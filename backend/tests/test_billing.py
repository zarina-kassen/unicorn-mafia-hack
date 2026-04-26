"""Billing, credits, and abuse-protection smoke tests."""

from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app import billing
from app.auth.clerk import require_auth
from app.main import app
from app.routes import pose_variants as pose_variants_module


@pytest.fixture(autouse=True)
def _bypass_auth() -> Generator[None]:
    app.dependency_overrides[require_auth] = lambda: "test-user-id"
    yield
    app.dependency_overrides.pop(require_auth, None)


def test_billing_account_endpoint() -> None:
    client = TestClient(app)
    res = client.get("/api/billing/account")
    assert res.status_code == 200
    body = res.json()
    assert body["plan_type"] in {"free", "paid"}
    assert body["balance"] >= 0
    assert body["free_monthly_credits"] > 0


def test_insufficient_credits_for_pose_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pose_variants_module, "check_rate_limit", lambda *a, **k: None)
    account = billing.get_account_state("test-user-id")
    if account["balance"] > 0:
        billing.spend_credits(
            "test-user-id",
            amount=account["balance"],
            event_type="test_drain",
        )
    client = TestClient(app)
    res = client.post(
        "/api/pose-variants",
        files={"reference_image": ("img.jpg", b"fake-image-bytes", "image/jpeg")},
    )
    assert res.status_code == 402
    body = res.json()
    assert body["detail"]["code"] == "insufficient_credits"


def test_webhook_dedupes_replayed_events(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_123")

    def fake_construct_event(
        raw: bytes, signature: str, secret: str
    ) -> dict[str, object]:
        assert raw == b"{}"
        assert signature == "sig"
        assert secret == "whsec_test_123"
        return {
            "id": "evt_test_replay_1",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_test_1",
                    "metadata": {
                        "clerk_user_id": "test-user-id",
                        "pack_id": "pack_100",
                        "credits": "100",
                    },
                }
            },
        }

    monkeypatch.setattr(billing.stripe.Webhook, "construct_event", fake_construct_event)

    first = billing.handle_stripe_webhook(b"{}", "sig")
    second = billing.handle_stripe_webhook(b"{}", "sig")

    assert first["ok"] is True
    assert second["ok"] is True
    assert second.get("deduped") is True


def test_failed_job_refund_is_idempotent() -> None:
    user_id = "test-user-id"
    job_id = f"job-{uuid.uuid4().hex}"
    billing.add_credits(user_id, amount=50, event_type="test_topup")
    before = billing.get_account_state(user_id)["balance"]
    billing.spend_credits(
        user_id, amount=10, event_type="pose_variant_job", event_ref=job_id
    )
    after_spend = billing.get_account_state(user_id)["balance"]
    assert after_spend == before - 10
    billing.credit_refund_for_failed_job(user_id, job_id)
    after_refund = billing.get_account_state(user_id)["balance"]
    assert after_refund == before
    billing.credit_refund_for_failed_job(user_id, job_id)
    assert billing.get_account_state(user_id)["balance"] == before
