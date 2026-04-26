"""Downscale images for faster APIs and smaller storage (pose pipeline)."""

from __future__ import annotations

import logging
from io import BytesIO

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


def downscale_to_jpeg(
    image_bytes: bytes,
    *,
    max_edge_px: int,
    jpeg_quality: int,
    fallback_content_type: str = "image/jpeg",
) -> tuple[bytes, str]:
    """Resize so longest side is at most max_edge_px; return JPEG bytes and image/jpeg."""
    if max_edge_px < 16:
        return image_bytes, fallback_content_type

    try:
        with Image.open(BytesIO(image_bytes)) as im:
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGB")
            w, h = im.size
            longest = max(w, h)
            if longest > max_edge_px:
                scale = max_edge_px / longest
                new_w = max(1, int(w * scale))
                new_h = max(1, int(h * scale))
                im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
            out = BytesIO()
            im.save(
                out,
                format="JPEG",
                quality=jpeg_quality,
                optimize=True,
            )
            return out.getvalue(), "image/jpeg"
    except Exception:
        logger.warning("Image downscale failed; using original bytes", exc_info=True)
        return image_bytes, fallback_content_type
