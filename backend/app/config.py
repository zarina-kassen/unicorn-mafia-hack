"""Application configuration using Pydantic Settings."""

from __future__ import annotations

from typing import Final

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings with validation."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # OpenRouter Configuration
    openrouter_api_key: str = Field(
        default="",
        description="OpenRouter API key",
    )
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        description="OpenRouter base URL",
    )

    # Mubit (required for memory routes; validated at startup)
    mubit_api_key: str = Field(
        default="",
        description="Mubit API key",
    )
    mubit_endpoint: str | None = Field(
        default=None,
        description="Optional Mubit API base URL",
    )
    mubit_transport: str = Field(
        default="auto",
        description="Mubit client transport (e.g. auto, http)",
    )

    # AI Model Configuration
    agent_model: str = Field(
        default="openai/gpt-5.4-mini",
        description=(
            "Text/structured pose-target planner (OpenRouter chat model). "
            "Cannot be FLUX — FLUX only generates pixels (see FAST_IMAGE_MODEL)."
        ),
    )
    fast_image_model: str = Field(
        default="black-forest-labs/flux.2-flex",
        description=(
            "Fast FLUX image model for pose variants on OpenRouter "
            "(env FAST_IMAGE_MODEL; legacy IMAGE_MODEL also accepted)."
        ),
        validation_alias=AliasChoices("FAST_IMAGE_MODEL", "IMAGE_MODEL"),
    )
    heavy_image_model: str = Field(
        default="black-forest-labs/flux.2-pro",
        description=("High-quality FLUX image model for final captures on OpenRouter."),
    )
    mask_model: str = Field(
        default="",
        description=(
            "Image model for person-segmentation masks (OpenRouter). "
            "Defaults to FAST_IMAGE_MODEL if empty."
        ),
        validation_alias=AliasChoices("MASK_MODEL"),
    )
    pose_guide_model: str = Field(
        default="",
        description=(
            "Vision LLM for silhouette JSON (image in, strict JSON Schema out). "
            "Cannot be FLUX — pick any OpenRouter vision+JSON-capable chat model. "
            "Defaults to AGENT_MODEL if empty."
        ),
    )
    onboarding_vision_model: str = Field(
        default="openai/gpt-4.1-mini",
        description=(
            "Vision model for onboarding image extraction (OpenRouter slug). "
            "Analyses selfie uploads and extracts pose/style/scene tags."
        ),
    )
    agent_max_tokens: int = Field(
        default=4096,
        ge=256,
        description="Max completion tokens for the Pydantic AI pose-target planner.",
    )
    pose_guide_max_tokens: int = Field(
        default=768,
        ge=256,
        description="Max completion tokens for silhouette JSON (small structured output).",
    )
    pose_variant_image_size: str = Field(
        default="1K",
        description="OpenRouter image_config.image_size for generated portraits (model-dependent).",
    )
    pose_reference_max_edge_px: int = Field(
        default=720,
        ge=320,
        le=2048,
        description="Max longest edge (px) for reference frame sent to image + vision APIs.",
    )
    pose_outline_vision_max_edge_px: int = Field(
        default=512,
        ge=256,
        le=1024,
        description="Max longest edge for images sent to POSE_GUIDE_MODEL.",
    )
    pose_stored_image_max_edge_px: int = Field(
        default=768,
        ge=320,
        le=2048,
        description="Cap stored generated image size before DB (smaller = faster UI).",
    )
    pose_jpeg_quality: int = Field(
        default=78,
        ge=50,
        le=95,
        description="JPEG quality for downscaled pipeline images (lower = smaller/faster).",
    )

    # Database Configuration
    database_url: str = Field(
        default="",
        description="PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db)",
    )

    # Storage Configuration
    generated_ttl_seconds: int = Field(
        default=6 * 60 * 60,
        description="TTL for generated images in seconds",
    )

    # CORS Configuration
    allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        description="Comma-separated list of allowed CORS origins",
    )

    # Logfire Observability
    logfire_token: str = Field(
        default="",
        description="Logfire write token for sending telemetry (read by logfire SDK via LOGFIRE_TOKEN env var)",
    )

    # Clerk Authentication
    clerk_secret_key: str = Field(
        default="",
        description="Clerk secret key for authentication",
    )
    clerk_jwt_key: str = Field(
        default="",
        description="Optional Clerk JWT verification public key (PEM)",
    )
    clerk_authorized_parties: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        description="Comma-separated list of authorized parties for Clerk",
    )

    @field_validator("generated_ttl_seconds")
    @classmethod
    def validate_ttl(cls, v: int) -> int:
        """Ensure TTL is positive."""
        if v <= 0:
            raise ValueError("TTL must be positive")
        return v

    @property
    def allowed_origins_list(self) -> list[str]:
        """Parse allowed origins into a list."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def clerk_authorized_parties_list(self) -> list[str]:
        """Parse authorized parties into a list."""
        return [
            p.strip() for p in self.clerk_authorized_parties.split(",") if p.strip()
        ]

    @property
    def resolved_mask_model(self) -> str:
        """Resolve mask model to FAST_IMAGE_MODEL if empty."""
        return self.mask_model or self.fast_image_model

    @property
    def resolved_pose_guide_model(self) -> str:
        """Resolve pose guide model to AGENT_MODEL if empty."""
        return self.pose_guide_model or self.agent_model


# Global settings instance
settings: Final[Settings] = Settings()


def validate_config(*, _settings: Settings | None = None) -> None:
    """Validate that required configuration is set."""
    cfg = _settings if _settings is not None else settings
    if not (cfg.openrouter_api_key or "").strip():
        raise ValueError("OPENROUTER_API_KEY environment variable is required")
    if not (cfg.mubit_api_key or "").strip():
        raise ValueError("MUBIT_API_KEY environment variable is required")
    if not (cfg.clerk_secret_key or "").strip():
        raise ValueError("CLERK_SECRET_KEY environment variable is required")
    if not (cfg.database_url or "").strip():
        raise ValueError("DATABASE_URL environment variable is required")
