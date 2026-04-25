"""Smoke tests for the templates and health endpoints."""

import importlib
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app import billing
from app.auth import require_auth
from app.main import app
from app.mubit_memory import get_mubit_memory
from app.pose_variants import (
    build_scene_prompt_fragment,
    pick_image_size_for_aspect_ratio,
)
from app.schemas import NormalizedSubjectBBox, PoseVariantSceneContext
from app.templates import TEMPLATE_IDS


@pytest.fixture(autouse=True)
def _bypass_auth(monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
    """Replace Clerk auth and avoid live Mubit (cached client can block CI)."""
    app.dependency_overrides[require_auth] = lambda: "test-user-id"
    monkeypatch.delenv("MUBIT_API_KEY", raising=False)
    monkeypatch.delenv("MUBIT_ENDPOINT", raising=False)
    get_mubit_memory.cache_clear()
    yield
    app.dependency_overrides.pop(require_auth, None)
    get_mubit_memory.cache_clear()


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


def _finish_pose_job_for_test(job_id: str, *args: object, **kwargs: object) -> None:
    """Mark job complete so it does not stay queued (avoids 429 on global active count)."""
    from app.pose_variants import POSE_VARIANTS, PoseVariantResult, _update_job

    phony = [
        PoseVariantResult(
            id=spec.id,
            title=spec.title,
            instruction=spec.instruction,
            image_url=f"/generated/{job_id}/{spec.id}.jpg",
            pose_template_id=spec.pose_template_id,
            replaceable=False,
        )
        for spec in POSE_VARIANTS
    ]
    _update_job(
        job_id,
        status="ready",
        progress=len(POSE_VARIANTS),
        results=phony,
    )


def test_pose_variant_accepts_scene_context(monkeypatch: pytest.MonkeyPatch) -> None:
    billing.add_credits("test-user-id", amount=100, event_type="test_topup")
    main_mod = importlib.import_module("app.main")
    # main.py binds billing helpers at import time; patch the names on `app.main`.
    monkeypatch.setattr(main_mod, "check_rate_limit", lambda *a, **k: None)
    monkeypatch.setattr(main_mod, "count_active_pose_jobs", lambda: 0)
    monkeypatch.setattr(main_mod, "count_user_active_pose_jobs", lambda _uid: 0)
    monkeypatch.setattr(main_mod, "get_mubit_memory", lambda: None)
    monkeypatch.setattr(main_mod, "run_pose_variant_job", _finish_pose_job_for_test)

    client = TestClient(app)
    ctx = PoseVariantSceneContext(
        capture_width=720,
        capture_height=1280,
        aspect_ratio=720 / 1280,
        subject_bbox=None,
        subject_fill_width=None,
        subject_fill_height=None,
        horizontal_placement="unknown",
        framing_label="test_framing",
    )
    r = client.post(
        "/api/pose-variants",
        data={"scene_context": ctx.model_dump_json()},
        files={"reference_image": ("ref.jpg", b"\xff\xd8\xff", "image/jpeg")},
    )
    assert r.status_code == 200
    body = r.json()
    assert "job_id" in body
    assert body.get("status") in {"queued", "generating"}


def test_build_scene_prompt_fragment_mentions_framing() -> None:
    ctx = PoseVariantSceneContext(
        capture_width=1080,
        capture_height=1920,
        aspect_ratio=1080 / 1920,
        subject_bbox=NormalizedSubjectBBox(
            x_min=0.1,
            y_min=0.1,
            x_max=0.9,
            y_max=0.9,
        ),
        subject_fill_width=0.6,
        subject_fill_height=0.7,
        horizontal_placement="center",
        framing_label="upper_body",
    )
    text = build_scene_prompt_fragment(ctx)
    assert "1080" in text
    assert "1920" in text
    assert "upper_body" in text
    assert "0.6" in text or "60" in text


def test_pick_image_size_matches_portrait() -> None:
    assert pick_image_size_for_aspect_ratio(1024 / 1536) == "1024x1536"
    assert pick_image_size_for_aspect_ratio(1536 / 1024) == "1536x1024"
    assert pick_image_size_for_aspect_ratio(1.0) == "1024x1024"


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
