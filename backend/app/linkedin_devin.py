"""Devin API client for LinkedIn image sequencing (with demo fallback)."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from dataclasses import dataclass

import httpx

from .linkedin_scoring import ScoredPhoto

logger = logging.getLogger(__name__)

_DEVIN_INVOKE_URL = os.environ.get(
    "DEVIN_INVOKE_URL",
    "https://api.devin.ai/v1/invoke",
).rstrip()
_DEVIN_KEY = os.environ.get("DEVIN_API_KEY", "").strip()

INSTRUCTION = (
    "You are a LinkedIn content strategist. Order these images for a LinkedIn post. "
    "The first image must be the strongest and most confidence-inspiring. Middle images should "
    "support the narrative. The final image should feel natural and approachable. "
    "Return the images in your recommended order with a one-line reason for each placement."
)


@dataclass(frozen=True)
class SequencedItem:
    photo_id: str
    reason: str
    order_index: int


def _demo_sequence(scored: list[ScoredPhoto]) -> list[SequencedItem]:
    items: list[SequencedItem] = []
    for i, s in enumerate(scored):
        if i == 0:
            r = "Strong opening with confidence and presence."
        elif i == len(scored) - 1:
            r = "Approachable, natural close."
        else:
            r = "Supports the narrative in the feed."
        items.append(SequencedItem(photo_id=s.photo_id, reason=r, order_index=i))
    return items


def _parse_array(text: str) -> list[tuple[str, str]] | None:
    text = text.strip()
    for m in re.finditer(r"(\[[\s\S]*\])", text):
        try:
            val = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if not isinstance(val, list) or not val:
            continue
        out: list[tuple[str, str]] = []
        for it in val:
            if not isinstance(it, dict):
                return None
            pid = it.get("photo_id") or it.get("id")
            if not isinstance(pid, str) or not pid:
                return None
            raw = it.get("reason")
            reason = str(raw) if raw is not None else "Fits the sequence."
            out.append((pid, reason[:200]))
        return out
    return None


async def sequence_for_linkedin(
    *,
    scored: list[ScoredPhoto],
    mubit_context: str,
    image_bytes_by_id: dict[str, bytes],
) -> list[SequencedItem]:
    """Return one row per input photo, ordered and with a short reason each."""
    if not scored:
        return []
    if not _DEVIN_KEY:
        return _demo_sequence(scored)

    by_id = {s.photo_id: s for s in scored}
    body = {
        "type": "linkedin_image_order",
        "instruction": INSTRUCTION,
        "mubit_context": mubit_context or "",
        "candidates": [
            {
                "photo_id": s.photo_id,
                "vision_average": round(s.average, 3),
                "image_base64": base64.standard_b64encode(
                    image_bytes_by_id.get(s.photo_id) or b""
                ).decode("ascii"),
            }
            for s in scored
        ],
    }
    headers = {
        "Authorization": f"Bearer {_DEVIN_KEY}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(120.0, connect=20.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(_DEVIN_INVOKE_URL, json=body, headers=headers)
        if res.status_code >= 400:
            logger.warning("Devin HTTP %s: %s", res.status_code, res.text[:300])
            return _demo_sequence(scored)
    except Exception:  # noqa: BLE001
        logger.exception("Devin call failed; using demo sequence")
        return _demo_sequence(scored)

    try:
        payload: object = res.json()
    except Exception:  # noqa: BLE001
        return _demo_sequence(scored)

    text: str
    if isinstance(payload, str):
        text = payload
    elif isinstance(payload, dict):
        text = str(
            payload.get("text")
            or payload.get("result")
            or payload.get("output")
            or json.dumps(payload)[:5000]
        )
    else:
        text = str(payload)

    arr = _parse_array(text) or _parse_array(
        (payload.get("content") if isinstance(payload, dict) else None) or ""
    )
    if not arr and isinstance(payload, dict):
        inner = payload.get("order")
        if isinstance(inner, list) and all(isinstance(x, str) for x in inner):
            arr = [
                (p, f"Placed {i + 1} per strategist.")
                for i, p in enumerate(inner)
                if p in by_id
            ]

    if not arr and isinstance(payload, dict):
        o = payload.get("ordered")
        if isinstance(o, list):
            tarr: list[tuple[str, str]] = []
            for i, oi in enumerate(o):
                if isinstance(oi, dict) and isinstance(oi.get("photo_id"), str):
                    tarr.append(
                        (
                            oi["photo_id"],
                            str(oi.get("reason") or f"Order slot {i + 1}"),
                        )
                    )
            if tarr:
                arr = tarr

    if not arr:
        return _demo_sequence(scored)

    seen: set[str] = set()
    items: list[SequencedItem] = []
    for i, (pid, reason) in enumerate(arr):
        if pid in by_id and pid not in seen:
            items.append(SequencedItem(photo_id=pid, reason=reason, order_index=i))
            seen.add(pid)
    for s in scored:
        if s.photo_id not in seen:
            items.append(
                SequencedItem(
                    photo_id=s.photo_id, reason="Fits the set.", order_index=len(items)
                )
            )
            seen.add(s.photo_id)
    return items[: len(scored)]
