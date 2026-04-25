"""PostgreSQL database configuration and operations using Piccolo ORM."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from piccolo.columns import Bytea, Timestamp, Varchar
from piccolo.columns.defaults.timestamp import TimestampNow
from piccolo.table import Table

from ..config import settings

logger = logging.getLogger(__name__)


class GeneratedImage(Table, tablename="generated_images"):
    """Generated images stored in PostgreSQL."""

    job_id = Varchar(length=64, required=True)
    filename = Varchar(length=255, required=True)
    content_type = Varchar(length=100, required=True)
    data = Bytea(required=True)
    created_at = Timestamp(default=TimestampNow())


async def init_db() -> None:
    """Initialize the database schema for image storage."""
    from piccolo.table import create_tables

    await asyncio.to_thread(create_tables, GeneratedImage, if_not_exists=True)
    logger.info("Database schema initialized")


async def store_image(
    job_id: str, filename: str, data: bytes, content_type: str
) -> str:
    """Store an image in the database and return its API URL."""
    try:
        await GeneratedImage.insert(
            GeneratedImage(
                job_id=job_id,
                filename=filename,
                content_type=content_type,
                data=data,
            )
        ).run()
    except Exception:
        # If insert fails (duplicate), update the existing record
        await (
            GeneratedImage.update(
                {
                    GeneratedImage.data: data,
                    GeneratedImage.content_type: content_type,
                    GeneratedImage.created_at: datetime.now(),
                }
            )
            .where(
                (GeneratedImage.job_id == job_id)
                & (GeneratedImage.filename == filename)
            )
            .run()
        )
    return f"/api/images/{job_id}/{filename}"


async def get_image(job_id: str, filename: str) -> tuple[bytes, str] | None:
    """Retrieve an image from the database."""
    image = (
        await GeneratedImage.select()
        .where(
            (GeneratedImage.job_id == job_id) & (GeneratedImage.filename == filename)
        )
        .first()
        .run()
    )
    if image:
        return image["data"], image["content_type"]
    return None


async def cleanup_old_images() -> None:
    """Delete images older than GENERATED_TTL_SECONDS."""
    cutoff = datetime.now() - timedelta(seconds=settings.generated_ttl_seconds)
    deleted = (
        await GeneratedImage.delete().where(GeneratedImage.created_at < cutoff).run()
    )
    if deleted > 0:
        logger.info("Cleaned up %d old images", deleted)


async def start_cleanup_task() -> None:
    """Start a background task to periodically clean up old images."""
    while True:
        try:
            await asyncio.sleep(60 * 60)
            await cleanup_old_images()
        except asyncio.CancelledError:
            logger.info("Cleanup task cancelled")
            break
        except Exception:
            logger.exception("Cleanup task failed")
