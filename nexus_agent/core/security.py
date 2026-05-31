"""Authentication, authorization, and API-key handling.

Provides FastAPI dependencies for protecting REST and WebSocket endpoints
without dragging in a heavyweight identity provider.  Two roles are supported:

* ``viewer``  — accepts any key in ``NEXUS_API_KEYS`` *or* ``NEXUS_ADMIN_API_KEYS``.
* ``admin``   — only accepts keys in ``NEXUS_ADMIN_API_KEYS``.

For production deployments behind an enterprise IdP (Azure AD, Keycloak, …),
replace ``_verify_key`` with a JWT validator.
"""

from __future__ import annotations

import hmac
import logging
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from nexus_agent.core.settings import Settings, get_settings

logger = logging.getLogger(__name__)

API_KEY_HEADER = "x-api-key"


def _verify_key(presented: str, candidates: list[str]) -> bool:
    """Constant-time comparison of the presented key against the allow-list."""

    if not presented:
        return False
    for candidate in candidates:
        if hmac.compare_digest(presented, candidate):
            return True
    return False


class Principal:
    """Lightweight principal returned by auth dependencies."""

    __slots__ = ("role", "key_hint")

    def __init__(self, role: str, key_hint: str = "") -> None:
        self.role = role
        self.key_hint = key_hint

    def __repr__(self) -> str:  # pragma: no cover — debug helper
        return f"Principal(role={self.role!r})"


def _allowed_keys(settings: Settings, *, admin_only: bool) -> list[str]:
    if admin_only:
        return list(settings.admin_api_keys)
    return [*settings.api_keys, *settings.admin_api_keys]


def require_api_key(
    x_api_key: Optional[str] = Header(default=None, alias=API_KEY_HEADER),
    settings: Settings = Depends(get_settings),
) -> Principal:
    """FastAPI dependency — accepts viewer or admin keys."""

    if not settings.auth_enabled:
        return Principal(role="anonymous")

    if not x_api_key or not _verify_key(x_api_key, _allowed_keys(settings, admin_only=False)):
        logger.warning("Rejected unauthenticated request")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid API key.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    role = "admin" if _verify_key(x_api_key, settings.admin_api_keys) else "viewer"
    return Principal(role=role, key_hint=x_api_key[:4] + "…")


def require_admin(
    principal: Principal = Depends(require_api_key),
    settings: Settings = Depends(get_settings),
) -> Principal:
    """FastAPI dependency — requires the admin role."""

    if not settings.auth_enabled:
        return principal
    if principal.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )
    return principal


async def verify_ws_token(websocket: WebSocket, token: Optional[str] = Query(default=None)) -> Principal:
    """WebSocket auth — token is sent as a query string ``?token=...``."""

    settings = get_settings()
    if not settings.auth_enabled and not settings.ws_token:
        return Principal(role="anonymous")

    expected = settings.ws_token or next(
        iter(settings.admin_api_keys + settings.api_keys), ""
    )
    if not expected or not token or not hmac.compare_digest(token, expected):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        raise WebSocketDisconnect(code=status.WS_1008_POLICY_VIOLATION)
    return Principal(role="viewer")
