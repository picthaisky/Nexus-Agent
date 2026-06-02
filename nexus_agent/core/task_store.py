"""Persistent task registry backed by SQLite.

Replaces the in-memory ``_TASK_REGISTRY`` dict so task history survives
server restarts.  Also persists the connected-repos list.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Resolve the data directory from env (set by Docker) or fall back to the repo root.
# Docker sets NEXUS_DATA_DIR=/app/data (a named volume) so SQLite files survive redeploys.
_DATA_DIR   = Path(os.environ.get("NEXUS_DATA_DIR", str(Path(__file__).resolve().parents[2])))
_DEFAULT_DB = _DATA_DIR / "nexus_local.db"


class TaskStore:
    """SQLite-backed store for task runs and connected repos."""

    def __init__(self, db_path: str | Path = _DEFAULT_DB) -> None:
        self.db_path = str(db_path)
        self._init_db()

    # ── Schema ────────────────────────────────────────────────────────────────

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS task_runs (
                    task_id     TEXT PRIMARY KEY,
                    goal        TEXT NOT NULL,
                    status      TEXT NOT NULL DEFAULT 'queued',
                    started_at  TEXT,
                    finished_at TEXT,
                    error       TEXT,
                    traceback   TEXT,
                    created_at  TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS connected_repos (
                    repo_id      TEXT PRIMARY KEY,
                    repo_url     TEXT NOT NULL,
                    branch       TEXT NOT NULL DEFAULT 'main',
                    local_path   TEXT NOT NULL,
                    status       TEXT NOT NULL DEFAULT 'connected',
                    connected_at TEXT NOT NULL,
                    last_synced  TEXT NOT NULL
                );

                -- Social media platform connections
                -- access_token is stored encrypted-at-rest via app-level AES when available,
                -- otherwise stored as plain text (sufficient for self-hosted single-tenant use).
                CREATE TABLE IF NOT EXISTS social_connections (
                    platform         TEXT PRIMARY KEY,
                    account_name     TEXT NOT NULL DEFAULT '',
                    account_id       TEXT NOT NULL DEFAULT '',
                    page_id          TEXT,
                    access_token     TEXT NOT NULL,
                    token_expires_at TEXT,
                    connected_at     TEXT NOT NULL,
                    extra            TEXT DEFAULT '{}'
                );

                -- History of social media posts made from the Content Creator
                CREATE TABLE IF NOT EXISTS social_posts (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform        TEXT NOT NULL,
                    content_snippet TEXT NOT NULL,
                    api_post_id     TEXT,
                    post_url        TEXT,
                    status          TEXT NOT NULL DEFAULT 'pending',
                    posted_at       TEXT,
                    error           TEXT,
                    created_at      TEXT NOT NULL
                );
            """)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # ── Task CRUD ─────────────────────────────────────────────────────────────

    def create_task(self, task_id: str, goal: str) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "task_id": task_id,
            "goal": goal,
            "status": "queued",
            "started_at": None,
            "finished_at": None,
            "error": None,
            "traceback": None,
            "created_at": now,
        }
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO task_runs
                   (task_id, goal, status, created_at)
                   VALUES (:task_id, :goal, :status, :created_at)""",
                row,
            )
        return row

    def update_task(self, task_id: str, **fields: Any) -> None:
        if not fields:
            return
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [task_id]
        with self._conn() as conn:
            conn.execute(
                f"UPDATE task_runs SET {set_clause} WHERE task_id = ?",
                values,
            )

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM task_runs WHERE task_id = ?", (task_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_tasks(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM task_runs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Repo CRUD ─────────────────────────────────────────────────────────────

    def upsert_repo(
        self,
        repo_id: str,
        repo_url: str,
        branch: str,
        local_path: str,
        status: str = "connected",
    ) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        existing = self.get_repo(repo_id)
        connected_at = existing["connected_at"] if existing else now
        row = {
            "repo_id": repo_id,
            "repo_url": repo_url,
            "branch": branch,
            "local_path": local_path,
            "status": status,
            "connected_at": connected_at,
            "last_synced": now,
        }
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO connected_repos
                   (repo_id, repo_url, branch, local_path, status, connected_at, last_synced)
                   VALUES (:repo_id, :repo_url, :branch, :local_path, :status, :connected_at, :last_synced)
                   ON CONFLICT(repo_id) DO UPDATE SET
                       repo_url = excluded.repo_url,
                       branch = excluded.branch,
                       local_path = excluded.local_path,
                       status = excluded.status,
                       last_synced = excluded.last_synced""",
                row,
            )
        return row

    def get_repo(self, repo_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM connected_repos WHERE repo_id = ?", (repo_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_repos(self) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM connected_repos ORDER BY last_synced DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_repo(self, repo_id: str) -> bool:
        with self._conn() as conn:
            result = conn.execute(
                "DELETE FROM connected_repos WHERE repo_id = ?", (repo_id,)
            )
        return result.rowcount > 0

    # ── Social Connections ────────────────────────────────────────────────────

    def upsert_social_connection(
        self,
        platform: str,
        account_name: str,
        account_id: str,
        access_token: str,
        page_id: str | None = None,
        token_expires_at: str | None = None,
        extra: dict | None = None,
    ) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "platform":         platform,
            "account_name":     account_name,
            "account_id":       account_id,
            "page_id":          page_id,
            "access_token":     access_token,
            "token_expires_at": token_expires_at,
            "connected_at":     now,
            "extra":            json.dumps(extra or {}),
        }
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO social_connections
                   (platform, account_name, account_id, page_id, access_token,
                    token_expires_at, connected_at, extra)
                   VALUES (:platform, :account_name, :account_id, :page_id, :access_token,
                           :token_expires_at, :connected_at, :extra)
                   ON CONFLICT(platform) DO UPDATE SET
                       account_name     = excluded.account_name,
                       account_id       = excluded.account_id,
                       page_id          = excluded.page_id,
                       access_token     = excluded.access_token,
                       token_expires_at = excluded.token_expires_at,
                       connected_at     = excluded.connected_at,
                       extra            = excluded.extra""",
                row,
            )
        return row

    def get_social_connection(self, platform: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM social_connections WHERE platform = ?", (platform,)
            ).fetchone()
        if row is None:
            return None
        d = dict(row)
        try:
            d["extra"] = json.loads(d.get("extra") or "{}")
        except Exception:
            d["extra"] = {}
        return d

    def list_social_connections(self) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT platform, account_name, account_id, page_id, token_expires_at, connected_at "
                "FROM social_connections ORDER BY connected_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_social_connection(self, platform: str) -> bool:
        with self._conn() as conn:
            result = conn.execute(
                "DELETE FROM social_connections WHERE platform = ?", (platform,)
            )
        return result.rowcount > 0

    # ── Social Posts Log ──────────────────────────────────────────────────────

    def log_social_post(
        self,
        platform: str,
        content_snippet: str,
        status: str = "pending",
        api_post_id: str | None = None,
        post_url: str | None = None,
        error: str | None = None,
    ) -> int:
        now = datetime.now(timezone.utc).isoformat()
        posted_at = now if status == "published" else None
        with self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO social_posts
                   (platform, content_snippet, api_post_id, post_url, status, posted_at, error, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (platform, content_snippet[:280], api_post_id, post_url, status, posted_at, error, now),
            )
        return cur.lastrowid or 0

    def update_social_post(self, post_id: int, **fields: Any) -> None:
        if not fields:
            return
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [post_id]
        with self._conn() as conn:
            conn.execute(f"UPDATE social_posts SET {set_clause} WHERE id = ?", values)

    def list_social_posts(self, platform: str | None = None, limit: int = 50) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if platform:
                rows = conn.execute(
                    "SELECT * FROM social_posts WHERE platform = ? ORDER BY created_at DESC LIMIT ?",
                    (platform, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM social_posts ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
        return [dict(r) for r in rows]


# Module-level singleton
task_store = TaskStore()
