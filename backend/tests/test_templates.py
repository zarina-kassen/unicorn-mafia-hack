"""Smoke tests for the templates and health endpoints."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.auth import require_auth
from app.main import app
from app.templates import TEMPLATE_IDS


@pytest.fixture(autouse=True)
def _bypass_auth() -> Generator[None]:
    """Replace the Clerk auth dependency with a no-op for tests."""
    app.dependency_overrides[require_auth] = lambda: "test-user-id"
    yield
    app.dependency_overrides.pop(require_auth, None)


def test_templates_endpoint() -> None:
    client = TestClient(app)
    r = client.get("/api/templates")
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()]
    assert set(ids) == set(TEMPLATE_IDS)


def test_health_endpoint() -> None:
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "model" in body


def test_pose_variant_missing_job() -> None:
    client = TestClient(app)
    r = client.get("/api/pose-variants/not-a-job")
    assert r.status_code == 404


def test_pose_variant_rejects_non_image_upload() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/pose-variants",
        files={"reference_image": ("note.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400
