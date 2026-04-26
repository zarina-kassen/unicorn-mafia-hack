"""Smoke tests for the health and pose-variants endpoints."""

from __future__ import annotations

import base64
import json
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from openrouter import components

from app.agents import get_pose_generation_agent
from app.auth.clerk import require_auth
from app.config import Settings, settings
from app.dependencies import get_openrouter_client
from app.main import app
from app.routes.pose_variants import _assistant_image_url
from app.schemas import PoseTargetSpec


@pytest.fixture(autouse=True)
def _bypass_dependencies() -> Generator[None]:
    """Replace dependencies with no-ops for tests."""
    app.dependency_overrides[require_auth] = lambda: "test-user-id"

    async def mock_agent():
        class MockAgent:
            async def run(self, *args, **kwargs):
                raise RuntimeError("Agent should not be called in this test")

        return MockAgent()

    app.dependency_overrides[get_pose_generation_agent] = mock_agent

    yield
    app.dependency_overrides.pop(require_auth, None)
    app.dependency_overrides.pop(get_pose_generation_agent, None)


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event_name = "message"
        data_payload: str | None = None
        for line in block.split("\n"):
            if line.startswith("event: "):
                event_name = line.removeprefix("event: ").strip()
            elif line.startswith("data: "):
                data_payload = line.removeprefix("data: ").strip()
        if data_payload is not None:
            events.append((event_name, json.loads(data_payload)))
    return events


def test_health_endpoint() -> None:
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"


def test_root_redirects_to_health() -> None:
    client = TestClient(app, follow_redirects=False)
    r = client.get("/")
    assert r.status_code == 307
    assert r.headers["location"] == "/health"


def test_root_head_redirects_to_health() -> None:
    client = TestClient(app, follow_redirects=False)
    r = client.head("/")
    assert r.status_code == 307
    assert r.headers["location"] == "/health"


def test_pose_variant_rejects_non_image_upload() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/pose-variants",
        files={"reference_image": ("note.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400


def test_pose_mask_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/pose-mask returns a stored mask URL (LLM mocked)."""
    minimal_png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    mask_data_url = f"data:image/png;base64,{minimal_png_b64}"

    async def fake_load(image_url: str):  # noqa: ARG001
        return f"data:image/png;base64,{minimal_png_b64}", 1, 1

    async def fake_store(
        job_id: str, filename: str, binary: bytes, content_type: str
    ) -> str:  # noqa: ARG001
        return f"http://testserver/api/images/{job_id}/{filename}"

    class FakeChat:
        async def send_async(self, **kwargs):  # noqa: ANN003
            return _sample_chat_result_with_image(url=mask_data_url)

    class FakeOpenRouter:
        def __init__(self) -> None:
            self.chat = FakeChat()

    monkeypatch.setattr(
        "app.routes.pose_mask._load_image_data_url_and_dimensions",
        fake_load,
    )
    monkeypatch.setattr("app.routes.pose_mask.store_image", fake_store)
    app.dependency_overrides[get_openrouter_client] = lambda: FakeOpenRouter()
    try:
        client = TestClient(app)
        r = client.post(
            "/api/pose-mask",
            json={"image_url": "/api/images/job1/pose.jpg"},
        )
    finally:
        app.dependency_overrides.pop(get_openrouter_client, None)

    assert r.status_code == 200
    body = r.json()
    assert body["mask_url"].startswith("http://testserver/api/images/")
    assert body["width"] >= 1
    assert body["height"] >= 1
    assert body["source"] == "llm"


def _sample_chat_result_with_image(*, url: str) -> components.ChatResult:
    return components.ChatResult(
        id="chatcmpl-test",
        object="chat.completion",
        created=0,
        model="black-forest-labs/flux.2-klein-4b",
        choices=[
            components.ChatChoice(
                finish_reason="stop",
                index=0,
                message=components.ChatAssistantMessage(
                    role="assistant",
                    images=[
                        components.ChatAssistantImages(
                            image_url=components.ChatAssistantImagesImageURL(url=url)
                        )
                    ],
                ),
            )
        ],
        system_fingerprint=None,
    )


def test_openrouter_sdk_chat_result_image_url() -> None:
    data_url = "data:image/png;base64,iVBORw0KGgo="
    result = _sample_chat_result_with_image(url=data_url)
    assert _assistant_image_url(result) == data_url


def test_pose_variants_sse_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/pose-variants returns SSE with pose + outline events."""

    minimal_png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    gen_data_url = f"data:image/png;base64,{minimal_png_b64}"
    _image_store: dict[tuple[str, str], tuple[bytes, str]] = {}

    async def fake_store_image(
        job_id: str, filename: str, binary: bytes, content_type: str
    ) -> str:
        _image_store[(job_id, filename)] = (binary, content_type)
        return f"http://testserver/api/images/{job_id}/{filename}"

    async def fake_get_image(job_id: str, filename: str):
        return _image_store.get((job_id, filename))

    monkeypatch.setattr("app.routes.pose_variants.store_image", fake_store_image)
    monkeypatch.setattr("app.routes.pose_variants.get_image", fake_get_image)
    monkeypatch.setattr(
        "app.routes.pose_variants.random.sample",
        lambda population, k, **kwargs: [population[0], population[1]],
    )

    polygon_json = (
        '{"polygon":['
        + ",".join(
            f'{{"x":{0.2 + (i % 4) * 0.15},"y":{0.2 + (i // 4) * 0.12}}}'
            for i in range(16)
        )
        + "]}"
    )

    class FakeChat:
        async def send_async(self, **kwargs):  # noqa: ANN003
            modalities = kwargs.get("modalities") or []
            if "image" in modalities:
                return _sample_chat_result_with_image(url=gen_data_url)
            return components.ChatResult(
                id="chatcmpl-outline",
                object="chat.completion",
                created=0,
                model=settings.pose_guide_model,
                choices=[
                    components.ChatChoice(
                        finish_reason="stop",
                        index=0,
                        message=components.ChatAssistantMessage(
                            role="assistant",
                            content=polygon_json,
                        ),
                    )
                ],
                system_fingerprint=None,
            )

    class FakeOpenRouter:
        def __init__(self) -> None:
            self.chat = FakeChat()

    async def streaming_agent():
        class MockAgent:
            async def run(self, *args, **kwargs):
                class Result:
                    output = [
                        PoseTargetSpec(
                            title="Agent-a",
                            instruction="i",
                            rationale="r",
                            approximate_landmarks=[],
                        ),
                        PoseTargetSpec(
                            title="Agent-b",
                            instruction="i",
                            rationale="r",
                            approximate_landmarks=[],
                        ),
                        PoseTargetSpec(
                            title="Agent-c",
                            instruction="i",
                            rationale="r",
                            approximate_landmarks=[],
                        ),
                        PoseTargetSpec(
                            title="Agent-d",
                            instruction="i",
                            rationale="r",
                            approximate_landmarks=[],
                        ),
                    ]

                return Result()

        return MockAgent()

    prev_agent_override = app.dependency_overrides.get(get_pose_generation_agent)
    app.dependency_overrides[get_pose_generation_agent] = streaming_agent
    app.dependency_overrides[get_openrouter_client] = lambda: FakeOpenRouter()
    try:
        client = TestClient(app)
        png_bytes = base64.b64decode(minimal_png_b64)
        with client.stream(
            "POST",
            "/api/pose-variants",
            files={
                "reference_image": ("ref.jpg", png_bytes, "image/jpeg"),
            },
        ) as r:
            assert r.status_code == 200
            assert r.headers.get("content-type", "").startswith("text/event-stream")
            raw = r.read().decode("utf-8")
    finally:
        app.dependency_overrides.pop(get_openrouter_client, None)
        if prev_agent_override is not None:
            app.dependency_overrides[get_pose_generation_agent] = prev_agent_override

    events = _parse_sse(raw)
    types = [e[0] for e in events]
    assert ": sse-open" in raw
    assert types[0] == "phase"
    assert events[0][1]["step"] == "planning"
    assert "target_count" in types
    assert types.count("pose") == 6
    assert "done" in types
    assert "error" not in types

    tc = next(p for t, p in events if t == "target_count")
    assert tc["count"] == 6
    done = next(p for t, p in events if t == "done")
    assert done["count"] == 6
    pose_payload = next(p for t, p in events if t == "pose")
    assert "pose" in pose_payload and "outline" in pose_payload
    assert len(pose_payload["outline"]["polygon"]) == 16


_VALID_SETTINGS = Settings(
    openrouter_api_key="sk-or-test",
    mubit_api_key="mbt_test",
    clerk_secret_key="sk_test_clerk",
    database_url="postgresql://u:p@localhost:5432/test",
)


def test_validate_config_requires_openrouter_key() -> None:
    from app.config import validate_config

    cfg = _VALID_SETTINGS.model_copy(update={"openrouter_api_key": ""})
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        validate_config(_settings=cfg)


def test_validate_config_requires_mubit_key() -> None:
    from app.config import validate_config

    cfg = _VALID_SETTINGS.model_copy(update={"mubit_api_key": ""})
    with pytest.raises(ValueError, match="MUBIT_API_KEY"):
        validate_config(_settings=cfg)


def test_validate_config_requires_clerk_secret_key() -> None:
    from app.config import validate_config

    cfg = _VALID_SETTINGS.model_copy(update={"clerk_secret_key": ""})
    with pytest.raises(ValueError, match="CLERK_SECRET_KEY"):
        validate_config(_settings=cfg)


def test_validate_config_requires_database_url() -> None:
    from app.config import validate_config

    cfg = _VALID_SETTINGS.model_copy(update={"database_url": ""})
    with pytest.raises(ValueError, match="DATABASE_URL"):
        validate_config(_settings=cfg)


def test_validate_config_passes_all_required() -> None:
    from app.config import validate_config

    validate_config(_settings=_VALID_SETTINGS)
