"""Pydantic-AI powered guidance agent.

Uses :class:`pydantic_ai.Agent` with ``output_type=GuidanceResponse`` so the
model is forced to return a schema-valid object. The default model is
``openai:gpt-4o-mini`` because it is fast, cheap, and reliable at structured
outputs. Change ``AGENT_MODEL`` to swap in any other Pydantic-AI-supported
model (e.g. ``openai:gpt-4o``, ``groq:llama-3.3-70b-versatile``).
"""

from __future__ import annotations

import os

from pydantic_ai import Agent

from ..schemas import GuidanceResponse, Landmark, PoseContext
from ..templates import TEMPLATES

AGENT_MODEL = os.environ.get("AGENT_MODEL", "openai:gpt-4o-mini")

SYSTEM_PROMPT = """\
You are a real-time photo posing coach embedded in a web camera app. Every
request represents one pose sample taken roughly once per second. You receive
a small set of 2D body landmarks plus the template the client's local matcher
already picked.

You must respond with a GuidanceResponse. Rules:
- recommended_template_id MUST be one of the provided ids.
- guidance MUST be short (<=120 characters), friendly, and actionable.
- If key landmarks are missing or visibility is low, set person_visible=false.
- Set pose_aligned=true only if the user is clearly already in the template.
- Set suggest_different=true if a different template fits the scene better
  than the client's candidate.
- reason must be one short sentence explaining your decision.
"""


def _summarize_landmarks(lm: list[Landmark]) -> str:
    if not lm:
        return "no landmarks"
    # Summarise only the joints relevant to the coarse decision to keep the
    # prompt short and deterministic.
    important = {
        11: "L-shoulder",
        12: "R-shoulder",
        13: "L-elbow",
        14: "R-elbow",
        15: "L-wrist",
        16: "R-wrist",
        23: "L-hip",
        24: "R-hip",
        25: "L-knee",
        26: "R-knee",
        27: "L-ankle",
        28: "R-ankle",
    }
    parts: list[str] = []
    for idx, name in important.items():
        if idx < len(lm):
            p = lm[idx]
            parts.append(f"{name}=({p.x:.2f},{p.y:.2f},v={p.visibility:.2f})")
    return "; ".join(parts)


def _render_prompt(ctx: PoseContext) -> str:
    tmpl_lines = "\n".join(
        f"- {t.id} ({t.posture}): {t.description}" for t in TEMPLATES
    )
    return (
        "Available pose templates:\n"
        f"{tmpl_lines}\n\n"
        f"Client candidate: {ctx.candidate_template_id}\n"
        f"Client confidence: {ctx.local_confidence:.2f}\n"
        f"Image size: {ctx.image_wh[0]}x{ctx.image_wh[1]}\n"
        f"Landmark summary: {_summarize_landmarks(ctx.landmarks)}\n\n"
        "Return a GuidanceResponse that tells the user what to do next."
    )


class PydanticAIAgent:
    """Thin wrapper around :class:`pydantic_ai.Agent`.

    The :class:`GuidanceResponse` output type guarantees that a malformed
    model reply will raise, which the route layer catches and falls back to
    the mock agent.
    """

    provider_name = "pydantic-ai"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or AGENT_MODEL
        self._agent: Agent[None, GuidanceResponse] = Agent(
            self.model,
            output_type=GuidanceResponse,
            system_prompt=SYSTEM_PROMPT,
        )

    async def guide(self, ctx: PoseContext) -> GuidanceResponse:
        result = await self._agent.run(_render_prompt(ctx))
        return result.output
