"""Pytest hooks: ensure required env vars exist before `app` imports settings."""

from __future__ import annotations

import os


def _ensure_non_empty(name: str, placeholder: str) -> None:
    if not (os.environ.get(name) or "").strip():
        os.environ[name] = placeholder


_ensure_non_empty("OPENROUTER_API_KEY", "test-openrouter-key")
_ensure_non_empty("MUBIT_API_KEY", "test-mubit-key")
_ensure_non_empty("CLERK_SECRET_KEY", "test-clerk-key")
_ensure_non_empty("DATABASE_URL", "postgresql://u:p@localhost:5432/test")

# Ensure billing SQLite tables exist before any test touches billing endpoints.
from app.billing import init_billing_store as _init_billing  # noqa: E402

_init_billing()
