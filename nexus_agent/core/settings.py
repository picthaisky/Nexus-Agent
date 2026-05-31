"""Centralised Pydantic settings for Nexus-Agent.

All runtime configuration is read from environment variables (or a ``.env`` file
in development).  Using a single ``Settings`` instance gives us:

* Type-checked configuration (no scattered ``os.getenv`` with stringly-typed defaults).
* A single place to document every knob.
* Easy mocking in tests via ``Settings(**overrides)``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, List, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


CsvList = Annotated[List[str], NoDecode]


class Settings(BaseSettings):
    """Single source of truth for runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────────────────────
    app_name: str = "Nexus-Agent"
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")
    environment: Literal["development", "staging", "production"] = Field(
        default="production", alias="ENVIRONMENT"
    )
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # ── Security ─────────────────────────────────────────────────────────
    # Comma-separated list of accepted API keys.  Empty list disables auth
    # (NOT recommended outside development).
    api_keys: CsvList = Field(default_factory=list, alias="NEXUS_API_KEYS")
    admin_api_keys: CsvList = Field(default_factory=list, alias="NEXUS_ADMIN_API_KEYS")
    auth_required: bool = Field(default=True, alias="NEXUS_AUTH_REQUIRED")
    ws_token: str = Field(default="", alias="NEXUS_WS_TOKEN")
    cors_origins: CsvList = Field(default_factory=lambda: ["*"], alias="CORS_ORIGINS")

    # ── Rate limiting ────────────────────────────────────────────────────
    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    rate_limit_default: str = Field(default="60/minute", alias="RATE_LIMIT_DEFAULT")
    rate_limit_inference: str = Field(default="20/minute", alias="RATE_LIMIT_INFERENCE")

    # ── Data stores ──────────────────────────────────────────────────────
    database_url: str = Field(default="", alias="DATABASE_URL")
    redis_url: str = Field(default="", alias="REDIS_URL")
    db_pool_size: int = Field(default=10, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=20, alias="DB_MAX_OVERFLOW")

    # ── Observability ────────────────────────────────────────────────────
    sentry_dsn: str = Field(default="", alias="SENTRY_DSN")
    sentry_traces_sample_rate: float = Field(default=0.1, alias="SENTRY_TRACES_SAMPLE_RATE")
    metrics_enabled: bool = Field(default=True, alias="METRICS_ENABLED")
    json_logs: bool = Field(default=True, alias="JSON_LOGS")

    # ── LLM providers (mirror existing inference.py contract) ────────────
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    vllm_enabled: bool = Field(default=False, alias="VLLM_ENABLED")

    # ── Reliability ──────────────────────────────────────────────────────
    inference_timeout_seconds: float = Field(default=60.0, alias="INFERENCE_TIMEOUT_SECONDS")
    inference_max_retries: int = Field(default=3, alias="INFERENCE_MAX_RETRIES")
    circuit_breaker_threshold: int = Field(default=5, alias="CIRCUIT_BREAKER_THRESHOLD")
    circuit_breaker_reset_seconds: int = Field(default=60, alias="CIRCUIT_BREAKER_RESET_SECONDS")

    # ── Validators ───────────────────────────────────────────────────────
    @field_validator("api_keys", "admin_api_keys", "cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, value):  # noqa: D401 — pydantic validator
        if value is None or value == "":
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _validate_auth(self):
        if self.auth_required and not (self.api_keys or self.admin_api_keys):
            import warnings
            warnings.warn(
                "NEXUS_AUTH_REQUIRED is true but neither NEXUS_API_KEYS nor NEXUS_ADMIN_API_KEYS are set. "
                "Auth is effectively DISABLED. Do not use this in production!",
                stacklevel=2,
            )
        return self

    # ── Convenience flags ────────────────────────────────────────────────
    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def auth_enabled(self) -> bool:
        return self.auth_required and bool(self.api_keys or self.admin_api_keys)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor — safe to call from any module."""

    return Settings()  # type: ignore[call-arg]
