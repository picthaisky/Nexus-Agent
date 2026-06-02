"""Code Reviewer Agent — reviews code quality, security, and best practices."""
from __future__ import annotations
import logging, json, re
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, CodeReviewResult, CodeIssue

logger = logging.getLogger(__name__)

_SYSTEM = """You are an expert Code Reviewer with deep knowledge of software engineering best practices,
security vulnerabilities (OWASP Top 10), and clean code principles.

When reviewing code or a task description:
1. Identify issues by severity: critical / major / minor / info
2. Categorise each issue: security / performance / style / logic / maintainability
3. Give actionable suggestions for each issue
4. Provide an overall score 0-100 and whether to approve the code

Respond ONLY with valid JSON matching this schema:
{
  "summary_md": "## Code Review\n...",
  "score": 82,
  "approved": true,
  "issues": [
    {
      "severity": "major",
      "file_path": "src/api.py",
      "line": "42",
      "category": "security",
      "description": "SQL query built with string concatenation",
      "suggestion": "Use parameterised queries or an ORM"
    }
  ]
}"""


class CodeReviewerAgent(BaseAgent):
    role = AgentRole.CODE_REVIEWER

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> CodeReviewResult:
        target = payload.get("target", payload.get("code", payload.get("task", "")))
        logger.info("CodeReviewerAgent reviewing: %s", str(target)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Review the following:\n\n{target}"},
                    ],
                    temperature=0.1, max_tokens=2048,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    issues = [CodeIssue(**i) for i in data.get("issues", [])]
                    return CodeReviewResult(
                        target=str(target)[:200],
                        summary_md=data.get("summary_md", ""),
                        issues=issues,
                        score=int(data.get("score", 70)),
                        approved=bool(data.get("approved", False)),
                        metadata={"provider": resp.provider, "tokens_in": resp.tokens_in, "tokens_out": resp.tokens_out},
                    )
            except Exception as exc:
                logger.warning("CodeReviewerAgent LLM failed: %s", exc)

        return CodeReviewResult(
            target=str(target)[:200],
            summary_md=f"## Code Review\n\n> ⚠️ LLM unavailable — static analysis only.\n\nTarget reviewed: `{str(target)[:100]}`",
            issues=[CodeIssue(severity="info", file_path="unknown", line="—", category="style",
                               description="Manual review required", suggestion="Configure an LLM provider")],
            score=50, approved=False,
        )
