"""Tests for core data models."""

import pytest

from nexus_agent.core.models import (
    AgentRole,
    ArchitecturePlan,
    CodeChange,
    EdgeCase,
    FailureMode,
    ImplementationPlan,
    OptimizationResult,
    PromptVariant,
    TaskStatus,
    UnitTest,
    AgentMessage,
)


# ---------------------------------------------------------------------------
# EdgeCase
# ---------------------------------------------------------------------------

class TestEdgeCase:
    def test_default_id_assigned(self):
        ec = EdgeCase(
            title="Empty input",
            description="User sends an empty string",
            impact="Crash",
            mitigation="Validate before processing",
        )
        assert ec.id
        assert ec.title == "Empty input"

    def test_custom_id_preserved(self):
        ec = EdgeCase(
            id="custom-id",
            title="T",
            description="D",
            impact="I",
            mitigation="M",
        )
        assert ec.id == "custom-id"


# ---------------------------------------------------------------------------
# FailureMode
# ---------------------------------------------------------------------------

class TestFailureMode:
    def test_fields(self):
        fm = FailureMode(
            title="DB timeout",
            description="Database does not respond within 5 s",
            probability="medium",
            recovery_strategy="Retry with exponential back-off",
        )
        assert fm.probability == "medium"
        assert "Retry" in fm.recovery_strategy


# ---------------------------------------------------------------------------
# ArchitecturePlan
# ---------------------------------------------------------------------------

MINIMAL_EDGE_CASE = dict(
    title="Null payload",
    description="Agent receives null payload",
    impact="KeyError",
    mitigation="Guard clause at entry",
)

MINIMAL_FAILURE_MODE = dict(
    title="LLM timeout",
    description="LLM API call exceeds 30 s",
    probability="low",
    recovery_strategy="Return cached response",
)


class TestArchitecturePlan:
    def _build(self, *, with_ec=True, with_fm=True):
        return ArchitecturePlan(
            requirements_summary="Build feature X",
            components=["API", "DB"],
            edge_cases=[EdgeCase(**MINIMAL_EDGE_CASE)] if with_ec else [],
            failure_modes=[FailureMode(**MINIMAL_FAILURE_MODE)] if with_fm else [],
            todo_items=["Design schema", "Write tests"],
        )

    def test_is_ready_when_both_present(self):
        plan = self._build()
        assert plan.is_ready_for_implementation() is True

    def test_not_ready_without_edge_cases(self):
        plan = self._build(with_ec=False)
        assert plan.is_ready_for_implementation() is False

    def test_not_ready_without_failure_modes(self):
        plan = self._build(with_fm=False)
        assert plan.is_ready_for_implementation() is False

    def test_render_todo_md_contains_key_sections(self):
        plan = self._build()
        md = plan.render_todo_md()
        assert "# TODO" in md
        assert "## Edge Cases" in md
        assert "## Failure Modes" in md
        assert "## TODO Items" in md
        assert "- [ ] Design schema" in md
        assert "- [ ] Write tests" in md

    def test_render_todo_md_includes_component(self):
        plan = self._build()
        md = plan.render_todo_md()
        assert "API" in md
        assert "DB" in md

    def test_render_todo_md_empty_lists(self):
        plan = ArchitecturePlan(
            requirements_summary="Empty plan",
            components=[],
            edge_cases=[],
            failure_modes=[],
            todo_items=[],
        )
        md = plan.render_todo_md()
        assert "_No edge cases identified yet._" in md
        assert "_No failure modes identified yet._" in md

    def test_render_todo_md_with_notes(self):
        plan = self._build()
        plan.notes = "See ADR-042"
        md = plan.render_todo_md()
        assert "ADR-042" in md


# ---------------------------------------------------------------------------
# ImplementationPlan
# ---------------------------------------------------------------------------

class TestImplementationPlan:
    def test_basic_construction(self):
        plan = ImplementationPlan(
            summary="Add user endpoint",
            code_changes=[
                CodeChange(
                    file_path="src/api.py",
                    diff="--- a/src/api.py\n+++ b/src/api.py\n@@ -1 +1 @@\n-old\n+new\n",
                    description="Add GET /users",
                )
            ],
            unit_tests=[
                UnitTest(
                    name="test_get_users",
                    file_path="tests/test_api.py",
                    content="def test_get_users(): ...",
                )
            ],
            sandbox_steps=["pip install -r requirements.txt", "pytest tests/"],
        )
        assert plan.summary == "Add user endpoint"
        assert len(plan.code_changes) == 1
        assert len(plan.unit_tests) == 1
        assert len(plan.sandbox_steps) == 2


# ---------------------------------------------------------------------------
# OptimizationResult / PromptVariant
# ---------------------------------------------------------------------------

class TestOptimizationResult:
    def _make_result(self, scores=(0.6, 0.8, 0.9)):
        variants = [
            PromptVariant(
                version=i + 1,
                system_prompt=f"Prompt v{i + 1}",
                rationale=f"Rationale {i + 1}",
                eval_score=scores[i],
            )
            for i in range(3)
        ]
        return OptimizationResult(
            execution_trace_summary="Agent failed on edge case X",
            deviation_points=["Step 3 diverged"],
            prompt_variants=variants,
        )

    def test_select_best_returns_highest_score(self):
        result = self._make_result(scores=(0.5, 0.9, 0.7))
        best = result.select_best_variant()
        assert best is not None
        assert best.eval_score == 0.9
        assert result.selected_variant_id == best.id

    def test_select_best_no_scored_variants(self):
        result = OptimizationResult(
            execution_trace_summary="trace",
            prompt_variants=[
                PromptVariant(version=1, system_prompt="p", rationale="r")
            ],
        )
        assert result.select_best_variant() is None

    def test_select_best_tie_picks_last_in_list(self):
        """When scores are equal the first max encountered is returned (stable)."""
        result = self._make_result(scores=(1.0, 1.0, 1.0))
        best = result.select_best_variant()
        assert best is not None
        assert best.eval_score == 1.0


# ---------------------------------------------------------------------------
# AgentMessage
# ---------------------------------------------------------------------------

class TestAgentMessage:
    def test_default_status_is_pending(self):
        msg = AgentMessage(
            sender=AgentRole.TECHNICAL_ARCHITECT,
            recipient=AgentRole.DEVELOPER,
            payload={"key": "value"},
        )
        assert msg.status == TaskStatus.PENDING

    def test_serialisation_roundtrip(self):
        msg = AgentMessage(
            sender=AgentRole.DEVELOPER,
            recipient=AgentRole.AUTONOMOUS_OPTIMIZER,
            payload={"result": 42},
            status=TaskStatus.COMPLETED,
        )
        data = msg.model_dump(mode="json")
        assert data["sender"] == "developer"
        assert data["recipient"] == "autonomous_optimizer"
        assert data["status"] == "completed"
        assert data["payload"] == {"result": 42}
