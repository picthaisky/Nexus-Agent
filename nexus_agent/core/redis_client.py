"""Redis client factory shared across the application.

Provides a single ``get_redis()`` accessor backed by a connection pool so we
do not create a new TCP connection per request.  If ``REDIS_URL`` is empty the
function returns ``None`` and callers should degrade gracefully.
"""

from __future__ import annotations

import logging
from typing import Optional

from nexus_agent.core.settings import get_settings

logger = logging.getLogger(__name__)

try:
    import redis  # type: ignore
except ImportError:  # pragma: no cover — handled at runtime
    redis = None  # type: ignore

_pool: Optional["redis.ConnectionPool"] = None


def get_redis() -> Optional["redis.Redis"]:
    """Return a process-wide Redis client, or ``None`` if not configured."""

    global _pool
    settings = get_settings()
    if not settings.redis_url or redis is None:
        return None
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            settings.redis_url,
            decode_responses=True,
            max_connections=50,
            socket_timeout=5,
            socket_connect_timeout=5,
        )
        logger.info("redis_pool_created")
    return redis.Redis(connection_pool=_pool)


async def ping_redis() -> bool:
    """Health-probe helper used by the readiness endpoint."""

    client = get_redis()
    if client is None:
        return False
    try:
        return bool(client.ping())
    except Exception as exc:  # pragma: no cover — connection error
        logger.warning("redis_ping_failed", extra={"error": str(exc)})
        return False
