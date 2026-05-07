"""Persistent Skill Vault for long-term agent capabilities and local deep research.

The vault stores reusable skills, tracks execution outcomes, supports full-text
search, imports markdown skills, and builds autonomous task plans using available
skills and research notes.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import sqlite3
import subprocess
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_WORD_RE = re.compile(r"[A-Za-z0-9_]+")


@dataclass
class SkillRecord:
    """Single skill row representation."""

    skill_id: str
    name: str
    summary: str
    description_md: str
    tags: list[str]
    source: str
    maturity: str
    usage_count: int
    success_count: int
    failure_count: int
    metadata: dict[str, Any]
    created_at: str
    updated_at: str

    @property
    def success_rate(self) -> float:
        total = self.success_count + self.failure_count
        if total == 0:
            return 0.0
        return self.success_count / total


@dataclass
class ResearchBrief:
    """Structured output for local deep research."""

    topic: str
    hypotheses: list[str]
    suggested_skills: list[dict[str, Any]]
    related_notes: list[dict[str, Any]]
    repo_signals: list[str]
    automation_plan: list[str]


class SkillVault:
    """Persistent skill memory with search and autonomous planning utilities."""

    def __init__(self, db_path: str = "nexus_skill_vault.db") -> None:
        self.db_path = Path(db_path)
        if self.db_path.parent != Path("."):
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def add_skill(
        self,
        name: str,
        summary: str,
        description_md: str,
        tags: list[str] | None = None,
        source: str = "manual",
        steps: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> SkillRecord:
        """Adds or updates a skill in the persistent vault."""
        if not name.strip():
            raise ValueError("Skill name must not be empty")

        normalized_tags = self._normalize_tags(tags or [])
        now = datetime.now(timezone.utc).isoformat()

        with self._connect() as conn:
            existing = conn.execute(
                "SELECT skill_id, usage_count, success_count, failure_count, created_at "
                "FROM skills WHERE name = ?",
                (name.strip(),),
            ).fetchone()

            if existing:
                skill_id = existing["skill_id"]
                created_at = existing["created_at"]
                usage_count = int(existing["usage_count"])
                success_count = int(existing["success_count"])
                failure_count = int(existing["failure_count"])
                maturity = self._compute_maturity(usage_count, success_count, failure_count)

                conn.execute(
                    "UPDATE skills SET summary = ?, description_md = ?, tags = ?, source = ?, "
                    "metadata = ?, maturity = ?, updated_at = ? WHERE skill_id = ?",
                    (
                        summary.strip(),
                        description_md,
                        json.dumps(normalized_tags),
                        source,
                        json.dumps(metadata or {}),
                        maturity,
                        now,
                        skill_id,
                    ),
                )
                conn.execute("DELETE FROM skill_steps WHERE skill_id = ?", (skill_id,))
            else:
                skill_id = f"sk-{uuid.uuid4().hex[:12]}"
                usage_count = 0
                success_count = 0
                failure_count = 0
                maturity = "candidate"
                created_at = now

                conn.execute(
                    "INSERT INTO skills ("
                    "skill_id, name, summary, description_md, tags, source, maturity, metadata, "
                    "usage_count, success_count, failure_count, created_at, updated_at"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        skill_id,
                        name.strip(),
                        summary.strip(),
                        description_md,
                        json.dumps(normalized_tags),
                        source,
                        maturity,
                        json.dumps(metadata or {}),
                        usage_count,
                        success_count,
                        failure_count,
                        created_at,
                        now,
                    ),
                )

            if steps:
                for idx, instruction in enumerate(steps, start=1):
                    text = instruction.strip()
                    if not text:
                        continue
                    conn.execute(
                        "INSERT INTO skill_steps (skill_id, step_order, instruction) VALUES (?, ?, ?)",
                        (skill_id, idx, text),
                    )

            self._upsert_fts(conn, skill_id)

        return self.get_skill(skill_id)

    def get_skill(self, skill_ref: str) -> SkillRecord:
        """Loads a skill by id or exact name."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM skills WHERE skill_id = ? OR name = ?",
                (skill_ref, skill_ref),
            ).fetchone()
            if row is None:
                raise ValueError(f"Skill not found: {skill_ref}")
            return self._row_to_skill_record(row)

    def list_skills(self, limit: int = 100) -> list[SkillRecord]:
        """Lists skills ordered by recency and usage."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM skills ORDER BY usage_count DESC, updated_at DESC LIMIT ?",
                (max(1, limit),),
            ).fetchall()
        return [self._row_to_skill_record(row) for row in rows]

    def search_skills(
        self,
        query: str,
        tags: list[str] | None = None,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Searches skills using full-text ranking with optional tag filtering."""
        normalized_tags = set(self._normalize_tags(tags or []))
        safe_query = self._to_fts_query(query)

        with self._connect() as conn:
            if safe_query:
                rows = conn.execute(
                    "SELECT s.*, bm25(skills_fts) as rank "
                    "FROM skills_fts f "
                    "JOIN skills s ON s.skill_id = f.skill_id "
                    "WHERE skills_fts MATCH ? "
                    "ORDER BY rank ASC LIMIT ?",
                    (safe_query, max(top_k * 3, top_k)),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT s.*, 0 as rank FROM skills s "
                    "ORDER BY usage_count DESC, updated_at DESC LIMIT ?",
                    (max(top_k * 3, top_k),),
                ).fetchall()

        results: list[dict[str, Any]] = []
        for row in rows:
            record = self._row_to_skill_record(row)
            if normalized_tags and not normalized_tags.issubset(set(record.tags)):
                continue

            item = asdict(record)
            item["success_rate"] = record.success_rate
            item["rank"] = float(row["rank"]) if "rank" in row.keys() else 0.0
            item["steps"] = self.get_skill_steps(record.skill_id)
            results.append(item)

            if len(results) >= top_k:
                break

        return results

    def suggest_skills_for_task(self, task_text: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Suggests best-fit skills for a task using lexical overlap plus FTS ranking."""
        candidates = self.search_skills(query=task_text, top_k=max(10, top_k * 3))
        task_tokens = set(self._tokenize(task_text))

        rescored: list[dict[str, Any]] = []
        for item in candidates:
            skill_tokens = set(self._tokenize(item["name"] + " " + item["summary"] + " " + " ".join(item["tags"])))
            overlap = len(task_tokens & skill_tokens)
            score = overlap * 2.0 + item.get("success_rate", 0.0) + (item.get("usage_count", 0) / 100.0)

            enriched = dict(item)
            enriched["relevance_score"] = round(score, 4)
            rescored.append(enriched)

        rescored.sort(key=lambda x: x["relevance_score"], reverse=True)
        return rescored[:top_k]

    def record_execution(self, skill_ref: str, successful: bool, feedback: str = "") -> SkillRecord:
        """Records execution result and updates maturity state."""
        skill = self.get_skill(skill_ref)

        usage_count = skill.usage_count + 1
        success_count = skill.success_count + (1 if successful else 0)
        failure_count = skill.failure_count + (0 if successful else 1)
        maturity = self._compute_maturity(usage_count, success_count, failure_count)
        now = datetime.now(timezone.utc).isoformat()

        with self._connect() as conn:
            conn.execute(
                "UPDATE skills SET usage_count = ?, success_count = ?, failure_count = ?, maturity = ?, updated_at = ? "
                "WHERE skill_id = ?",
                (usage_count, success_count, failure_count, maturity, now, skill.skill_id),
            )
            self._upsert_fts(conn, skill.skill_id)

        if feedback.strip():
            topic = f"skill-feedback:{skill.name}"
            self.add_research_note(topic=topic, content=feedback.strip(), source="execution-feedback")

        return self.get_skill(skill.skill_id)

    def import_skills_from_markdown_dir(
        self,
        directory: str,
        source: str = "awesome-codex-skills",
        default_tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Imports markdown-based skills (for example from awesome-codex-skills)."""
        root = Path(directory)
        if not root.exists() or not root.is_dir():
            raise ValueError(f"Directory does not exist: {directory}")

        imported = 0
        failed: list[str] = []

        for md_path in sorted(root.rglob("*.md")):
            try:
                parsed = self._parse_markdown_skill(md_path)
                tags = [*(default_tags or []), *parsed["tags"]]
                self.add_skill(
                    name=parsed["name"],
                    summary=parsed["summary"],
                    description_md=parsed["description_md"],
                    tags=tags,
                    source=source,
                    steps=parsed["steps"],
                    metadata={"import_path": str(md_path.as_posix())},
                )
                imported += 1
            except Exception as exc:
                failed.append(f"{md_path.as_posix()}: {exc}")

        return {
            "source_directory": str(root.resolve()),
            "imported": imported,
            "failed_count": len(failed),
            "failed": failed,
        }

    def sync_skill_repository(
        self,
        repo_reference: str,
        branch: str = "main",
        cache_dir: str | None = None,
        shallow_clone: bool = True,
    ) -> dict[str, Any]:
        """Syncs a skill repository from Git or accepts a local directory directly."""
        target = repo_reference.strip()
        if not target:
            raise ValueError("repo_reference must not be empty")

        local_candidate = Path(target).expanduser()
        if local_candidate.exists() and local_candidate.is_dir():
            return {
                "repo_reference": target,
                "local_path": str(local_candidate.resolve()),
                "branch": branch,
                "mode": "local-path",
                "status": "ready",
            }

        git_binary = shutil.which("git")
        if git_binary is None:
            raise RuntimeError("Git is required to import from remote repositories")

        cache_root = Path(cache_dir or ".skill_sources").resolve()
        cache_root.mkdir(parents=True, exist_ok=True)

        repo_key = self._derive_repo_key(target)
        local_repo_path = cache_root / repo_key

        if local_repo_path.exists() and (local_repo_path / ".git").exists():
            self._run_subprocess([git_binary, "-C", str(local_repo_path), "fetch", "--all", "--prune"])
            if branch:
                self._run_subprocess([git_binary, "-C", str(local_repo_path), "checkout", branch])
                self._run_subprocess([git_binary, "-C", str(local_repo_path), "pull", "origin", branch])
            else:
                self._run_subprocess([git_binary, "-C", str(local_repo_path), "pull"])
            status = "updated"
        elif local_repo_path.exists():
            raise RuntimeError(f"Cache path exists but is not a git repository: {local_repo_path}")
        else:
            clone_cmd = [git_binary, "clone"]
            if shallow_clone:
                clone_cmd.extend(["--depth", "1"])
            if branch:
                clone_cmd.extend(["--branch", branch])
            clone_cmd.extend([target, str(local_repo_path)])
            self._run_subprocess(clone_cmd)
            status = "cloned"

        return {
            "repo_reference": target,
            "local_path": str(local_repo_path),
            "branch": branch,
            "mode": "git",
            "status": status,
        }

    def import_skills_from_github(
        self,
        repo_url: str,
        branch: str = "main",
        source: str = "awesome-codex-skills",
        default_tags: list[str] | None = None,
        cache_dir: str | None = None,
        shallow_clone: bool = True,
    ) -> dict[str, Any]:
        """Syncs a GitHub repository and imports markdown skills from it."""
        sync_result = self.sync_skill_repository(
            repo_reference=repo_url,
            branch=branch,
            cache_dir=cache_dir,
            shallow_clone=shallow_clone,
        )

        import_result = self.import_skills_from_markdown_dir(
            directory=sync_result["local_path"],
            source=source,
            default_tags=default_tags,
        )

        return {
            "repo_url": repo_url,
            "branch": branch,
            "sync": sync_result,
            "import": import_result,
            "imported": import_result["imported"],
            "failed_count": import_result["failed_count"],
            "failed": import_result["failed"],
        }

    def add_research_note(
        self,
        topic: str,
        content: str,
        source: str = "local",
        confidence: float = 0.5,
    ) -> str:
        """Stores a persistent research note."""
        note_id = f"note-{uuid.uuid4().hex[:12]}"
        created_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO research_notes (note_id, topic, content, source, confidence, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (note_id, topic.strip(), content.strip(), source, float(confidence), created_at),
            )
        return note_id

    def get_research_notes(self, topic_query: str, limit: int = 10) -> list[dict[str, Any]]:
        """Returns recent research notes that match a topic query."""
        topic_query = topic_query.strip()
        if not topic_query:
            return []

        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM research_notes WHERE topic LIKE ? OR content LIKE ? "
                "ORDER BY created_at DESC LIMIT ?",
                (f"%{topic_query}%", f"%{topic_query}%", max(1, limit)),
            ).fetchall()

        return [dict(row) for row in rows]

    def create_automation_rule(
        self,
        name: str,
        trigger_query: str,
        skill_ref: str,
        priority: int = 100,
        enabled: bool = True,
    ) -> str:
        """Creates a trigger rule that maps user intent to a skill."""
        skill = self.get_skill(skill_ref)
        rule_id = f"rule-{uuid.uuid4().hex[:12]}"
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO automation_rules (rule_id, name, trigger_query, skill_id, priority, enabled) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (rule_id, name.strip(), trigger_query.strip(), skill.skill_id, int(priority), int(enabled)),
            )
        return rule_id

    def match_automation_rules(self, task_text: str) -> list[dict[str, Any]]:
        """Finds matching automation rules for a task string."""
        normalized_task = task_text.lower()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT r.*, s.name as skill_name, s.summary as skill_summary "
                "FROM automation_rules r "
                "JOIN skills s ON s.skill_id = r.skill_id "
                "WHERE r.enabled = 1 "
                "ORDER BY r.priority ASC"
            ).fetchall()

        matched: list[dict[str, Any]] = []
        for row in rows:
            trigger_tokens = self._tokenize(row["trigger_query"])
            if not trigger_tokens:
                continue

            overlap = len(set(trigger_tokens) & set(self._tokenize(normalized_task)))
            if overlap == 0:
                continue

            matched.append(
                {
                    "rule_id": row["rule_id"],
                    "rule_name": row["name"],
                    "trigger_query": row["trigger_query"],
                    "skill_id": row["skill_id"],
                    "skill_name": row["skill_name"],
                    "skill_summary": row["skill_summary"],
                    "priority": row["priority"],
                    "overlap": overlap,
                }
            )

        matched.sort(key=lambda item: (item["priority"], -item["overlap"]))
        return matched

    def deep_research(
        self,
        topic: str,
        top_k: int = 5,
        repo_graph: Any | None = None,
    ) -> ResearchBrief:
        """Builds a local research brief from skills, notes, and optional graph signals."""
        suggested_skills = self.suggest_skills_for_task(topic, top_k=top_k)
        related_notes = self.get_research_notes(topic, limit=max(5, top_k * 2))

        repo_signals: list[str] = []
        if repo_graph is not None and hasattr(repo_graph, "symbols"):
            topic_tokens = set(self._tokenize(topic))
            for symbol in repo_graph.symbols.values():
                label = f"{symbol.module}.{symbol.qualname}"
                symbol_tokens = set(self._tokenize(label + " " + symbol.docstring))
                if topic_tokens & symbol_tokens:
                    repo_signals.append(label)
                if len(repo_signals) >= top_k:
                    break

        hypotheses = [
            f"Apply skill '{skill['name']}' to accelerate '{topic}'."
            for skill in suggested_skills[:top_k]
        ]
        if not hypotheses:
            hypotheses = [f"No matching skills found yet for '{topic}'. Add seed skills first."]

        automation_plan = [
            f"Collect context for topic: {topic}",
            "Select top-ranked reusable skills from persistent vault",
            "Execute steps with validation checkpoints after each phase",
            "Record outcomes and feedback to update skill maturity",
            "Promote successful patterns into autonomous trigger rules",
        ]

        return ResearchBrief(
            topic=topic,
            hypotheses=hypotheses,
            suggested_skills=suggested_skills,
            related_notes=related_notes,
            repo_signals=repo_signals,
            automation_plan=automation_plan,
        )

    def plan_autonomous_task(self, task_text: str, top_k: int = 5) -> dict[str, Any]:
        """Creates a human-like autonomous execution plan using rules and skills."""
        matched_rules = self.match_automation_rules(task_text)
        suggested_skills = self.suggest_skills_for_task(task_text, top_k=top_k)

        plan_steps: list[str] = [
            f"Understand intent: {task_text}",
            "Load relevant persistent skills and execution history",
        ]

        if matched_rules:
            first_rule = matched_rules[0]
            plan_steps.append(
                f"Apply automation rule '{first_rule['rule_name']}' with skill '{first_rule['skill_name']}'"
            )
        elif suggested_skills:
            plan_steps.append(
                f"Apply top suggested skill '{suggested_skills[0]['name']}'"
            )
        else:
            plan_steps.append("No skill match found, run exploratory deep research")

        plan_steps += [
            "Execute incrementally with verification after each action",
            "Record trace and update skill success metrics",
            "Generate follow-up rule if success is repeatable",
        ]

        return {
            "task": task_text,
            "matched_rules": matched_rules,
            "suggested_skills": suggested_skills,
            "plan_steps": plan_steps,
        }

    def export_skill_markdown(self, skill_ref: str, output_path: str) -> str:
        """Exports a skill as markdown for wiki or repository docs."""
        skill = self.get_skill(skill_ref)
        steps = self.get_skill_steps(skill.skill_id)

        lines = [
            f"# Skill: {skill.name}",
            "",
            f"- ID: {skill.skill_id}",
            f"- Source: {skill.source}",
            f"- Maturity: {skill.maturity}",
            f"- Usage: {skill.usage_count}",
            f"- Success Rate: {skill.success_rate:.2f}",
            f"- Tags: {', '.join(skill.tags)}",
            "",
            "## Summary",
            skill.summary,
            "",
            "## Description",
            skill.description_md,
            "",
            "## Steps",
        ]

        if steps:
            for idx, instruction in enumerate(steps, start=1):
                lines.append(f"{idx}. {instruction}")
        else:
            lines.append("1. No explicit steps stored")

        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return str(target)

    def get_skill_steps(self, skill_id: str) -> list[str]:
        """Returns ordered steps for a skill."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT instruction FROM skill_steps WHERE skill_id = ? ORDER BY step_order ASC",
                (skill_id,),
            ).fetchall()
        return [row["instruction"] for row in rows]

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS skills ("
                "skill_id TEXT PRIMARY KEY, "
                "name TEXT UNIQUE NOT NULL, "
                "summary TEXT NOT NULL, "
                "description_md TEXT NOT NULL, "
                "tags TEXT NOT NULL, "
                "source TEXT NOT NULL, "
                "maturity TEXT NOT NULL DEFAULT 'candidate', "
                "metadata TEXT NOT NULL DEFAULT '{}', "
                "usage_count INTEGER NOT NULL DEFAULT 0, "
                "success_count INTEGER NOT NULL DEFAULT 0, "
                "failure_count INTEGER NOT NULL DEFAULT 0, "
                "created_at TEXT NOT NULL, "
                "updated_at TEXT NOT NULL"
                ")"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS skill_steps ("
                "skill_id TEXT NOT NULL, "
                "step_order INTEGER NOT NULL, "
                "instruction TEXT NOT NULL, "
                "PRIMARY KEY (skill_id, step_order), "
                "FOREIGN KEY (skill_id) REFERENCES skills(skill_id) ON DELETE CASCADE"
                ")"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS research_notes ("
                "note_id TEXT PRIMARY KEY, "
                "topic TEXT NOT NULL, "
                "content TEXT NOT NULL, "
                "source TEXT NOT NULL, "
                "confidence REAL NOT NULL, "
                "created_at TEXT NOT NULL"
                ")"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS automation_rules ("
                "rule_id TEXT PRIMARY KEY, "
                "name TEXT NOT NULL, "
                "trigger_query TEXT NOT NULL, "
                "skill_id TEXT NOT NULL, "
                "priority INTEGER NOT NULL DEFAULT 100, "
                "enabled INTEGER NOT NULL DEFAULT 1, "
                "FOREIGN KEY (skill_id) REFERENCES skills(skill_id) ON DELETE CASCADE"
                ")"
            )
            conn.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5("
                "skill_id UNINDEXED, name, summary, description_md, tags"
                ")"
            )

    def _upsert_fts(self, conn: sqlite3.Connection, skill_id: str) -> None:
        row = conn.execute(
            "SELECT skill_id, name, summary, description_md, tags FROM skills WHERE skill_id = ?",
            (skill_id,),
        ).fetchone()
        if row is None:
            return

        conn.execute("DELETE FROM skills_fts WHERE skill_id = ?", (skill_id,))
        conn.execute(
            "INSERT INTO skills_fts (skill_id, name, summary, description_md, tags) VALUES (?, ?, ?, ?, ?)",
            (row["skill_id"], row["name"], row["summary"], row["description_md"], row["tags"]),
        )

    def _row_to_skill_record(self, row: sqlite3.Row) -> SkillRecord:
        return SkillRecord(
            skill_id=row["skill_id"],
            name=row["name"],
            summary=row["summary"],
            description_md=row["description_md"],
            tags=json.loads(row["tags"]),
            source=row["source"],
            maturity=row["maturity"],
            usage_count=int(row["usage_count"]),
            success_count=int(row["success_count"]),
            failure_count=int(row["failure_count"]),
            metadata=json.loads(row["metadata"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def _normalize_tags(self, tags: list[str]) -> list[str]:
        normalized = {
            tag.strip().lower().replace(" ", "-")
            for tag in tags
            if tag and tag.strip()
        }
        return sorted(normalized)

    def _derive_repo_key(self, repo_reference: str) -> str:
        suffix = repo_reference.rstrip("/").split("/")[-1]
        suffix = suffix[:-4] if suffix.endswith(".git") else suffix
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", suffix).strip("-") or "repo"
        digest = hashlib.sha1(repo_reference.encode("utf-8")).hexdigest()[:10]
        return f"{safe_name}-{digest}"

    def _run_subprocess(self, command: list[str]) -> None:
        try:
            subprocess.run(command, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").strip()
            stdout = (exc.stdout or "").strip()
            detail = stderr or stdout or str(exc)
            raise RuntimeError(f"Command failed: {' '.join(command)} :: {detail}") from exc

    def _compute_maturity(self, usage_count: int, success_count: int, failure_count: int) -> str:
        total = success_count + failure_count
        success_rate = (success_count / total) if total > 0 else 0.0

        if usage_count >= 10 and success_rate >= 0.8:
            return "proven"
        if usage_count >= 3 and success_rate >= 0.6:
            return "established"
        return "candidate"

    def _parse_markdown_skill(self, path: Path) -> dict[str, Any]:
        content = path.read_text(encoding="utf-8")
        lines = content.splitlines()

        name = ""
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("#"):
                name = stripped.lstrip("#").strip()
                break
        if not name:
            name = path.stem.replace("-", " ").replace("_", " ").title()

        summary = self._extract_summary(lines)
        steps = self._extract_steps(lines)

        tags = [
            part.lower().replace("_", "-")
            for part in path.parent.parts
            if part and part not in {".", ".."}
        ]

        return {
            "name": name,
            "summary": summary,
            "description_md": content,
            "steps": steps,
            "tags": tags,
        }

    def _extract_summary(self, lines: list[str]) -> str:
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                continue
            if stripped.startswith("```"):
                continue
            return stripped[:240]
        return "Imported skill"

    def _extract_steps(self, lines: list[str]) -> list[str]:
        steps: list[str] = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("- "):
                steps.append(stripped[2:].strip())
            elif re.match(r"^\d+\.\s+", stripped):
                steps.append(re.sub(r"^\d+\.\s+", "", stripped))
            if len(steps) >= 20:
                break
        return steps

    def _to_fts_query(self, text: str) -> str:
        words = [word for word in self._tokenize(text) if len(word) > 1]
        if not words:
            return ""
        return " OR ".join(f"{word}*" for word in words)

    def _tokenize(self, text: str) -> list[str]:
        return [token.lower() for token in _WORD_RE.findall(text)]


__all__ = ["SkillRecord", "ResearchBrief", "SkillVault"]
