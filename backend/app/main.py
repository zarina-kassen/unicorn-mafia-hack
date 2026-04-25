"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import asyncio
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agents import get_agent
from .agents.mock import MockAgent
from .schemas import GuidanceResponse, PoseContext, TemplateMeta
from .templates import TEMPLATES

logger = logging.getLogger(__name__)

app = FastAPI(title="frame-mog")

_allowed_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_agent = get_agent()
_fallback = MockAgent()

# The agent call has its own guardrail so a slow or failing provider never
# blocks the live frontend experience.
_AGENT_TIMEOUT_S = float(os.environ.get("AGENT_TIMEOUT_S", "4.0"))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": _agent.provider_name}


@app.get("/api/templates", response_model=list[TemplateMeta])
def list_templates() -> list[TemplateMeta]:
    return TEMPLATES


@app.post("/api/guidance", response_model=GuidanceResponse)
async def guidance(ctx: PoseContext) -> GuidanceResponse:
    try:
        return await asyncio.wait_for(_agent.guide(ctx), timeout=_AGENT_TIMEOUT_S)
    except asyncio.TimeoutError:
        logger.warning("Guidance agent timed out; falling back to MockAgent.")
    except Exception:  # noqa: BLE001 - any provider error should fall back
        logger.exception("Guidance agent raised; falling back to MockAgent.")
    return await _fallback.guide(ctx)
