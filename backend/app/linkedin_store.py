"""SQLite persistence for LinkedIn-saved photos and OAuth tokens."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_LOCK = threading.Lock()
_DB_PATH = Path(
    os.environ.get(
        "LINKEDIN_DB_PATH",
        str(Path(__file__).resolve().parents[1] / "linkedin.sqlite3"),
    )
)


@dataclass(frozen=True)
class SavedPhotoRow:
    id: str
    clerk_user_id: str
    created_at: int
    pose_name: str
    confidence: float
    occasion_type: str
    image_relpath: str
    content_type: str
    extra: dict[str, Any]


@dataclass(frozen=True)
class LinkedInTokenRow:
    clerk_user_id: str
    access_token: str
    refresh_token: str | None
    expires_at: int
    linkedin_member_id: str | None


def _conn() -> sqlite3.Connection:
    db = sqlite3.connect(_DB_PATH, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


def init_linkedin_store() -> None:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, _conn() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS saved_photos (
                id TEXT PRIMARY KEY,
                clerk_user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                pose_name TEXT NOT NULL,
                confidence REAL NOT NULL,
                occasion_type TEXT NOT NULL,
                image_relpath TEXT NOT NULL,
                content_type TEXT NOT NULL,
                extra_json TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_saved_photos_user
                ON saved_photos (clerk_user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS linkedin_tokens (
                clerk_user_id TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at INTEGER NOT NULL,
                linkedin_member_id TEXT
            );

            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                clerk_user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            """
        )


def _parse_extra(row: sqlite3.Row) -> dict[str, Any]:
    raw = row["extra_json"]
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        return dict(val) if isinstance(val, dict) else {}
    except Exception:
        return {}


def insert_saved_photo(
    *,
    clerk_user_id: str,
    pose_name: str,
    confidence: float,
    occasion_type: str,
    image_relpath: str,
    content_type: str,
    extra: dict[str, Any] | None = None,
    photo_id: str | None = None,
) -> str:
    pid = photo_id or uuid.uuid4().hex
    now = int(time.time())
    extra_s = json.dumps(extra or {}, separators=(",", ":"), ensure_ascii=True)
    with _LOCK, _conn() as db:
        db.execute(
            """
            INSERT INTO saved_photos (
                id, clerk_user_id, created_at, pose_name, confidence, occasion_type,
                image_relpath, content_type, extra_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                clerk_user_id,
                now,
                pose_name,
                confidence,
                occasion_type,
                image_relpath,
                content_type,
                extra_s,
            ),
        )
        db.commit()
    return pid


def get_saved_photos_for_user(user_id: str) -> list[SavedPhotoRow]:
    with _LOCK, _conn() as db:
        cur = db.execute(
            """
            SELECT id, clerk_user_id, created_at, pose_name, confidence, occasion_type,
                   image_relpath, content_type, extra_json
            FROM saved_photos
            WHERE clerk_user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    return [
        SavedPhotoRow(
            id=r["id"],
            clerk_user_id=r["clerk_user_id"],
            created_at=int(r["created_at"]),
            pose_name=r["pose_name"],
            confidence=float(r["confidence"]),
            occasion_type=r["occasion_type"],
            image_relpath=r["image_relpath"],
            content_type=r["content_type"],
            extra=_parse_extra(r),
        )
        for r in rows
    ]


def get_saved_photo(user_id: str, photo_id: str) -> SavedPhotoRow | None:
    with _LOCK, _conn() as db:
        cur = db.execute(
            """
            SELECT id, clerk_user_id, created_at, pose_name, confidence, occasion_type,
                   image_relpath, content_type, extra_json
            FROM saved_photos
            WHERE clerk_user_id = ? AND id = ?
            """,
            (user_id, photo_id),
        )
        r = cur.fetchone()
    if not r:
        return None
    return SavedPhotoRow(
        id=r["id"],
        clerk_user_id=r["clerk_user_id"],
        created_at=int(r["created_at"]),
        pose_name=r["pose_name"],
        confidence=float(r["confidence"]),
        occasion_type=r["occasion_type"],
        image_relpath=r["image_relpath"],
        content_type=r["content_type"],
        extra=_parse_extra(r),
    )


def create_oauth_state(*, clerk_user_id: str) -> str:
    state = f"{uuid.uuid4().hex}{uuid.uuid4().hex}"
    now = int(time.time())
    with _LOCK, _conn() as db:
        db.execute("DELETE FROM oauth_states WHERE created_at < ?", (now - 600,))
        db.execute(
            "INSERT INTO oauth_states (state, clerk_user_id, created_at) VALUES (?, ?, ?)",
            (state, clerk_user_id, now),
        )
        db.commit()
    return state


def take_oauth_state(state: str) -> str | None:
    now = int(time.time())
    with _LOCK, _conn() as db:
        db.execute("DELETE FROM oauth_states WHERE created_at < ?", (now - 600,))
        cur = db.execute(
            "SELECT clerk_user_id FROM oauth_states WHERE state = ?",
            (state,),
        )
        row = cur.fetchone()
        if not row:
            return None
        user_id: str = row["clerk_user_id"]
        db.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
        db.commit()
    return user_id


def upsert_linkedin_tokens(
    *,
    clerk_user_id: str,
    access_token: str,
    refresh_token: str | None,
    expires_in_seconds: int,
    linkedin_member_id: str | None = None,
) -> None:
    expires_at = int(time.time()) + max(60, expires_in_seconds) - 120
    with _LOCK, _conn() as db:
        cur = db.execute(
            "SELECT linkedin_member_id FROM linkedin_tokens WHERE clerk_user_id = ?",
            (clerk_user_id,),
        )
        old = cur.fetchone()
        existing_mid = (
            str(old["linkedin_member_id"])
            if old and old["linkedin_member_id"]
            else None
        )
        member_id = linkedin_member_id or existing_mid
        db.execute(
            """
            INSERT INTO linkedin_tokens (
                clerk_user_id, access_token, refresh_token, expires_at, linkedin_member_id
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (clerk_user_id) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = COALESCE(excluded.refresh_token, linkedin_tokens.refresh_token),
                expires_at = excluded.expires_at,
                linkedin_member_id = COALESCE(
                    excluded.linkedin_member_id, linkedin_tokens.linkedin_member_id
                )
            """,
            (clerk_user_id, access_token, refresh_token, expires_at, member_id),
        )
        db.commit()


def set_linkedin_member_id(clerk_user_id: str, member_id: str) -> None:
    with _LOCK, _conn() as db:
        db.execute(
            "UPDATE linkedin_tokens SET linkedin_member_id = ? WHERE clerk_user_id = ?",
            (member_id, clerk_user_id),
        )
        db.commit()


def get_linkedin_tokens(clerk_user_id: str) -> LinkedInTokenRow | None:
    with _LOCK, _conn() as db:
        cur = db.execute(
            """
            SELECT clerk_user_id, access_token, refresh_token, expires_at, linkedin_member_id
            FROM linkedin_tokens WHERE clerk_user_id = ?
            """,
            (clerk_user_id,),
        )
        r = cur.fetchone()
    if not r:
        return None
    return LinkedInTokenRow(
        clerk_user_id=r["clerk_user_id"],
        access_token=r["access_token"],
        refresh_token=r["refresh_token"],
        expires_at=int(r["expires_at"]),
        linkedin_member_id=r["linkedin_member_id"],
    )


def update_linkedin_access_token(
    *, clerk_user_id: str, access_token: str, expires_in_seconds: int
) -> None:
    expires_at = int(time.time()) + max(60, expires_in_seconds) - 120
    with _LOCK, _conn() as db:
        db.execute(
            """
            UPDATE linkedin_tokens
            SET access_token = ?, expires_at = ?
            WHERE clerk_user_id = ?
            """,
            (access_token, expires_at, clerk_user_id),
        )
        db.commit()
