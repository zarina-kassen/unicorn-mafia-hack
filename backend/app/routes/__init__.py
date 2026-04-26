"""Routes module."""

from __future__ import annotations

from .health import router as health_router
from .images import router as images_router
from .linkedin import router as linkedin_router
from .memory import router as memory_router
from .pose_mask import router as pose_mask_router
from .pose_variants import router as pose_variants_router

__all__ = [
    "health_router",
    "images_router",
    "linkedin_router",
    "memory_router",
    "pose_mask_router",
    "pose_variants_router",
]
