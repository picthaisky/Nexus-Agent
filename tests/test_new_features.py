"""Tests for new Nexus-Agent features: task store extensions, notification store,
scheduler store, workspace isolation, vector store, and system tools.
"""
from __future__ import annotations

import os
import pathlib
import tempfile

import pytest


def _tmp_db() -> str:
    """Create a temp db file that is immediately closed (fixes Windows file-lock)."""
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    name = f.name
    f.close()   # close the handle so SQLite can open it freely on Windows
    return name


# ── Task Store Extensions ────────────────────────────────────────────────────

class TestTaskStoreExtensions:
    """Test the new tables added to task_store: templates, webhooks, chat, cost log."""

    def setup_method(self):
        from nexus_agent.core.task_store import TaskStore
        self.db_path = _tmp_db()
        self.store = TaskStore(db_path=self.db_path)

    def teardown_method(self):
        try: os.unlink(self.db_path)
        except OSError: pass

    # --- Templates ---

    def test_create_and_get_template(self):
        row = self.store.upsert_template(
            template_id="t1", name="Test", category="general",
            description="desc", goal_template="Do {{task}}",
        )
        assert row["template_id"] == "t1"
        fetched = self.store.get_template("t1")
        assert fetched is not None
        assert fetched["name"] == "Test"

    def test_list_templates(self):
        self.store.upsert_template("t2", "A", "dev", "", "goal A")
        self.store.upsert_template("t3", "B", "qa", "", "goal B")
        rows = self.store.list_templates()
        ids = [r["template_id"] for r in rows]
        assert "t2" in ids and "t3" in ids

    def test_list_templates_by_category(self):
        self.store.upsert_template("t4", "C", "finance", "", "goal C")
        self.store.upsert_template("t5", "D", "general", "", "goal D")
        rows = self.store.list_templates(category="finance")
        assert all(r["category"] == "finance" for r in rows)

    def test_delete_template(self):
        self.store.upsert_template("t6", "E", "general", "", "goal E")
        assert self.store.delete_template("t6")
        assert self.store.get_template("t6") is None

    def test_increment_template_usage(self):
        self.store.upsert_template("t7", "F", "general", "", "goal F")
        self.store.increment_template_usage("t7")
        self.store.increment_template_usage("t7")
        row = self.store.get_template("t7")
        assert row["usage_count"] == 2

    # --- Webhooks ---

    def test_create_webhook(self):
        wh = self.store.create_webhook("test hook", "run {{task}}")
        assert "webhook_id" in wh
        assert "secret_token" in wh
        assert len(wh["secret_token"]) > 10

    def test_list_webhooks(self):
        self.store.create_webhook("hook A", "goal A")
        self.store.create_webhook("hook B", "goal B")
        hooks = self.store.list_webhooks()
        names = [h["name"] for h in hooks]
        assert "hook A" in names and "hook B" in names

    def test_delete_webhook(self):
        wh = self.store.create_webhook("to delete", "some goal")
        wid = wh["webhook_id"]
        assert self.store.delete_webhook(wid)
        assert self.store.get_webhook(wid) is None

    def test_increment_webhook_hit(self):
        wh = self.store.create_webhook("counter", "goal")
        self.store.increment_webhook_hit(wh["webhook_id"])
        self.store.increment_webhook_hit(wh["webhook_id"])
        fetched = self.store.get_webhook(wh["webhook_id"])
        assert fetched["hit_count"] == 2

    # --- Chat Sessions ---

    def test_create_chat_session(self):
        sess = self.store.create_chat_session("My Chat", "planner")
        assert "session_id" in sess
        assert sess["title"] == "My Chat"

    def test_add_and_get_chat_messages(self):
        sess = self.store.create_chat_session("Test", "developer")
        sid = sess["session_id"]
        self.store.add_chat_message(sid, "user", "Hello!")
        self.store.add_chat_message(sid, "assistant", "Hi there!")
        history = self.store.get_chat_history(sid)
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[1]["content"] == "Hi there!"

    def test_delete_chat_session(self):
        sess = self.store.create_chat_session("Delete me", "planner")
        sid = sess["session_id"]
        assert self.store.delete_chat_session(sid)
        sessions = self.store.list_chat_sessions()
        assert all(s["session_id"] != sid for s in sessions)

    # --- Cost Log ---

    def test_log_api_call(self):
        log_id = self.store.log_api_call(
            provider="openai", model="gpt-4o-mini",
            agent_id="planner", tokens_in=100, tokens_out=50,
            cost_usd=0.0015, latency_ms=420.0,
        )
        assert log_id > 0

    def test_cost_summary(self):
        self.store.log_api_call("openai", "gpt-4o-mini", tokens_in=200, tokens_out=100, cost_usd=0.003)
        self.store.log_api_call("gemini", "gemini-1.5-flash", tokens_in=150, tokens_out=80, cost_usd=0.001)
        summary = self.store.get_cost_summary()
        assert summary["total_cost_usd"] > 0
        providers = [p["provider"] for p in summary["by_provider"]]
        assert "openai" in providers and "gemini" in providers

    # --- Social Connections ---

    def test_upsert_social_connection(self):
        row = self.store.upsert_social_connection(
            platform="facebook", account_name="Test Page",
            account_id="12345", access_token="tok_abc",
            page_id="12345",
        )
        assert row["platform"] == "facebook"

    def test_list_social_connections(self):
        self.store.upsert_social_connection("facebook", "Page A", "111", "tok1")
        connections = self.store.list_social_connections()
        assert any(c["platform"] == "facebook" for c in connections)

    def test_delete_social_connection(self):
        self.store.upsert_social_connection("tiktok", "TT User", "tid1", "tok2")
        assert self.store.delete_social_connection("tiktok")
        assert self.store.get_social_connection("tiktok") is None

    # --- Task delete / clear ---

    def test_delete_single_task(self):
        import uuid
        tid = str(uuid.uuid4())
        self.store.create_task(task_id=tid, goal="test task")
        assert self.store.delete_task(tid)
        assert self.store.get_task(tid) is None

    def test_clear_all_tasks(self):
        import uuid
        for _ in range(3):
            self.store.create_task(task_id=str(uuid.uuid4()), goal="task")
        n = self.store.clear_all_tasks()
        assert n >= 3
        assert len(self.store.list_tasks()) == 0

    def test_delete_duplicate_tasks(self):
        import uuid
        # 3 tasks with same goal
        same_goal = "duplicate goal"
        for _ in range(3):
            self.store.create_task(task_id=str(uuid.uuid4()), goal=same_goal)
        # 1 task with unique goal
        self.store.create_task(task_id=str(uuid.uuid4()), goal="unique goal")
        deleted = self.store.delete_duplicate_tasks()
        remaining = self.store.list_tasks()
        # Should keep only 1 of the 3 same-goal tasks + 1 unique = 2
        assert len(remaining) == 2
        assert deleted == 2


# ── Notification Store ───────────────────────────────────────────────────────

class TestNotificationStore:
    def setup_method(self):
        from nexus_agent.core.notification_store import NotificationStore
        self.db_path = _tmp_db()
        self.store = NotificationStore(db_path=self.db_path)

    def teardown_method(self):
        try: os.unlink(self.db_path)
        except OSError: pass

    def test_create_notification(self):
        n = self.store.create("task_completed", "Task Done", "Your task finished.")
        assert "id" in n
        assert n["category"] == "task_completed"
        assert not n["is_read"]

    def test_list_unread(self):
        self.store.create("info", "Info 1", "body 1")
        self.store.create("info", "Info 2", "body 2")
        unread = self.store.list(unread_only=True)
        assert len(unread) >= 2

    def test_mark_read(self):
        n = self.store.create("system_alert", "Alert", "Something happened")
        assert self.store.mark_read(n["id"])
        all_notifs = self.store.list()
        found = next(x for x in all_notifs if x["id"] == n["id"])
        assert found["is_read"]

    def test_mark_all_read(self):
        self.store.create("info", "A", "")
        self.store.create("info", "B", "")
        count = self.store.mark_all_read()
        assert count >= 2
        assert self.store.unread_count() == 0

    def test_delete_notification(self):
        n = self.store.create("mention", "Mention", "You were mentioned")
        assert self.store.delete(n["id"])
        assert all(x["id"] != n["id"] for x in self.store.list())

    def test_unread_count(self):
        initial = self.store.unread_count()
        self.store.create("info", "Test", "")
        assert self.store.unread_count() == initial + 1

    def test_invalid_category_defaults_to_info(self):
        n = self.store.create("not_a_real_category", "Test", "")
        assert n["category"] == "info"


# ── Scheduler Store ──────────────────────────────────────────────────────────

class TestSchedulerStore:
    def setup_method(self):
        from nexus_agent.core.scheduler import SchedulerStore
        self.db_path = _tmp_db()
        self.store = SchedulerStore(db_path=self.db_path)

    def teardown_method(self):
        try: os.unlink(self.db_path)
        except OSError: pass

    def test_create_job(self):
        job = self.store.create_job(
            name="Daily Report",
            goal_template="Generate report for {{date}}",
            cron_expr="0 9 * * 1-5",
            tz_name="Asia/Bangkok",
        )
        assert "job_id" in job
        assert job["name"] == "Daily Report"
        assert job["enabled"]

    def test_list_jobs(self):
        self.store.create_job("Job A", "goal A", "0 8 * * *")
        self.store.create_job("Job B", "goal B", "0 10 * * *")
        jobs = self.store.list_jobs()
        names = [j["name"] for j in jobs]
        assert "Job A" in names and "Job B" in names

    def test_toggle_job(self):
        job = self.store.create_job("Toggle Me", "goal", "0 8 * * *")
        jid = job["job_id"]
        assert self.store.toggle_job(jid, enabled=False)
        jobs = self.store.list_jobs()
        found = next(j for j in jobs if j["job_id"] == jid)
        assert not found["enabled"]

    def test_delete_job(self):
        job = self.store.create_job("Delete Me", "goal", "0 8 * * *")
        jid = job["job_id"]
        assert self.store.delete_job(jid)
        assert self.store.get_job(jid) is None

    def test_mark_run(self):
        job = self.store.create_job("Runnable", "goal", "0 8 * * *")
        jid = job["job_id"]
        self.store.mark_run(jid)
        self.store.mark_run(jid)
        updated = self.store.get_job(jid)
        assert updated["run_count"] == 2
        assert updated["last_run_at"] is not None


# ── Workspace Store ──────────────────────────────────────────────────────────

class TestWorkspaceStore:
    def setup_method(self):
        from nexus_agent.core.workspace import WorkspaceStore
        self.db_path = _tmp_db()
        self.store = WorkspaceStore(db_path=self.db_path)

    def teardown_method(self):
        try: os.unlink(self.db_path)
        except OSError: pass

    def test_create_workspace(self):
        ws = self.store.create_workspace("Production", "Main workspace")
        assert "workspace_id" in ws
        assert ws["name"] == "Production"

    def test_list_workspaces(self):
        self.store.create_workspace("WS A", "")
        self.store.create_workspace("WS B", "")
        workspaces = self.store.list_workspaces()
        names = [w["name"] for w in workspaces]
        assert "WS A" in names and "WS B" in names

    def test_create_and_resolve_api_key(self):
        ws = self.store.create_workspace("Test WS", "")
        key_data = self.store.create_key(ws["workspace_id"], "Production Key", "operator")
        api_key = key_data["api_key"]
        assert api_key.startswith("nxa-")
        resolved = self.store.resolve_key(api_key)
        assert resolved is not None
        assert resolved["permission"] == "operator"
        assert resolved["workspace_name"] == "Test WS"

    def test_invalid_key_returns_none(self):
        assert self.store.resolve_key("invalid-key-xxx") is None

    def test_revoke_key(self):
        ws = self.store.create_workspace("Revoke WS", "")
        key_data = self.store.create_key(ws["workspace_id"], "Temp Key", "viewer")
        assert self.store.revoke_key(key_data["key_id"])
        resolved = self.store.resolve_key(key_data["api_key"])
        assert resolved is None  # revoked key should not resolve

    def test_delete_workspace(self):
        ws = self.store.create_workspace("Delete WS", "")
        wid = ws["workspace_id"]
        assert self.store.delete_workspace(wid)
        workspaces = self.store.list_workspaces()
        assert all(w["workspace_id"] != wid for w in workspaces)


# ── Vector Store ─────────────────────────────────────────────────────────────

class TestVectorStore:
    def setup_method(self):
        from nexus_agent.core.vector_store import VectorStore
        self.db_path = _tmp_db()
        self.vs = VectorStore(db_path=self.db_path)

    def teardown_method(self):
        try: os.unlink(self.db_path)
        except OSError: pass

    def test_add_document(self):
        n = self.vs.add_document(
            doc_id="doc1",
            text="Python is a programming language. It is easy to learn.",
            title="Python Intro",
            source="test",
        )
        assert n >= 1

    def test_search_returns_results(self):
        self.vs.add_document("doc2", "FastAPI is a modern web framework for Python.", title="FastAPI")
        results = self.vs.search("web framework", top_k=5)
        assert len(results) >= 1
        assert any("FastAPI" in r["title"] or "fastapi" in r["text"].lower() for r in results)

    def test_stats(self):
        self.vs.add_document("doc3", "Some sample content here.", title="Sample")
        stats = self.vs.stats()
        assert stats["documents"] >= 1
        assert stats["chunks"] >= 1

    def test_delete_document(self):
        self.vs.add_document("doc4", "To be deleted", title="Delete me")
        assert self.vs.delete_document("doc4")
        docs = self.vs.list_documents()
        assert all(d["doc_id"] != "doc4" for d in docs)

    def test_search_empty_returns_empty(self):
        results = self.vs.search("")
        assert results == []

    def test_chunking_large_document(self):
        large_text = "This is a sentence. " * 200  # ~3600 chars
        n = self.vs.add_document("doc5", large_text, title="Large doc")
        assert n >= 2  # should create multiple chunks


# ── System Tools — File System Helpers ──────────────────────────────────────

class TestFileSystemTools:
    def setup_method(self):
        # Create a temp workspace tree
        self.workspace = tempfile.mkdtemp()
        os.makedirs(f"{self.workspace}/src/api", exist_ok=True)
        os.makedirs(f"{self.workspace}/tests", exist_ok=True)
        pathlib.Path(f"{self.workspace}/src/api/main.py").write_text("from fastapi import FastAPI\napp = FastAPI()\n")
        pathlib.Path(f"{self.workspace}/src/api/models.py").write_text("from pydantic import BaseModel\n")
        pathlib.Path(f"{self.workspace}/tests/test_main.py").write_text("def test_health(): assert True\n")
        pathlib.Path(f"{self.workspace}/README.md").write_text("# My Project\n")
        # Patch _DEFAULT_CWD for tests
        import nexus_agent.tools.system_tools as st
        self._orig_cwd = st._DEFAULT_CWD
        st._DEFAULT_CWD = self.workspace

    def teardown_method(self):
        import nexus_agent.tools.system_tools as st
        st._DEFAULT_CWD = self._orig_cwd
        import shutil
        shutil.rmtree(self.workspace, ignore_errors=True)

    def test_list_files_basic(self):
        from nexus_agent.tools.system_tools import list_files
        result = list_files.invoke({"directory": ".", "pattern": "*.md"})
        assert "README.md" in result

    def test_list_files_recursive(self):
        from nexus_agent.tools.system_tools import list_files
        result = list_files.invoke({"directory": ".", "pattern": "*.py", "recursive": True})
        assert "main.py" in result
        assert "test_main.py" in result

    def test_list_files_no_match(self):
        from nexus_agent.tools.system_tools import list_files
        result = list_files.invoke({"directory": ".", "pattern": "*.rs"})
        assert "no files matching" in result.lower() or result == "(no files matching '*.rs' in '.')"

    def test_get_file_tree(self):
        from nexus_agent.tools.system_tools import get_file_tree
        result = get_file_tree.invoke({"root": ".", "max_depth": 3})
        assert "src" in result
        assert "tests" in result
        assert "main.py" in result

    def test_get_file_tree_nonexistent(self):
        from nexus_agent.tools.system_tools import get_file_tree
        result = get_file_tree.invoke({"root": "nonexistent", "max_depth": 2})
        assert "Error" in result or "does not exist" in result

    def test_search_in_files(self):
        from nexus_agent.tools.system_tools import search_in_files
        result = search_in_files.invoke({"pattern": "FastAPI", "directory": ".", "file_glob": "*.py"})
        assert "main.py" in result
        assert "FastAPI" in result

    def test_search_in_files_no_match(self):
        from nexus_agent.tools.system_tools import search_in_files
        result = search_in_files.invoke({"pattern": "XYZNOTFOUND", "directory": ".", "file_glob": "*.py"})
        assert "no matches" in result.lower() or result.startswith("(no matches")

    def test_search_in_files_invalid_regex(self):
        from nexus_agent.tools.system_tools import search_in_files
        result = search_in_files.invoke({"pattern": "[invalid(", "directory": ".", "file_glob": "*.py"})
        assert "Error" in result
