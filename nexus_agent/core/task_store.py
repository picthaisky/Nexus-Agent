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

                -- Priority column for task_runs (added separately below)

                -- Webhook registrations (incoming HTTP triggers)
                CREATE TABLE IF NOT EXISTS webhooks (
                    webhook_id   TEXT PRIMARY KEY,
                    name         TEXT NOT NULL,
                    goal_template TEXT NOT NULL,
                    secret_token TEXT NOT NULL,
                    enabled      INTEGER NOT NULL DEFAULT 1,
                    hit_count    INTEGER NOT NULL DEFAULT 0,
                    created_at   TEXT NOT NULL
                );

                -- Chat / conversation sessions
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    session_id   TEXT PRIMARY KEY,
                    title        TEXT NOT NULL DEFAULT 'New Chat',
                    agent_role   TEXT NOT NULL DEFAULT 'planner',
                    created_at   TEXT NOT NULL,
                    updated_at   TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    message_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id   TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
                    role         TEXT NOT NULL,
                    content      TEXT NOT NULL,
                    created_at   TEXT NOT NULL
                );

                -- Task priority queue support (priority 1=highest, 5=lowest)
                CREATE TABLE IF NOT EXISTS task_runs_v2 AS
                    SELECT *, 3 AS priority FROM task_runs WHERE 0;

                -- Add priority column to task_runs if not already present
                -- (SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS easily)

                -- Task templates
                CREATE TABLE IF NOT EXISTS task_templates (
                    template_id  TEXT PRIMARY KEY,
                    name         TEXT NOT NULL,
                    category     TEXT NOT NULL DEFAULT 'general',
                    description  TEXT NOT NULL DEFAULT '',
                    goal_template TEXT NOT NULL,
                    tags         TEXT NOT NULL DEFAULT '[]',
                    usage_count  INTEGER NOT NULL DEFAULT 0,
                    created_at   TEXT NOT NULL
                );

                -- File uploads (attached to tasks or standalone)
                CREATE TABLE IF NOT EXISTS file_uploads (
                    file_id      TEXT PRIMARY KEY,
                    filename     TEXT NOT NULL,
                    content_type TEXT NOT NULL DEFAULT 'text/plain',
                    size_bytes   INTEGER NOT NULL DEFAULT 0,
                    task_id      TEXT,
                    storage_path TEXT NOT NULL,
                    created_at   TEXT NOT NULL
                );

                -- API cost log per provider call
                CREATE TABLE IF NOT EXISTS api_cost_log (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider     TEXT NOT NULL,
                    model        TEXT NOT NULL DEFAULT '',
                    agent_id     TEXT NOT NULL DEFAULT 'system',
                    task_id      TEXT,
                    tokens_in    INTEGER NOT NULL DEFAULT 0,
                    tokens_out   INTEGER NOT NULL DEFAULT 0,
                    cost_usd     REAL NOT NULL DEFAULT 0.0,
                    latency_ms   REAL NOT NULL DEFAULT 0.0,
                    status       TEXT NOT NULL DEFAULT 'success',
                    created_at   TEXT NOT NULL
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

    def create_task(self, task_id: str, goal: str, priority: int = 3) -> Dict[str, Any]:
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
            # Try inserting with priority column (may not exist on old DBs)
            try:
                conn.execute(
                    """INSERT INTO task_runs
                       (task_id, goal, status, created_at)
                       VALUES (:task_id, :goal, :status, :created_at)""",
                    row,
                )
                # Add priority column if needed (idempotent)
                try:
                    conn.execute("ALTER TABLE task_runs ADD COLUMN priority INTEGER NOT NULL DEFAULT 3")
                except Exception:
                    pass
                conn.execute("UPDATE task_runs SET priority=? WHERE task_id=?", (priority, task_id))
            except Exception:
                pass
        row["priority"] = priority
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

    def delete_task(self, task_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM task_runs WHERE task_id = ?", (task_id,))
        return r.rowcount > 0

    def delete_duplicate_tasks(self) -> int:
        """Delete tasks with duplicate goals, keeping only the newest per goal."""
        with self._conn() as conn:
            result = conn.execute(
                """DELETE FROM task_runs WHERE task_id NOT IN (
                    SELECT task_id FROM task_runs
                    GROUP BY goal
                    HAVING task_id = MAX(task_id)
                )"""
            )
        return result.rowcount

    def clear_all_tasks(self) -> int:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM task_runs")
        return r.rowcount

    def list_tasks(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            try:
                # Priority-aware ordering: lower number = higher priority; within same priority newest first
                rows = conn.execute(
                    "SELECT * FROM task_runs ORDER BY COALESCE(priority,3) ASC, created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            except Exception:
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

    # ── Webhooks ──────────────────────────────────────────────────────────────

    def create_webhook(self, name: str, goal_template: str) -> Dict[str, Any]:
        import secrets
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "webhook_id":    str(__import__("uuid").uuid4()),
            "name":          name,
            "goal_template": goal_template,
            "secret_token":  secrets.token_urlsafe(32),
            "enabled":       1,
            "hit_count":     0,
            "created_at":    now,
        }
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO webhooks (webhook_id,name,goal_template,secret_token,enabled,hit_count,created_at) "
                "VALUES (:webhook_id,:name,:goal_template,:secret_token,:enabled,:hit_count,:created_at)", row)
        return {**row, "enabled": True}

    def list_webhooks(self) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM webhooks ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r); d["enabled"] = bool(d.get("enabled",1)); result.append(d)
        return result

    def get_webhook(self, webhook_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM webhooks WHERE webhook_id=?", (webhook_id,)).fetchone()
        if not row: return None
        d = dict(row); d["enabled"] = bool(d.get("enabled",1)); return d

    def delete_webhook(self, webhook_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM webhooks WHERE webhook_id=?", (webhook_id,))
        return r.rowcount > 0

    def increment_webhook_hit(self, webhook_id: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE webhooks SET hit_count=hit_count+1 WHERE webhook_id=?", (webhook_id,))

    # ── Chat Sessions ─────────────────────────────────────────────────────────

    def create_chat_session(self, title: str = "New Chat", agent_role: str = "planner") -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        session_id = str(__import__("uuid").uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO chat_sessions (session_id,title,agent_role,created_at,updated_at) VALUES (?,?,?,?,?)",
                (session_id, title, agent_role, now, now))
        return {"session_id": session_id, "title": title, "agent_role": agent_role, "created_at": now}

    def list_chat_sessions(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT s.*, COUNT(m.message_id) AS message_count FROM chat_sessions s "
                "LEFT JOIN chat_messages m ON s.session_id=m.session_id "
                "GROUP BY s.session_id ORDER BY s.updated_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def delete_chat_session(self, session_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM chat_sessions WHERE session_id=?", (session_id,))
        return r.rowcount > 0

    def add_chat_message(self, session_id: str, role: str, content: str) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO chat_messages (session_id,role,content,created_at) VALUES (?,?,?,?)",
                (session_id, role, content, now))
            conn.execute("UPDATE chat_sessions SET updated_at=? WHERE session_id=?", (now, session_id))
        return cur.lastrowid or 0

    def get_chat_history(self, session_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM chat_messages WHERE session_id=? ORDER BY message_id DESC LIMIT ?",
                (session_id, limit)).fetchall()
        return list(reversed([dict(r) for r in rows]))

    def update_chat_title(self, session_id: str, title: str) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            r = conn.execute("UPDATE chat_sessions SET title=?,updated_at=? WHERE session_id=?",
                             (title, now, session_id))
        return r.rowcount > 0

    # ── Task Templates ────────────────────────────────────────────────────────

    def upsert_template(
        self,
        template_id: str,
        name: str,
        category: str,
        description: str,
        goal_template: str,
        tags: list | None = None,
    ) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "template_id":   template_id,
            "name":          name,
            "category":      category,
            "description":   description,
            "goal_template": goal_template,
            "tags":          json.dumps(tags or []),
            "created_at":    now,
        }
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO task_templates
                   (template_id, name, category, description, goal_template, tags, created_at)
                   VALUES (:template_id,:name,:category,:description,:goal_template,:tags,:created_at)
                   ON CONFLICT(template_id) DO UPDATE SET
                       name=excluded.name, category=excluded.category,
                       description=excluded.description, goal_template=excluded.goal_template,
                       tags=excluded.tags""",
                row,
            )
        return row

    def list_templates(self, category: str | None = None) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if category:
                rows = conn.execute(
                    "SELECT * FROM task_templates WHERE category=? ORDER BY usage_count DESC", (category,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM task_templates ORDER BY usage_count DESC"
                ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try: d["tags"] = json.loads(d.get("tags") or "[]")
            except Exception: d["tags"] = []
            result.append(d)
        return result

    def get_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM task_templates WHERE template_id=?", (template_id,)
            ).fetchone()
        if not row: return None
        d = dict(row)
        try: d["tags"] = json.loads(d.get("tags") or "[]")
        except Exception: d["tags"] = []
        return d

    def delete_template(self, template_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM task_templates WHERE template_id=?", (template_id,))
        return r.rowcount > 0

    def increment_template_usage(self, template_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE task_templates SET usage_count=usage_count+1 WHERE template_id=?",
                (template_id,),
            )

    # ── File Uploads ──────────────────────────────────────────────────────────

    def register_upload(
        self,
        file_id: str,
        filename: str,
        content_type: str,
        size_bytes: int,
        storage_path: str,
        task_id: str | None = None,
    ) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "file_id":      file_id,
            "filename":     filename,
            "content_type": content_type,
            "size_bytes":   size_bytes,
            "task_id":      task_id,
            "storage_path": storage_path,
            "created_at":   now,
        }
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO file_uploads
                   (file_id,filename,content_type,size_bytes,task_id,storage_path,created_at)
                   VALUES (:file_id,:filename,:content_type,:size_bytes,:task_id,:storage_path,:created_at)""",
                row,
            )
        return row

    def list_uploads(self, task_id: str | None = None, limit: int = 50) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if task_id:
                rows = conn.execute(
                    "SELECT * FROM file_uploads WHERE task_id=? ORDER BY created_at DESC LIMIT ?",
                    (task_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM file_uploads ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
        return [dict(r) for r in rows]

    def get_upload(self, file_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM file_uploads WHERE file_id=?", (file_id,)).fetchone()
        return dict(row) if row else None

    def delete_upload(self, file_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM file_uploads WHERE file_id=?", (file_id,))
        return r.rowcount > 0

    # ── API Cost Log ──────────────────────────────────────────────────────────

    def log_api_call(
        self,
        provider: str,
        model: str = "",
        agent_id: str = "system",
        task_id: str | None = None,
        tokens_in: int = 0,
        tokens_out: int = 0,
        cost_usd: float = 0.0,
        latency_ms: float = 0.0,
        status: str = "success",
    ) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO api_cost_log
                   (provider,model,agent_id,task_id,tokens_in,tokens_out,cost_usd,latency_ms,status,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (provider, model, agent_id, task_id, tokens_in, tokens_out, cost_usd, latency_ms, status, now),
            )
        return cur.lastrowid or 0

    def get_cost_summary(self, since_iso: str | None = None) -> Dict[str, Any]:
        with self._conn() as conn:
            if since_iso:
                rows = conn.execute(
                    "SELECT provider,model,SUM(tokens_in) ti,SUM(tokens_out) to_,SUM(cost_usd) cost,"
                    "COUNT(*) calls,SUM(latency_ms)/COUNT(*) avg_ms "
                    "FROM api_cost_log WHERE created_at>=? GROUP BY provider,model ORDER BY cost DESC",
                    (since_iso,),
                ).fetchall()
                total = conn.execute(
                    "SELECT SUM(cost_usd) FROM api_cost_log WHERE created_at>=?", (since_iso,)
                ).fetchone()[0] or 0.0
            else:
                rows = conn.execute(
                    "SELECT provider,model,SUM(tokens_in) ti,SUM(tokens_out) to_,SUM(cost_usd) cost,"
                    "COUNT(*) calls,SUM(latency_ms)/COUNT(*) avg_ms "
                    "FROM api_cost_log GROUP BY provider,model ORDER BY cost DESC"
                ).fetchall()
                total = conn.execute("SELECT SUM(cost_usd) FROM api_cost_log").fetchone()[0] or 0.0
        return {
            "total_cost_usd": round(float(total), 6),
            "by_provider": [
                {
                    "provider": r[0], "model": r[1],
                    "tokens_in": r[2], "tokens_out": r[3],
                    "cost_usd": round(float(r[4] or 0), 6),
                    "calls": r[5], "avg_latency_ms": round(float(r[6] or 0), 1),
                }
                for r in rows
            ],
        }

    def list_cost_log(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM api_cost_log ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

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
