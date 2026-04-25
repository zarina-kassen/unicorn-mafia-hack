"""Image serving route."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from ..storage.database import get_image

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/{job_id}/{filename}")
async def get_generated_image(
    job_id: str,
    filename: str,
) -> Response:
    """Serve a generated image from the database."""
    image_data = await get_image(job_id, filename)
    if image_data:
        data, content_type = image_data
        return Response(content=data, media_type=content_type)
    else:
        raise HTTPException(status_code=404, detail="Image not found")
