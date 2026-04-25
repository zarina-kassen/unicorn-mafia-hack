"""Memory management routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..auth.clerk import require_auth
from ..memory_onboarding import OnboardingImageInput, extract_memory_seed_entries
from ..mubit_memory import get_mubit_memory
from ..schemas import (
    MemoryPreferencesRequest,
    MemoryResetRequest,
    MemoryStatusResponse,
)

logger = logging.getLogger(__name__)
MAX_ONBOARDING_IMAGES = 5
MAX_ONBOARDING_IMAGE_BYTES = 8 * 1024 * 1024

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.post("/onboarding/images", response_model=MemoryStatusResponse)
async def seed_memory_onboarding_images(
    images: list[UploadFile] = File(...),
    allow_camera_roll: bool = Form(default=True),
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    if not images:
        raise HTTPException(status_code=400, detail="at least one image is required")
    if len(images) > MAX_ONBOARDING_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"too many images (max {MAX_ONBOARDING_IMAGES})",
        )

    prepared: list[OnboardingImageInput] = []
    for upload in images:
        content_type = (upload.content_type or "").lower().strip()
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(
                status_code=400,
                detail="only JPEG, PNG, and WebP images are supported",
            )
        raw = await upload.read()
        if len(raw) > MAX_ONBOARDING_IMAGE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"image too large: {upload.filename or 'unknown'}",
            )
        prepared.append(
            OnboardingImageInput(
                filename=(upload.filename or "upload").strip()[:120],
                content_type=content_type,
                data=raw,
            )
        )

    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)

    memory.remember_preferences(
        user_id=user_id,
        allow_camera_roll=allow_camera_roll,
        allow_instagram=False,
        allow_pinterest=False,
    )
    entries = extract_memory_seed_entries(prepared)
    if not entries:
        logger.warning("No onboarding entries extracted for user=%s", user_id)
        return MemoryStatusResponse(ok=False)
    memory.remember_onboarding_seed(
        user_id=user_id,
        entries=[entry.model_dump() for entry in entries],
    )
    logger.info(
        "Onboarding seed stored for user=%s selected=%d extracted=%d",
        user_id,
        len(prepared),
        len(entries),
    )
    return MemoryStatusResponse(ok=True)


@router.post("/preferences", response_model=MemoryStatusResponse)
def set_memory_preferences(
    payload: MemoryPreferencesRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.remember_preferences(
        user_id=user_id,
        allow_camera_roll=payload.allow_camera_roll,
        allow_instagram=payload.allow_instagram,
        allow_pinterest=payload.allow_pinterest,
    )
    return MemoryStatusResponse(ok=True)


@router.post("/reset", response_model=MemoryStatusResponse)
def reset_memory_profile(
    payload: MemoryResetRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.reset_user_memory(user_id=user_id, hard_reset=payload.hard_reset)
    return MemoryStatusResponse(ok=True)
