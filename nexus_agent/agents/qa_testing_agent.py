"""QA Testing Agent — generates unit, integration, and E2E test suites."""
from __future__ import annotations
import logging, json, re
from typing import Any
from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import AgentRole, QATestingResult, TestCase

logger = logging.getLogger(__name__)

_SYSTEM = """You are a Senior QA Engineer specialising in test automation.
Given code, a feature description, or API spec, generate comprehensive tests.

Include:
1. Unit tests (pytest / jest) for individual functions
2. Integration tests for API endpoints
3. Edge case and negative tests
4. Commands to run the tests

Respond ONLY with valid JSON:
{
  "summary_md": "## Test Plan\n...",
  "coverage_estimate": "~85%",
  "commands": ["pytest tests/ -v --cov=src"],
  "test_cases": [
    {
      "name": "test_create_invoice_success",
      "test_type": "unit",
      "description": "Happy path for invoice creation",
      "code": "def test_create_invoice_success():\n    ...",
      "file_path": "tests/test_invoice.py"
    }
  ]
}"""


class QATestingAgent(BaseAgent):
    role = AgentRole.QA_TESTER

    def __init__(self) -> None:
        super().__init__(system_prompt=_SYSTEM)
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    def run(self, payload: dict[str, Any]) -> QATestingResult:
        target = payload.get("target", payload.get("code", payload.get("task", "")))
        framework = payload.get("framework", "pytest")
        logger.info("QATestingAgent generating tests for: %s", str(target)[:80])

        if self.engine:
            try:
                resp = self.engine.generate_detailed(
                    messages=[
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": f"Framework: {framework}\n\nGenerate tests for:\n\n{target}"},
                    ],
                    temperature=0.2, max_tokens=3000,
                )
                raw = resp.content.strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    tests = [TestCase(**tc) for tc in data.get("test_cases", [])]
                    return QATestingResult(
                        target=str(target)[:200],
                        summary_md=data.get("summary_md", ""),
                        test_cases=tests,
                        coverage_estimate=data.get("coverage_estimate", ""),
                        commands=data.get("commands", []),
                        metadata={"provider": resp.provider, "framework": framework},
                    )
            except Exception as exc:
                logger.warning("QATestingAgent LLM failed: %s", exc)

        return QATestingResult(
            target=str(target)[:200],
            summary_md=f"## Test Plan\n\n> ⚠️ LLM unavailable.\n\nTarget: `{str(target)[:100]}`",
            test_cases=[TestCase(name="test_placeholder", test_type="unit",
                                  description="Configure LLM to generate real tests",
                                  code="def test_placeholder():\n    assert True  # Replace with real test",
                                  file_path="tests/test_placeholder.py")],
            commands=[f"{framework} tests/ -v"],
        )
