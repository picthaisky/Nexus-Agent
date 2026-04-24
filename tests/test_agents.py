"""Tests for agent implementations."""

import pathlib
import tempfile

import pytest

from nexus_agent.agents.technical_architect import TechnicalArchitectAgent
from nexus_agent.agents.developer import DeveloperAgent
from nexus_agent.agents.autonomous_optimizer import (
    AutonomousOptimizerAgent,
    REQUIRED_VARIANT_COUNT,
)
from nexus_agent.core.models import (
    ArchitecturePlan,
    ImplementationPlan,
    OptimizationResult,
)


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

EDGE_CASE = dict(
    title="Empty payload",
    description="Agent receives empty dict",
    impact="KeyError",
    mitigation="Validate at entry",
)

FAILURE_MODE = dict(
    title="LLM API down",
    description="LLM service unavailable",
    probability="low",
    recovery_strategy="Return cached result",
)

VARIANT = dict(
    version=1,
    system_prompt="You are an expert assistant.",
    rationale="Concise and direct.",
    eval_score=0.85,
)


def _make_three_variants(base_score=0.7):
    return [
        dict(
            version=i + 1,
            system_prompt=f"Variant {i + 1} prompt",
            rationale=f"Rationale {i + 1}",
            eval_score=base_score + i * 0.05,
        )
        for i in range(REQUIRED_VARIANT_COUNT)
    ]


# ---------------------------------------------------------------------------
# TechnicalArchitectAgent
# ---------------------------------------------------------------------------

class TestTechnicalArchitectAgent:
    def setup_method(self):
        self.agent = TechnicalArchitectAgent()

    def _valid_payload(self, **overrides):
        payload = dict(
            requirements_summary="Build authentication module",
            components=["API Gateway", "Auth Service", "DB"],
            edge_cases=[EDGE_CASE],
            failure_modes=[FAILURE_MODE],
            todo_items=["Design schema", "Implement JWT", "Write tests"],
        )
        payload.update(overrides)
        return payload

    def test_role(self):
        from nexus_agent.core.models import AgentRole
        assert self.agent.role == AgentRole.TECHNICAL_ARCHITECT

    def test_system_prompt_set(self):
        assert "Technical Architect" in self.agent.system_prompt
        assert self.agent.system_prompt  # non-empty

    def test_run_returns_architecture_plan(self):
        result = self.agent.run(self._valid_payload())
        assert isinstance(result, ArchitecturePlan)

    def test_run_plan_has_correct_summary(self):
        result = self.agent.run(self._valid_payload())
        assert result.requirements_summary == "Build authentication module"

    def test_run_plan_has_edge_cases(self):
        result = self.agent.run(self._valid_payload())
        assert len(result.edge_cases) == 1
        assert result.edge_cases[0].title == "Empty payload"

    def test_run_plan_has_failure_modes(self):
        result = self.agent.run(self._valid_payload())
        assert len(result.failure_modes) == 1

    def test_run_raises_runtime_error_without_edge_cases(self):
        with pytest.raises(RuntimeError, match="edge case"):
            self.agent.run(self._valid_payload(edge_cases=[]))

    def test_run_raises_runtime_error_without_failure_modes(self):
        with pytest.raises(RuntimeError, match="failure mode"):
            self.agent.run(self._valid_payload(failure_modes=[]))

    def test_run_raises_value_error_missing_summary(self):
        payload = self._valid_payload()
        del payload["requirements_summary"]
        with pytest.raises(ValueError, match="requirements_summary"):
            self.agent.run(payload)

    def test_run_writes_todo_md_when_output_path_given(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = str(pathlib.Path(tmpdir) / "TODO_.md")
            self.agent.run(self._valid_payload(output_path=output_path))
            assert pathlib.Path(output_path).exists()
            content = pathlib.Path(output_path).read_text(encoding="utf-8")
            assert "# TODO" in content

    def test_describe(self):
        assert "technical_architect" in self.agent.describe()

    def test_build_plan_alias(self):
        result = self.agent.build_plan(self._valid_payload())
        assert isinstance(result, ArchitecturePlan)


# ---------------------------------------------------------------------------
# DeveloperAgent
# ---------------------------------------------------------------------------

class TestDeveloperAgent:
    def setup_method(self):
        self.agent = DeveloperAgent()

    def _valid_payload(self, **overrides):
        payload = dict(
            summary="Add user registration endpoint",
            code_changes=[
                dict(
                    file_path="src/api.py",
                    original="# empty\n",
                    modified="def register(): pass\n",
                    description="Add register function",
                )
            ],
            unit_tests=[
                dict(
                    name="test_register",
                    file_path="tests/test_api.py",
                    content="def test_register(): assert True",
                )
            ],
            sandbox_steps=[
                "pip install -r requirements.txt",
                "pytest tests/test_api.py -v",
            ],
        )
        payload.update(overrides)
        return payload

    def test_role(self):
        from nexus_agent.core.models import AgentRole
        assert self.agent.role == AgentRole.DEVELOPER

    def test_run_returns_implementation_plan(self):
        result = self.agent.run(self._valid_payload())
        assert isinstance(result, ImplementationPlan)

    def test_run_generates_unified_diff(self):
        result = self.agent.run(self._valid_payload())
        diff = result.code_changes[0].diff
        assert "---" in diff
        assert "+++" in diff
        assert "+def register" in diff

    def test_run_uses_provided_diff_directly(self):
        manual_diff = "--- a/f.py\n+++ b/f.py\n@@ -1 +1 @@\n-x\n+y\n"
        payload = self._valid_payload(
            code_changes=[
                dict(
                    file_path="f.py",
                    diff=manual_diff,
                    description="Manual diff",
                )
            ]
        )
        result = self.agent.run(payload)
        assert result.code_changes[0].diff == manual_diff

    def test_run_preserves_sandbox_steps(self):
        result = self.agent.run(self._valid_payload())
        assert len(result.sandbox_steps) == 2
        assert "pytest" in result.sandbox_steps[1]

    def test_run_raises_value_error_missing_summary(self):
        payload = self._valid_payload()
        del payload["summary"]
        with pytest.raises(ValueError, match="summary"):
            self.agent.run(payload)

    def test_run_with_empty_code_changes(self):
        result = self.agent.run(self._valid_payload(code_changes=[]))
        assert result.code_changes == []

    def test_run_with_empty_unit_tests(self):
        result = self.agent.run(self._valid_payload(unit_tests=[]))
        assert result.unit_tests == []


# ---------------------------------------------------------------------------
# AutonomousOptimizerAgent
# ---------------------------------------------------------------------------

class TestAutonomousOptimizerAgent:
    def setup_method(self):
        self.agent = AutonomousOptimizerAgent()

    def _valid_payload(self, **overrides):
        payload = dict(
            execution_trace_summary="Agent failed at step 3 due to null reference",
            deviation_points=[
                "Step 2: ignored validation error",
                "Step 3: returned incorrect format",
            ],
            prompt_variants=_make_three_variants(),
        )
        payload.update(overrides)
        return payload

    def test_role(self):
        from nexus_agent.core.models import AgentRole
        assert self.agent.role == AgentRole.AUTONOMOUS_OPTIMIZER

    def test_run_returns_optimization_result(self):
        result = self.agent.run(self._valid_payload())
        assert isinstance(result, OptimizationResult)

    def test_run_selects_best_variant(self):
        result = self.agent.run(self._valid_payload())
        assert result.selected_variant_id is not None

    def test_run_selects_highest_score(self):
        variants = [
            dict(version=1, system_prompt="P1", rationale="R1", eval_score=0.5),
            dict(version=2, system_prompt="P2", rationale="R2", eval_score=0.95),
            dict(version=3, system_prompt="P3", rationale="R3", eval_score=0.7),
        ]
        result = self.agent.run(self._valid_payload(prompt_variants=variants))
        best_variant = next(
            v for v in result.prompt_variants if v.id == result.selected_variant_id
        )
        assert best_variant.eval_score == 0.95

    def test_run_assigns_synthetic_scores_when_none_provided(self):
        variants = [
            dict(version=i + 1, system_prompt=f"P{i}", rationale=f"R{i}")
            for i in range(REQUIRED_VARIANT_COUNT)
        ]
        result = self.agent.run(self._valid_payload(prompt_variants=variants))
        # All variants should have been assigned scores.
        assert all(v.eval_score is not None for v in result.prompt_variants)
        # The last variant (highest synthetic score) should be selected.
        assert result.selected_variant_id == result.prompt_variants[-1].id

    def test_run_raises_value_error_wrong_variant_count(self):
        with pytest.raises(ValueError, match=str(REQUIRED_VARIANT_COUNT)):
            self.agent.run(
                self._valid_payload(
                    prompt_variants=[
                        dict(version=1, system_prompt="P", rationale="R")
                    ]
                )
            )

    def test_run_raises_value_error_missing_required_keys(self):
        with pytest.raises(ValueError, match="execution_trace_summary"):
            self.agent.run({"prompt_variants": _make_three_variants()})

    def test_run_raises_value_error_missing_prompt_variants(self):
        with pytest.raises(ValueError, match="prompt_variants"):
            self.agent.run({"execution_trace_summary": "trace"})

    def test_run_stores_deviation_points(self):
        result = self.agent.run(self._valid_payload())
        assert len(result.deviation_points) == 2
