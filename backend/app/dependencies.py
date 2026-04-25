"""FastAPI dependencies for dependency injection."""

from __future__ import annotations

from functools import lru_cache

from openai import AsyncOpenAI

from .config import settings


@lru_cache
def get_openai_client() -> AsyncOpenAI:
    """Get cached OpenAI client for OpenRouter."""
    return AsyncOpenAI(
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
    )
