"""Developer Agent.

Role: Senior Software Engineer.
Responsibility: Implement features using JSON data structures and produce:
  1. A summary plan
  2. Code changes in Unified Diff format
  3. Unit tests
  4. Steps to run tests in a sandbox
"""

from __future__ import annotations

from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import (
    AgentRole,
    CodeChange,
    ImplementationPlan,
    UnitTest,
)
from nexus_agent.prompts.templates import DEVELOPER_SYSTEM_PROMPT
from nexus_agent.utils.diff_utils import generate_unified_diff


class DeveloperAgent(BaseAgent):
    """Turns an :class:`~nexus_agent.core.models.ArchitecturePlan` (or raw
    payload) into a concrete :class:`~nexus_agent.core.models.ImplementationPlan`
    containing unified diffs, unit tests, and sandbox steps.

    Expected *payload* keys
    -----------------------
    summary : str
        A concise description of the work being done.
    code_changes : list[dict]
        Each item may supply:

        * ``file_path`` (str) – target file
        * ``original`` (str, optional) – existing file content (empty for new files)
        * ``modified`` (str) – desired file content after changes
        * ``description`` (str) – human-readable description of the change

        If ``diff`` is provided directly it is used as-is; otherwise the diff is
        computed from ``original`` and ``modified``.
    unit_tests : list[dict]
        Each item must supply ``name``, ``file_path``, and ``content``.
    sandbox_steps : list[str]
        Ordered shell commands to execute the test suite inside a sandbox.
    """

    role = AgentRole.DEVELOPER

    def __init__(self) -> None:
        super().__init__(system_prompt=DEVELOPER_SYSTEM_PROMPT)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, payload: dict[str, Any]) -> ImplementationPlan:
        """Build an :class:`ImplementationPlan` from *payload*.

        Raises
        ------
        ValueError
            If required keys are missing from *payload*.
        """
        self._validate_payload(payload)

        code_changes = [
            self._build_code_change(cc) for cc in payload.get("code_changes", [])
        ]
        unit_tests = [UnitTest(**ut) for ut in payload.get("unit_tests", [])]
        sandbox_steps = payload.get("sandbox_steps", [])

        return ImplementationPlan(
            summary=payload["summary"],
            code_changes=code_changes,
            unit_tests=unit_tests,
            sandbox_steps=sandbox_steps,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_payload(payload: dict[str, Any]) -> None:
        required = ("summary",)
        missing = [k for k in required if k not in payload]
        if missing:
            raise ValueError(
                f"DeveloperAgent.run() missing required keys: {missing}"
            )

    @staticmethod
    def _build_code_change(item: dict[str, Any]) -> CodeChange:
        """Convert a raw dict into a :class:`CodeChange`, computing the diff
        when ``diff`` is not provided directly."""
        if "diff" in item:
            return CodeChange(
                file_path=item["file_path"],
                diff=item["diff"],
                description=item.get("description", ""),
            )
        original = item.get("original", "")
        modified = item.get("modified", "")
        diff = generate_unified_diff(
            original=original,
            modified=modified,
            from_file=f"a/{item['file_path']}",
            to_file=f"b/{item['file_path']}",
        )
        return CodeChange(
            file_path=item["file_path"],
            diff=diff,
            description=item.get("description", ""),
        )
