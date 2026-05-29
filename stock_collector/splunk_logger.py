from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

_logger = logging.getLogger("splunk_logger")

_HEC_URL = os.getenv("SPLUNK_HEC_URL", "https://localhost:8088")
_HEC_TOKEN = os.getenv("SPLUNK_HEC_TOKEN", "")
_INDEX = os.getenv("SPLUNK_INDEX", "stock_agents")


def log_event(sourcetype: str, fields: dict) -> None:
    if not _HEC_TOKEN:
        return
    payload = {
        "time": time.time(),
        "source": "stock-agents-pipeline",
        "sourcetype": sourcetype,
        "index": _INDEX,
        "event": fields,
    }
    try:
        with httpx.Client(verify=False, timeout=3.0) as client:
            resp = client.post(
                f"{_HEC_URL}/services/collector/event",
                headers={
                    "Authorization": f"Splunk {_HEC_TOKEN}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if resp.status_code != 200:
                _logger.debug(f"Splunk HEC returned {resp.status_code}: {resp.text}")
    except Exception as exc:
        _logger.debug(f"Splunk logging failed (non-fatal): {exc}")
