"""Health check route."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/")
def root() -> RedirectResponse:
    """Redirect root to /health so probes and bots get a 200."""
    return RedirectResponse(url="/health", status_code=307)
