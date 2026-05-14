from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from openai import AsyncOpenAI

from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.types import Message, Part, Role, Task, TextPart

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
logger = logging.getLogger("stock_collector")

STOCK_COLLECTOR_PROMPT = """\
You are a stock market researcher. Given a topic or sector, identify 3 relevant
stock tickers to analyze. Return ONLY a comma separated list of tickers.
Example: AAPL, TSLA, NVDA
"""


async def collect_tickers(llm: AsyncOpenAI, model: str, topic: str) -> str:
    """Ask the LLM to identify relevant tickers for a given topic."""
    response = await llm.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": STOCK_COLLECTOR_PROMPT},
            {"role": "user", "content": topic},
        ],
        temperature=0.3,
    )
    tickers = response.choices[0].message.content or ""
    logger.info(f"Collected tickers: {tickers}")
    return tickers.strip()

async def call_agent(http_client: httpx.AsyncClient, guard_base_url: str, role: str, message_text: str) -> str:
    resolver = A2ACardResolver(httpx_client=http_client, base_url=guard_base_url)

    try:
        card = await resolver.get_agent_card(
            http_kwargs={"params": {"role": role}},
        )
    except Exception as exc:
        logger.error(f"Failed to discover agent role={role}: {exc}")
        return f"Error discovering agent: {exc}"

    a2a_client = ClientFactory(
        ClientConfig(httpx_client=http_client, streaming=False)
    ).create(card)

    message = Message(
        role=Role.user,
        parts=[Part(root=TextPart(text=message_text))],
        message_id=uuid.uuid4().hex[:12],
        context_id=uuid.uuid4().hex,
    )

    try:
        async for event in a2a_client.send_message(message):
            result = event[0] if isinstance(event, tuple) else event
            break
    except Exception as exc:
        logger.error(f"Failed to call agent: {exc}")
        return f"Error calling agent: {exc}"

    if isinstance(result, Task):
        texts = []
        if result.artifacts:
            for artifact in result.artifacts:
                for part in artifact.parts:
                    root = getattr(part, "root", part)
                    if hasattr(root, "text"):
                        texts.append(root.text)
        return "\n".join(texts) if texts else "No response received"

    return str(result)

async def main():
    openai_key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    tumeryk_api_key = os.getenv("TUMERYK_API_KEY", "")
    research_analyst_url = os.getenv("RESEARCH_ANALYST_A2A", "")
    decision_maker_url = os.getenv("DECISION_MAKER_A2A", "")

    missing = [k for k, v in {
        "OPENAI_API_KEY": openai_key,
        "TUMERYK_API_KEY": tumeryk_api_key,
        "RESEARCH_ANALYST_A2A": research_analyst_url,
        "DECISION_MAKER_A2A": decision_maker_url,
    }.items() if not v]

    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        return

    llm = AsyncOpenAI(api_key=openai_key)
    auth_headers = {"Authorization": f"Bearer {tumeryk_api_key}"}

    topic = input("Enter a stock topic or sector: ").strip()
    if not topic:
        print("No topic entered.")
        return

    print("\n--- Step 1: Collecting tickers ---")
    tickers = await collect_tickers(llm, model, topic)
    print(f"Tickers: {tickers}")

    async with httpx.AsyncClient(timeout=120.0, headers=auth_headers) as http_client:
        print("\n--- Step 2: Research Analyst ---")
        analysis = await call_agent(http_client, "https://chat-azdev.tmryk.com", "ResearchAnalyst", tickers)
        print(f"Analysis:\n{analysis}")

        print("\n--- Step 3: Decision Maker ---")
        recommendations = await call_agent(http_client, "https://chat-azdev.tmryk.com", "DecisionMaker", analysis)
        print(f"Recommendations:\n{recommendations}")


if __name__ == "__main__":
    asyncio.run(main())
