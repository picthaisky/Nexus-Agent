"""Validator Agent — LLM-based validation of executor output."""
from __future__ import annotations

import json
import logging
from typing import Any

from nexus_agent.core.state import AgentState
from nexus_agent.core.memory import ProceduralMemory

try:
    from nexus_agent.core.inference import InferenceEngine, InferenceConfig
except Exception:
    InferenceEngine = None  # type: ignore
    InferenceConfig = None  # type: ignore

logger = logging.getLogger(__name__)

_VALIDATION_PROMPT = """You are a Validation Agent. Your job is to assess whether the task execution was successful.

Goal: {goal}
Plan steps: {plan}
Actions taken: {actions}
Final output: {final_output}

Assess whether the goal was achieved based on the actions and output.
Respond ONLY with a JSON object:
{{"status": "success" | "partial" | "failed", "feedback": "brief explanation of what worked and what didn't"}}
"""


class ValidatorAgent:
    """Validates executor output using LLM judgment.

    Falls back to a heuristic (action count check) when LLM is unavailable.
    Records feedback on all playbook rules that were used.
    """

    def __init__(self, procedural_memory: ProceduralMemory) -> None:
        self.memory = procedural_memory
        try:
            self.engine = InferenceEngine(InferenceConfig()) if InferenceEngine else None
        except Exception:
            self.engine = None

    def run(self, state: AgentState) -> dict[str, Any]:
        actions = state.get("actions_taken", [])
        used_rule_ids = state.get("used_rule_ids", [])
        goal = state.get("goal", "")
        plan = state.get("plan", [])
        final_output = state.get("final_output", "")

        # LLM-based validation
        validation_status, feedback = self._validate(goal, plan, actions, final_output)

        is_success = validation_status in ("success", "partial")

        # Record feedback for playbook rules
        for rule_id in used_rule_ids:
            try:
                self.memory.record_feedback(rule_id, is_helpful=is_success)
            except Exception as exc:
                logger.debug("Failed to record feedback for rule %s: %s", rule_id, exc)

        return {
            "validation_status": validation_status,
            "validation_feedback": feedback,
            "messages": [
                {
                    "role": "validator",
                    "content": f"Validation result: {validation_status}. {feedback}",
                }
            ],
        }

    def _validate(
        self,
        goal: str,
        plan: list,
        actions: list,
        final_output: Any,
    ) -> tuple[str, str]:
        """Return (status, feedback). Tries LLM first, then heuristic."""
        if self.engine is not None and actions:
            try:
                prompt = _VALIDATION_PROMPT.format(
                    goal=goal[:300],
                    plan=json.dumps(plan[:5], ensure_ascii=False),
                    actions=json.dumps(actions[:10], ensure_ascii=False),
                    final_output=str(final_output)[:500],
                )
                resp = self.engine.generate_detailed(
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                )
                raw = resp.content.strip()
                import re
                match = re.search(r"\{.*\}", raw, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    status = data.get("status", "failed")
                    if status not in ("success", "partial", "failed"):
                        status = "failed"
                    return status, data.get("feedback", "LLM validation complete.")
            except Exception as exc:
                logger.debug("LLM validation failed, using heuristic: %s", exc)

        # Heuristic fallback
        if not actions:
            return "failed", "No actions were taken by the executor."
        if any("error" in a.lower() for a in actions):
            return "partial", "Some actions encountered errors. Review output carefully."
        return "success", f"Executed {len(actions)} action(s) successfully."
