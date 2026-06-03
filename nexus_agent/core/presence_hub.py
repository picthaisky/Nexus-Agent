"""Real-time presence tracking hub.

Tracks connected browser sessions and broadcasts presence events so the
dashboard can display who is online and their current activity.

Event types (sent over /ws/presence)
--------------------------------------
snapshot        Full roster of online users on connect.
user_joined     A new browser session connected.
user_left       A session disconnected.
user_status     A user changed their status message or activity.
ping            Server keepalive every 30 s (clients should not display).
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from typing import Any, Dict, Optional, Set

logger = logging.getLogger(__name__)

# ── User / session model ──────────────────────────────────────────────────────

class PresenceUser:
    __slots__ = ("session_id", "name", "avatar_color", "status", "activity", "connected_at", "last_seen")

    STATUS_COLORS = [
        "#5fe1ff", "#36c987", "#d4af37", "#e879a0", "#9b59b6",
        "#1d83b8", "#c2783a", "#d94d4d",
    ]

    def __init__(self, session_id: str, name: str = "") -> None:
        self.session_id   = session_id
        self.name         = name or f"User-{session_id[:6]}"
        self.avatar_color = self.STATUS_COLORS[hash(session_id) % len(self.STATUS_COLORS)]
        self.status       = "online"          # online | away | busy
        self.activity     = ""                # free-text: "Monitoring agents", "Running task"
        self.connected_at = time.time()
        self.last_seen    = time.time()

    def to_dict(self) -> dict:
        return {
            "session_id":   self.session_id,
            "name":         self.name,
            "avatar_color": self.avatar_color,
            "status":       self.status,
            "activity":     self.activity,
            "connected_at": self.connected_at,
            "last_seen":    self.last_seen,
        }


# ── Hub ───────────────────────────────────────────────────────────────────────

class PresenceHub:
    """Manages online users and broadcasts presence events."""

    def __init__(self) -> None:
        self._sessions:  Dict[str, PresenceUser]  = {}
        self._websockets: Dict[str, Any]          = {}  # session_id → ws
        self._lock   = asyncio.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ping_task: Optional[asyncio.Task] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        # Start keepalive ping task
        self._ping_task = loop.create_task(self._keepalive())

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, websocket, name: str = "") -> str:
        """Register a new session. Returns the generated session_id."""
        session_id = secrets.token_hex(8)
        user       = PresenceUser(session_id, name)

        async with self._lock:
            self._sessions[session_id]  = user
            self._websockets[session_id] = websocket

        await websocket.accept()
        # Send full roster snapshot to the new client
        await websocket.send_text(json.dumps({
            "event": "snapshot",
            "users": [u.to_dict() for u in self._sessions.values()],
            "your_session_id": session_id,
        }))
        # Broadcast join to everyone else
        await self._broadcast("user_joined", user.to_dict(), exclude=session_id)
        logger.debug("presence: %s joined (%s)", user.name, session_id)
        return session_id

    async def disconnect(self, session_id: str) -> None:
        async with self._lock:
            user = self._sessions.pop(session_id, None)
            self._websockets.pop(session_id, None)

        if user:
            await self._broadcast("user_left", {"session_id": session_id, "name": user.name})
            logger.debug("presence: %s left", user.name)

    # ── Status updates ────────────────────────────────────────────────────────

    async def update_status(self, session_id: str, status: str = "", activity: str = "") -> None:
        async with self._lock:
            user = self._sessions.get(session_id)
        if not user:
            return
        if status:  user.status   = status
        if activity: user.activity = activity
        user.last_seen = time.time()
        await self._broadcast("user_status", user.to_dict())

    def update_status_threadsafe(self, session_id: str, **kwargs: str) -> None:
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self.update_status(session_id, **kwargs), self._loop
            )

    # ── Broadcast ────────────────────────────────────────────────────────────

    async def _broadcast(self, event: str, payload: dict, exclude: str | None = None) -> None:
        msg = json.dumps({"event": event, "payload": payload}, ensure_ascii=False, default=str)
        async with self._lock:
            targets = dict(self._websockets)
        stale: list[str] = []
        for sid, ws in targets.items():
            if sid == exclude:
                continue
            try:
                await ws.send_text(msg)
            except Exception:
                stale.append(sid)
        for sid in stale:
            await self.disconnect(sid)

    # ── Keepalive ─────────────────────────────────────────────────────────────

    async def _keepalive(self) -> None:
        while True:
            await asyncio.sleep(30)
            ping = json.dumps({"event": "ping", "ts": time.time()})
            async with self._lock:
                targets = dict(self._websockets)
            for sid, ws in targets.items():
                try:
                    await ws.send_text(ping)
                except Exception:
                    await self.disconnect(sid)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def online_count(self) -> int:
        return len(self._sessions)

    def get_users(self) -> list[dict]:
        return [u.to_dict() for u in self._sessions.values()]


presence_hub = PresenceHub()
