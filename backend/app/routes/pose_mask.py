"""Person-segmentation mask for pose guides (branch-5 style: image model → stored mask)."""

from __future__ import annotations

import base64
import binascii
import logging
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from openrouter import OpenRouter

from ..auth.clerk import require_auth
from ..config import settings
from ..dependencies import get_openrouter_client
from .pose_variants import (
    _assistant_image_url,
    _image_dimensions_from_bytes,
    _load_image_data_url_and_dimensions,
    _user_vision_message,
)
from ..schemas import PoseMaskRequest, PoseMaskResponse
from ..storage.database import store_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pose-mask", tags=["pose-mask"])

_MASK_PROMPT = (
    "Create a person segmentation matte from this image.\n"
    "Output exactly one mask image with these strict rules:\n"
    "- Main person silhouette must be solid white (#FFFFFF) only — no gray, no soft edges in the mask.\n"
    "- Background must be solid black (#000000), full frame — no checkerboard, no gradients, no shadows.\n"
    "- White may include ONLY the human: skin, hair, clothing, glasses, and small props they clearly hold. "
    "One primary selfie subject only.\n"
    "- Black must include ALL non-person pixels: walls, ceiling, beams, pipes, lights, windows, doors, "
    "furniture, floor, scenery. Do NOT trace ceiling grids, corrugated metal, shelves, or room edges in white.\n"
    "- No text, borders, labels, or extra shapes — exactly one white foreground blob on black.\n"
    "- Preserve the SAME subject pose, camera angle, framing, position, and scale from the source.\n"
    "- Do NOT re-center, re-pose, re-frame, or beautify the subject.\n"
    "- Pixel-align the white region to the real person only, not the room."
)


async def _bytes_from_image_url(url: str) -> tuple[bytes, str]:
    if url.startswith("data:image/"):
        header, separator, encoded = url.partition(",")
        if separator != "," or ";base64" not in header:
            raise RuntimeError("Invalid mask data URL")
        raw = base64.b64decode(encoded, validate=True)
        ctype = (
            header.removeprefix("data:").split(";", maxsplit=1)[0].strip()
            or "image/png"
        )
        return raw, ctype
    if url.startswith(("http://", "https://")):
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as http:
            response = await http.get(url)
            response.raise_for_status()
            raw = response.content
        ctype = response.headers.get("content-type", "image/png").split(";")[0].strip()
        if not ctype.startswith("image/"):
            ctype = "image/png"
        return raw, ctype
    raise RuntimeError("Mask model returned unsupported image URL")


async def _persist_mask_image(mask_ref: str) -> tuple[str, int, int]:
    raw, content_type = await _bytes_from_image_url(mask_ref)
    w, h = _image_dimensions_from_bytes(raw) or (1024, 1024)
    job_id = f"m{uuid4().hex[:11]}"
    filename = (
        f"{uuid4().hex[:10]}.png"
        if "png" in content_type
        else f"{uuid4().hex[:10]}.jpg"
    )
    stored = await store_image(job_id, filename, raw, content_type)
    return stored, w, h


@router.post("", response_model=PoseMaskResponse)
async def extract_pose_mask(
    req: PoseMaskRequest,
    _user_id: str = Depends(require_auth),
    client: OpenRouter = Depends(get_openrouter_client),
) -> PoseMaskResponse:
    """Generate a white-on-black person mask from a stored pose variant image."""
    try:
        data_url, _, _ = await _load_image_data_url_and_dimensions(req.image_url)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Pose mask: could not load source image")
        raise HTTPException(
            status_code=400, detail=f"Could not load source image: {exc}"
        ) from exc

    try:
        response = await client.chat.send_async(
            model=settings.resolved_mask_model,
            messages=[_user_vision_message(text=_MASK_PROMPT, image_data_url=data_url)],
            modalities=["image"],
            image_config={
                "aspect_ratio": "1:1",
                "image_size": settings.pose_variant_image_size,
            },
            stream=False,
        )
        mask_ref = _assistant_image_url(response)
        mask_url, width, height = await _persist_mask_image(mask_ref)
    except binascii.Error as exc:
        logger.exception("Pose mask: bad base64 from model")
        raise HTTPException(
            status_code=502, detail=f"mask extraction failed: {exc}"
        ) from exc
    except Exception as exc:
        logger.exception("Pose mask extraction failed")
        raise HTTPException(
            status_code=502, detail=f"mask extraction failed: {exc}"
        ) from exc

    return PoseMaskResponse(mask_url=mask_url, width=width, height=height, source="llm")
