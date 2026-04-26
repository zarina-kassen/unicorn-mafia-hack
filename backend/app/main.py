"""FastAPI entrypoint for the frame-mog backend."""

from __future__ import annotations

import asyncio
import logging

from contextlib import asynccontextmanager

import logfire
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings, validate_config
from .routes import (
    health_router,
    images_router,
    memory_router,
    pose_mask_router,
    pose_variants_router,
)
from .storage.database import init_db, start_cleanup_task

load_dotenv(override=True)

logfire.configure(service_name="frame-mog")
logfire.instrument_pydantic_ai()
logfire.instrument_asyncpg()
logfire.instrument_httpx()

logging.basicConfig(
    handlers=[logfire.LogfireLoggingHandler()],
    level=logging.INFO,
    force=True,
)
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

logfire.instrument_fastapi(app, excluded_urls="health")

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
app.include_router(pose_mask_router)
app.include_router(pose_variants_router)
