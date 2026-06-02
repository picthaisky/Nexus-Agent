"""Scheduled task runner using APScheduler.

Jobs are persisted in SQLite so they survive restarts. Each job runs
a Nexus-Agent orchestrator task on a cron schedule.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime
from datetime import timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_DATA_DIR   = Path(os.environ.get("NEXUS_DATA_DIR", str(Path(__file__).resolve().parents[2])))
_SCHED_DB   = _DATA_DIR / "nexus_scheduler.db"


class SchedulerStore:
    """SQLite persistence for scheduled jobs."""

    def __init__(self, db_path: str | Path = _SCHED_DB) -> None:
        self.db_path = str(db_path)
        self._init_db()

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS scheduled_jobs (
                    job_id        TEXT PRIMARY KEY,
                    name          TEXT NOT NULL,
                    goal_template TEXT NOT NULL,
                    cron_expr     TEXT NOT NULL,
                    timezone      TEXT NOT NULL DEFAULT 'Asia/Bangkok',
                    enabled       INTEGER NOT NULL DEFAULT 1,
                    run_count     INTEGER NOT NULL DEFAULT 0,
                    last_run_at   TEXT,
                    next_run_at   TEXT,
                    created_at    TEXT NOT NULL,
                    tags          TEXT NOT NULL DEFAULT '[]'
                );
            """)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def create_job(self, name: str, goal_template: str, cron_expr: str,
                   tz_name: str = "Asia/Bangkok", tags: list | None = None) -> Dict[str, Any]:
        job_id = str(uuid.uuid4())
        now    = datetime.now(timezone.utc).isoformat()
        row = {
            "job_id": job_id, "name": name, "goal_template": goal_template,
            "cron_expr": cron_expr, "timezone": tz_name, "enabled": 1,
            "run_count": 0, "last_run_at": None, "next_run_at": None,
            "created_at": now, "tags": json.dumps(tags or []),
        }
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO scheduled_jobs (job_id,name,goal_template,cron_expr,timezone,"
                "enabled,run_count,last_run_at,next_run_at,created_at,tags) "
                "VALUES (:job_id,:name,:goal_template,:cron_expr,:timezone,:enabled,"
                ":run_count,:last_run_at,:next_run_at,:created_at,:tags)", row)
        return self._to_dict(row)

    def list_jobs(self) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM scheduled_jobs ORDER BY created_at DESC").fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM scheduled_jobs WHERE job_id=?", (job_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def toggle_job(self, job_id: str, enabled: bool) -> bool:
        with self._conn() as conn:
            r = conn.execute("UPDATE scheduled_jobs SET enabled=? WHERE job_id=?",
                             (1 if enabled else 0, job_id))
        return r.rowcount > 0

    def delete_job(self, job_id: str) -> bool:
        with self._conn() as conn:
            r = conn.execute("DELETE FROM scheduled_jobs WHERE job_id=?", (job_id,))
        return r.rowcount > 0

    def mark_run(self, job_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "UPDATE scheduled_jobs SET run_count=run_count+1, last_run_at=? WHERE job_id=?",
                (now, job_id))

    def update_next_run(self, job_id: str, next_run: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE scheduled_jobs SET next_run_at=? WHERE job_id=?", (next_run, job_id))

    @staticmethod
    def _row_to_dict(row) -> Dict[str, Any]:
        d = dict(row)
        try: d["tags"] = json.loads(d.get("tags") or "[]")
        except Exception: d["tags"] = []
        d["enabled"] = bool(d.get("enabled", 1))
        return d

    @staticmethod
    def _to_dict(row: dict) -> Dict[str, Any]:
        d = dict(row)
        try: d["tags"] = json.loads(d.get("tags") or "[]")
        except Exception: d["tags"] = []
        d["enabled"] = bool(d.get("enabled", 1))
        return d


scheduler_store = SchedulerStore()


# ── APScheduler integration ───────────────────────────────────────────────────

_apscheduler: Any = None


def get_scheduler():
    """Lazy-init and return the APScheduler instance."""
    global _apscheduler
    if _apscheduler is None:
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from nexus_agent.core.settings import get_settings
            tz = get_settings().scheduler_timezone
            _apscheduler = AsyncIOScheduler(timezone=tz)
        except ImportError:
            logger.warning("APScheduler not installed — scheduler disabled")
    return _apscheduler


def _make_job_func(job_id: str, goal_template: str):
    """Return an async function that runs the orchestrator for a scheduled job."""
    async def _run():
        logger.info("Scheduler: running job %s", job_id)
        scheduler_store.mark_run(job_id)
        try:
            from nexus_agent.core.task_store import task_store as ts
            from nexus_agent.core.orchestrator import Orchestrator
            import uuid as _uuid
            task_id = str(_uuid.uuid4())
            ts.create_task(task_id=task_id, goal=goal_template)
            ts.update_task(task_id, status="running",
                           started_at=datetime.now(timezone.utc).isoformat())
            orch = Orchestrator()
            orch.run_task(goal_template)
            ts.update_task(task_id, status="completed",
                           finished_at=datetime.now(timezone.utc).isoformat())
        except Exception as exc:
            logger.error("Scheduled job %s failed: %s", job_id, exc)
    return _run


def register_all_jobs() -> int:
    """Load all enabled jobs from DB and register them with APScheduler."""
    sched = get_scheduler()
    if not sched:
        return 0
    jobs = scheduler_store.list_jobs()
    count = 0
    for job in jobs:
        if not job["enabled"]:
            continue
        try:
            _register_job(sched, job)
            count += 1
        except Exception as exc:
            logger.warning("Failed to register job %s: %s", job["job_id"], exc)
    return count


def _register_job(sched, job: dict) -> None:
    from apscheduler.triggers.cron import CronTrigger
    parts = job["cron_expr"].split()  # "min hour dom mon dow"
    trigger = CronTrigger.from_crontab(job["cron_expr"], timezone=job.get("timezone","Asia/Bangkok"))
    sched.add_job(
        _make_job_func(job["job_id"], job["goal_template"]),
        trigger=trigger,
        id=job["job_id"],
        name=job["name"],
        replace_existing=True,
    )
    # Persist next run time
    try:
        next_run = sched.get_job(job["job_id"]).next_run_time
        if next_run:
            scheduler_store.update_next_run(job["job_id"], next_run.isoformat())
    except Exception:
        pass


def add_job(job_id: str, name: str, goal_template: str, cron_expr: str,
            timezone_str: str = "Asia/Bangkok") -> Optional[Dict[str, Any]]:
    """Add a job to both the store and the running scheduler."""
    row = scheduler_store.create_job(name, goal_template, cron_expr, tz_name=timezone_str)
    sched = get_scheduler()
    if sched and sched.running:
        _register_job(sched, row)
    return row


def remove_job(job_id: str) -> bool:
    ok = scheduler_store.delete_job(job_id)
    sched = get_scheduler()
    if sched:
        try:
            sched.remove_job(job_id)
        except Exception:
            pass
    return ok


def start_scheduler() -> None:
    sched = get_scheduler()
    if sched and not sched.running:
        n = register_all_jobs()
        sched.start()
        logger.info("Scheduler started with %d jobs", n)


def stop_scheduler() -> None:
    sched = get_scheduler()
    if sched and sched.running:
        sched.shutdown(wait=False)
        logger.info("Scheduler stopped")
