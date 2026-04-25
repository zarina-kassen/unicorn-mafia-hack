"""Routes for pose variant generation and mask extraction."""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import struct
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion
from pydantic_ai import Agent

from ..agents import PoseAgentDeps as AgentDeps, get_pose_generation_agent
from ..auth.clerk import require_auth
from ..config import settings
from ..dependencies import get_openai_client
from ..schemas import (
    OpenRouterChatResponse,
    PoseMaskRequest,
    PoseMaskResponse,
    PoseTargetSpec,
    PoseVariantResult,
)
from ..storage.database import get_image, store_image

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


def _extract_generated_image_url(response: ChatCompletion) -> str | None:
    parsed = OpenRouterChatResponse.model_validate(response.model_dump())
    if not parsed.choices:
        return None

    images = parsed.choices[0].message.images
    if not images:
        return None

    image_url = images[0].image_url.url.strip()
    if not image_url:
        return None
    return image_url


async def _store_generated_image(
    job_id: str, image_url: str, slot_index: int
) -> str | None:
    if not image_url.startswith("data:image/"):
        if image_url.startswith(("http://", "https://")):
            return image_url
        logger.warning(
            "Image generation failed for slot %d: invalid image URL", slot_index
        )
        return None

    header, separator, encoded = image_url.partition(",")
    if separator != "," or ";base64" not in header:
        logger.warning(
            "Image generation failed for slot %d: invalid data URL", slot_index
        )
        return None

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except binascii.Error:
        logger.warning(
            "Image generation failed for slot %d: invalid base64", slot_index
        )
        return None

    content_type = header.removeprefix("data:").split(";", maxsplit=1)[0]
    filename = f"{uuid4().hex[:8]}.png"
    return await store_image(job_id, filename, image_bytes, content_type)


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
        response = await client.chat.completions.create(
            model=settings.image_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": reference_image_data_url},
                        },
                    ],
                }
            ],
            extra_body={
                "modalities": ["image"],
                "image_config": {"aspect_ratio": "1:1", "image_size": "1K"},
            },
        )

        generated_image_url = _extract_generated_image_url(response)
        if generated_image_url is None:
            logger.warning(
                "Image generation failed for slot %d: no images in response",
                slot_index,
            )
            return None
        image_url = await _store_generated_image(
            job_id, generated_image_url, slot_index
        )
        if image_url is None:
            return None
    except Exception as exc:
        logger.exception("Image generation failed for slot %d: %s", slot_index, exc)
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

    if not results:
        raise HTTPException(status_code=502, detail="Image generation failed")

    return results


# Mask extraction helpers


def _image_dimensions_from_bytes(data: bytes) -> tuple[int, int] | None:
    """Extract width/height from PNG or JPEG bytes."""
    if len(data) < 24:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data.startswith(b"\xff\xd8"):
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC9, 0xCA, 0xCB}:
                h = struct.unpack(">H", data[i + 5 : i + 7])[0]
                w = struct.unpack(">H", data[i + 7 : i + 9])[0]
                return w, h
            if i + 4 >= len(data):
                break
            block = struct.unpack(">H", data[i + 2 : i + 4])[0]
            i += 2 + block
    return None


async def _store_mask_image(b64_or_url: str) -> tuple[str, int, int]:
    """Store mask image and return URL with dimensions."""
    if b64_or_url.startswith(("http://", "https://")):
        return b64_or_url, 1024, 1536
    raw_b64 = (
        b64_or_url.split(",", 1)[1] if b64_or_url.startswith("data:") else b64_or_url
    )
    binary = base64.b64decode(raw_b64)
    dims = _image_dimensions_from_bytes(binary) or (1024, 1536)
    filename = f"{uuid4().hex[:8]}.png"
    content_type = "image/png"
    url = await store_image("mask", filename, binary, content_type)
    return url, dims[0], dims[1]


def _parse_stored_image_url(image_url: str) -> tuple[str, str] | None:
    """Extract storage identifiers from an app image URL."""
    parsed = urlsplit(image_url)
    path = parsed.path if parsed.scheme else image_url
    parts = [unquote(part) for part in path.strip("/").split("/")]
    if len(parts) != 4 or parts[:2] != ["api", "images"]:
        return None
    job_id, filename = parts[2], parts[3]
    if not job_id or not filename:
        return None
    return job_id, filename


async def _convert_image_to_model_input(image_url: str) -> str:
    """Resolve an image URL into provider-readable image input."""
    stored_image_ref = _parse_stored_image_url(image_url)
    if stored_image_ref is not None:
        job_id, filename = stored_image_ref
        image = await get_image(job_id, filename)
        if image is None:
            raise HTTPException(status_code=404, detail="Image not found")

        data, content_type = image
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Stored file is not an image")

        encoded = base64.b64encode(data).decode("ascii")
        return f"data:{content_type};base64,{encoded}"

    parsed = urlsplit(image_url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return image_url

    raise HTTPException(status_code=400, detail="Unsupported image URL")


async def _extract_mask_from_llm_response(body: dict) -> tuple[str, int, int]:
    """Extract mask image URL from various OpenRouter response structures."""
    # Try data array
    data = body.get("data") or []
    if data:
        first = data[0]
        if isinstance(first.get("b64_json"), str):
            return await _store_mask_image(first["b64_json"])
        if isinstance(first.get("url"), str):
            return await _store_mask_image(first["url"])

    # Try images array
    images = body.get("images") or []
    if images:
        first = images[0]
        if isinstance(first.get("b64_json"), str):
            return await _store_mask_image(first["b64_json"])
        if isinstance(first.get("image_url"), str):
            return await _store_mask_image(first["image_url"])
        if isinstance(first.get("url"), str):
            return await _store_mask_image(first["url"])

    # Try choices -> message -> images
    choices = body.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        message_images = message.get("images") or []
        if message_images:
            first = message_images[0]
            if isinstance(first.get("b64_json"), str):
                return await _store_mask_image(first["b64_json"])
            if isinstance(first.get("image_url"), str):
                return await _store_mask_image(first["image_url"])

        # Try content array
        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                image_data = part.get("image_url")
                if isinstance(image_data, dict):
                    if isinstance(image_data.get("b64_json"), str):
                        return await _store_mask_image(image_data["b64_json"])
                    if isinstance(image_data.get("url"), str):
                        return await _store_mask_image(image_data["url"])

    raise RuntimeError("No image data found in LLM response")


@router.post("/mask", response_model=PoseMaskResponse)
async def extract_pose_mask(
    req: PoseMaskRequest,
    _auth: str = Depends(require_auth),
    client: AsyncOpenAI = Depends(get_openai_client),
) -> PoseMaskResponse:
    """Extract a person mask from an image using LLM vision."""
    model_input = await _convert_image_to_model_input(req.image_url)
    prompt = (
        "Create a person segmentation matte from this image.\n"
        "Output exactly one mask image with these strict rules:\n"
        "- Main person silhouette must be solid white (#FFFFFF)\n"
        "- Background must be solid black (#000000), no checkerboard pattern\n"
        "- No text, no borders, no shadows, no gradients, no background remnants\n"
        "- Preserve the SAME subject pose, camera angle, framing, position, and scale from source\n"
        "- Do NOT re-center, re-pose, re-frame, or beautify the subject\n"
        "- Output must be pixel-aligned to the original subject silhouette"
    )

    try:
        response = await client.chat.completions.create(
            model=settings.image_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": model_input}},
                    ],
                }
            ],
            extra_body={
                "modalities": ["image"],
                "image_config": {"aspect_ratio": "1:1", "image_size": "1K"},
            },
        )
    except Exception as exc:
        logger.exception("LLM mask extraction request failed")
        raise HTTPException(
            status_code=502, detail=f"Mask extraction failed: {exc}"
        ) from exc

    try:
        body = response.model_dump()
    except Exception as exc:
        logger.exception("Failed to parse LLM response")
        raise HTTPException(status_code=502, detail="Invalid LLM response") from exc

    try:
        mask_url, width, height = await _extract_mask_from_llm_response(body)
    except Exception as exc:
        logger.exception("Failed to extract mask from LLM response")
        raise HTTPException(
            status_code=502, detail=f"Mask extraction failed: {exc}"
        ) from exc

    return PoseMaskResponse(mask_url=mask_url, width=width, height=height, source="llm")
