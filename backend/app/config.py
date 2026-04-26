"""Application configuration using Pydantic Settings."""

from __future__ import annotations

from typing import Final

from pydantic import Field, field_validator
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

    # OpenAI Configuration
    openai_api_key: str = Field(
        default="",
        description="OpenAI API key",
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
        description="Model for pose generation agent (OpenRouter slug)",
    )
    image_model: str = Field(
        default="black-forest-labs/flux.2-pro",
        description="Image generation model",
    )
    pose_guide_model: str = Field(
        default="google/gemini-3.1-pro-preview",
        description=(
            "Vision LLM that returns a loose hand-drawn-style silhouette polygon "
            "(normalized x,y vertices) for a generated pose image. Must support "
            "image input and JSON Schema structured outputs on OpenRouter."
        ),
    )
    agent_max_tokens: int = Field(
        default=8192,
        ge=256,
        description="Max completion tokens for the pose-target planning agent (OpenRouter bills against this cap).",
    )
    pose_guide_max_tokens: int = Field(
        default=2048,
        ge=256,
        description="Max completion tokens for vision outline JSON (small structured output).",
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

    # Clerk Authentication
    clerk_secret_key: str = Field(
        default="",
        description="Clerk secret key for authentication",
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


# Global settings instance
settings: Final[Settings] = Settings()


def validate_config(*, _settings: Settings | None = None) -> None:
    """Validate that required configuration is set."""
    cfg = _settings if _settings is not None else settings
    if not (cfg.openrouter_api_key or "").strip():
        raise ValueError("OPENROUTER_API_KEY environment variable is required")
    if not (cfg.mubit_api_key or "").strip():
        raise ValueError("MUBIT_API_KEY environment variable is required")
