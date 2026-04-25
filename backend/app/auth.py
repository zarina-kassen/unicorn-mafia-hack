"""Clerk JWT authentication for FastAPI routes."""

from __future__ import annotations

import os

from clerk_backend_api import authenticate_request, AuthenticateRequestOptions
from fastapi import HTTPException, Request
from starlette import status

CLERK_SECRET_KEY = os.environ.get("CLERK_SECRET_KEY", "")
CLERK_AUTHORIZED_PARTIES = [
    p.strip()
    for p in os.environ.get(
        "CLERK_AUTHORIZED_PARTIES",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if p.strip()
]


async def require_auth(request: Request) -> str:
    """FastAPI dependency that verifies the Clerk session token.

    Returns the authenticated user's ID (the ``sub`` claim).
    Raises 401 if the token is missing, expired, or invalid.
    """
    if not CLERK_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CLERK_SECRET_KEY is not configured",
        )

    request_state = authenticate_request(
        request,
        AuthenticateRequestOptions(
            secret_key=CLERK_SECRET_KEY,
            authorized_parties=CLERK_AUTHORIZED_PARTIES,
        ),
    )

    if not request_state.is_signed_in:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=request_state.message or "Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str | None = request_state.payload.get("sub") if request_state.payload else None
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user_id
