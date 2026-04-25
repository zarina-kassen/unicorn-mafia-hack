"""Pydantic AI agent for dynamic pose target generation."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel

from .config import settings
from .schemas import PoseTarget, PoseTargetSpec


@dataclass
class AgentDeps:
    """Dependencies for the pose agent."""

    active_target: PoseTarget | None = None
    available_targets: list[PoseTarget] | None = None


@lru_cache
def get_pose_generation_agent() -> Agent[AgentDeps, list[PoseTargetSpec]]:
    """FastAPI dependency for the pose generation agent."""
    model = OpenAIModel(
        settings.agent_model,
        base_url=settings.openrouter_base_url,
        api_key=settings.openrouter_api_key,
    )
    return Agent[AgentDeps, list[PoseTargetSpec]](
        "You are a pose generation expert. Generate diverse, flattering pose targets for portrait photography based on a reference image.",
        model=model,
        deps_type=AgentDeps,
    )
