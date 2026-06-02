"""Prompt Version Control — store, version, and apply agent system prompts."""
from __future__ import annotations

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
_DB_PATH  = _DATA_DIR / "nexus_prompts.db"


class PromptStore:
    """SQLite-backed store for versioned agent prompts."""

    def __init__(self, db_path: str | Path = _DB_PATH) -> None:
        self.db_path = str(db_path)
        self._init_db()

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS prompt_versions (
                    version_id  TEXT PRIMARY KEY,
                    agent_role  TEXT NOT NULL,
                    name        TEXT NOT NULL,
                    content     TEXT NOT NULL,
                    is_active   INTEGER NOT NULL DEFAULT 0,
                    version_num INTEGER NOT NULL DEFAULT 1,
                    notes       TEXT NOT NULL DEFAULT '',
                    created_at  TEXT NOT NULL
                );
            """)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def create_version(self, agent_role: str, name: str, content: str, notes: str = "") -> Dict[str, Any]:
        # Find next version number for this role
        with self._conn() as conn:
            row = conn.execute(
                "SELECT MAX(version_num) FROM prompt_versions WHERE agent_role=?", (agent_role,)
            ).fetchone()
            next_ver = (row[0] or 0) + 1
            version_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT INTO prompt_versions (version_id,agent_role,name,content,is_active,version_num,notes,created_at) "
                "VALUES (?,?,?,?,0,?,?,?)",
                (version_id, agent_role, name, content, next_ver, notes, now),
            )
        return self.get_version(version_id) or {}

    def list_versions(self, agent_role: str | None = None) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if agent_role:
                rows = conn.execute(
                    "SELECT * FROM prompt_versions WHERE agent_role=? ORDER BY version_num DESC", (agent_role,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM prompt_versions ORDER BY agent_role, version_num DESC"
                ).fetchall()
        return [dict(r) for r in rows]

    def get_version(self, version_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM prompt_versions WHERE version_id=?", (version_id,)).fetchone()
        return dict(row) if row else None

    def get_active_prompt(self, agent_role: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM prompt_versions WHERE agent_role=? AND is_active=1 ORDER BY version_num DESC LIMIT 1",
                (agent_role,),
            ).fetchone()
        return dict(row) if row else None

    def activate_version(self, version_id: str) -> bool:
        v = self.get_version(version_id)
        if not v:
            return False
        with self._conn() as conn:
            conn.execute("UPDATE prompt_versions SET is_active=0 WHERE agent_role=?", (v["agent_role"],))
            conn.execute("UPDATE prompt_versions SET is_active=1 WHERE version_id=?", (version_id,))
        return True

    def delete_version(self, version_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM prompt_versions WHERE version_id=?", (version_id,))
        return r.rowcount > 0

    def get_active_roles(self) -> List[str]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT DISTINCT agent_role FROM prompt_versions WHERE is_active=1"
            ).fetchall()
        return [r[0] for r in rows]


prompt_store = PromptStore()
