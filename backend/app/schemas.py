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


class PoseTarget(BaseModel):
    """A dynamically generated pose target with landmarks and metadata."""

    id: str
    title: str
    instruction: str
    rationale: str
    target_landmarks: list[Landmark]
    image_url: str | None = None
    replaceable: bool = True


class PoseTargetSpec(BaseModel):
    """Specification for generating a pose target."""

    title: str
    instruction: str
    rationale: str
    approximate_landmarks: list[Landmark]


class PoseVariantResult(BaseModel):
    """One generated pose image returned by the image generation pipeline."""

    id: str
    slot_index: int
    title: str
    instruction: str
    image_url: str
    target_id: str
    target_landmarks: list[Landmark]
    replaceable: bool
    tier: str  # "fast" | "hq"
    model: str


class ImageUrl(BaseModel):
    """Image URL structure from OpenRouter response."""

    url: str


class OpenRouterImage(BaseModel):
    """Image structure from OpenRouter chat completions response."""

    type: str = "image_url"
    image_url: ImageUrl


class PoseMaskResponse(BaseModel):
    """Mask image metadata returned by the LLM extraction pipeline."""

    mask_url: str = Field(min_length=1)
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    source: str = Field(min_length=1)


class MemorySeedEntry(BaseModel):
    """A single onboarding reference with extracted preference tags."""

    source_ref: str
    pose_tags: list[str] = Field(default_factory=list)
    style_tags: list[str] = Field(default_factory=list)
    composition_tags: list[str] = Field(default_factory=list)
    scene_tags: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class MemoryStatusResponse(BaseModel):
    """Simple response for memory write operations."""

    ok: bool


class MemoryPreferencesRequest(BaseModel):
    """Privacy and learning controls for memory sources."""

    allow_camera_roll: bool = True
    allow_instagram: bool = False
    allow_pinterest: bool = False


class MemoryResetRequest(BaseModel):
    """Clear or reduce remembered user taste profile."""

    hard_reset: bool = False
