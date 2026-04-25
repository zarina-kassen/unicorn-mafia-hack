"""S3-compatible object storage for generated images.

When S3 is configured (S3_ENDPOINT_URL is set), images are uploaded to the
bucket and served via a public URL.  Otherwise falls back to local filesystem
storage so development works without running Garage.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig

logger = logging.getLogger(__name__)


def _s3_env(key: str, default: str | None = None) -> str | None:
    return os.environ.get(key, default)


def s3_enabled() -> bool:
    return bool(
        _s3_env("S3_ENDPOINT_URL")
        and _s3_env("S3_ACCESS_KEY_ID")
        and _s3_env("S3_SECRET_ACCESS_KEY")
    )


@lru_cache(maxsize=1)
def _get_s3_client():  # type: ignore[no-untyped-def]
    return boto3.client(
        "s3",
        endpoint_url=_s3_env("S3_ENDPOINT_URL"),
        aws_access_key_id=_s3_env("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=_s3_env("S3_SECRET_ACCESS_KEY"),
        region_name=_s3_env("S3_REGION", "garage"),
        config=BotoConfig(signature_version="s3v4"),
    )


def _bucket() -> str:
    return _s3_env("S3_BUCKET") or "generated-images"


def upload_file(local_path: Path, s3_key: str) -> str:
    """Upload a local file to S3 and return the public URL."""
    client = _get_s3_client()
    content_type = "image/jpeg"
    if local_path.suffix.lower() == ".png":
        content_type = "image/png"
    elif local_path.suffix.lower() == ".webp":
        content_type = "image/webp"

    client.upload_file(
        str(local_path),
        _bucket(),
        s3_key,
        ExtraArgs={"ContentType": content_type},
    )
    return public_url(s3_key)


def upload_bytes(data: bytes, s3_key: str, content_type: str = "image/jpeg") -> str:
    """Upload raw bytes to S3 and return the public URL."""
    client = _get_s3_client()
    client.put_object(
        Bucket=_bucket(),
        Key=s3_key,
        Body=data,
        ContentType=content_type,
    )
    return public_url(s3_key)


def delete_prefix(prefix: str) -> None:
    """Delete all objects under a given S3 key prefix."""
    client = _get_s3_client()
    response = client.list_objects_v2(Bucket=_bucket(), Prefix=prefix)
    objects = response.get("Contents", [])
    if objects:
        client.delete_objects(
            Bucket=_bucket(),
            Delete={"Objects": [{"Key": obj["Key"]} for obj in objects]},
        )


def public_url(s3_key: str) -> str:
    """Return the public URL for an S3 object."""
    base = _s3_env("S3_PUBLIC_URL") or _s3_env("S3_ENDPOINT_URL") or ""
    return f"{base.rstrip('/')}/{_bucket()}/{s3_key}"
