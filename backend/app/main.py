"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import asyncio
import logging

from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings, validate_config
from .routes import (
    health_router,
    images_router,
    memory_router,
    pose_variants_router,
)
from .storage.database import init_db, start_cleanup_task

load_dotenv(override=True)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan: DB init and cleanup task."""
    # Startup
    validate_config()
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
app.include_router(health_router)
app.include_router(images_router)
app.include_router(memory_router)
app.include_router(pose_variants_router)
