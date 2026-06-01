from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import uuid

import sys
sys.path.insert(0, str(Path(__file__).parent))
from client import collect_tickers, call_agent, ATTACK_PROMPTS, score_prompt, parse_tickers
from splunk_logger import log_event

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
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.middleware("http")
async def request_log_middleware(request: Request, call_next):
    _t0 = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - _t0) * 1000)
    # only log API calls, not static assets or the root page
    if request.url.path.startswith("/api/"):
        log_event("request_log", {
            "method": request.method,
            "endpoint": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        })
    return response


class RunRequest(BaseModel):
    topic: str
    custom_prompt: str | None = None

class RunDecisionRequest(BaseModel):
    analysis: str

class AttackRequest(BaseModel):
    attack_name: str


@app.get("/", response_class=HTMLResponse)
async def root():
    html = (Path(__file__).parent / "index.html").read_text()
    return HTMLResponse(html)

@app.post("/api/run-research")
async def run_research(body: RunRequest):
    if not body.topic.strip():
        return JSONResponse({"error": "No topic provided"}, status_code=400)

    run_id = uuid.uuid4().hex[:8]
    _t0 = time.time()

    try:
        tickers = await collect_tickers(app.state.llm, app.state.model, body.topic, body.custom_prompt)

        analysis, research_metrics, research_card = await call_agent(
            app.state.http_client, GUARD_URL, "ResearchAnalyst", tickers
        )

        if not analysis or not analysis.strip():
            analysis = "No analysis returned."

        log_event("pipeline_run", {
            "topic": body.topic,
            "run_id": run_id,
            "status": "success",
            "duration_ms": round((time.time() - _t0) * 1000),
            "ticker_count": len(parse_tickers(tickers)),
        })

        return {
            "tickers": tickers,
            "parsed_tickers": parse_tickers(tickers),
            "analysis": analysis,
            "research_metrics": research_metrics,
            "research_card": research_card,
        }

    except Exception as exc:
        logger.error(f"Pipeline error: {exc}")
        log_event("pipeline_run", {
            "topic": body.topic,
            "run_id": run_id,
            "status": "error",
            "duration_ms": round((time.time() - _t0) * 1000),
        })
        log_event("app_error", {
            "endpoint": "/api/run-research",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        })
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/run-decision")
async def run_decision(body: RunDecisionRequest):
    try:
        recommendations, decision_metrics, decision_card = await call_agent(
            app.state.http_client, GUARD_URL, "DecisionMaker", body.analysis
        )

        return {
            "recommendations": recommendations,
            "decision_metrics": decision_metrics,
            "decision_card": decision_card,
        }

    except Exception as exc:
        logger.error(f"Pipeline error: {exc}")
        log_event("app_error", {
            "endpoint": "/api/run-decision",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        })
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/attack")
async def run_attack(body: AttackRequest):
    attack_prompt = ATTACK_PROMPTS.get(body.attack_name)
    if not attack_prompt:
        return JSONResponse({"error": f"Unknown attack: {body.attack_name}"}, status_code=400)

    try:
        analysis, research_metrics, _ = await call_agent(
            app.state.http_client, GUARD_URL, "ResearchAnalyst", attack_prompt
        )

        log_event("attack_attempt", {
            "attack_type": body.attack_name,
            "blocked": research_metrics.get("violation", False),
            "block_reason": research_metrics.get("block_reason"),
            "jailbreak_score": research_metrics.get("jailbreak_score"),
        })

        return {
            "attack_name": body.attack_name,
            "attack_prompt": attack_prompt,
            "analysis": analysis,
            "research_metrics": research_metrics,
        }

    except Exception as exc:
        logger.error(f"Attack pipeline error: {exc}")
        log_event("app_error", {
            "endpoint": "/api/attack",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "attack_type": body.attack_name,
        })
        return JSONResponse({"error": str(exc)}, status_code=500)

@app.post("/api/score-prompt")
async def score_prompt_endpoint(body: RunRequest):
    if not body.custom_prompt or not body.custom_prompt.strip():
        return JSONResponse({"error": "No prompt provided"}, status_code=400)

    try:
        metrics = await score_prompt(
            app.state.http_client, GUARD_URL, body.custom_prompt
        )
        log_event("prompt_score", {
            "trust_score": metrics.get("trust_score"),
            "violation": metrics.get("violation", False),
            "prompt_length": len(body.custom_prompt),
        })

        return {
            "metrics": metrics,
            "blocked": metrics.get("violation", False),
            "trust_score": metrics.get("trust_score", 0),
        }

    except Exception as exc:
        logger.error(f"Score prompt error: {exc}")
        log_event("app_error", {
            "endpoint": "/api/score-prompt",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        })
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