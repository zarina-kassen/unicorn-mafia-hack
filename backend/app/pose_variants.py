"""Routes for pose variant generation."""

from __future__ import annotations

import base64
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openai import AsyncOpenAI
from pydantic_ai import Agent

from .agent import AgentDeps, get_pose_generation_agent
from .auth.clerk import require_auth
from .config import settings
from .dependencies import get_openai_client
from .schemas import PoseTargetSpec, PoseVariantResult
from .storage.database import store_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pose-variants", tags=["pose-variants"])

POSE_VARIANT_TOTAL = 6


def _make_variation_prompt(
    title: str, instruction: str, rationale: str, slot_index: int
) -> str:
    """Create a prompt for image generation."""
    return (
        "Generate a realistic selfie-style portrait of the same person from the reference photo.\n"
        "Preserve face identity, skin tone, hair, and overall likeness from the reference.\n"
        "Do not stylize as cartoon/illustration; avoid blur, artifacts, and distorted anatomy.\n"
        f"Pose: {title}. Instruction: {instruction}.\n"
        f"Rationale: {rationale}.\n"
        f"Variation seed: {slot_index + 1}.\n"
        "Framing: upper body, portrait orientation, social-media ready, natural expression."
    )


async def _store_base64_image(b64_or_url: str, job_id: str) -> str:
    """Store a base64 image or return URL if already a URL."""
    if b64_or_url.startswith("http://") or b64_or_url.startswith("https://"):
        return b64_or_url

    raw_b64 = (
        b64_or_url.split(",", 1)[1] if b64_or_url.startswith("data:") else b64_or_url
    )
    binary = base64.b64decode(raw_b64)
    filename = f"{uuid4().hex[:8]}.png"
    return await store_image(job_id, filename, binary, "image/png")


@router.post("", response_model=list[PoseVariantResult])
async def create_pose_variants(
    reference_image: UploadFile = File(...),
    user_id: str = Depends(require_auth),
    agent: Agent[AgentDeps, list[PoseTargetSpec]] = Depends(get_pose_generation_agent),
    client: AsyncOpenAI = Depends(get_openai_client),
) -> list[PoseVariantResult]:
    """Generate dynamic pose targets using AI agent - returns all results at once."""
    # Validate that the upload is an image
    mime = reference_image.content_type or ""
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    image_bytes = await reference_image.read()
    reference_image_data_url = (
        f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    )

    # Generate dynamic pose targets using the agent
    deps = AgentDeps()
    target_specs_result = await agent.run(
        f"Generate {POSE_VARIANT_TOTAL} pose targets for the reference image. Reference image: {reference_image_data_url[:100]}...",
        deps=deps,
    )
    target_specs = target_specs_result.data

    # Generate all images synchronously
    results: list[PoseVariantResult] = []
    job_id = uuid4().hex[:8]

    for slot_index, target in enumerate(target_specs):
        target_id = f"target-{uuid4().hex[:8]}-{slot_index + 1:02d}"

        prompt = _make_variation_prompt(
            target.title, target.instruction, target.rationale, slot_index
        )
        model = settings.fast_image_model

        try:
            message_content = [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": reference_image_data_url}},
            ]
            response = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": message_content}],
            )

            if response.choices and response.choices[0].message.content:
                content = response.choices[0].message.content
                if isinstance(content, str):
                    image_url = await _store_base64_image(content, job_id)
                else:
                    continue
            else:
                continue
        except Exception as exc:
            logger.warning("Image generation failed for slot %d: %s", slot_index, exc)
            continue

        result = PoseVariantResult(
            id=target_id,
            slot_index=slot_index,
            title=target.title,
            instruction=target.instruction,
            image_url=image_url,
            target_id=target_id,
            target_landmarks=target.approximate_landmarks,
            replaceable=True,
            tier="fast",
            model=model,
        )
        results.append(result)

    return results
