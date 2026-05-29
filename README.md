# Stock Agents A2A

A multi-agent stock analysis pipeline built with the A2A (Agent-to-Agent) protocol and secured by [Tumeryk](https://tumeryk.com) Guard — an AI security layer that scores every message for jailbreaks, prompt injection, PII leakage, bias, and topic violations before it reaches an agent.

Every pipeline run, Guard decision, attack attempt, and trust score is recorded in Splunk Enterprise for real-time observability.

---

## What It Does

You give it a topic like "electric vehicles" or "AI chips". The pipeline automatically:

1. **Picks relevant stock tickers** using GPT (e.g. TSLA, NVDA, AAPL)
2. **Researches each ticker** — market sentiment, key factors, short-term outlook
3. **Makes investment decisions** — buy / hold / sell with confidence levels and reasoning

All agent communication passes through Tumeryk Guard, which scores and optionally blocks messages in real time. You can watch the trust scores, jailbreak scores, and latency for every call live in the UI and in Splunk.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Web UI (port 7860)                 │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────▼──────────────┐
          │      Stock Collector        │  GPT picks tickers from your topic
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │   Tumeryk Guard (proxy)     │  Scores & optionally blocks messages
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │   Research Analyst          │  A2A agent — port 9002
          │   (analyzes tickers)        │  GPT-powered market analysis
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │   Tumeryk Guard (proxy)     │  Scores & optionally blocks messages
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │   Decision Maker            │  A2A agent — port 9003
          │   (buy/hold/sell recs)      │  GPT-powered investment decisions
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │   Splunk HEC                │  Logs all events for dashboards
          └─────────────────────────────┘
```

---

## Project Structure

```
stock-agents-a2a/
│
├── research_analyst/
│   └── server.py          # A2A agent server — analyzes stock tickers (port 9002)
│
├── decision_maker/
│   └── server.py          # A2A agent server — makes buy/hold/sell decisions (port 9003)
│
├── stock_collector/
│   ├── client.py          # Core orchestration — collects tickers, calls agents, handles Guard metrics
│   ├── ui_server.py       # FastAPI web server — hosts the UI and exposes API endpoints (port 7860)
│   ├── splunk_logger.py   # Sends events to Splunk HEC (silent, non-blocking)
│   ├── index.html         # Main UI page
│   └── static/
│       ├── app.js         # Frontend logic — pipeline flow, rendering, attack simulator
│       └── style.css      # Styling with dark/light theme support
│
├── requirements.txt
└── .env                   # API keys and config (never committed)
```

---

## Key Features

**Pipeline**
- LLM-powered ticker selection from any topic or sector
- Two-stage A2A agent pipeline: research → decision
- Custom prompt support to guide the analysis

**Security (Tumeryk Guard)**
- Every message in and out of each agent is scored in real time
- Scores: trust score, jailbreak score, moderation score, bias score
- Messages can be blocked by Guard before reaching the agent
- Full metrics visible in the UI per pipeline stage

**Red Team Simulator**
Built into the UI — 5 predefined attack prompts to test Guard:
- Jailbreak
- Prompt Injection
- DAN Roleplay
- PII Extraction
- Combined Attack

**Observability (Splunk)**
Four event types logged to Splunk via HTTP Event Collector:

| Event | What it captures |
|---|---|
| `pipeline_run` | Topic and run ID for every pipeline execution |
| `guard_decision` | Trust score, jailbreak score, latency, blocked status — per agent per call |
| `attack_attempt` | Attack type, whether it was blocked, jailbreak score |
| `prompt_score` | Manual prompt scoring result |

---

## Setup

**1. Install dependencies**
```bash
pip install -r requirements.txt
```

**2. Create a `.env` file** in the project root:
```
OPENAI_API_KEY=your_openai_key
LLM_MODEL=gpt-4o-mini

TUMERYK_API_KEY=your_tumeryk_key
TUMERYK_BASE_URL=https://chat-azdev.tmryk.com

RESEARCH_ANALYST_A2A=https://chat-azdev.tmryk.com/v1/a2a/ResearchAnalyst
DECISION_MAKER_A2A=https://chat-azdev.tmryk.com/v1/a2a/DecisionMaker

SPLUNK_HEC_URL=https://localhost:8088
SPLUNK_HEC_TOKEN=your_hec_token
SPLUNK_INDEX=stock_agents
```

**3. Start the agent servers** (each in a separate terminal):
```bash
python research_analyst/server.py    # runs on port 9002
python decision_maker/server.py      # runs on port 9003
```

**4. Expose the agents publicly** so Tumeryk Guard can reach them (requires [localtunnel](https://theboroer.github.io/localtunnel-www/) or similar):
```bash
lt --port 9002   # copy the URL → set as RESEARCH_ANALYST_A2A in Tumeryk
lt --port 9003   # copy the URL → set as DECISION_MAKER_A2A in Tumeryk
```

**5. Start the UI server**:
```bash
python stock_collector/ui_server.py
```

Open `http://localhost:7860` in your browser.

---

## How Tumeryk Guard Works

Tumeryk Guard sits as a proxy in front of each A2A agent. When the pipeline sends a message to an agent, Guard intercepts it, runs it through its security models, and either:

- **Passes it through** — attaches a signed trust credential (JWT) with scores to the response metadata
- **Blocks it** — returns a `guardrail_blocked: true` response with the reason and flat metrics

The UI displays the guard card for each stage showing exactly what Guard scored and whether it blocked anything.

---

## Built With

- [A2A SDK](https://github.com/google-a2a/a2a-python) — Agent-to-Agent communication protocol
- [FastAPI](https://fastapi.tiangolo.com) — Web framework for the UI server and agent servers
- [OpenAI API](https://platform.openai.com) — LLM for ticker selection, analysis, and decisions
- [Tumeryk Guard](https://tumeryk.com) — AI security and guardrails proxy
- [Splunk Enterprise](https://www.splunk.com) — Observability and dashboarding
- [httpx](https://www.python-httpx.org) — Async HTTP client
