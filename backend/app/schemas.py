"""Pydantic schemas shared by routes and agents."""

from __future__ import annotations

from pydantic import BaseModel


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
