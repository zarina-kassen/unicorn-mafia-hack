"""Thin Mubit wrapper for user taste memory.

All methods fail open so camera flows keep working if memory is unavailable.
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from typing import Any

from mubit import Client

logger = logging.getLogger(__name__)

MEMORY_AGENT_ID = "framemog-pose-generator"


class MubitMemory:
    """Encapsulate remember/recall calls used by API routes."""

    def __init__(self, api_key: str, endpoint: str | None = None) -> None:
        kwargs: dict[str, Any] = {
            "api_key": api_key,
            "transport": os.getenv("MUBIT_TRANSPORT", "auto"),
            "run_id": "framemog-runtime",
        }
        if endpoint:
            kwargs["endpoint"] = endpoint
        self._client = Client(**kwargs)

    def get_personalization_block(
        self,
        *,
        user_id: str,
        scene_tags: list[str] | None,
    ) -> str:
        """Return short text block to inject into image prompts."""
        tags = ", ".join(scene_tags or []) or "unknown scene"
        query = (
            "Return concise pose/style preferences for this user for camera pose suggestions. "
            f"Current scene tags: {tags}. Prioritize negative constraints and confidence."
        )
        try:
            response = self._client.recall(
                session_id=user_id,
                agent_id=MEMORY_AGENT_ID,
                query=query,
                entry_types=["rule", "lesson", "fact"],
            )
        except Exception:  # noqa: BLE001
            logger.exception("Mubit recall failed for user=%s", user_id)
            return ""
        if not isinstance(response, dict):
            return ""
        final_answer = response.get("final_answer")
        return str(final_answer).strip() if final_answer else ""

    def rank_pose_candidates(
        self,
        *,
        user_id: str,
        candidates: list[dict[str, str]],
        scene_tags: list[str] | None,
    ) -> list[str]:
        """Return candidate ids sorted by memory alignment."""
        context = self.get_personalization_block(user_id=user_id, scene_tags=scene_tags)
        if not context:
            return [item["id"] for item in candidates]
        haystack = context.lower()

        def score(item: dict[str, str]) -> int:
            text = f"{item.get('title', '')} {item.get('prompt', '')}".lower()
            points = 0
            for token in (
                "cross",
                "relax",
                "chin",
                "side",
                "profile",
                "lean",
                "confident",
                "natural",
            ):
                if token in text and token in haystack:
                    points += 1
            return points

        ranked = sorted(candidates, key=score, reverse=True)
        return [item["id"] for item in ranked]

    def remember_onboarding_seed(
        self,
        *,
        user_id: str,
        entries: list[dict[str, Any]],
    ) -> None:
        """Store structured seed preferences from camera-roll onboarding."""
        for entry in entries:
            content = json.dumps(entry, separators=(",", ":"), ensure_ascii=True)
            try:
                self._client.remember(
                    session_id=user_id,
                    agent_id=MEMORY_AGENT_ID,
                    content=content,
                    intent="fact",
                    source="camera_roll_seed",
                    metadata={"seed": True, "version": "v1"},
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "Mubit remember onboarding failed for user=%s", user_id
                )

    def remember_feedback(
        self,
        *,
        user_id: str,
        event: str,
        pose_template_id: str | None,
        scene_tags: list[str] | None,
        outcome_score: float | None,
    ) -> None:
        lesson_type = "success" if (outcome_score or 0) >= 0.6 else "failure"
        payload = {
            "event": event,
            "pose_template_id": pose_template_id,
            "scene_tags": scene_tags or [],
            "outcome_score": outcome_score,
        }
        try:
            self._client.remember(
                session_id=user_id,
                agent_id=MEMORY_AGENT_ID,
                content=json.dumps(payload, separators=(",", ":"), ensure_ascii=True),
                intent="lesson",
                lesson_type=lesson_type,
                source="camera_live",
                metadata={"version": "v1"},
            )
        except Exception:  # noqa: BLE001
            logger.exception("Mubit remember feedback failed for user=%s", user_id)

        if event in {"favorite_saved", "share", "overlay_completed"}:
            self.reflect_session(user_id=user_id)

    def remember_preferences(
        self,
        *,
        user_id: str,
        allow_camera_roll: bool,
        allow_instagram: bool,
        allow_pinterest: bool,
    ) -> None:
        payload = {
            "allow_camera_roll": allow_camera_roll,
            "allow_instagram": allow_instagram,
            "allow_pinterest": allow_pinterest,
        }
        try:
            self._client.remember(
                session_id=user_id,
                agent_id=MEMORY_AGENT_ID,
                content=json.dumps(payload, separators=(",", ":"), ensure_ascii=True),
                intent="rule",
                source="user_settings",
                metadata={"version": "v1"},
            )
        except Exception:  # noqa: BLE001
            logger.exception("Mubit remember preferences failed for user=%s", user_id)

    def reset_user_memory(self, *, user_id: str, hard_reset: bool) -> None:
        mode = "hard" if hard_reset else "soft"
        payload = {"event": "memory_reset", "mode": mode}
        try:
            self._client.remember(
                session_id=user_id,
                agent_id=MEMORY_AGENT_ID,
                content=json.dumps(payload, separators=(",", ":"), ensure_ascii=True),
                intent="rule",
                source="user_settings",
                metadata={"version": "v1"},
            )
            if hard_reset and hasattr(self._client, "forget"):
                try:
                    self._client.forget(session_id=user_id, query="*", limit=200)  # type: ignore[call-arg]
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "Mubit hard reset forget failed for user=%s", user_id
                    )
        except Exception:  # noqa: BLE001
            logger.exception("Mubit reset memory failed for user=%s", user_id)

    def reflect_session(self, *, user_id: str) -> None:
        if not hasattr(self._client, "reflect"):
            return
        try:
            self._client.reflect(
                session_id=user_id,
                focus="Extract reusable pose/style lessons for future candidate generation.",
            )  # type: ignore[call-arg]
        except Exception:  # noqa: BLE001
            logger.exception("Mubit reflect failed for user=%s", user_id)


@lru_cache(maxsize=1)
def get_mubit_memory() -> MubitMemory | None:
    api_key = os.getenv("MUBIT_API_KEY", "").strip()
    if not api_key:
        return None
    endpoint = os.getenv("MUBIT_ENDPOINT", "").strip() or None
    return MubitMemory(api_key=api_key, endpoint=endpoint)
