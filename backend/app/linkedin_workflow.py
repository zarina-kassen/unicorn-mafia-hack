"""Run LinkedIn vision rank + Devin sequence (used by /api/linkedin/pipeline)."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

from .linkedin_devin import sequence_for_linkedin
from .linkedin_scoring import ScoredPhoto, rank_and_trim, score_image
from .linkedin_store import SavedPhotoRow, get_saved_photo, insert_saved_photo
from .mubit_memory import get_mubit_memory

logger = logging.getLogger(__name__)


def save_uploaded_photos(
    *,
    clerk_user_id: str,
    base_dir: Path,
    metas: list[dict[str, Any]],
    image_blobs: list[bytes],
    content_types: list[str],
) -> list[SavedPhotoRow]:
    base_dir.mkdir(parents=True, exist_ok=True)
    rows: list[SavedPhotoRow] = []
    for i, raw in enumerate(image_blobs):
        meta = metas[i] if i < len(metas) else {}
        pose_name = str(meta.get("pose_name") or "Unknown pose")
        confidence = float(meta.get("confidence") or 0.0)
        occasion = str(meta.get("occasion_type") or "general")
        ext = ".jpg"
        content_type = (
            content_types[i] if i < len(content_types) else "image/jpeg"
        ) or "image/jpeg"
        if "png" in content_type:
            ext = ".png"
        elif "webp" in content_type:
            ext = ".webp"
        photo_id = uuid.uuid4().hex
        relpath = f"linkedin/{clerk_user_id}/{photo_id}{ext}"
        out = base_dir / relpath
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(raw)
        extra = {
            "captured_at": meta.get("captured_at"),
            "client_id": meta.get("client_id"),
        }
        insert_saved_photo(
            clerk_user_id=clerk_user_id,
            pose_name=pose_name,
            confidence=confidence,
            occasion_type=occasion,
            image_relpath=relpath,
            content_type=content_type,
            extra=extra,
            photo_id=photo_id,
        )
        row = get_saved_photo(clerk_user_id, photo_id)
        if row:
            rows.append(row)
    return rows


async def run_pipeline(
    *,
    user_id: str,
    base_dir: Path,
    photos: list[SavedPhotoRow],
) -> dict[str, Any]:
    mubit = get_mubit_memory()
    mubit_ctx = ""
    if mubit:
        mubit_ctx = mubit.recall_linkedin_sequencing_context(user_id=user_id)

    image_bytes: dict[str, bytes] = {}
    scored: list[ScoredPhoto] = []
    for p in photos:
        path = base_dir / p.image_relpath
        if not path.is_file():
            logger.warning("Missing image %s", path)
            continue
        data = path.read_bytes()
        image_bytes[p.id] = data
        sc = await score_image(data, p.content_type or "image/jpeg", p.id)
        scored.append(sc)

    top = rank_and_trim(scored, 6)
    top_bytes = {
        k: image_bytes[k] for k in image_bytes if k in {x.photo_id for x in top}
    }
    sequence = await sequence_for_linkedin(
        scored=top, mubit_context=mubit_ctx, image_bytes_by_id=top_bytes
    )

    return {
        "mubit_context": mubit_ctx,
        "scored_all": scored,
        "top_six": top,
        "sequence": sequence,
    }
