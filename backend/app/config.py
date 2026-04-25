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

    # AI Model Configuration
    agent_model: str = Field(
        default="openai/gpt-4.1-mini",
        description="Model for pose generation agent",
    )
    image_model: str = Field(
        default="openai/gpt-5.4-image-2",
        description="Image generation model",
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

# Export individual settings for backward compatibility (will be removed)
OPENROUTER_API_KEY = settings.openrouter_api_key
OPENROUTER_BASE_URL = settings.openrouter_base_url
AGENT_MODEL = settings.agent_model
IMAGE_MODEL = settings.image_model
GENERATED_TTL_SECONDS = settings.generated_ttl_seconds
ALLOWED_ORIGINS = settings.allowed_origins_list
CLERK_SECRET_KEY = settings.clerk_secret_key
CLERK_AUTHORIZED_PARTIES = settings.clerk_authorized_parties_list


def validate_config() -> None:
    """Validate that required configuration is set."""
    if not settings.openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable is required")
