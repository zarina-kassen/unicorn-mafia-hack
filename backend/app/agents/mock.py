"""Deterministic mock guidance agent.

Used when ``AI_PROVIDER=mock`` (the default) and as a fallback whenever the
real provider fails or times out. It does a lightweight classification of
the incoming landmarks so the UI feels responsive without requiring an API key.
"""

from __future__ import annotations

from ..schemas import GuidanceResponse, Landmark, PoseContext
from ..templates import TEMPLATE_IDS, get_template

# MediaPipe BlazePose landmark indices used for quick classification.
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_KNEE = 25
RIGHT_KNEE = 26
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_WRIST = 15
RIGHT_WRIST = 16


def _mid(a: Landmark, b: Landmark) -> tuple[float, float]:
    return ((a.x + b.x) / 2.0, (a.y + b.y) / 2.0)


def _is_visible(lm: list[Landmark], idx: int, threshold: float = 0.3) -> bool:
    return 0 <= idx < len(lm) and lm[idx].visibility >= threshold


def _person_visible(lm: list[Landmark]) -> bool:
    if len(lm) < 33:
        return False
    key = [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP]
    return sum(1 for i in key if _is_visible(lm, i)) >= 3


def _infer_posture(lm: list[Landmark]) -> str:
    """Return one of ``standing``, ``seated``, ``leaning``, ``unknown``."""
    if not _person_visible(lm):
        return "unknown"
    hip_y = _mid(lm[LEFT_HIP], lm[RIGHT_HIP])[1]
    knee_y = _mid(lm[LEFT_KNEE], lm[RIGHT_KNEE])[1] if _is_visible(lm, LEFT_KNEE) and _is_visible(lm, RIGHT_KNEE) else None
    shoulder_mid = _mid(lm[LEFT_SHOULDER], lm[RIGHT_SHOULDER])
    hip_mid = _mid(lm[LEFT_HIP], lm[RIGHT_HIP])

    torso_dx = shoulder_mid[0] - hip_mid[0]
    torso_dy = shoulder_mid[1] - hip_mid[1]

    # Leaning: torso tilted more than ~15 degrees from vertical.
    if abs(torso_dy) > 1e-3:
        tilt = abs(torso_dx) / abs(torso_dy)
        if tilt > 0.27:  # ~15°
            return "leaning"

    if knee_y is not None:
        # Seated: knees not much below hips (y increases downward).
        if knee_y - hip_y < 0.12:
            return "seated"
    return "standing"


def _hand_on_hip(lm: list[Landmark]) -> bool:
    if not _person_visible(lm):
        return False
    for wrist_idx, hip_idx in ((LEFT_WRIST, LEFT_HIP), (RIGHT_WRIST, RIGHT_HIP)):
        if not (_is_visible(lm, wrist_idx) and _is_visible(lm, hip_idx)):
            continue
        dx = lm[wrist_idx].x - lm[hip_idx].x
        dy = lm[wrist_idx].y - lm[hip_idx].y
        if (dx * dx + dy * dy) ** 0.5 < 0.08:
            return True
    return False


def _legs_crossed(lm: list[Landmark]) -> bool:
    if not (_is_visible(lm, LEFT_KNEE) and _is_visible(lm, RIGHT_KNEE)):
        return False
    # When legs are crossed the left knee tends to be to the right of the right knee
    # (or vice versa) relative to the hips.
    return (lm[LEFT_KNEE].x - lm[RIGHT_KNEE].x) > 0.02


def _classify(lm: list[Landmark]) -> str:
    posture = _infer_posture(lm)
    if posture == "seated":
        return "seated_crossed_legs" if _legs_crossed(lm) else "seated_relaxed"
    if posture == "leaning":
        return "leaning_casual"
    if posture == "standing":
        return "hand_on_hip" if _hand_on_hip(lm) else "standing_straight"
    return "standing_straight"


class MockAgent:
    """Cheap, deterministic agent that never calls out over the network."""

    provider_name = "mock"

    async def guide(self, ctx: PoseContext) -> GuidanceResponse:
        visible = _person_visible(ctx.landmarks)
        if not visible:
            return GuidanceResponse(
                recommended_template_id=ctx.candidate_template_id or "standing_straight",
                confidence=0.0,
                guidance="Step fully into frame so we can see your shoulders and hips.",
                person_visible=False,
                pose_aligned=False,
                suggest_different=False,
                reason="Key landmarks (shoulders/hips) are not sufficiently visible.",
            )

        server_pick = _classify(ctx.landmarks)
        candidate = ctx.candidate_template_id if ctx.candidate_template_id in TEMPLATE_IDS else server_pick
        pose_aligned = candidate == server_pick and ctx.local_confidence >= 0.7
        suggest_different = candidate != server_pick

        template = get_template(server_pick)
        name = template.name if template else server_pick

        if suggest_different:
            guidance = f"Try '{name}' — it looks like a closer match to your current posture."
        elif pose_aligned:
            guidance = f"Nice — you're well aligned with '{name}'. Hold it and take the shot."
        else:
            guidance = f"Getting there. Match the '{name}' outline a little more closely."

        return GuidanceResponse(
            recommended_template_id=server_pick,
            confidence=max(ctx.local_confidence, 0.55 if pose_aligned else 0.4),
            guidance=guidance,
            person_visible=True,
            pose_aligned=pose_aligned,
            suggest_different=suggest_different,
            reason=f"Posture classifier picked {server_pick}.",
        )
