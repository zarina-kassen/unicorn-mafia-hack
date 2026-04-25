"""Image-to-memory extraction for onboarding gallery seeds."""

from __future__ import annotations

import base64
import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from .schemas import MemorySeedEntry

logger = logging.getLogger(__name__)

VISION_MODEL = os.getenv("ONBOARDING_VISION_MODEL", "gpt-4.1-mini")
MAX_TAGS_PER_FIELD = 5


@dataclass(frozen=True)
class OnboardingImageInput:
    """Single user-selected onboarding image."""

    filename: str
    content_type: str
    data: bytes


def _trim_tags(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    clean: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        tag = item.strip().lower()
        if not tag or tag in clean:
            continue
        clean.append(tag[:40])
        if len(clean) >= MAX_TAGS_PER_FIELD:
            break
    return clean


def _safe_parse_entry(raw: dict[str, Any], source_ref: str) -> MemorySeedEntry | None:
    try:
        return MemorySeedEntry(
            source_ref=source_ref,
            pose_tags=_trim_tags(raw.get("pose_tags")),
            style_tags=_trim_tags(raw.get("style_tags")),
            composition_tags=_trim_tags(raw.get("composition_tags")),
            scene_tags=_trim_tags(raw.get("scene_tags")),
            confidence=float(raw.get("confidence", 0.7)),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to parse onboarding extraction JSON for %s", source_ref)
        return None


def _prompt_for(filename: str) -> str:
    return (
        "Analyze this selfie-style image and extract concise user taste signals. "
        "Return JSON only with keys: pose_tags, style_tags, composition_tags, scene_tags, confidence.\n"
        "- pose_tags: body pose cues like crossed_arms, profile, lean_in.\n"
        "- style_tags: vibe/aesthetic like minimal, candid, confident, moody.\n"
        "- composition_tags: framing choices like centered, close_crop, upper_body.\n"
        "- scene_tags: environment cues like indoor, mirror, window_light.\n"
        "- confidence: float 0..1.\n"
        "Keep each tag short snake_case and do not exceed 5 tags per list.\n"
        f"Source filename: {filename}"
    )


def _extract_single(client: OpenAI, image: OnboardingImageInput) -> MemorySeedEntry | None:
    b64 = base64.b64encode(image.data).decode("ascii")
    data_url = f"data:{image.content_type};base64,{b64}"
    try:
        response = client.responses.create(
            model=VISION_MODEL,
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": _prompt_for(image.filename)},
                        {"type": "input_image", "image_url": data_url},
                    ],
                }
            ],
            text={"format": {"type": "json_object"}},
        )
        text = (response.output_text or "").strip()
        if not text:
            return None
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            return None
        return _safe_parse_entry(parsed, source_ref=image.filename)
    except Exception:  # noqa: BLE001
        logger.exception("Onboarding extraction failed for %s", image.filename)
        return None


def extract_memory_seed_entries(images: list[OnboardingImageInput]) -> list[MemorySeedEntry]:
    """Convert uploaded onboarding images into memory seed entries.

    This function intentionally fails open: one bad image should not prevent all
    successful extractions from being remembered.
    """
    if not images:
        return []
    client = OpenAI()
    entries: list[MemorySeedEntry] = []
    for image in images:
        entry = _extract_single(client, image)
        if entry is None:
            continue
        entries.append(entry)
    return entries
