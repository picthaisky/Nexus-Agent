"""Observability layer for Nexus-Agent.

Two responsibilities:

1. Tracing — wraps agent execution in Langfuse-style spans (mocked when
   credentials are absent).
2. Per-agent metrics — tracks processing time and token / cost usage indexed
   by ``agent_id`` so the Cyber-Thai Command Center can render live KPIs.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Dict, Iterator, Optional

logger = logging.getLogger(__name__)


DEFAULT_PRICING: dict[str, tuple[float, float]] = {
    # model -> (input_per_1k, output_per_1k) in USD
    "gpt-4o": (0.0050, 0.0150),
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4": (0.03, 0.06),
    "claude-3-5-sonnet": (0.003, 0.015),
    "claude-3-opus": (0.015, 0.075),
    "claude-3-haiku": (0.00025, 0.00125),
    "gemini-1.5-pro": (0.00125, 0.005),
    "gemini-1.5-flash": (0.000075, 0.0003),
    "local": (0.0, 0.0),
}


def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    """Estimate cost in USD for ``(model, tokens_in, tokens_out)``.

    Unknown models fall back to zero-cost.
    """
    # Allow partial-prefix matching for variants such as ``claude-3-5-sonnet-20240620``.
    key = model
    if key not in DEFAULT_PRICING:
        for pricing_key in DEFAULT_PRICING:
            if pricing_key != "local" and model.startswith(pricing_key):
                key = pricing_key
                break
    inp, outp = DEFAULT_PRICING.get(key, DEFAULT_PRICING["local"])
    return (tokens_in / 1000.0) * inp + (tokens_out / 1000.0) * outp


@dataclass
class AgentMetricsRecord:
    """Mutable per-agent metric counters."""

    agent_id: str
    total_calls: int = 0
    total_processing_time_ms: float = 0.0
    last_processing_time_ms: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    last_model: str = ""
    last_updated: float = field(default_factory=time.time)


class AgentMetricsRegistry:
    """Thread-safe in-memory metric registry keyed by ``agent_id``."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._records: Dict[str, AgentMetricsRecord] = {}

    def get(self, agent_id: str) -> AgentMetricsRecord:
        with self._lock:
            if agent_id not in self._records:
                self._records[agent_id] = AgentMetricsRecord(agent_id=agent_id)
            return self._records[agent_id]

    def record_call(
        self,
        agent_id: str,
        *,
        processing_time_ms: float,
        tokens_in: int = 0,
        tokens_out: int = 0,
        model: str = "local",
    ) -> AgentMetricsRecord:
        with self._lock:
            rec = self.get(agent_id)
            rec.total_calls += 1
            rec.last_processing_time_ms = processing_time_ms
            rec.total_processing_time_ms += processing_time_ms
            rec.tokens_in += tokens_in
            rec.tokens_out += tokens_out
            rec.cost_usd += estimate_cost(model, tokens_in, tokens_out)
            rec.last_model = model
            rec.last_updated = time.time()
            return rec

    def snapshot(self) -> dict[str, dict]:
        with self._lock:
            return {
                aid: {
                    "agent_id": r.agent_id,
                    "total_calls": r.total_calls,
                    "total_processing_time_ms": r.total_processing_time_ms,
                    "last_processing_time_ms": r.last_processing_time_ms,
                    "tokens_in": r.tokens_in,
                    "tokens_out": r.tokens_out,
                    "cost_usd": round(r.cost_usd, 6),
                    "last_model": r.last_model,
                    "last_updated": r.last_updated,
                }
                for aid, r in self._records.items()
            }

    def reset(self, agent_id: Optional[str] = None) -> None:
        with self._lock:
            if agent_id is None:
                self._records.clear()
            else:
                self._records.pop(agent_id, None)


# Module-level singleton for convenience
metrics_registry = AgentMetricsRegistry()


class ObservabilityManager:
    """Tracing manager using Langfuse when available, otherwise mocked."""

    def __init__(self, registry: AgentMetricsRegistry | None = None) -> None:
        self.langfuse_public_key = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
        self.langfuse_secret_key = os.environ.get("LANGFUSE_SECRET_KEY", "")
        self.registry = registry or metrics_registry

        if self.langfuse_public_key:
            logger.info("Langfuse Tracing is ENABLED.")
        else:
            logger.warning("Langfuse credentials missing. Tracing will be mocked.")

        logger.info("Prometheus metrics registry initialized (mock).")

    @contextmanager
    def trace_agent_execution(
        self,
        agent_name: str,
        task_name: str,
        *,
        agent_id: Optional[str] = None,
        model: str = "local",
    ) -> Iterator[dict]:
        """Context manager that times an agent call and records metrics.

        Yields a mutable ``dict`` the caller can populate with ``tokens_in`` /
        ``tokens_out`` / ``model`` to feed into cost accounting.
        """
        trace_id = f"trace_{agent_name}_{task_name}"
        logger.info(f"[Langfuse] Started trace {trace_id}")
        start = time.perf_counter()
        span: dict = {"tokens_in": 0, "tokens_out": 0, "model": model}
        try:
            yield span
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            if agent_id:
                self.registry.record_call(
                    agent_id,
                    processing_time_ms=elapsed_ms,
                    tokens_in=int(span.get("tokens_in", 0)),
                    tokens_out=int(span.get("tokens_out", 0)),
                    model=str(span.get("model", model)),
                )
            logger.info(
                f"[Langfuse] Completed trace {trace_id} in {elapsed_ms:.1f}ms"
            )
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            if agent_id:
                self.registry.record_call(
                    agent_id,
                    processing_time_ms=elapsed_ms,
                    tokens_in=int(span.get("tokens_in", 0)),
                    tokens_out=int(span.get("tokens_out", 0)),
                    model=str(span.get("model", model)),
                )
            logger.error(f"[Langfuse] Trace {trace_id} failed: {e}")
            raise


class HardwareMonitor:
    """Stub hardware monitor returning GPU metrics for the dashboard."""

    @staticmethod
    def get_gpu_metrics() -> dict:
        return {
            "gpu_temp_c": 58,
            "vram_used_mb": 11200,
            "vram_total_mb": 24576,
            "utilization_percent": 65,
        }
