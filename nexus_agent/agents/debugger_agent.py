"""Debugger Agent — diagnoses errors, reads logs, and proposes fixes."""
from __future__ import annotations
import logging, json, re
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, DebugReport

logger = logging.getLogger(__name__)

_SYSTEM = """You are an expert Debugging Engineer. You analyse error messages, stack traces, and logs to:
1. Identify the ROOT CAUSE clearly
2. List affected files/components
3. Provide ordered, actionable fix suggestions
4. Explain WHY the error occurred

Respond ONLY with valid JSON:
{
  "root_cause": "One-sentence root cause",
  "analysis_md": "## Diagnosis\n...",
  "fix_suggestions": ["Step 1: ...", "Step 2: ..."],
  "affected_files": ["path/to/file.py"]
}"""


class DebuggerAgent(BaseAgent):
    role = AgentRole.DEBUGGER

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> DebugReport:
        error_input = payload.get("error", payload.get("log", payload.get("task", "")))
        logger.info("DebuggerAgent diagnosing: %s", str(error_input)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Diagnose this error/log:\n\n{error_input}"},
                    ],
                    temperature=0.1, max_tokens=2048,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    return DebugReport(
                        error_input=str(error_input)[:500],
                        root_cause=data.get("root_cause", "Unknown"),
                        analysis_md=data.get("analysis_md", ""),
                        fix_suggestions=data.get("fix_suggestions", []),
                        affected_files=data.get("affected_files", []),
                        metadata={"provider": resp.provider, "tokens_in": resp.tokens_in},
                    )
            except Exception as exc:
                logger.warning("DebuggerAgent LLM failed: %s", exc)

        return DebugReport(
            error_input=str(error_input)[:500],
            root_cause="LLM provider not configured",
            analysis_md=f"## Debug Analysis\n\n> ⚠️ LLM unavailable.\n\nError submitted:\n```\n{str(error_input)[:300]}\n```",
            fix_suggestions=["Configure a valid LLM provider (OpenAI/Claude/Gemini) and retry."],
        )
