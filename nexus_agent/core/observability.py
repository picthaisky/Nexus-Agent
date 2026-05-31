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

from nexus_agent.core.cost import estimate_cost

logger = logging.getLogger(__name__)


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
            rec.cost_usd += estimate_cost(model, tokens_in, tokens_out).total_usd
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
    """Hardware monitor returning GPU metrics for the dashboard.
    Will attempt to use real metrics if pynvml is available, else fallback to 0.
    """

    @staticmethod
    def get_gpu_metrics() -> dict:
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util_info = pynvml.nvmlDeviceGetUtilizationRates(handle)
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            
            metrics = {
                "gpu_temp_c": temp,
                "vram_used_mb": mem_info.used // 1048576,
                "vram_total_mb": mem_info.total // 1048576,
                "utilization_percent": util_info.gpu,
            }
            pynvml.nvmlShutdown()
            return metrics
        except Exception:
            return {
                "gpu_temp_c": 0,
                "vram_used_mb": 0,
                "vram_total_mb": 0,
                "utilization_percent": 0,
            }
