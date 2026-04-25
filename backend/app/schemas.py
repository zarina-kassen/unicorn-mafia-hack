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
    """One generated pose image returned by the image generation pipeline."""

    id: str
    slot_index: int
    title: str
    instruction: str
    image_url: str
    pose_template_id: str
    replaceable: bool
    tier: str  # "fast" | "hq"
    model: str


class PoseVariantJob(BaseModel):
    """Current state of a pose-variant generation job."""

    job_id: str
    status: str  # "queued" | "generating" | "ready" | "failed"
    progress: int
    total: int
    results: list[PoseVariantResult]
    error: str | None = None


class PoseMaskRequest(BaseModel):
    """Input for LLM-based body mask extraction from one generated image."""

    image_url: str = Field(min_length=1)


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


class BillingAccountResponse(BaseModel):
    """Current billing/quota state for the signed-in user."""

    user_id: str
    plan_type: str
    balance: int
    free_monthly_credits: int
    guidance_cost: int
    pose_variant_cost: int
    has_stripe_customer: bool


class CheckoutRequest(BaseModel):
    """Create a Stripe checkout session for a credit pack."""

    pack_id: str
    success_url: str
    cancel_url: str


class CheckoutResponse(BaseModel):
    """Stripe checkout session details."""

    checkout_url: str
    session_id: str
