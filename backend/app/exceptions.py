"""Custom exceptions for the application."""

from __future__ import annotations


class ApplicationException(Exception):
    """Base exception for application-specific errors."""

    def __init__(self, message: str, *, detail: str | None = None) -> None:
        self.message = message
        self.detail = detail or message
        super().__init__(self.message)


class ConfigurationError(ApplicationException):
    """Raised when configuration is invalid or missing."""

    pass


class AuthenticationError(ApplicationException):
    """Raised when authentication fails."""

    pass


class ValidationError(ApplicationException):
    """Raised when request validation fails."""

    pass


class ExternalServiceError(ApplicationException):
    """Raised when an external service (OpenRouter, etc.) fails."""

    def __init__(
        self,
        message: str,
        *,
        service_name: str,
        detail: str | None = None,
        original_error: Exception | None = None,
    ) -> None:
        self.service_name = service_name
        self.original_error = original_error
        super().__init__(message, detail=detail)


class StorageError(ApplicationException):
    """Raised when storage operations fail."""

    pass


class ImageGenerationError(ExternalServiceError):
    """Raised when image generation fails."""

    def __init__(
        self,
        message: str,
        *,
        model: str,
        detail: str | None = None,
        original_error: Exception | None = None,
    ) -> None:
        self.model = model
        super().__init__(
            message,
            service_name="OpenRouter",
            detail=detail,
            original_error=original_error,
        )


class PoseGenerationError(ExternalServiceError):
    """Raised when pose generation fails."""

    def __init__(
        self,
        message: str,
        *,
        detail: str | None = None,
        original_error: Exception | None = None,
    ) -> None:
        super().__init__(
            message,
            service_name="PydanticAI",
            detail=detail,
            original_error=original_error,
        )
