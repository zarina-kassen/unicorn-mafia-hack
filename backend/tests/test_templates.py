"""Smoke tests for the health and pose-variants endpoints."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.auth.clerk import require_auth
from app.main import app


@pytest.fixture(autouse=True)
def _bypass_dependencies() -> Generator[None]:
    """Replace dependencies with no-ops for tests."""
    app.dependency_overrides[require_auth] = lambda: "test-user-id"

    # Mock the agent dependency
    async def mock_agent():
        class MockAgent:
            async def run(self, *args, **kwargs):
                raise RuntimeError("Agent should not be called in this test")

        return MockAgent()

    from app.agent import get_pose_generation_agent

    app.dependency_overrides[get_pose_generation_agent] = mock_agent

    yield
    app.dependency_overrides.pop(require_auth, None)
    app.dependency_overrides.pop(get_pose_generation_agent, None)


def test_health_endpoint() -> None:
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"


def test_pose_variant_rejects_non_image_upload() -> None:
    client = TestClient(app)
    r = client.post(
        "/api/pose-variants",
        files={"reference_image": ("note.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400
