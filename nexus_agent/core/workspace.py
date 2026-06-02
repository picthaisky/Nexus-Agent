"""Multi-workspace + RBAC support.

Each API key is associated with a workspace and a permission level:
  - viewer    : read-only access to tasks and results
  - operator  : can run tasks and use agents
  - admin     : full access including configuration changes

Workspaces provide logical isolation: tasks, templates, and files are
scoped to the workspace of the requesting API key.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_DATA_DIR = Path(os.environ.get("NEXUS_DATA_DIR", str(Path(__file__).resolve().parents[2])))
_DB_PATH  = _DATA_DIR / "nexus_workspace.db"

PERMISSIONS = ("viewer", "operator", "admin")


class WorkspaceStore:
    """SQLite-backed store for workspaces and API keys."""

    def __init__(self, db_path: str | Path = _DB_PATH) -> None:
        self.db_path = str(db_path)
        self._init_db()

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS workspaces (
                    workspace_id TEXT PRIMARY KEY,
                    name         TEXT NOT NULL,
                    description  TEXT NOT NULL DEFAULT '',
                    created_at   TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workspace_keys (
                    key_id       TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
                    api_key      TEXT NOT NULL UNIQUE,
                    label        TEXT NOT NULL DEFAULT '',
                    permission   TEXT NOT NULL DEFAULT 'operator',
                    is_active    INTEGER NOT NULL DEFAULT 1,
                    created_at   TEXT NOT NULL,
                    last_used_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_wkeys_api_key ON workspace_keys(api_key);
            """)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    # ── Workspaces ────────────────────────────────────────────────────────────

    def create_workspace(self, name: str, description: str = "") -> Dict[str, Any]:
        ws_id = str(uuid.uuid4())
        now   = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO workspaces (workspace_id,name,description,created_at) VALUES (?,?,?,?)",
                (ws_id, name, description, now),
            )
        return {"workspace_id": ws_id, "name": name, "description": description, "created_at": now}

    def list_workspaces(self) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT w.*, COUNT(k.key_id) AS key_count FROM workspaces w "
                "LEFT JOIN workspace_keys k ON w.workspace_id=k.workspace_id "
                "GROUP BY w.workspace_id ORDER BY w.created_at"
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_workspace(self, workspace_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM workspaces WHERE workspace_id=?", (workspace_id,))
        return r.rowcount > 0

    # ── API Keys ──────────────────────────────────────────────────────────────

    def create_key(self, workspace_id: str, label: str, permission: str = "operator") -> Dict[str, Any]:
        if permission not in PERMISSIONS:
            permission = "operator"
        key_id = str(uuid.uuid4())
        api_key = f"nxa-{secrets.token_urlsafe(32)}"
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO workspace_keys (key_id,workspace_id,api_key,label,permission,is_active,created_at) "
                "VALUES (?,?,?,?,?,1,?)",
                (key_id, workspace_id, api_key, label, permission, now),
            )
        return {
            "key_id": key_id, "workspace_id": workspace_id,
            "api_key": api_key, "label": label, "permission": permission,
            "is_active": True, "created_at": now,
        }

    def list_keys(self, workspace_id: str) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT key_id,workspace_id,label,permission,is_active,created_at,last_used_at,"
                "SUBSTR(api_key,1,8)||'...'||SUBSTR(api_key,-6) AS api_key_masked "
                "FROM workspace_keys WHERE workspace_id=? ORDER BY created_at DESC",
                (workspace_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def revoke_key(self, key_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("UPDATE workspace_keys SET is_active=0 WHERE key_id=?", (key_id,))
        return r.rowcount > 0

    def delete_key(self, key_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM workspace_keys WHERE key_id=?", (key_id,))
        return r.rowcount > 0

    def resolve_key(self, api_key: str) -> Optional[Dict[str, Any]]:
        """Resolve an API key to workspace + permission info. Returns None if invalid."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT k.*, w.name AS workspace_name FROM workspace_keys k "
                "JOIN workspaces w ON k.workspace_id=w.workspace_id "
                "WHERE k.api_key=? AND k.is_active=1",
                (api_key,),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        # Update last_used_at (non-critical, ignore errors)
        try:
            with self._conn() as conn:
                conn.execute("UPDATE workspace_keys SET last_used_at=? WHERE key_id=?",
                             (datetime.now(timezone.utc).isoformat(), d["key_id"]))
        except Exception:
            pass
        return d


workspace_store = WorkspaceStore()
