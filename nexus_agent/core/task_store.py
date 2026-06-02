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


# Module-level singleton
task_store = TaskStore()
