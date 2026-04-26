"""FastAPI dependencies for dependency injection."""

from __future__ import annotations

from functools import lru_cache

from openrouter import OpenRouter

from .config import settings


@lru_cache
def get_openrouter_client() -> OpenRouter:
    """Get cached OpenRouter SDK client."""
    return OpenRouter(
        api_key=settings.openrouter_api_key,
        server_url=settings.openrouter_base_url,
    )
