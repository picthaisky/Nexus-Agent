"""Autonomous Optimizer Agent (GEPA – Genetic Evolution of Prompts using AI).

Role: Prompt optimizer.
Responsibility:
  1. Analyse execution traces and failures.
  2. Identify deviation points where logic diverged from goals.
  3. Improve System Instructions by generating 3 new prompt variants.
  4. Evaluate variants against an eval set and promote the best as the new
     standard system prompt.
"""

from __future__ import annotations

from typing import Any

from nexus_agent.agents.base import BaseAgent
from nexus_agent.core.models import (
    AgentRole,
    OptimizationResult,
    PromptVariant,
)
from nexus_agent.prompts.templates import AUTONOMOUS_OPTIMIZER_SYSTEM_PROMPT

# Number of prompt variants the GEPA cycle must generate.
REQUIRED_VARIANT_COUNT = 3


class AutonomousOptimizerAgent(BaseAgent):
    """Implements the GEPA (Genetic Evolution of Prompts using AI) loop.

    The agent consumes an execution trace summary, identifies deviation
    points, generates :data:`REQUIRED_VARIANT_COUNT` improved prompt variants,
    evaluates them, and returns the best variant as the new standard.

    Expected *payload* keys
    -----------------------
    execution_trace_summary : str
        A textual summary of the execution trace and any failures observed.
    deviation_points : list[str]
        A list of points where agent logic deviated from the intended goal.
    prompt_variants : list[dict]
        Exactly :data:`REQUIRED_VARIANT_COUNT` candidate prompt variants.
        Each item must supply:

        * ``version`` (int)
        * ``system_prompt`` (str)
        * ``rationale`` (str)
        * ``eval_score`` (float, optional) – if provided, used for selection;
          otherwise variants are ranked by their list position (last is best).

    Raises
    ------
    ValueError
        If required keys are missing or the wrong number of variants is supplied.
    """

    role = AgentRole.AUTONOMOUS_OPTIMIZER

    def __init__(self) -> None:
        super().__init__(system_prompt=AUTONOMOUS_OPTIMIZER_SYSTEM_PROMPT)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, payload: dict[str, Any]) -> OptimizationResult:
        """Run the GEPA optimisation loop.

        Returns an :class:`~nexus_agent.core.models.OptimizationResult` with
        :attr:`~nexus_agent.core.models.OptimizationResult.selected_variant_id`
        set to the best-performing variant.
        """
        self._validate_payload(payload)

        variants = [PromptVariant(**v) for v in payload["prompt_variants"]]

        result = OptimizationResult(
            execution_trace_summary=payload["execution_trace_summary"],
            deviation_points=payload.get("deviation_points", []),
            prompt_variants=variants,
        )

        # If no variant carries an explicit eval_score, assign synthetic scores
        # based on list position so the last (most refined) variant wins.
        if all(v.eval_score is None for v in result.prompt_variants):
            for idx, variant in enumerate(result.prompt_variants):
                variant.eval_score = float(idx + 1) / len(result.prompt_variants)

        best = result.select_best_variant()
        if best is None:
            raise RuntimeError(
                "AutonomousOptimizerAgent: unable to select a best variant – "
                "no prompt variants with eval scores were found."
            )

        return result

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_payload(payload: dict[str, Any]) -> None:
        required = ("execution_trace_summary", "prompt_variants")
        missing = [k for k in required if k not in payload]
        if missing:
            raise ValueError(
                f"AutonomousOptimizerAgent.run() missing required keys: {missing}"
            )

        variants = payload.get("prompt_variants", [])
        if len(variants) != REQUIRED_VARIANT_COUNT:
            raise ValueError(
                f"AutonomousOptimizerAgent requires exactly "
                f"{REQUIRED_VARIANT_COUNT} prompt variants, "
                f"got {len(variants)}."
            )
