"""Smoke tests for the MockAgent and /api/guidance route."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.agents.mock import MockAgent
from app.main import app
from app.schemas import Landmark, PoseContext
from app.templates import TEMPLATE_IDS


def _standing_landmarks() -> list[Landmark]:
    """Synthesize a plausible frontal standing pose (33 landmarks)."""
    lm = [Landmark(x=0.5, y=0.5, z=0.0, visibility=0.9) for _ in range(33)]
    # Shoulders
    lm[11] = Landmark(x=0.42, y=0.35, z=0.0, visibility=0.95)  # L shoulder
    lm[12] = Landmark(x=0.58, y=0.35, z=0.0, visibility=0.95)  # R shoulder
    # Hips
    lm[23] = Landmark(x=0.44, y=0.55, z=0.0, visibility=0.9)
    lm[24] = Landmark(x=0.56, y=0.55, z=0.0, visibility=0.9)
    # Knees significantly below hips => standing
    lm[25] = Landmark(x=0.44, y=0.78, z=0.0, visibility=0.85)
    lm[26] = Landmark(x=0.56, y=0.78, z=0.0, visibility=0.85)
    # Wrists away from hips
    lm[15] = Landmark(x=0.30, y=0.65, z=0.0, visibility=0.9)
    lm[16] = Landmark(x=0.70, y=0.65, z=0.0, visibility=0.9)
    return lm


@pytest.mark.asyncio
async def test_mock_agent_recognizes_standing_and_hand_on_hip() -> None:
    agent = MockAgent()

    # Standing: returns a standing template.
    ctx = PoseContext(
        landmarks=_standing_landmarks(),
        candidate_template_id="standing_straight",
        local_confidence=0.8,
        image_wh=(640, 480),
    )
    resp = await agent.guide(ctx)
    assert resp.person_visible is True
    assert resp.recommended_template_id in TEMPLATE_IDS
    assert len(resp.guidance) <= 160

    # Move the left wrist near the left hip -> should flip to hand_on_hip.
    lm = _standing_landmarks()
    lm[15] = Landmark(x=lm[23].x + 0.01, y=lm[23].y + 0.01, z=0.0, visibility=0.95)
    ctx2 = PoseContext(
        landmarks=lm,
        candidate_template_id="standing_straight",
        local_confidence=0.8,
        image_wh=(640, 480),
    )
    resp2 = await agent.guide(ctx2)
    assert resp2.recommended_template_id == "hand_on_hip"
    assert resp2.suggest_different is True


@pytest.mark.asyncio
async def test_mock_agent_handles_missing_person() -> None:
    agent = MockAgent()
    ctx = PoseContext(
        landmarks=[Landmark(x=0.0, y=0.0, z=0.0, visibility=0.0) for _ in range(33)],
        candidate_template_id="standing_straight",
        local_confidence=0.1,
        image_wh=(640, 480),
    )
    resp = await agent.guide(ctx)
    assert resp.person_visible is False
    assert resp.confidence == 0.0


def test_guidance_route_uses_mock_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    payload = PoseContext(
        landmarks=_standing_landmarks(),
        candidate_template_id="standing_straight",
        local_confidence=0.7,
        image_wh=(640, 480),
    ).model_dump()
    r = client.post("/api/guidance", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["recommended_template_id"] in TEMPLATE_IDS
    assert isinstance(body["guidance"], str) and body["guidance"]


def test_templates_endpoint() -> None:
    client = TestClient(app)
    r = client.get("/api/templates")
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()]
    assert set(ids) == set(TEMPLATE_IDS)
