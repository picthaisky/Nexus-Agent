"""Orchestrator – coordinates the three Nexus-Agent roles in a pipeline.

Typical pipeline:
  1. ``TechnicalArchitectAgent`` → produces an ``ArchitecturePlan``
  2. ``DeveloperAgent``          → produces an ``ImplementationPlan``
  3. ``AutonomousOptimizerAgent``→ produces an ``OptimizationResult``
"""

from __future__ import annotations

import json
from typing import Any

from nexus_agent.agents.autonomous_optimizer import AutonomousOptimizerAgent
from nexus_agent.agents.developer import DeveloperAgent
from nexus_agent.agents.technical_architect import TechnicalArchitectAgent
from nexus_agent.core.models import (
    AgentMessage,
    AgentRole,
    ArchitecturePlan,
    ImplementationPlan,
    OptimizationResult,
    TaskStatus,
)


class Orchestrator:
    """Central coordinator that routes payloads between agent roles.

    Usage::

        orch = Orchestrator()

        # Step 1: Architecture planning
        arch_plan = orch.run_architect(architect_payload)

        # Step 2: Implementation (only after planning is complete)
        impl_plan = orch.run_developer(developer_payload)

        # Step 3: Prompt optimisation
        opt_result = orch.run_optimizer(optimizer_payload)
    """

    def __init__(self) -> None:
        self.architect = TechnicalArchitectAgent()
        self.developer = DeveloperAgent()
        self.optimizer = AutonomousOptimizerAgent()
        
        from nexus_agent.core.intent_parser import IntentParser, ComplexityAnalyzer
        self.intent_parser = IntentParser()
        self.complexity_analyzer = ComplexityAnalyzer()
        
        self._message_log: list[AgentMessage] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run_architect(self, payload: dict[str, Any]) -> ArchitecturePlan:
        """Run the Technical Architect Agent and log the exchange."""
        msg = self._make_message(
            sender=AgentRole.TECHNICAL_ARCHITECT,
            recipient=AgentRole.TECHNICAL_ARCHITECT,
            payload=payload,
        )
        try:
            result = self.architect.run(payload)
            msg.status = TaskStatus.COMPLETED
        except Exception:
            msg.status = TaskStatus.FAILED
            self._message_log.append(msg)
            raise
        self._message_log.append(msg)
        return result

    def run_developer(self, payload: dict[str, Any]) -> ImplementationPlan:
        """Run the Developer Agent and log the exchange."""
        msg = self._make_message(
            sender=AgentRole.DEVELOPER,
            recipient=AgentRole.DEVELOPER,
            payload=payload,
        )
        try:
            result = self.developer.run(payload)
            msg.status = TaskStatus.COMPLETED
        except Exception:
            msg.status = TaskStatus.FAILED
            self._message_log.append(msg)
            raise
        self._message_log.append(msg)
        return result

    def run_optimizer(self, payload: dict[str, Any]) -> OptimizationResult:
        """Run the Autonomous Optimizer Agent and log the exchange."""
        msg = self._make_message(
            sender=AgentRole.AUTONOMOUS_OPTIMIZER,
            recipient=AgentRole.AUTONOMOUS_OPTIMIZER,
            payload=payload,
        )
        try:
            result = self.optimizer.run(payload)
            msg.status = TaskStatus.COMPLETED
        except Exception:
            msg.status = TaskStatus.FAILED
            self._message_log.append(msg)
            raise
        self._message_log.append(msg)
        return result

    def run_pipeline(
        self,
        architect_payload: dict[str, Any],
        developer_payload: dict[str, Any],
        optimizer_payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Run the full three-stage pipeline and return a combined result dict.

        Stages
        ------
        1. Technical Architect – validates requirements and produces a plan.
        2. Developer          – implements the plan and produces code changes.
        3. Autonomous Optimizer – evaluates prompt variants and selects the best.

        Returns
        -------
        dict with keys ``architecture``, ``implementation``, ``optimization``.
        """
        arch = self.run_architect(architect_payload)
        impl = self.run_developer(developer_payload)
        opt = self.run_optimizer(optimizer_payload)
        return {
            "architecture": arch.model_dump(mode="json"),
            "implementation": impl.model_dump(mode="json"),
            "optimization": opt.model_dump(mode="json"),
        }

    @property
    def message_log(self) -> list[AgentMessage]:
        """Read-only view of all exchanged messages."""
        return list(self._message_log)

    def message_log_json(self) -> str:
        """Return the message log serialised as a JSON string."""
        return json.dumps(
            [m.model_dump(mode="json") for m in self._message_log],
            ensure_ascii=False,
            indent=2,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _make_message(
        sender: AgentRole,
        recipient: AgentRole,
        payload: dict[str, Any],
    ) -> AgentMessage:
        return AgentMessage(
            sender=sender,
            recipient=recipient,
            payload=payload,
            status=TaskStatus.IN_PROGRESS,
        )
