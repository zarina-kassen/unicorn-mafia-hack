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


class PoseOutlinePoint(BaseModel):
    """One vertex of a silhouette outline in normalized image coordinates."""

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)


class PoseOutlineResponse(BaseModel):
    """Closed silhouette polygon plus source image pixel size for mapping."""

    polygon: list[PoseOutlinePoint] = Field(min_length=16, max_length=28)
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    source: str = Field(min_length=1)
    model: str = Field(min_length=1)


class PoseStreamItem(BaseModel):
    """One streamed pose variant with its silhouette outline."""

    pose: PoseVariantResult
    outline: PoseOutlineResponse


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


# --- LinkedIn post agent ---


class LinkedInConnectionStatus(BaseModel):
    """Whether the user has connected LinkedIn (server-side token)."""

    connected: bool


class LinkedInOAuthStartResponse(BaseModel):
    """Browser should navigate to this URL to complete OAuth."""

    authorization_url: str
    state: str


class VisionDimensionPublic(BaseModel):
    """Four vision scores 0..10 and their mean."""

    composition: float
    pose_quality: float
    lighting: float
    expression: float
    average: float


class ScoredPhotoPublic(BaseModel):
    """One image after vision scoring."""

    photo_id: str
    dimensions: VisionDimensionPublic


class SequencedPhotoPublic(BaseModel):
    """Devin-ordered row with a reason."""

    photo_id: str
    order_index: int
    reason: str
    client_id: str | None = None


class LinkedInPipelineResponse(BaseModel):
    """Result after vision rank + top-6 + Devin ordering."""

    mubit_context: str
    photos_scored: list[ScoredPhotoPublic]
    top_six: list[ScoredPhotoPublic]
    sequence: list[SequencedPhotoPublic]
    # IDs of photos stored for this run (to publish in confirm step)
    stored_photo_ids: list[str]


class LinkedInPublishRequest(BaseModel):
    """Confirm publish after reviewing sequence."""

    ordered_photo_ids: list[str] = Field(
        min_length=1, description="Include every image to post, in final order"
    )
    as_draft: bool = True
    sequence: list[SequencedPhotoPublic] | None = None


class LinkedInPublishResponse(BaseModel):
    """UGC result."""

    post_urn: str
    demo: bool
