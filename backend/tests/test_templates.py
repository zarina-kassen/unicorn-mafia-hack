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


def test_memory_preferences_endpoint_without_mubit() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/memory/preferences",
        json={
            "allow_camera_roll": True,
            "allow_instagram": False,
            "allow_pinterest": False,
        },
    )
    assert r.status_code == 200
    assert "ok" in r.json()


def test_memory_reset_endpoint_without_mubit() -> None:
    client = TestClient(app)
    r = client.post("/api/memory/reset", json={"hard_reset": False})
    assert r.status_code == 200
    assert "ok" in r.json()


def test_pose_outline_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import main as main_module

    async def fake_extract(_image_url: str) -> tuple[str, int, int]:
        return "/generated/fake-mask.png", 320, 480

    monkeypatch.setattr(main_module, "_llm_extract_pose_mask", fake_extract)
    client = TestClient(app)
    r = client.post("/api/pose-mask", json={"image_url": "/generated/fake.png"})
    assert r.status_code == 200
    body = r.json()
    assert body["mask_url"] == "/generated/fake-mask.png"
    assert body["width"] == 320
    assert body["height"] == 480
    assert body["source"] == "llm"


def test_pose_mask_endpoint_returns_502_on_model_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main as main_module

    async def fake_extract(_image_url: str) -> tuple[str, int, int]:
        raise RuntimeError("quota exceeded")

    monkeypatch.setattr(main_module, "_llm_extract_pose_mask", fake_extract)
    client = TestClient(app)
    r = client.post("/api/pose-mask", json={"image_url": "/generated/fake.png"})
    assert r.status_code == 502
    body = r.json()
    assert "detail" in body
    assert "quota exceeded" in body["detail"]
