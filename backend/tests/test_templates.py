"""Smoke tests for the templates and health endpoints."""

import importlib
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.auth import require_auth
from app.main import app
from app.memory_onboarding import OnboardingImageInput, extract_memory_seed_entries
from app.schemas import MemorySeedEntry
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


def test_memory_onboarding_images_rejects_too_many(monkeypatch: pytest.MonkeyPatch) -> None:
    main_mod = importlib.import_module("app.main")
    monkeypatch.setattr(main_mod, "get_mubit_memory", lambda: None)
    client = TestClient(app)
    files = [
        ("images", (f"img-{idx}.jpg", b"\xff\xd8\xff", "image/jpeg")) for idx in range(6)
    ]
    r = client.post("/api/memory/onboarding/images", files=files)
    assert r.status_code == 400


def test_memory_onboarding_images_success(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyMemory:
        def __init__(self) -> None:
            self.preferences_called = False
            self.seeded_entries: list[dict[str, object]] = []

        def remember_preferences(
            self,
            *,
            user_id: str,
            allow_camera_roll: bool,
            allow_instagram: bool,
            allow_pinterest: bool,
        ) -> None:
            self.preferences_called = (
                user_id == "test-user-id"
                and allow_camera_roll
                and not allow_instagram
                and not allow_pinterest
            )

        def remember_onboarding_seed(
            self, *, user_id: str, entries: list[dict[str, object]]
        ) -> None:
            if user_id == "test-user-id":
                self.seeded_entries = entries

    dummy = DummyMemory()
    main_mod = importlib.import_module("app.main")
    monkeypatch.setattr(main_mod, "get_mubit_memory", lambda: dummy)
    monkeypatch.setattr(
        main_mod,
        "extract_memory_seed_entries",
        lambda _prepared: [
            MemorySeedEntry(
                source_ref="img-1.jpg",
                pose_tags=["profile"],
                style_tags=["candid"],
                composition_tags=["centered"],
                scene_tags=["indoor"],
                confidence=0.8,
            )
        ],
    )

    client = TestClient(app)
    files = [("images", ("img-1.jpg", b"\xff\xd8\xff", "image/jpeg"))]
    r = client.post("/api/memory/onboarding/images", files=files)
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert dummy.preferences_called
    assert len(dummy.seeded_entries) == 1


def test_extract_memory_seed_entries_fail_open(monkeypatch: pytest.MonkeyPatch) -> None:
    onboarding_mod = importlib.import_module("app.memory_onboarding")
    monkeypatch.setattr(onboarding_mod, "OpenAI", lambda: object())

    calls: list[str] = []

    def fake_extract_single(_client: object, image: OnboardingImageInput):
        calls.append(image.filename)
        if image.filename == "bad.jpg":
            return None
        return onboarding_mod.MemorySeedEntry(
            source_ref=image.filename,
            pose_tags=["crossed_arms"],
            style_tags=["confident"],
            composition_tags=["upper_body"],
            scene_tags=["indoor"],
            confidence=0.75,
        )

    monkeypatch.setattr(onboarding_mod, "_extract_single", fake_extract_single)
    entries = extract_memory_seed_entries(
        [
            OnboardingImageInput(
                filename="good.jpg", content_type="image/jpeg", data=b"\xff\xd8\xff"
            ),
            OnboardingImageInput(
                filename="bad.jpg", content_type="image/jpeg", data=b"\xff\xd8\xff"
            ),
        ]
    )
    assert calls == ["good.jpg", "bad.jpg"]
    assert len(entries) == 1
    assert entries[0].source_ref == "good.jpg"
