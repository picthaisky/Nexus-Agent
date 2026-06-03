"""Persistent notification store + real-time push via WebSocket.

Notification categories
------------------------
task_completed  A background task finished successfully.
task_failed     A background task failed.
agent_error     An agent encountered an error.
system_alert    Infrastructure warning (high memory, quota, etc.).
info            General information.
mention         A user or agent was mentioned.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_DATA_DIR = Path(os.environ.get("NEXUS_DATA_DIR", str(Path(__file__).resolve().parents[2])))
_DB_PATH  = _DATA_DIR / "nexus_notifications.db"

CATEGORIES = ("task_completed", "task_failed", "agent_error", "system_alert", "info", "mention")


class NotificationStore:
    """SQLite-backed notification storage with in-process pub/sub."""

    def __init__(self, db_path: str | Path = _DB_PATH) -> None:
        self.db_path = str(db_path)
        self._subscribers: set = set()
        self._lock = asyncio.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._init_db()

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ── Schema ────────────────────────────────────────────────────────────────

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id          TEXT PRIMARY KEY,
                    category    TEXT NOT NULL DEFAULT 'info',
                    title       TEXT NOT NULL,
                    body        TEXT NOT NULL DEFAULT '',
                    action_url  TEXT,
                    is_read     INTEGER NOT NULL DEFAULT 0,
                    created_at  TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);
            """)

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.db_path)
        c.row_factory = sqlite3.Row
        return c

    # ── Write ─────────────────────────────────────────────────────────────────

    def create(
        self,
        category: str,
        title: str,
        body: str = "",
        action_url: str | None = None,
    ) -> Dict[str, Any]:
        if category not in CATEGORIES:
            category = "info"
        nid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "id": nid, "category": category, "title": title,
            "body": body, "action_url": action_url,
            "is_read": 0, "created_at": now,
        }
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO notifications (id,category,title,body,action_url,is_read,created_at) "
                "VALUES (:id,:category,:title,:body,:action_url,:is_read,:created_at)", row
            )
        notif = {**row, "is_read": False}
        # Push to WebSocket subscribers
        self._push_threadsafe(notif)
        return notif

    def mark_read(self, notification_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("UPDATE notifications SET is_read=1 WHERE id=?", (notification_id,))
        return r.rowcount > 0

    def mark_all_read(self) -> int:
        with self._conn() as conn:
            r = conn.execute("UPDATE notifications SET is_read=1 WHERE is_read=0")
        return r.rowcount

    def delete(self, notification_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM notifications WHERE id=?", (notification_id,))
        return r.rowcount > 0

    def clear_old(self, days: int = 30) -> int:
        with self._conn() as conn:
            r = conn.execute(
                "DELETE FROM notifications WHERE created_at < datetime('now', ?)",
                (f"-{days} days",),
            )
        return r.rowcount

    # ── Read ──────────────────────────────────────────────────────────────────

    def list(self, limit: int = 50, unread_only: bool = False) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if unread_only:
                rows = conn.execute(
                    "SELECT * FROM notifications WHERE is_read=0 ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def unread_count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM notifications WHERE is_read=0").fetchone()[0]

    @staticmethod
    def _row_to_dict(row) -> Dict[str, Any]:
        d = dict(row)
        d["is_read"] = bool(d.get("is_read", 0))
        return d

    # ── Real-time push ────────────────────────────────────────────────────────

    async def subscribe(self, websocket) -> None:
        async with self._lock:
            self._subscribers.add(websocket)
        # Hydrate: send unread notifications immediately
        unreads = self.list(limit=20, unread_only=True)
        for notif in reversed(unreads):
            try:
                await websocket.send_text(json.dumps({"event": "notification", "payload": notif}))
            except Exception:
                break

    async def unsubscribe(self, websocket) -> None:
        async with self._lock:
            self._subscribers.discard(websocket)

    async def _push(self, notif: dict) -> None:
        msg = json.dumps({"event": "notification", "payload": notif}, ensure_ascii=False, default=str)
        async with self._lock:
            subs = set(self._subscribers)
        stale: list = []
        for ws in subs:
            try:
                await ws.send_text(msg)
            except Exception:
                stale.append(ws)
        async with self._lock:
            for ws in stale:
                self._subscribers.discard(ws)

    def _push_threadsafe(self, notif: dict) -> None:
        if self._loop and self._loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self._push(notif), self._loop)
            except RuntimeError:
                pass

    # ── Convenience factory ───────────────────────────────────────────────────

    def notify_task_done(self, task_id: str, goal: str) -> None:
        self.create(
            "task_completed",
            title="Task Completed ✅",
            body=f"{goal[:80]}",
            action_url=f"/tasks/{task_id}",
        )

    def notify_task_failed(self, task_id: str, goal: str, error: str) -> None:
        self.create(
            "task_failed",
            title="Task Failed ❌",
            body=f"{goal[:60]} — {error[:80]}",
            action_url=f"/tasks/{task_id}",
        )

    def notify_system(self, title: str, body: str = "") -> None:
        self.create("system_alert", title=title, body=body)


notification_store = NotificationStore()
