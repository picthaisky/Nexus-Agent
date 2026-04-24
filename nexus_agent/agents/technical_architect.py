"""Technical Architect Agent.

Role: Expert Technical Architect and AI Developer in Mob Elaboration sessions.
Responsibility: Review requirements and codebase structure to design a technical
plan in TODO_.md format.  Code generation is blocked until all edge cases and
failure modes have been identified.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import (
    AgentRole,
    ArchitecturePlan,
    EdgeCase,
    FailureMode,
)
from nexus_agent.prompts.templates import TECHNICAL_ARCHITECT_SYSTEM_PROMPT


class TechnicalArchitectAgent(BaseAgent):
    """Analyses requirements, identifies edge cases / failure modes, and
    produces an :class:`~nexus_agent.core.models.ArchitecturePlan` rendered
    as a ``TODO_.md`` document.

    The agent enforces the rule: *no implementation may begin until
    :meth:`~nexus_agent.core.models.ArchitecturePlan.is_ready_for_implementation`
    returns ``True``*.

    Expected *payload* keys
    -----------------------
    requirements_summary : str
        A concise description of the feature or system to be built.
    components : list[str]
        High-level system components involved.
    edge_cases : list[dict]
        Each item must supply ``title``, ``description``, ``impact``, and
        ``mitigation``.
    failure_modes : list[dict]
        Each item must supply ``title``, ``description``, ``probability``, and
        ``recovery_strategy``.
    todo_items : list[str]
        Ordered list of tasks to be implemented.
    notes : str  (optional)
        Free-form notes to append to the plan.
    output_path : str  (optional)
        If provided, the rendered ``TODO_.md`` is written to this path.
    """

    role = AgentRole.TECHNICAL_ARCHITECT

    def __init__(self) -> None:
        super().__init__(system_prompt=TECHNICAL_ARCHITECT_SYSTEM_PROMPT)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, payload: dict[str, Any]) -> ArchitecturePlan:
        """Build an :class:`ArchitecturePlan` from *payload*.

        Raises
        ------
        ValueError
            If required keys are missing from *payload*.
        RuntimeError
            If the plan is not ready for implementation (i.e. edge cases or
            failure modes are absent).
        """
        self._validate_payload(payload)

        edge_cases = [EdgeCase(**ec) for ec in payload.get("edge_cases", [])]
        failure_modes = [FailureMode(**fm) for fm in payload.get("failure_modes", [])]

        plan = ArchitecturePlan(
            requirements_summary=payload["requirements_summary"],
            components=payload.get("components", []),
            edge_cases=edge_cases,
            failure_modes=failure_modes,
            todo_items=payload.get("todo_items", []),
            notes=payload.get("notes", ""),
        )

        if not plan.is_ready_for_implementation():
            raise RuntimeError(
                "Cannot proceed: the plan must include at least one edge case "
                "and one failure mode before implementation begins. "
                f"(edge_cases={len(plan.edge_cases)}, "
                f"failure_modes={len(plan.failure_modes)})"
            )

        if output_path := payload.get("output_path"):
            self._write_todo_md(plan, output_path)

        return plan

    def build_plan(self, payload: dict[str, Any]) -> ArchitecturePlan:
        """Alias for :meth:`run` with a more descriptive name."""
        return self.run(payload)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_payload(payload: dict[str, Any]) -> None:
        required = ("requirements_summary",)
        missing = [k for k in required if k not in payload]
        if missing:
            raise ValueError(
                f"TechnicalArchitectAgent.run() missing required keys: {missing}"
            )

    @staticmethod
    def _write_todo_md(plan: ArchitecturePlan, output_path: str) -> pathlib.Path:
        path = pathlib.Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(plan.render_todo_md(), encoding="utf-8")
        return path
