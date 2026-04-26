"""OpenRouter vision scoring for LinkedIn image selection (top 6).

Uses the same OpenRouter stack as mask extraction in ``main.py``.
When ``OPENROUTER_API_KEY`` is unset, falls back to deterministic local scores.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
_OPENROUTER_BASE_URL = os.environ.get(
    "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
).rstrip("/")
# Vision-capable chat model on OpenRouter (not the image-edit flux models).
_SCORE_MODEL = os.environ.get(
    "LINKEDIN_SCORE_MODEL",
    os.environ.get("OPENROUTER_VISION_MODEL", "openai/gpt-4o-mini"),
)


class FourDimensionScore(BaseModel):
    composition: float = Field(ge=0.0, le=10.0)
    pose_quality: float = Field(ge=0.0, le=10.0, alias="poseQuality")
    lighting: float = Field(ge=0.0, le=10.0)
    expression: float = Field(ge=0.0, le=10.0)

    model_config = {"populate_by_name": True}

    @property
    def average(self) -> float:
        return (
            self.composition + self.pose_quality + self.lighting + self.expression
        ) / 4.0


@dataclass(frozen=True)
class ScoredPhoto:
    photo_id: str
    dimensions: FourDimensionScore
    average: float


def _stable_demo_dimensions(image_bytes: bytes) -> FourDimensionScore:
    h = hashlib.sha256(image_bytes).digest()

    def grab(i: int) -> float:
        v = h[i] / 255.0
        return max(0.0, min(10.0, 4.0 + v * 6.0))

    return FourDimensionScore.model_validate(
        {
            "composition": grab(0),
            "poseQuality": grab(1),
            "lighting": grab(2),
            "expression": grab(3),
        }
    )


def _coerce_score(value: object, default: float = 5.0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return default
    return default


def _parse_json_object(text: str) -> dict[str, object] | None:
    text = text.strip()
    m = re.search(r"\{[\s\S]*\}\s*$", text)
    if not m:
        return None
    try:
        val = json.loads(m.group(0))
        return val if isinstance(val, dict) else None
    except json.JSONDecodeError:
        return None


def _message_text_from_openrouter(body: dict[str, Any]) -> str:
    choices = body.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text" and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return " ".join(parts)
    return ""


async def score_image(
    image_bytes: bytes, media_type: str, photo_id: str
) -> ScoredPhoto:
    """Return four-dimension score and average for a single image."""
    if not _OPENROUTER_API_KEY:
        dims = _stable_demo_dimensions(image_bytes)
        return ScoredPhoto(photo_id=photo_id, dimensions=dims, average=dims.average)

    mime = media_type if media_type.startswith("image/") else "image/jpeg"
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    prompt = (
        "Score this portrait for a professional LinkedIn post. "
        "Output ONLY valid JSON, no markdown, with keys exactly: "
        "composition, poseQuality, lighting, expression — each a "
        "number from 0 to 10 (decimals allowed)."
    )
    payload: dict[str, Any] = {
        "model": _SCORE_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }
    headers = {
        "Authorization": f"Bearer {_OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(60.0, connect=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                f"{_OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            )
        if res.status_code >= 400:
            logger.warning(
                "OpenRouter vision failed for %s (%s): %s",
                photo_id,
                res.status_code,
                res.text[:300],
            )
            dims = _stable_demo_dimensions(image_bytes)
            return ScoredPhoto(photo_id=photo_id, dimensions=dims, average=dims.average)
        body = res.json()
    except Exception:  # noqa: BLE001
        logger.exception(
            "OpenRouter vision request failed for %s; using demo score", photo_id
        )
        dims = _stable_demo_dimensions(image_bytes)
        return ScoredPhoto(photo_id=photo_id, dimensions=dims, average=dims.average)

    text = _message_text_from_openrouter(body)
    obj = _parse_json_object(text)
    if not obj:
        logger.warning("Could not parse vision JSON for %s: %s", photo_id, text[:200])
        dims = _stable_demo_dimensions(image_bytes)
        return ScoredPhoto(photo_id=photo_id, dimensions=dims, average=dims.average)

    try:
        raw = {
            k: obj.get(k)
            for k in ("composition", "poseQuality", "lighting", "expression")
        }
        dims = FourDimensionScore.model_validate(
            {
                "composition": _coerce_score(raw.get("composition"), 5.0),
                "poseQuality": _coerce_score(raw.get("poseQuality"), 5.0),
                "lighting": _coerce_score(raw.get("lighting"), 5.0),
                "expression": _coerce_score(raw.get("expression"), 5.0),
            }
        )
    except Exception:  # noqa: BLE001
        logger.warning("Invalid vision numbers for %s: %s", photo_id, obj)
        dims = _stable_demo_dimensions(image_bytes)
        return ScoredPhoto(photo_id=photo_id, dimensions=dims, average=dims.average)

    return ScoredPhoto(photo_id=photo_id, dimensions=dims, average=dims.average)


def rank_and_trim(scored: list[ScoredPhoto], limit: int = 6) -> list[ScoredPhoto]:
    ranked = sorted(scored, key=lambda s: s.average, reverse=True)
    return ranked[: min(limit, len(ranked))]
