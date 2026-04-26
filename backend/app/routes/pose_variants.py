"""Routes for pose variant generation (SSE: image + outline per item)."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import random
import struct
from collections.abc import AsyncIterator
from urllib.parse import unquote, urlsplit
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openrouter import OpenRouter, components
from openrouter.types import UNSET
from pydantic import BaseModel, Field
from pydantic_ai import Agent

from ..agents import PoseAgentDeps as AgentDeps, get_pose_generation_agent
from ..auth.clerk import require_auth
from ..config import settings
from ..dependencies import get_openrouter_client
from ..image_resize import downscale_to_jpeg
from ..pose_variant_templates import TEMPLATE_POSE_POOL
from ..schemas import (
    PoseOutlinePoint,
    PoseOutlineResponse,
    PoseStreamItem,
    PoseTargetSpec,
    PoseVariantResult,
)
from ..storage.database import get_image, store_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pose-variants", tags=["pose-variants"])

POSE_VARIANT_TOTAL = 6
POSE_VARIANT_TEMPLATE_SLOTS = 2
POSE_VARIANT_AGENT_SLOTS = 4


def _agent_specs_with_fallbacks(
    agent_specs: list[PoseTargetSpec],
    k: int,
    *,
    exclude_titles: frozenset[str],
) -> list[PoseTargetSpec]:
    """Ensure exactly k specs for agent slots; pad from template pool if the model returns too few."""
    out = list(agent_specs)[:k]
    if len(out) >= k:
        return out
    used = {s.title for s in out} | set(exclude_titles)
    for tmpl in TEMPLATE_POSE_POOL:
        if tmpl.title in used:
            continue
        out.append(tmpl.model_copy(deep=True))
        used.add(tmpl.title)
        if len(out) >= k:
            return out
    while len(out) < k:
        fallback = out[-1] if out else TEMPLATE_POSE_POOL[0]
        out.append(fallback.model_copy(deep=True))
    return out[:k]


POSE_OUTLINE_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "polygon": {
            "type": "array",
            "minItems": 16,
            "maxItems": 28,
            "items": {
                "type": "object",
                "properties": {
                    "x": {"type": "number", "minimum": 0, "maximum": 1},
                    "y": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["x", "y"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["polygon"],
    "additionalProperties": False,
}


class _LLMPolygonPayload(BaseModel):
    """Body returned by the vision model (image dimensions are added server-side)."""

    polygon: list[PoseOutlinePoint] = Field(min_length=16, max_length=28)


def _sse_frame(event: str, payload: dict) -> str:
    """One Server-Sent Events message (UTF-8 text)."""
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


def _downscale_data_url_for_vision(data_url: str) -> str:
    """Smaller image for outline LLM (faster upload + inference)."""
    if not data_url.startswith("data:image/") or ";base64" not in data_url:
        return data_url
    header, separator, encoded = data_url.partition(",")
    if separator != ",":
        return data_url
    try:
        raw = base64.b64decode(encoded, validate=True)
    except binascii.Error:
        return data_url
    out_bytes, _ = downscale_to_jpeg(
        raw,
        max_edge_px=settings.pose_outline_vision_max_edge_px,
        jpeg_quality=settings.pose_jpeg_quality,
        fallback_content_type="image/jpeg",
    )
    return f"data:image/jpeg;base64,{base64.b64encode(out_bytes).decode('ascii')}"


def _outline_prompt_text() -> str:
    return (
        "Look at this photo. Output ONE closed polygon that outlines ONLY the main human "
        "subject in a loose, hand-drawn chalk-line style — a thick stroke around the person, "
        "NOT room geometry.\n"
        "Rules:\n"
        "- The loop must hug the person (head, hair, shoulders, torso, arms as visible). "
        "Never follow walls, ceiling beams, corrugated panels, pipes, lights, windows, shelves, "
        "or any background edges — those must stay OUTSIDE the polygon.\n"
        "- If several people appear, choose the primary selfie subject (usually largest / most central).\n"
        "- Use between 18 and 26 vertices (stay within the allowed range).\n"
        "- x and y are normalized to the full image: 0=left/top, 1=right/bottom.\n"
        "- Order vertices consistently around the silhouette (clockwise).\n"
        "- Leave a modest margin outside the body and clothes (slightly puffy outline).\n"
        "- Include clearly held objects (diploma, bouquet, phone, etc.) inside the loop.\n"
        "- Do NOT add text, labels, or separate shapes — one outer loop only.\n"
        "- Do NOT repeat the first point at the end.\n"
        "- Match the subject's pose, scale, and framing in this image (no re-posing)."
    )


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


def _assistant_image_url(result: components.ChatResult) -> str:
    """First generated image URL from an OpenRouter SDK chat completion."""
    if not result.choices:
        raise RuntimeError("No choices in chat completion response")
    message = result.choices[0].message
    images = message.images
    if not images:
        raise RuntimeError("No images in assistant message")
    url = images[0].image_url.url.strip()
    if not url:
        raise RuntimeError("Empty image URL in assistant message")
    return url


def _assistant_text_content(message: components.ChatAssistantMessage) -> str:
    """Plain text (JSON) from an assistant message."""
    raw = message.content
    if raw is None or raw is UNSET:
        raise RuntimeError("No text content in assistant message")
    if isinstance(raw, str):
        text = raw.strip()
        if text:
            return text
        raise RuntimeError("Empty assistant text content")
    if isinstance(raw, list):
        parts: list[str] = []
        for item in raw:
            if isinstance(item, components.ChatContentText):
                parts.append(item.text or "")
            elif isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        text = "".join(parts).strip()
        if text:
            return text
    raise RuntimeError("Could not extract text from assistant message")


def _user_vision_message(
    *, text: str, image_data_url: str
) -> components.ChatUserMessage:
    """Build a multimodal user message for vision + image generation."""
    return components.ChatUserMessage(
        role="user",
        content=[
            components.ChatContentText(type="text", text=text),
            components.ChatContentImage(
                type="image_url",
                image_url=components.ChatContentImageImageURL(url=image_data_url),
            ),
        ],
    )


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
    image_bytes, _ = downscale_to_jpeg(
        image_bytes,
        max_edge_px=settings.pose_stored_image_max_edge_px,
        jpeg_quality=settings.pose_jpeg_quality,
        fallback_content_type=content_type,
    )
    filename = f"{uuid4().hex[:8]}.jpg"
    return await store_image(job_id, filename, image_bytes, "image/jpeg")


async def _generate_and_store_image(
    target: PoseTargetSpec,
    slot_index: int,
    client: OpenRouter,
    job_id: str,
    reference_image_data_url: str,
) -> PoseVariantResult | None:
    """Generate and store an image for a single target."""
    target_id = f"target-{uuid4().hex[:8]}-{slot_index + 1:02d}"

    prompt = _make_variation_prompt(
        target.title, target.instruction, target.rationale, slot_index
    )

    try:
        response = await client.chat.send_async(
            model=settings.fast_image_model,
            messages=[
                _user_vision_message(
                    text=prompt, image_data_url=reference_image_data_url
                )
            ],
            modalities=["image"],
            image_config={
                "aspect_ratio": "1:1",
                "image_size": settings.pose_variant_image_size,
            },
            stream=False,
        )
        try:
            generated_image_url = _assistant_image_url(response)
        except RuntimeError:
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
        model=settings.fast_image_model,
    )


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


async def _load_image_data_url_and_dimensions(image_url: str) -> tuple[str, int, int]:
    """Resolve image_url to a data URL and pixel dimensions."""
    stored_image_ref = _parse_stored_image_url(image_url)
    if stored_image_ref is not None:
        job_id, filename = stored_image_ref
        image = await get_image(job_id, filename)
        if image is None:
            raise HTTPException(status_code=404, detail="Image not found")

        data, content_type = image
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Stored file is not an image")

        w, h = _image_dimensions_from_bytes(data) or (1024, 1024)
        encoded = base64.b64encode(data).decode("ascii")
        return f"data:{content_type};base64,{encoded}", w, h

    parsed = urlsplit(image_url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as http:
                response = await http.get(image_url)
                response.raise_for_status()
                data = response.content
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail=f"Could not download image: {exc}"
            ) from exc
        ctype = response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if not ctype.startswith("image/"):
            ctype = "image/jpeg"
        w, h = _image_dimensions_from_bytes(data) or (1024, 1024)
        encoded = base64.b64encode(data).decode("ascii")
        return f"data:{ctype};base64,{encoded}", w, h

    raise HTTPException(status_code=400, detail="Unsupported image URL")


async def _try_load_image_data_url_and_dimensions(
    image_url: str,
) -> tuple[str, int, int] | None:
    try:
        return await _load_image_data_url_and_dimensions(image_url)
    except HTTPException:
        logger.warning("Outline: could not load image bytes for %s", image_url[:80])
        return None


async def _extract_pose_outline_from_data_url(
    data_url: str,
    width: int,
    height: int,
    client: OpenRouter,
) -> PoseOutlineResponse:
    vision_url = _downscale_data_url_for_vision(data_url)
    response = await client.chat.send_async(
        model=settings.resolved_pose_guide_model,
        messages=[
            _user_vision_message(text=_outline_prompt_text(), image_data_url=vision_url)
        ],
        response_format=components.ChatFormatJSONSchemaConfig(
            type="json_schema",
            json_schema=components.ChatJSONSchemaConfig(
                name="pose_outline",
                description="Loose silhouette polygon for pose overlay",
                schema=POSE_OUTLINE_JSON_SCHEMA,
                strict=True,
            ),
        ),
        max_tokens=settings.pose_guide_max_tokens,
        stream=False,
    )
    if not response.choices:
        raise RuntimeError("empty outline response")

    text = _assistant_text_content(response.choices[0].message)
    payload = json.loads(text)
    parsed = _LLMPolygonPayload.model_validate(payload)
    return PoseOutlineResponse(
        polygon=parsed.polygon,
        width=width,
        height=height,
        source="openrouter-pose-outline",
        model=settings.resolved_pose_guide_model,
    )


async def _generate_variant_with_outline(
    target: PoseTargetSpec,
    slot_index: int,
    client: OpenRouter,
    job_id: str,
    reference_image_data_url: str,
) -> tuple[str, dict]:
    """Run image gen + outline; return (event_name, payload dict)."""
    try:
        variant = await _generate_and_store_image(
            target, slot_index, client, job_id, reference_image_data_url
        )
        if variant is None:
            return (
                "pose_error",
                {"slot_index": slot_index, "message": "Image generation failed"},
            )
        loaded = await _try_load_image_data_url_and_dimensions(variant.image_url)
        if loaded is None:
            return (
                "pose_error",
                {
                    "slot_index": slot_index,
                    "message": "Could not load generated image for outline",
                },
            )
        data_url, w, h = loaded
        try:
            outline = await _extract_pose_outline_from_data_url(data_url, w, h, client)
        except Exception as exc:
            logger.exception("Outline failed for slot %d", slot_index)
            return (
                "pose_error",
                {"slot_index": slot_index, "message": f"Pose outline failed: {exc}"},
            )
        item = PoseStreamItem(pose=variant, outline=outline)
        return ("pose", item.model_dump(mode="json"))
    except Exception as exc:
        logger.exception("Slot %d failed", slot_index)
        return (
            "pose_error",
            {"slot_index": slot_index, "message": str(exc)},
        )


@router.post("")
async def create_pose_variants(
    reference_image: UploadFile = File(...),
    _user_id: str = Depends(require_auth),
    agent: Agent[AgentDeps, list[PoseTargetSpec]] = Depends(get_pose_generation_agent),
    client: OpenRouter = Depends(get_openrouter_client),
) -> StreamingResponse:
    """Stream pose variants as each image + outline completes (SSE)."""
    mime = reference_image.content_type or ""
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    image_bytes = await reference_image.read()
    image_bytes, mime = downscale_to_jpeg(
        image_bytes,
        max_edge_px=settings.pose_reference_max_edge_px,
        jpeg_quality=settings.pose_jpeg_quality,
        fallback_content_type=mime or "image/jpeg",
    )
    mime = "image/jpeg"
    reference_image_data_url = (
        f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    )

    async def event_stream() -> AsyncIterator[str]:
        # Open the stream immediately so clients/proxies see bytes before slow work.
        # (SSE comment — no `data:` line; parsers that only care about events ignore it.)
        yield ": sse-open\n\n"
        yield _sse_frame("phase", {"step": "planning"})
        job_id = uuid4().hex[:8]
        yield _sse_frame("target_count", {"count": POSE_VARIANT_TOTAL})
        yield _sse_frame("phase", {"step": "generating", "count": POSE_VARIANT_TOTAL})

        template_specs = random.sample(
            list(TEMPLATE_POSE_POOL),
            k=POSE_VARIANT_TEMPLATE_SLOTS,
        )
        exclude_titles = frozenset(t.title for t in template_specs)
        early_tasks = [
            asyncio.create_task(
                _generate_variant_with_outline(
                    template_specs[i],
                    i,
                    client,
                    job_id,
                    reference_image_data_url,
                )
            )
            for i in range(POSE_VARIANT_TEMPLATE_SLOTS)
        ]

        deps = AgentDeps()
        target_specs_result = await agent.run(
            f"Generate exactly {POSE_VARIANT_AGENT_SLOTS} diverse, flattering pose targets "
            f"for portrait photography from the reference image. "
            f"Vary body angle, arms, and head position; make them distinct from "
            f"generic studio clichés. Reference image: {reference_image_data_url[:100]}...",
            deps=deps,
        )
        raw_agent = target_specs_result.output
        agent_specs = _agent_specs_with_fallbacks(
            raw_agent,
            POSE_VARIANT_AGENT_SLOTS,
            exclude_titles=exclude_titles,
        )
        late_tasks = [
            asyncio.create_task(
                _generate_variant_with_outline(
                    agent_specs[j],
                    POSE_VARIANT_TEMPLATE_SLOTS + j,
                    client,
                    job_id,
                    reference_image_data_url,
                )
            )
            for j in range(POSE_VARIANT_AGENT_SLOTS)
        ]
        tasks = early_tasks + late_tasks
        success_count = 0
        for finished in asyncio.as_completed(tasks):
            event_name, payload = await finished
            yield _sse_frame(event_name, payload)
            if event_name == "pose":
                success_count += 1
            # Tiny yield so intermediaries can flush SSE without adding much latency.
            await asyncio.sleep(0.004)
        if success_count == 0:
            yield _sse_frame("error", {"message": "Image generation failed"})
        yield _sse_frame("done", {"count": success_count})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
