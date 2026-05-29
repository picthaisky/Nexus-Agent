"""Optional Sentry initialisation — no-op when ``SENTRY_DSN`` is unset."""

from __future__ import annotations

import logging

from nexus_agent.core.settings import get_settings

logger = logging.getLogger(__name__)


def init_sentry() -> bool:
    """Initialise the Sentry SDK if a DSN is configured.

    Returns ``True`` when Sentry was activated.
    """

    settings = get_settings()
    if not settings.sentry_dsn:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:  # pragma: no cover — optional dep
        logger.warning("sentry_sdk_not_installed")
        return False

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=f"{settings.app_name}@{settings.app_version}",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,  # PDPA: never auto-collect PII
        integrations=[
            FastApiIntegration(),
            StarletteIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
    logger.info("sentry_initialised", extra={"environment": settings.environment})
    return True
