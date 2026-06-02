"""Tests for the Cyber-Thai Command Center: dashboard hub, micro-states, and
the multi-provider inference engine.
"""

from __future__ import annotations

import asyncio

import pytest

from nexus_agent.core.dashboard_hub import DashboardHub, DashboardEvent
from nexus_agent.core.inference import (
    InferenceConfig,
    InferenceEngine,
    InferenceResult,
    ProviderConfig,
    _BaseAdapter,
    ADAPTER_REGISTRY,
)
from nexus_agent.core.models import AgentRole
from nexus_agent.core.observability import (
    AgentMetricsRegistry,
    ObservabilityManager,
    estimate_cost,
)
from nexus_agent.core.state import AgentMicroState, AgentRuntimeState


# ---------------------------------------------------------------------------
# Micro-state model
# ---------------------------------------------------------------------------


class TestAgentRuntimeState:
    def test_defaults(self):
        s = AgentRuntimeState(agent_id="a1", role=AgentRole.PLANNER)
        assert s.current_micro_state == AgentMicroState.IDLE
        assert s.exp_points == 0
        assert s.metrics.cost_usd == 0.0

    def test_touch_updates_timestamp(self):
        s = AgentRuntimeState(agent_id="a1", role=AgentRole.PLANNER)
        before = s.last_updated
        s.last_updated = before - 1
        s.touch()
        assert s.last_updated >= before


# ---------------------------------------------------------------------------
# Observability metrics
# ---------------------------------------------------------------------------


class TestObservability:
    def test_estimate_cost_known_model(self):
        # gpt-4o: $0.005 / 1K input, $0.015 / 1K output
        cost = estimate_cost("gpt-4o", 1000, 1000)
        assert cost.total_usd == pytest.approx(0.020, rel=1e-3)

    def test_estimate_cost_unknown_falls_back_to_zero(self):
        assert estimate_cost("nonexistent-model", 5000, 5000).total_usd == 0.0

    def test_estimate_cost_prefix_match(self):
        # Claude variants like ``claude-3-5-sonnet-20240620`` should price-match.
        cost = estimate_cost("claude-3-5-sonnet-20240620", 1000, 0)
        assert cost.total_usd == pytest.approx(0.003, rel=1e-3)

    def test_registry_records_call(self):
        reg = AgentMetricsRegistry()
        rec = reg.record_call(
            "planner",
            processing_time_ms=120.5,
            tokens_in=100,
            tokens_out=200,
            model="gpt-4o-mini",
        )
        assert rec.total_calls == 1
        assert rec.tokens_in == 100
        assert rec.cost_usd > 0
        snap = reg.snapshot()
        assert "planner" in snap

    def test_manager_records_via_context(self):
        reg = AgentMetricsRegistry()
        obs = ObservabilityManager(registry=reg)
        with obs.trace_agent_execution(
            "planner", "make_plan", agent_id="planner", model="gpt-4o-mini"
        ) as span:
            span["tokens_in"] = 10
            span["tokens_out"] = 20
        snap = reg.snapshot()
        assert snap["planner"]["total_calls"] == 1
        assert snap["planner"]["tokens_in"] == 10


# ---------------------------------------------------------------------------
# Dashboard hub
# ---------------------------------------------------------------------------


class _FakeWS:
    def __init__(self):
        self.accepted = False
        self.sent: list[str] = []

    async def accept(self):
        self.accepted = True

    async def send_text(self, msg):
        self.sent.append(msg)


def _run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


class TestDashboardHub:
    def test_default_roster_has_six_agents(self):
        hub = DashboardHub()
        snap = hub.snapshot()
        assert snap["type"] == "snapshot"
        ids = {a["agent_id"] for a in snap["agents"]}
        # The roster now includes 10 specialist agents in addition to the
        # original 6 core agents; verify all original core agents are present.
        core_ids = {"planner", "architect", "developer", "ui_weaver", "validator", "optimizer"}
        assert core_ids.issubset(ids), f"Core agents missing from roster: {core_ids - ids}"
        # Verify new specialist agents are also registered
        specialist_ids = {
            "code_reviewer", "debugger", "qa_tester", "db_architect",
            "devops", "data_analyst", "project_mgr", "security",
            "rag_agent", "api_integration",
        }
        assert specialist_ids.issubset(ids), f"Specialist agents missing: {specialist_ids - ids}"
        assert len(snap["agents"]) == len(core_ids) + len(specialist_ids), (
            f"Expected {len(core_ids) + len(specialist_ids)} agents, got {len(snap['agents'])}"
        )

    def test_connect_sends_snapshot(self):
        hub = DashboardHub()
        ws = _FakeWS()
        _run(hub.connect(ws))
        assert ws.accepted is True
        assert any('"type": "snapshot"' in s for s in ws.sent)

    def test_emit_state_broadcasts_event(self):
        hub = DashboardHub()
        ws = _FakeWS()
        _run(hub.connect(ws))
        ws.sent.clear()
        _run(hub.emit_state(
            agent_id="planner",
            role=AgentRole.PLANNER,
            micro_state=AgentMicroState.PLANNING,
            status_message="Drafting plan",
        ))
        assert any('"agent_update"' in s and '"planner"' in s for s in ws.sent)
        assert hub.get_state("planner").current_micro_state == AgentMicroState.PLANNING

    def test_exp_delta_emits_extra_event(self):
        hub = DashboardHub()
        ws = _FakeWS()
        _run(hub.connect(ws))
        ws.sent.clear()
        _run(hub.emit_state(
            agent_id="developer",
            role=AgentRole.DEVELOPER,
            micro_state=AgentMicroState.COMPLETED,
            status_message="done",
            exp_delta=15,
        ))
        # Expect both agent_update and exp_gained.
        assert sum('"exp_gained"' in s for s in ws.sent) == 1
        assert hub.get_state("developer").exp_points == 15

    def test_emit_state_threadsafe_no_loop_updates_local(self):
        hub = DashboardHub()
        hub.emit_state_threadsafe(
            agent_id="planner",
            role=AgentRole.PLANNER,
            micro_state=AgentMicroState.THINKING,
            status_message="thinking…",
            exp_delta=3,
        )
        s = hub.get_state("planner")
        assert s.current_micro_state == AgentMicroState.THINKING
        assert s.exp_points == 3


# ---------------------------------------------------------------------------
# Multi-provider inference
# ---------------------------------------------------------------------------


class _StubAdapter(_BaseAdapter):
    name = "stub"

    def __init__(self, cfg, *, content: str = "ok", fail: bool = False):
        super().__init__(cfg)
        self.content = content
        self.fail = fail
        self.calls = 0

    def generate(self, messages, *, temperature=0.7, max_tokens=1024):
        self.calls += 1
        if self.fail:
            raise RuntimeError("stub failure")
        return InferenceResult(
            content=self.content,
            provider=self.cfg.name,
            model=self.cfg.model,
            tokens_in=5,
            tokens_out=7,
        )


class TestInferenceEngine:
    def _engine_with(self, adapters: list[_BaseAdapter]) -> InferenceEngine:
        eng = InferenceEngine.__new__(InferenceEngine)
        eng.config = InferenceConfig()
        eng._adapters = adapters
        return eng

    def test_list_providers(self):
        a = _StubAdapter(ProviderConfig(name="p1", provider="openai_compatible", model="m1"))
        eng = self._engine_with([a])
        info = eng.list_providers()
        assert info[0]["name"] == "p1"

    def test_generate_uses_first_provider(self):
        a = _StubAdapter(ProviderConfig(name="p1", provider="openai_compatible", model="m1"), content="hi")
        eng = self._engine_with([a])
        assert eng.generate([{"role": "user", "content": "x"}]) == "hi"
        assert a.calls == 1

    def test_generate_falls_back_on_failure(self):
        a = _StubAdapter(ProviderConfig(name="p1", provider="openai_compatible", model="m1"), fail=True)
        b = _StubAdapter(ProviderConfig(name="p2", provider="openai_compatible", model="m2"), content="from-b")
        eng = self._engine_with([a, b])
        assert eng.generate([{"role": "user", "content": "x"}]) == "from-b"
        assert a.calls == 1 and b.calls == 1

    def test_generate_with_explicit_provider(self):
        a = _StubAdapter(ProviderConfig(name="p1", provider="openai_compatible", model="m1"), content="A")
        b = _StubAdapter(ProviderConfig(name="p2", provider="openai_compatible", model="m2"), content="B")
        eng = self._engine_with([a, b])
        assert eng.generate([{"role": "user", "content": "x"}], provider="p2") == "B"

    def test_generate_unknown_provider_raises(self):
        a = _StubAdapter(ProviderConfig(name="p1", provider="openai_compatible", model="m1"))
        eng = self._engine_with([a])
        with pytest.raises(ValueError):
            eng.generate([{"role": "user", "content": "x"}], provider="missing")

    def test_no_providers_raises(self):
        eng = self._engine_with([])
        with pytest.raises(RuntimeError):
            eng.generate([{"role": "user", "content": "x"}])

    def test_adapter_registry_aliases(self):
        # All major provider aliases must resolve to an adapter class.
        for alias in ("openai", "azure", "vllm", "ollama", "anthropic", "claude", "gemini", "google"):
            assert alias in ADAPTER_REGISTRY
