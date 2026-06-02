"""Project Manager Agent — tracks tasks, generates status reports, manages timelines."""
from __future__ import annotations
import logging, json, re, uuid
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, ProjectStatusReport, ProjectTask

logger = logging.getLogger(__name__)

_SYSTEM = """You are a Senior Project Manager experienced in Agile, Scrum, and Kanban methodologies.

Given a project description or current status, produce:
1. A structured task breakdown with priorities and statuses
2. Risk identification
3. Next actionable steps
4. Overall progress estimate (%)

Respond ONLY with valid JSON:
{
  "summary_md": "## Project Status: [Name]\n...",
  "progress_pct": 35,
  "risks": ["Scope creep on billing module", "API rate limits in production"],
  "next_actions": ["Complete DB schema", "Deploy to staging", "User testing"],
  "tasks": [
    {
      "id": "T-001",
      "title": "Database schema design",
      "status": "done",
      "priority": "high",
      "assignee": "DB Architect",
      "due_date": "2026-06-05",
      "notes": "Completed, pending review"
    }
  ]
}"""


class ProjectManagerAgent(BaseAgent):
    role = AgentRole.PROJECT_MANAGER

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> ProjectStatusReport:
        project = payload.get("project", payload.get("task", ""))
        context = payload.get("context", "")
        full_input = f"{project}\n\nContext:\n{context}" if context else project
        logger.info("ProjectManagerAgent managing: %s", str(project)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Project/Task:\n{full_input}"},
                    ],
                    temperature=0.3, max_tokens=3000,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    tasks = [ProjectTask(id=t.get("id", str(uuid.uuid4())[:8]), **{k: v for k, v in t.items() if k != "id"})
                             for t in data.get("tasks", [])]
                    return ProjectStatusReport(
                        project=str(project)[:200],
                        summary_md=data.get("summary_md", ""),
                        tasks=tasks,
                        risks=data.get("risks", []),
                        next_actions=data.get("next_actions", []),
                        progress_pct=int(data.get("progress_pct", 0)),
                        metadata={"provider": resp.provider},
                    )
            except Exception as exc:
                logger.warning("ProjectManagerAgent LLM failed: %s", exc)

        return ProjectStatusReport(
            project=str(project)[:200],
            summary_md=f"## Project Status\n\n> ⚠️ LLM unavailable.\n\nProject: `{str(project)[:100]}`",
            tasks=[ProjectTask(id="T-001", title="Configure LLM Provider", status="todo",
                                priority="high", notes="Required for AI-powered project management")],
            risks=["LLM provider not configured"],
            next_actions=["Set OPENAI_API_KEY or ANTHROPIC_API_KEY in Stack.env"],
            progress_pct=0,
        )
