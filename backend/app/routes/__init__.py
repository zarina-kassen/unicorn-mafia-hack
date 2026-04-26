"""Routes module."""

from __future__ import annotations

from .health import router as health_router
from .images import router as images_router
from .memory import router as memory_router
from .pose_variants import router as pose_variants_router

__all__ = [
    "health_router",
    "images_router",
    "memory_router",
    "pose_variants_router",
]
