"""Routes for pose variant generation."""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import cast
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openai import AsyncOpenAI
from pydantic_ai import Agent

from .agents import PoseAgentDeps as AgentDeps, get_pose_generation_agent
from .auth.clerk import require_auth
from .config import settings
from .dependencies import get_openai_client
from .schemas import OpenRouterImage, PoseTargetSpec, PoseVariantResult
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

    # Handle both data URLs and raw base64 strings
    if b64_or_url.startswith("data:"):
        raw_b64 = b64_or_url.split(",", 1)[1]
    else:
        raw_b64 = b64_or_url

    binary = base64.b64decode(raw_b64)
    filename = f"{uuid4().hex[:8]}.png"
    return await store_image(job_id, filename, binary, "image/png")


async def _generate_and_store_image(
    target: PoseTargetSpec,
    slot_index: int,
    client: AsyncOpenAI,
    job_id: str,
    reference_image_data_url: str,
) -> PoseVariantResult | None:
    """Generate and store an image for a single target."""
    target_id = f"target-{uuid4().hex[:8]}-{slot_index + 1:02d}"

    prompt = _make_variation_prompt(
        target.title, target.instruction, target.rationale, slot_index
    )

    try:
        # Use OpenRouter chat completions for image generation with reference image
        message_content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": reference_image_data_url}},
        ]
        response = await client.chat.completions.create(
            model=settings.image_model,
            messages=cast(list, [{"role": "user", "content": message_content}]),
        )

        # Extract image from response - OpenRouter returns images in message.images
        message = response.choices[0].message
        if response.choices and hasattr(message, "images") and message.images:  # type: ignore[attr-defined]
            images_data = message.images  # type: ignore[attr-defined]
            if images_data:
                try:
                    # Validate response structure using Pydantic model
                    first_image = OpenRouterImage.model_validate(images_data[0])
                    image_data_url = first_image.image_url.url
                except Exception as exc:
                    logger.warning("Image generation failed for slot %d: Invalid image format: %s", slot_index, exc)
                    return None

                if image_data_url:
                    image_url = await _store_base64_image(image_data_url, job_id)
                else:
                    logger.warning("Image generation failed for slot %d: No image URL in response", slot_index)
                    return None
            else:
                logger.warning("Image generation failed for slot %d: Empty images array", slot_index)
                return None
        else:
            logger.warning("Image generation failed for slot %d: No images in response", slot_index)
            return None
    except Exception as exc:
        logger.warning("Image generation failed for slot %d: %s", slot_index, exc)
        return None

    return PoseVariantResult(
        id=target_id,
        slot_index=slot_index,
        title=target.title,
        instruction=target.instruction,
        image_url=image_url,
        target_id=target_id,
        target_landmarks=target.approximate_landmarks,
        replaceable=True,
        tier="standard",
        model=settings.image_model,
    )


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
    target_specs = target_specs_result.output

    # Generate images in parallel
    job_id = uuid4().hex[:8]
    tasks = [
        _generate_and_store_image(
            target, slot_index, client, job_id, reference_image_data_url
        )
        for slot_index, target in enumerate(target_specs)
    ]
    processed_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out failed results and exceptions
    results: list[PoseVariantResult] = []
    for result in processed_results:
        if isinstance(result, Exception):
            logger.warning("Error processing target: %s", result)
        elif isinstance(result, PoseVariantResult):
            results.append(result)

    return results
