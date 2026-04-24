"""Tests for the Orchestrator."""

import pytest

from nexus_agent.core.orchestrator import Orchestrator
from nexus_agent.core.models import (
    ArchitecturePlan,
    ImplementationPlan,
    OptimizationResult,
    TaskStatus,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

EDGE_CASE = dict(
    title="Null input",
    description="Null value passed to agent",
    impact="Crash",
    mitigation="Input guard",
)

FAILURE_MODE = dict(
    title="Network failure",
    description="HTTP 500 from upstream",
    probability="medium",
    recovery_strategy="Retry 3 times",
)


def _architect_payload(**overrides):
    p = dict(
        requirements_summary="Build data pipeline",
        components=["Ingestion", "Processing", "Storage"],
        edge_cases=[EDGE_CASE],
        failure_modes=[FAILURE_MODE],
        todo_items=["Scaffold repo", "Implement ingestion", "Write tests"],
    )
    p.update(overrides)
    return p


def _developer_payload(**overrides):
    p = dict(
        summary="Implement ingestion module",
        code_changes=[
            dict(
                file_path="src/ingestion.py",
                original="",
                modified="def ingest(data): return data\n",
                description="Add ingest function",
            )
        ],
        unit_tests=[
            dict(
                name="test_ingest",
                file_path="tests/test_ingestion.py",
                content="def test_ingest(): assert ingest({}) == {}",
            )
        ],
        sandbox_steps=["pip install -r requirements.txt", "pytest"],
    )
    p.update(overrides)
    return p


def _optimizer_payload(**overrides):
    p = dict(
        execution_trace_summary="Step 2 returned wrong type",
        deviation_points=["Step 2 returned str instead of dict"],
        prompt_variants=[
            dict(version=i + 1, system_prompt=f"P{i}", rationale=f"R{i}", eval_score=0.6 + i * 0.1)
            for i in range(3)
        ],
    )
    p.update(overrides)
    return p


# ---------------------------------------------------------------------------
# Orchestrator tests
# ---------------------------------------------------------------------------

class TestOrchestrator:
    def setup_method(self):
        self.orch = Orchestrator()

    def test_run_architect_returns_plan(self):
        result = self.orch.run_architect(_architect_payload())
        assert isinstance(result, ArchitecturePlan)

    def test_run_developer_returns_plan(self):
        result = self.orch.run_developer(_developer_payload())
        assert isinstance(result, ImplementationPlan)

    def test_run_optimizer_returns_result(self):
        result = self.orch.run_optimizer(_optimizer_payload())
        assert isinstance(result, OptimizationResult)

    def test_run_architect_logs_message(self):
        self.orch.run_architect(_architect_payload())
        assert len(self.orch.message_log) == 1
        assert self.orch.message_log[0].status == TaskStatus.COMPLETED

    def test_run_developer_logs_message(self):
        self.orch.run_developer(_developer_payload())
        assert len(self.orch.message_log) == 1
        assert self.orch.message_log[0].status == TaskStatus.COMPLETED

    def test_run_optimizer_logs_message(self):
        self.orch.run_optimizer(_optimizer_payload())
        assert len(self.orch.message_log) == 1
        assert self.orch.message_log[0].status == TaskStatus.COMPLETED

    def test_failed_run_logs_failed_status(self):
        bad_payload = {}  # missing required keys
        with pytest.raises(Exception):
            self.orch.run_architect(bad_payload)
        assert self.orch.message_log[-1].status == TaskStatus.FAILED

    def test_message_log_is_copy(self):
        self.orch.run_developer(_developer_payload())
        log = self.orch.message_log
        log.clear()
        assert len(self.orch.message_log) == 1  # internal log unchanged

    def test_message_log_json_is_valid_json(self):
        import json
        self.orch.run_developer(_developer_payload())
        raw = self.orch.message_log_json()
        parsed = json.loads(raw)
        assert isinstance(parsed, list)
        assert len(parsed) == 1

    def test_run_pipeline_returns_all_three_results(self):
        result = self.orch.run_pipeline(
            architect_payload=_architect_payload(),
            developer_payload=_developer_payload(),
            optimizer_payload=_optimizer_payload(),
        )
        assert "architecture" in result
        assert "implementation" in result
        assert "optimization" in result

    def test_run_pipeline_logs_three_messages(self):
        self.orch.run_pipeline(
            architect_payload=_architect_payload(),
            developer_payload=_developer_payload(),
            optimizer_payload=_optimizer_payload(),
        )
        assert len(self.orch.message_log) == 3
        assert all(m.status == TaskStatus.COMPLETED for m in self.orch.message_log)

    def test_run_pipeline_architect_failure_propagates(self):
        with pytest.raises(RuntimeError):
            self.orch.run_pipeline(
                architect_payload=_architect_payload(edge_cases=[]),  # will fail
                developer_payload=_developer_payload(),
                optimizer_payload=_optimizer_payload(),
            )
