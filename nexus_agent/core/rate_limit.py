"""Rate limiting helpers built on top of ``slowapi``.

Usage::

    from nexus_agent.core.rate_limit import limiter

    @app.post("/inference/generate")
    @limiter.limit(get_settings().rate_limit_inference)
    async def inference_generate(request: Request, ...):
        ...

The limiter keys requests by API key (if present) or client IP so individual
keys cannot be drowned by a noisy neighbour.
"""

from __future__ import annotations

from typing import Any

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from nexus_agent.core.security import API_KEY_HEADER
from nexus_agent.core.settings import get_settings


def _key_func(request: Request) -> str:
    """Use API key when available, otherwise fall back to client IP."""

    api_key = request.headers.get(API_KEY_HEADER)
    if api_key:
        return f"key:{api_key}"
    return f"ip:{get_remote_address(request)}"


def _make_limiter() -> Limiter:
    settings = get_settings()
    kwargs: dict[str, Any] = {"key_func": _key_func, "default_limits": [settings.rate_limit_default]}
    # Use Redis as the storage backend when available for multi-replica safety.
    if settings.redis_url:
        kwargs["storage_uri"] = settings.redis_url
    return Limiter(**kwargs)


limiter = _make_limiter()
"""Process-wide ``Limiter`` instance — import from this module everywhere."""
