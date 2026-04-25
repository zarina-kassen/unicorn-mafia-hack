"""Credit ledger, quota checks, and Stripe integration helpers."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import stripe
from fastapi import HTTPException, status


@dataclass(frozen=True)
class BillingConfig:
    free_monthly_credits: int = int(os.environ.get("FREE_MONTHLY_CREDITS", "80"))
    guidance_cost: int = int(os.environ.get("GUIDANCE_COST_CREDITS", "1"))
    pose_variant_cost: int = int(os.environ.get("POSE_VARIANT_COST_CREDITS", "15"))
    guidance_rate_per_hour: int = int(os.environ.get("GUIDANCE_RATE_LIMIT_PER_HOUR", "40"))
    pose_jobs_per_day_free: int = int(os.environ.get("POSE_JOBS_PER_DAY_FREE", "5"))
    pose_jobs_per_day_paid: int = int(os.environ.get("POSE_JOBS_PER_DAY_PAID", "15"))
    memory_writes_per_hour: int = int(os.environ.get("MEMORY_WRITES_PER_HOUR", "120"))
    max_pose_jobs_per_hour_global: int = int(os.environ.get("MAX_POSE_JOBS_PER_HOUR_GLOBAL", "120"))


CONFIG = BillingConfig()

_DB_PATH = Path(os.environ.get("BILLING_DB_PATH", str(Path(__file__).resolve().parents[1] / "billing.sqlite3")))
_LOCK = threading.Lock()

PACK_CREDITS: dict[str, int] = {
    "pack_100": 100,
    "pack_200": 200,
}

PACK_PRICE_ENV: dict[str, str] = {
    "pack_100": "STRIPE_PRICE_100_CREDITS",
    "pack_200": "STRIPE_PRICE_200_CREDITS",
}


def _conn() -> sqlite3.Connection:
    db = sqlite3.connect(_DB_PATH, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


def init_billing_store() -> None:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, _conn() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                clerk_user_id TEXT PRIMARY KEY,
                stripe_customer_id TEXT,
                plan_type TEXT NOT NULL DEFAULT 'free',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS credit_balances (
                clerk_user_id TEXT PRIMARY KEY,
                balance INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS credit_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clerk_user_id TEXT NOT NULL,
                delta INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                event_ref TEXT,
                metadata_json TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created
              ON credit_ledger(clerk_user_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS monthly_free_grants (
                clerk_user_id TEXT NOT NULL,
                month_key TEXT NOT NULL,
                credits INTEGER NOT NULL,
                granted_at INTEGER NOT NULL,
                PRIMARY KEY (clerk_user_id, month_key)
            );
            CREATE TABLE IF NOT EXISTS rate_counters (
                counter_key TEXT PRIMARY KEY,
                window_start INTEGER NOT NULL,
                count INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stripe_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                processed_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stripe_checkout_sessions (
                session_id TEXT PRIMARY KEY,
                clerk_user_id TEXT NOT NULL,
                pack_id TEXT NOT NULL,
                credits INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'created',
                created_at INTEGER NOT NULL
            );
            """
        )


def _now() -> int:
    return int(time.time())


def _month_key(ts: int | None = None) -> str:
    stamp = time.gmtime(ts or _now())
    return f"{stamp.tm_year:04d}-{stamp.tm_mon:02d}"


def _ensure_user(db: sqlite3.Connection, user_id: str) -> None:
    now = _now()
    db.execute(
        "INSERT OR IGNORE INTO users(clerk_user_id, created_at) VALUES(?, ?)",
        (user_id, now),
    )
    db.execute(
        "INSERT OR IGNORE INTO credit_balances(clerk_user_id, balance, updated_at) VALUES(?, 0, ?)",
        (user_id, now),
    )


def _append_ledger(
    db: sqlite3.Connection,
    user_id: str,
    *,
    delta: int,
    event_type: str,
    event_ref: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    now = _now()
    payload = json.dumps(metadata or {}, separators=(",", ":"))
    db.execute(
        """
        INSERT INTO credit_ledger(clerk_user_id, delta, event_type, event_ref, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, delta, event_type, event_ref, payload, now),
    )
    db.execute(
        "UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE clerk_user_id = ?",
        (delta, now, user_id),
    )


def _grant_monthly_if_needed(db: sqlite3.Connection, user_id: str) -> None:
    month = _month_key()
    row = db.execute(
        "SELECT 1 FROM monthly_free_grants WHERE clerk_user_id = ? AND month_key = ?",
        (user_id, month),
    ).fetchone()
    if row:
        return
    now = _now()
    db.execute(
        "INSERT INTO monthly_free_grants(clerk_user_id, month_key, credits, granted_at) VALUES(?, ?, ?, ?)",
        (user_id, month, CONFIG.free_monthly_credits, now),
    )
    _append_ledger(
        db,
        user_id,
        delta=CONFIG.free_monthly_credits,
        event_type="monthly_free_grant",
        event_ref=month,
    )


def get_account_state(user_id: str) -> dict[str, Any]:
    with _LOCK, _conn() as db:
        _ensure_user(db, user_id)
        _grant_monthly_if_needed(db, user_id)
        user = db.execute(
            "SELECT plan_type, stripe_customer_id FROM users WHERE clerk_user_id = ?",
            (user_id,),
        ).fetchone()
        bal = db.execute(
            "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
            (user_id,),
        ).fetchone()
        db.commit()
    return {
        "user_id": user_id,
        "plan_type": user["plan_type"] if user else "free",
        "balance": int(bal["balance"]) if bal else 0,
        "free_monthly_credits": CONFIG.free_monthly_credits,
        "guidance_cost": CONFIG.guidance_cost,
        "pose_variant_cost": CONFIG.pose_variant_cost,
        "has_stripe_customer": bool(user and user["stripe_customer_id"]),
    }


def _set_counter(db: sqlite3.Connection, key: str, window_start: int, count: int) -> None:
    db.execute(
        """
        INSERT INTO rate_counters(counter_key, window_start, count)
        VALUES(?, ?, ?)
        ON CONFLICT(counter_key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count
        """,
        (key, window_start, count),
    )


def check_rate_limit(key: str, *, max_count: int, window_seconds: int) -> None:
    now = _now()
    window_start = now - (now % window_seconds)
    with _LOCK, _conn() as db:
        row = db.execute(
            "SELECT window_start, count FROM rate_counters WHERE counter_key = ?",
            (key,),
        ).fetchone()
        if not row or int(row["window_start"]) != window_start:
            _set_counter(db, key, window_start, 1)
            db.commit()
            return
        current_count = int(row["count"])
        if current_count >= max_count:
            raise_limit_error(
                code="rate_limited",
                message="Too many requests right now. Please try again soon.",
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        _set_counter(db, key, window_start, current_count + 1)
        db.commit()


def raise_limit_error(
    *,
    code: str,
    message: str,
    status_code: int,
    remaining_credits: int | None = None,
) -> None:
    detail: dict[str, Any] = {"code": code, "message": message}
    if remaining_credits is not None:
        detail["remaining_credits"] = remaining_credits
    raise HTTPException(status_code=status_code, detail=detail)


def spend_credits(
    user_id: str,
    *,
    amount: int,
    event_type: str,
    event_ref: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    if amount <= 0:
        return get_account_state(user_id)["balance"]
    with _LOCK, _conn() as db:
        _ensure_user(db, user_id)
        _grant_monthly_if_needed(db, user_id)
        bal_row = db.execute(
            "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
            (user_id,),
        ).fetchone()
        balance = int(bal_row["balance"]) if bal_row else 0
        if balance < amount:
            raise_limit_error(
                code="insufficient_credits",
                message="Not enough credits for this action.",
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                remaining_credits=balance,
            )
        _append_ledger(
            db,
            user_id,
            delta=-amount,
            event_type=event_type,
            event_ref=event_ref,
            metadata=metadata,
        )
        updated = db.execute(
            "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
            (user_id,),
        ).fetchone()
        db.commit()
        return int(updated["balance"]) if updated else 0


def add_credits(
    user_id: str,
    *,
    amount: int,
    event_type: str,
    event_ref: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    if amount <= 0:
        return get_account_state(user_id)["balance"]
    with _LOCK, _conn() as db:
        _ensure_user(db, user_id)
        _append_ledger(
            db,
            user_id,
            delta=amount,
            event_type=event_type,
            event_ref=event_ref,
            metadata=metadata,
        )
        if event_type == "stripe_checkout_completed":
            db.execute(
                "UPDATE users SET plan_type = 'paid' WHERE clerk_user_id = ?",
                (user_id,),
            )
        row = db.execute(
            "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
            (user_id,),
        ).fetchone()
        db.commit()
        return int(row["balance"]) if row else 0


def credit_refund_for_failed_job(user_id: str, job_id: str) -> int:
    with _LOCK, _conn() as db:
        row = db.execute(
            """
            SELECT id, delta FROM credit_ledger
            WHERE clerk_user_id = ? AND event_type = 'pose_variant_job' AND event_ref = ?
            LIMIT 1
            """,
            (user_id, job_id),
        ).fetchone()
        if not row:
            db.commit()
            return int(
                db.execute(
                    "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
                    (user_id,),
                ).fetchone()["balance"]
            )
        existing_refund = db.execute(
            """
            SELECT 1 FROM credit_ledger
            WHERE clerk_user_id = ? AND event_type = 'pose_variant_refund' AND event_ref = ?
            LIMIT 1
            """,
            (user_id, job_id),
        ).fetchone()
        if existing_refund:
            bal = db.execute(
                "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
                (user_id,),
            ).fetchone()
            db.commit()
            return int(bal["balance"]) if bal else 0
        debited_amount = abs(int(row["delta"]))
        if debited_amount <= 0:
            db.commit()
            bal = db.execute(
                "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
                (user_id,),
            ).fetchone()
            return int(bal["balance"]) if bal else 0
        _append_ledger(
            db,
            user_id,
            delta=debited_amount,
            event_type="pose_variant_refund",
            event_ref=job_id,
            metadata={"reason": "generation_failed"},
        )
        bal = db.execute(
            "SELECT balance FROM credit_balances WHERE clerk_user_id = ?",
            (user_id,),
        ).fetchone()
        db.commit()
        return int(bal["balance"]) if bal else 0


def _stripe_key() -> str:
    api_key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "billing_unavailable", "message": "Stripe is not configured."},
        )
    return api_key


def create_checkout_session(
    *,
    user_id: str,
    pack_id: str,
    success_url: str,
    cancel_url: str,
) -> dict[str, str]:
    if pack_id not in PACK_CREDITS:
        raise HTTPException(status_code=400, detail={"code": "invalid_pack", "message": "Invalid credit pack."})
    price_id = os.environ.get(PACK_PRICE_ENV[pack_id], "").strip()
    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "pack_unavailable", "message": "Price is not configured."},
        )
    stripe.api_key = _stripe_key()
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"clerk_user_id": user_id, "pack_id": pack_id, "credits": str(PACK_CREDITS[pack_id])},
    )
    with _LOCK, _conn() as db:
        _ensure_user(db, user_id)
        db.execute(
            """
            INSERT OR REPLACE INTO stripe_checkout_sessions(session_id, clerk_user_id, pack_id, credits, status, created_at)
            VALUES(?, ?, ?, ?, 'created', ?)
            """,
            (session.id, user_id, pack_id, PACK_CREDITS[pack_id], _now()),
        )
        db.commit()
    return {"checkout_url": str(session.url), "session_id": str(session.id)}


def handle_stripe_webhook(raw_body: bytes, signature: str | None) -> dict[str, Any]:
    stripe.api_key = _stripe_key()
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    if not webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "billing_unavailable", "message": "Stripe webhook secret is missing."},
        )
    if not signature:
        raise HTTPException(status_code=400, detail={"code": "invalid_signature", "message": "Missing signature header."})
    try:
        event = stripe.Webhook.construct_event(raw_body, signature, webhook_secret)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "invalid_signature", "message": str(exc)}) from exc
    event_id = str(event.get("id", ""))
    event_type = str(event.get("type", ""))
    if not event_id:
        raise HTTPException(status_code=400, detail={"code": "invalid_event", "message": "Missing event id."})
    with _LOCK, _conn() as db:
        existing = db.execute(
            "SELECT 1 FROM stripe_events WHERE event_id = ?",
            (event_id,),
        ).fetchone()
        if existing:
            db.commit()
            return {"ok": True, "deduped": True}

        if event_type == "checkout.session.completed":
            session = event["data"]["object"]
            session_id = str(session.get("id", ""))
            metadata = session.get("metadata") or {}
            user_id = str(metadata.get("clerk_user_id", "")).strip()
            pack_id = str(metadata.get("pack_id", "")).strip()
            credits = int(str(metadata.get("credits", "0")) or "0")
            if (not user_id or credits <= 0) and session_id:
                saved = db.execute(
                    "SELECT clerk_user_id, credits, pack_id FROM stripe_checkout_sessions WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
                if saved:
                    user_id = str(saved["clerk_user_id"])
                    credits = int(saved["credits"])
                    pack_id = str(saved["pack_id"])
            if user_id and credits > 0:
                _ensure_user(db, user_id)
                _append_ledger(
                    db,
                    user_id,
                    delta=credits,
                    event_type="stripe_checkout_completed",
                    event_ref=session_id or event_id,
                    metadata={"pack_id": pack_id},
                )
                if session_id:
                    db.execute(
                        "UPDATE stripe_checkout_sessions SET status = 'completed' WHERE session_id = ?",
                        (session_id,),
                    )
                db.execute(
                    "UPDATE users SET plan_type = 'paid' WHERE clerk_user_id = ?",
                    (user_id,),
                )

        db.execute(
            "INSERT INTO stripe_events(event_id, event_type, processed_at) VALUES(?, ?, ?)",
            (event_id, event_type, _now()),
        )
        db.commit()
    return {"ok": True, "event_type": event_type}
