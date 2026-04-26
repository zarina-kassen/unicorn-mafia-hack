"""LinkedIn OAuth token exchange, refresh, and UGC image posts."""

from __future__ import annotations

import logging
import os
import time
import urllib.parse
from pathlib import Path
from typing import Any

import httpx

from .linkedin_store import (
    get_linkedin_tokens,
    set_linkedin_member_id,
    update_linkedin_access_token,
)

logger = logging.getLogger(__name__)

_LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
_LINKEDIN_API = "https://api.linkedin.com"
_DEMO_MODE = os.environ.get("LINKEDIN_DEMO_MODE", "true").strip().lower() in {
    "1",
    "true",
    "yes",
}

_CLIENT_ID = os.environ.get("LINKEDIN_CLIENT_ID", "").strip()
_CLIENT_SECRET = os.environ.get("LINKEDIN_CLIENT_SECRET", "").strip()
_REDIRECT_URI = os.environ.get("LINKEDIN_REDIRECT_URI", "").strip()


def linkedin_demo_mode() -> bool:
    return _DEMO_MODE or not _CLIENT_ID or not _CLIENT_SECRET


def build_authorize_url(*, state: str, scope: str | None = None) -> str:
    sc = scope or "openid profile w_member_social"
    params = {
        "response_type": "code",
        "client_id": _CLIENT_ID,
        "redirect_uri": _REDIRECT_URI,
        "state": state,
        "scope": sc,
    }
    return f"https://www.linkedin.com/oauth/v2/authorization?{urllib.parse.urlencode(params)}"


async def exchange_code_for_tokens(*, code: str) -> dict[str, Any]:
    if linkedin_demo_mode():
        return {
            "access_token": "demo-access-token",
            "expires_in": 3600,
            "refresh_token": "demo-refresh",
            "token_type": "Bearer",
        }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _REDIRECT_URI,
        "client_id": _CLIENT_ID,
        "client_secret": _CLIENT_SECRET,
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            _LINKEDIN_TOKEN_URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    r.raise_for_status()
    return r.json()


async def refresh_access_token(*, refresh_token: str) -> dict[str, Any]:
    if linkedin_demo_mode():
        return {
            "access_token": "demo-access-token",
            "expires_in": 3600,
        }
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": _CLIENT_ID,
        "client_secret": _CLIENT_SECRET,
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            _LINKEDIN_TOKEN_URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    r.raise_for_status()
    return r.json()


async def fetch_linkedin_sub(*, access_token: str) -> str | None:
    if linkedin_demo_mode():
        return "demoMember"
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_LINKEDIN_API}/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.status_code >= 400:
        return None
    j = r.json()
    sub = j.get("sub")
    return str(sub) if isinstance(sub, str) and sub else None


async def ensure_fresh_token(user_id: str) -> str | None:
    row = get_linkedin_tokens(user_id)
    if not row:
        return None
    if row.expires_at > int(time.time()) + 30:
        return row.access_token
    if not row.refresh_token or linkedin_demo_mode():
        return row.access_token
    try:
        tok = await refresh_access_token(refresh_token=row.refresh_token)
    except Exception:  # noqa: BLE001
        logger.exception("Token refresh failed for user=%s", user_id)
        return None
    at = tok.get("access_token")
    if not isinstance(at, str):
        return None
    exp = int(tok.get("expires_in", 3600))
    update_linkedin_access_token(
        clerk_user_id=user_id, access_token=at, expires_in_seconds=exp
    )
    return at


async def _register_image_upload(
    *, access_token: str, person_id: str, file_path: Path
) -> str:
    """Return digitalmediaAsset URN after upload."""
    owner = f"urn:li:person:{person_id}"
    reg_body = {
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
            "owner": owner,
            "serviceRelationships": [
                {
                    "relationshipType": "OWNER",
                    "identifier": "urn:li:userGeneratedContent",
                }
            ],
        }
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{_LINKEDIN_API}/v2/assets?action=registerUpload",
            json=reg_body,
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-Restli-Protocol-Version": "2.0.0",
            },
        )
    r.raise_for_status()
    reg = r.json()
    value = reg.get("value", reg)
    upload = value.get("uploadMechanism", {}).get(
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest", {}
    )
    upload_url = upload.get("uploadUrl")
    asset_urn = value.get("asset")
    if not isinstance(upload_url, str) or not isinstance(asset_urn, str):
        raise RuntimeError("LinkedIn registerUpload response missing fields")
    data = file_path.read_bytes()
    async with httpx.AsyncClient() as client:
        up = await client.put(
            upload_url,
            content=data,
            headers={"Content-Type": "application/octet-stream"},
        )
    if up.status_code >= 400:
        raise RuntimeError(f"LinkedIn image upload failed: {up.status_code}")
    return asset_urn


async def publish_ugc_image_carousel(
    *,
    user_id: str,
    image_paths: list[Path],
    as_draft: bool,
    share_commentary: str = "New photos from Frame Mog.",
) -> str:
    """Create a multi-image UGC post; return share URN or id."""
    if linkedin_demo_mode():
        return "urn:li:ugcPost:demo-00000000-0000-0000-0000-000000000000"

    access = await ensure_fresh_token(user_id)
    if not access:
        raise RuntimeError("Not connected to LinkedIn")
    row = get_linkedin_tokens(user_id)
    if not row or not row.linkedin_member_id:
        sub = await fetch_linkedin_sub(access_token=access)
        if not sub:
            raise RuntimeError("Could not read LinkedIn member id")
        set_linkedin_member_id(user_id, sub)
        row = get_linkedin_tokens(user_id)
    if not row or not row.linkedin_member_id:
        raise RuntimeError("Missing LinkedIn person id")
    person_id: str = str(row.linkedin_member_id)

    media: list[dict[str, Any]] = []
    for p in image_paths:
        asset = await _register_image_upload(
            access_token=access, person_id=person_id, file_path=p
        )
        media.append(
            {
                "status": "READY",
                "description": {"text": " "},
                "media": asset,
                "title": {"text": " "},
            }
        )

    access = await ensure_fresh_token(user_id) or access
    lifecycle = "DRAFT" if as_draft else "PUBLISHED"
    ugc = {
        "author": f"urn:li:person:{person_id}",
        "lifecycleState": lifecycle,
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {
                    "text": share_commentary,
                },
                "shareMediaCategory": "IMAGE",
                "media": media,
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{_LINKEDIN_API}/v2/ugcPosts",
            json=ugc,
            headers={
                "Authorization": f"Bearer {access}",
                "X-Restli-Protocol-Version": "2.0.0",
                "Content-Type": "application/json",
            },
        )
    if r.status_code >= 400:
        raise RuntimeError(f"ugcPosts failed: {r.status_code} {r.text[:500]}")
    j = r.json()
    key = j.get("id")
    if isinstance(key, str):
        return key
    return "urn:li:ugcPost:unknown"
