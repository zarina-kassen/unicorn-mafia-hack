"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings, validate_config
from .linkedin_store import init_linkedin_store
from .routes import (
    health_router,
    images_router,
    linkedin_router,
    memory_router,
    pose_mask_router,
    pose_variants_router,
)
from .storage.database import init_db, start_cleanup_task

load_dotenv(override=True)

logger = logging.getLogger(__name__)

_GENERATED_DIR = Path(__file__).resolve().parent.parent / "generated"
# Starlette StaticFiles requires this path to exist when the app is built (import
# time). Lifespan runs later, so a fresh clone / CI without `generated/` would
# raise RuntimeError on import of this module.
_GENERATED_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan: DB init, local dirs, and cleanup task."""
    validate_config()
    await init_db()
    _GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    init_linkedin_store()
    cleanup_task = asyncio.create_task(start_cleanup_task())
    yield
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

app.mount(
    "/generated",
    StaticFiles(directory=str(_GENERATED_DIR)),
    name="generated",
)

# Include routers
app.include_router(health_router)
app.include_router(images_router)
app.include_router(linkedin_router)
app.include_router(memory_router)
app.include_router(pose_mask_router)
app.include_router(pose_variants_router)
