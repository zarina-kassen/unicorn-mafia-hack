"""Pose generation agent using Pydantic AI."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from pydantic_ai import Agent, ModelSettings
from pydantic_ai.models.openai import OpenAIChatModel

from ..config import settings
from ..schemas import PoseTarget, PoseTargetSpec


@dataclass
class PoseAgentDeps:
    """Dependencies for the pose generation agent."""

    active_target: PoseTarget | None = None
    available_targets: list[PoseTarget] | None = None


@lru_cache
def get_pose_generation_agent() -> Agent[PoseAgentDeps, list[PoseTargetSpec]]:
    """Get the pose generation agent instance.

    This agent generates diverse, flattering pose targets for portrait photography
    based on a reference image using OpenRouter's OpenAI-compatible API.

    Returns:
        A cached Agent instance configured for pose generation.
    """
    # Set environment variables for OpenRouter compatibility
    import os

    os.environ["OPENAI_API_KEY"] = settings.openrouter_api_key
    os.environ["OPENAI_BASE_URL"] = settings.openrouter_base_url

    # OpenAI-compatible client → OpenRouter; model slug is any OpenRouter id (not necessarily openai/*).
    model = OpenAIChatModel(settings.agent_model, provider="openai")
    model_settings: ModelSettings = {"max_tokens": settings.agent_max_tokens}
    return Agent[PoseAgentDeps, list[PoseTargetSpec]](
        model=model,
        deps_type=PoseAgentDeps,
        output_type=list[PoseTargetSpec],
        model_settings=model_settings,
        retries=3,
        system_prompt="You are a pose generation expert. Generate diverse, flattering pose targets for portrait photography based on a reference image.",
    )
