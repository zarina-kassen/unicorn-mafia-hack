"""Clerk JWT authentication for FastAPI."""

from __future__ import annotations

import logging

from clerk_backend_api import AuthenticateRequestOptions, authenticate_request_async
from fastapi import HTTPException, Request
from starlette import status

from ..config import settings

logger = logging.getLogger(__name__)


async def require_auth(request: Request) -> str:
    """FastAPI dependency that verifies the Clerk session token.

    Args:
        request: The FastAPI request object.

    Returns:
        The authenticated user's ID (the ``sub`` claim).

    Raises:
        HTTPException: If authentication fails (401) or configuration is invalid (500).
    """
    try:
        request_state = await authenticate_request_async(
            request,
            AuthenticateRequestOptions(
                secret_key=settings.clerk_secret_key,
                jwt_key=settings.clerk_jwt_key or None,
                authorized_parties=settings.clerk_authorized_parties_list,
            ),
        )
    except Exception as exc:
        logger.exception("Clerk authentication failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        ) from exc

    if not request_state.is_signed_in:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=request_state.message or "Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str | None = (
        request_state.payload.get("sub") if request_state.payload else None
    )
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user_id
