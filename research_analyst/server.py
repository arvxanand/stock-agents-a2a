from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from openai import AsyncOpenAI

from a2a.server.apps import A2AStarletteApplication
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Part,
    TaskState,
    TextPart,
)
from a2a.utils import new_agent_text_message, new_task

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
logger = logging.getLogger("research_analyst")

RESEARCH_ANALYST_PROMPT = """\
You are a research analyst specializing in stock analysis.
Given a list of stock tickers, provide a brief analysis for each one covering:
- Current market sentiment
- Key factors affecting the stock
- Short-term outlook (bullish/bearish/neutral)

Be concise. One paragraph per ticker.
"""

class ResearchAnalystExecutor(AgentExecutor):
    def __init__(self, llm: AsyncOpenAI, model: str):
        self.llm = llm 
        self.model = model
    
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        user_text = context.get_user_input()
        task = context.current_task

        if not task:
            if context.message is not None:
                task = new_task(context.message)
                await event_queue.enqueue_event(task)
            else:
                logger.error("No Current task and no message provided. Cannot proceed")
                return
        
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        await updater.update_status(
            TaskState.working,
            new_agent_text_message(
                "Analyzing tickers...",
                task.context_id, task.id,
            ),
        )

        try:
            response = await self.llm.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": RESEARCH_ANALYST_PROMPT},
                    {"role": "user", "content": user_text},
                ],
                temperature=0.3,
            )
            response_text = response.choices[0].message.content or ""

            await updater.add_artifact(
                [Part(root=TextPart(text=response_text))],
                name="analysis",
            )
            await updater.complete()

        except Exception as exc:
            logger.error(f"Research Analyst failed: {exc}")
            await updater.update_status(
                TaskState.failed,
                new_agent_text_message(str(exc), task.context_id, task.id),
                final=True,
            )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        pass
    
    
def build_app(host: str, port: int, llm: AsyncOpenAI, model: str):
    capabilities = AgentCapabilities(streaming=False, push_notifications=False)
    skill = AgentSkill(
        id="analyze-stocks",
        name="Analyze Stocks",
        description="Receives stock tickers and returns research analysis for each one.",
        tags=["stocks", "research", "analysis"],
        examples=["Analyze AAPL, TSLA, NVDA"],
    )
    agent_card = AgentCard(
        name="Research Analyst",
        description="Analyzes stock tickers and provides market research.",
        url=f"http://{host}:{port}/",
        version="1.0.0",
        default_input_modes=["text", "text/plain"],
        default_output_modes=["text", "text/plain"],
        capabilities=capabilities,
        skills=[skill],
    )

    executor = ResearchAnalystExecutor(llm, model)
    handler = DefaultRequestHandler(
        agent_executor=executor,
        task_store=InMemoryTaskStore(),
    )
    server = A2AStarletteApplication(agent_card=agent_card, http_handler=handler)
    return server.build()

def main():
    parser = argparse.ArgumentParser(description="Research Analyst A2A Server")
    parser.add_argument("--host", default=os.getenv("RESEARCH_ANALYST_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("RESEARCH_ANALYST_PORT", "9002")))
    args = parser.parse_args()

    openai_key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")

    if not openai_key:
        print("Missing OPENAI_API_KEY in .env")
        sys.exit(1)

    llm = AsyncOpenAI(api_key=openai_key)
    app = build_app(args.host, args.port, llm, model)

    print(f"Research Analyst running on http://{args.host}:{args.port}/")

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()