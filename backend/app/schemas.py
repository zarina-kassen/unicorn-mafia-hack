"""Pydantic schemas shared by routes and agents."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Landmark(BaseModel):
    """A single normalized MediaPipe pose landmark.

    MediaPipe outputs x/y in image-relative normalized coordinates (0..1),
    z relative to the hip, and a visibility score in [0, 1].
    """

    x: float
    y: float
    z: float = 0.0
    visibility: float = 0.0


class PoseContext(BaseModel):
    """Lightweight payload sent from the browser once per ~1.5s.

    We intentionally send only landmarks + a small amount of metadata so the
    request is cheap and the agent does not have to do real-time tracking.
    """

    landmarks: list[Landmark] = Field(default_factory=list)
    candidate_template_id: str
    local_confidence: float = Field(ge=0.0, le=1.0)
    image_wh: tuple[int, int] = (0, 0)
    snapshot_b64: str | None = None


class GuidanceResponse(BaseModel):
    """Structured output returned by the guidance agent."""

    recommended_template_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    guidance: str
    person_visible: bool
    pose_aligned: bool
    suggest_different: bool
    reason: str


class TemplateMeta(BaseModel):
    """Metadata describing a pose template that the agent may reference."""

    id: str
    name: str
    description: str
    posture: str  # "standing" | "seated" | "leaning"


class PoseVariantResult(BaseModel):
    """A generated pose variant returned to the frontend gallery."""

    id: str
    title: str
    instruction: str
    image_url: str
    pose_template_id: str
    replaceable: bool = False


class PoseVariantJob(BaseModel):
    """Status payload for asynchronous pose-variant generation."""

    job_id: str
    status: str  # "queued" | "generating" | "ready" | "failed"
    progress: int = Field(ge=0, le=10)
    total: int = 10
    results: list[PoseVariantResult] = Field(default_factory=list)
    error: str | None = None
