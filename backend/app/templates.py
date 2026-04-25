"""Predefined pose template metadata.

Normalized landmark geometry lives in the frontend template module because
that is where matching and rendering happens. The backend only needs the
identifiers, names, and high-level descriptions so the agent can reason about
which template best fits a scene.
"""

from __future__ import annotations

from .schemas import TemplateMeta

TEMPLATES: list[TemplateMeta] = [
    TemplateMeta(
        id="standing_straight",
        name="Standing straight",
        description="Subject standing upright, arms relaxed at sides, shoulders level.",
        posture="standing",
    ),
    TemplateMeta(
        id="hand_on_hip",
        name="Hand on hip",
        description="Standing with one hand placed on the hip, opposite arm relaxed.",
        posture="standing",
    ),
    TemplateMeta(
        id="seated_relaxed",
        name="Seated relaxed",
        description="Seated upright with both feet on the floor, hands resting on lap.",
        posture="seated",
    ),
    TemplateMeta(
        id="seated_crossed_legs",
        name="Seated, crossed legs",
        description="Seated with one leg crossed over the other, torso upright.",
        posture="seated",
    ),
    TemplateMeta(
        id="leaning_casual",
        name="Leaning casual",
        description="Standing with slight lean to one side, weight on one leg.",
        posture="standing",
    ),
]

TEMPLATE_IDS = [t.id for t in TEMPLATES]


def get_template(template_id: str) -> TemplateMeta | None:
    for t in TEMPLATES:
        if t.id == template_id:
            return t
    return None
