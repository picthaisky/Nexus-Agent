"""Integration smoke tests for the production hardening layer.

These tests are intentionally hermetic — they exercise the new modules with
in-memory / stub backends rather than real Postgres/Redis.  Run with::

    pytest tests/test_production_hardening.py
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest


def test_settings_defaults(monkeypatch):
    monkeypatch.delenv("NEXUS_API_KEYS", raising=False)
    monkeypatch.delenv("NEXUS_ADMIN_API_KEYS", raising=False)
    from nexus_agent.core.settings import Settings

    s = Settings()
    assert s.auth_enabled is False  # no keys configured -> auth off
    assert s.rate_limit_enabled is True
    assert s.db_pool_size >= 1
    assert s.inference_max_retries >= 1


def test_settings_csv_parsing(monkeypatch):
    monkeypatch.setenv("NEXUS_API_KEYS", "k1, k2 ,k3")
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example.com,https://b.example.com")
    # Cache must be cleared because get_settings is lru_cache'd.
    from nexus_agent.core import settings as settings_module

    settings_module.get_settings.cache_clear()
    s = settings_module.get_settings()
    assert s.api_keys == ["k1", "k2", "k3"]
    assert s.cors_origins == ["https://a.example.com", "https://b.example.com"]
    assert s.auth_enabled is True


def test_database_engine_falls_back_to_sqlite(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.chdir(tmp_path)
    from nexus_agent.core import settings as settings_module

    settings_module.get_settings.cache_clear()
    # Re-import to pick up cleared settings cache
    import importlib
    from nexus_agent.core import database as database_module

    importlib.reload(database_module)
    from sqlalchemy import text

    with database_module.get_engine().connect() as conn:
        assert conn.execute(text("SELECT 1")).scalar() == 1


def test_cost_estimate_known_model():
    from nexus_agent.core.cost import estimate_cost

    est = estimate_cost("gpt-4o-mini", tokens_in=1000, tokens_out=500)
    assert est.total_usd == pytest.approx(0.00015 + 0.0006 * 0.5)


def test_cost_estimate_unknown_model_is_zero():
    from nexus_agent.core.cost import estimate_cost

    est = estimate_cost("nonexistent-model", 1000, 1000)
    assert est.total_usd == 0.0


def test_resilient_call_retries_then_succeeds():
    from nexus_agent.core.resilience import resilient_call

    attempts = {"n": 0}

    def flaky():
        attempts["n"] += 1
        if attempts["n"] < 2:
            raise ConnectionError("transient")
        return "ok"

    assert resilient_call("test:flaky", flaky) == "ok"
    assert attempts["n"] == 2


def test_metrics_counters_increment():
    from nexus_agent.core.metrics import (
        INFERENCE_COST,
        INFERENCE_TOKENS,
        record_inference_call,
    )

    before_in = INFERENCE_TOKENS.labels(provider="test", model="m", direction="in")._value.get()
    record_inference_call(
        provider="test",
        model="m",
        tokens_in=10,
        tokens_out=5,
        cost_usd=0.001,
        latency_seconds=0.5,
    )
    after_in = INFERENCE_TOKENS.labels(provider="test", model="m", direction="in")._value.get()
    assert after_in - before_in == 10


def test_redis_client_returns_none_when_unset(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    from nexus_agent.core import settings as settings_module

    settings_module.get_settings.cache_clear()
    from nexus_agent.core.redis_client import get_redis

    assert get_redis() is None
