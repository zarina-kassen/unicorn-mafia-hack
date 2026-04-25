"""Provider abstraction so the underlying AI model can be swapped.

The frontend never depends on which provider is active. The backend picks the
implementation at startup based on the ``AI_PROVIDER`` environment variable:

- ``mock`` (default): deterministic, no network or API key needed.
- ``openai``: Pydantic-AI agent backed by OpenAI (``gpt-4o-mini`` by default).
"""

from __future__ import annotations

import logging
import os
from typing import Protocol

from ..schemas import GuidanceResponse, PoseContext

logger = logging.getLogger(__name__)


class GuidanceAgent(Protocol):
    """Protocol for any guidance agent implementation."""

    provider_name: str

    async def guide(self, ctx: PoseContext) -> GuidanceResponse: ...


def get_agent() -> GuidanceAgent:
    provider = os.environ.get("AI_PROVIDER", "mock").lower()

    if provider == "openai":
        try:
            from .pydantic_ai_agent import PydanticAIAgent

            return PydanticAIAgent()
        except Exception as exc:  # noqa: BLE001 - we want a broad fallback
            logger.warning(
                "Falling back to MockAgent because PydanticAIAgent failed to initialize: %s",
                exc,
            )

    from .mock import MockAgent

    return MockAgent()
