"""Tests for LinkedIn pipeline (demo mode, no real external APIs)."""

import base64
import json
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.auth import require_auth
from app.main import app
from app.linkedin_store import take_oauth_state


@pytest.fixture(autouse=True)
def _bypass_auth() -> Generator[None]:
    app.dependency_overrides[require_auth] = lambda: "test-linkedin-user"
    yield
    app.dependency_overrides.pop(require_auth, None)


def _tiny_jpeg() -> bytes:
    """1×1-style minimal JPEG, no extra deps (see also pose variant tests)."""
    return base64.b64decode(
        "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwg"
        "IyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoK"
        "CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQAB"
        "AQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAA"
        "AAAAAAAgD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCsg//Z"
    )


def test_linkedin_status() -> None:
    client = TestClient(app)
    r = client.get("/api/linkedin/status")
    assert r.status_code == 200
    assert r.json() == {"connected": True}


def test_linkedin_pipeline_demo() -> None:
    client = TestClient(app)
    jpeg = _tiny_jpeg()
    metas = [
        {
            "pose_name": "Confident",
            "confidence": 0.8,
            "occasion_type": "general",
            "captured_at": "2026-04-26T12:00:00.000Z",
            "client_id": "client-1",
        }
    ]
    r = client.post(
        "/api/linkedin/pipeline",
        data={"metas": json.dumps(metas)},
        files=[("images", ("a.jpg", jpeg, "image/jpeg"))],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "sequence" in body
    assert "top_six" in body
    assert "stored_photo_ids" in body
    assert len(body["stored_photo_ids"]) == 1
    assert len(body["sequence"]) == 1


def test_linkedin_oauth_state_roundtrip() -> None:
    from app.linkedin_store import create_oauth_state

    st = create_oauth_state(clerk_user_id="test-linkedin-user")
    uid = take_oauth_state(st)
    assert uid == "test-linkedin-user"
    assert take_oauth_state(st) is None
