"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import asyncio
import logging

from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .auth.clerk import require_auth
from .config import settings
from .memory_onboarding import OnboardingImageInput, extract_memory_seed_entries
from .mubit_memory import get_mubit_memory
from .pose_variants import router as pose_variants_router
from .schemas import (
    MemoryPreferencesRequest,
    MemoryResetRequest,
    MemoryStatusResponse,
)
from .storage.database import get_image, init_db, start_cleanup_task

load_dotenv(override=True)

logger = logging.getLogger(__name__)
MAX_ONBOARDING_IMAGES = 5
MAX_ONBOARDING_IMAGE_BYTES = 8 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan: DB init and cleanup task."""
    # Startup
    await init_db()
    cleanup_task = asyncio.create_task(start_cleanup_task())
    yield
    # Shutdown
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="frame-mog", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(pose_variants_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/images/{job_id}/{filename}")
async def get_generated_image(job_id: str, filename: str) -> Response:
    """Serve a generated image from the database."""
    image_data = await get_image(job_id, filename)
    if image_data:
        data, content_type = image_data
        return Response(content=data, media_type=content_type)
    else:
        raise HTTPException(status_code=404, detail="Image not found")


@app.post("/api/memory/onboarding/images", response_model=MemoryStatusResponse)
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


@app.post("/api/memory/preferences", response_model=MemoryStatusResponse)
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


@app.post("/api/memory/reset", response_model=MemoryStatusResponse)
def reset_memory_profile(
    payload: MemoryResetRequest,
    user_id: str = Depends(require_auth),
) -> MemoryStatusResponse:
    memory = get_mubit_memory()
    if not memory:
        return MemoryStatusResponse(ok=False)
    memory.reset_user_memory(user_id=user_id, hard_reset=payload.hard_reset)
    return MemoryStatusResponse(ok=True)
