from __future__ import annotations

import json
import logging
import os
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

import sys
sys.path.insert(0, str(Path(__file__).parent))
from client import collect_tickers, call_agent, STOCK_COLLECTOR_PROMPT

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
logger = logging.getLogger("ui_server")

GUARD_URL = "https://chat-azdev.tmryk.com"
TUMERYK_API_KEY = os.getenv("TUMERYK_API_KEY", "")
UI_PORT = int(os.getenv("UI_PORT", "7860"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        timeout=120.0,
        headers={"Authorization": f"Bearer {TUMERYK_API_KEY}"},
    )
    from openai import AsyncOpenAI
    app.state.llm = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
    app.state.model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    yield
    await app.state.http_client.aclose()


app = FastAPI(lifespan=lifespan)


class RunRequest(BaseModel):
    topic: str


@app.get("/", response_class=HTMLResponse)
async def root():
    html = (Path(__file__).parent / "index.html").read_text()
    return HTMLResponse(html)


@app.post("/api/run")
async def run_pipeline(body: RunRequest):
    if not body.topic.strip():
        return JSONResponse({"error": "No topic provided"}, status_code=400)

    try:
        tickers = await collect_tickers(app.state.llm, app.state.model, body.topic)

        analysis, research_metrics = await call_agent(
            app.state.http_client, GUARD_URL, "ResearchAnalyst", tickers
        )

        recommendations, decision_metrics = await call_agent(
            app.state.http_client, GUARD_URL, "DecisionMaker", analysis
        )

        return {
            "tickers": tickers,
            "analysis": analysis,
            "research_metrics": research_metrics,
            "recommendations": recommendations,
            "decision_metrics": decision_metrics,
        }

    except Exception as exc:
        logger.error(f"Pipeline error: {exc}")
        return JSONResponse({"error": str(exc)}, status_code=500)




if __name__ == "__main__":
    if not TUMERYK_API_KEY:
        print("Missing TUMERYK_API_KEY in .env")
        exit(1)
    print(f"\n{'='*50}")
    print("  Stock Agents UI")
    print(f"  http://0.0.0.0:{UI_PORT}/")
    print(f"{'='*50}\n")
    uvicorn.run(app, host="0.0.0.0", port=UI_PORT, log_level="warning")