"""Real-time WebSocket hub for the Cyber-Thai Command Center dashboard.

Provides:

* ``DashboardEvent`` — JSON schema for messages pushed to the frontend.
* ``DashboardHub`` — connection manager that broadcasts events to all
  connected ``/ws/dashboard`` clients and keeps the latest per-agent snapshot
  so newly-connected clients can hydrate immediately.

The hub is intentionally framework-agnostic in its public API (``broadcast`` /
``emit_state``) so non-FastAPI callers (e.g. the orchestrator) can push events
without importing FastAPI.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from nexus_agent.core.models import AgentRole
from nexus_agent.core.state import (
    AgentMetrics,
    AgentMicroState,
    AgentRuntimeState,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# JSON schema
# ---------------------------------------------------------------------------


class DashboardEvent(BaseModel):
    """Wire-format message pushed to dashboard clients."""

    event: str = "agent_update"  # "agent_update" | "exp_gained" | "log" | "snapshot"
    agent_id: str
    role: AgentRole
    micro_state: AgentMicroState
    status_message: str = ""
    metrics: AgentMetrics = Field(default_factory=AgentMetrics)
    extra: Dict[str, Any] = Field(default_factory=dict)
    timestamp: float = Field(default_factory=lambda: time.time())


# ---------------------------------------------------------------------------
# Connection manager
# ---------------------------------------------------------------------------


class DashboardHub:
    """In-process pub/sub hub for dashboard WebSocket clients."""

    # The agents the dashboard expects (Cyber-Thai roster of 6)
    DEFAULT_ROSTER: List[tuple[str, AgentRole, str]] = [
        # Core orchestration agents
        ("planner",        AgentRole.PLANNER,               "เสนาบดีไซเบอร์ / Planner"),
        ("architect",      AgentRole.TECHNICAL_ARCHITECT,   "พระวิศวกรรม / Architect"),
        ("developer",      AgentRole.DEVELOPER,             "วานรล้ำยุค / Developer"),
        ("ui_weaver",      AgentRole.UI_WEAVER,             "นางอัปสรทอแสง / UI Weaver"),
        ("validator",      AgentRole.VALIDATOR,             "ยักษ์ทวารบาล / Validator"),
        ("optimizer",      AgentRole.AUTONOMOUS_OPTIMIZER,  "ฤาษีดิจิทัล / Optimizer"),
        # New specialist agents
        ("code_reviewer",  AgentRole.CODE_REVIEWER,         "นักตรวจโค้ด / Code Reviewer"),
        ("debugger",       AgentRole.DEBUGGER,              "นักสืบดิจิทัล / Debugger"),
        ("qa_tester",      AgentRole.QA_TESTER,             "ผู้ทดสอบระบบ / QA Tester"),
        ("db_architect",   AgentRole.DATABASE_ARCHITECT,    "สถาปนิก DB / DB Architect"),
        ("devops",         AgentRole.DEVOPS_AGENT,          "วิศวกร DevOps / DevOps"),
        ("data_analyst",   AgentRole.DATA_ANALYST,          "นักวิเคราะห์ข้อมูล / Data Analyst"),
        ("project_mgr",    AgentRole.PROJECT_MANAGER,       "ผู้จัดการโครงการ / Project Manager"),
        ("security",       AgentRole.SECURITY_AUDITOR,      "ผู้ตรวจความปลอดภัย / Security Auditor"),
        ("rag_agent",      AgentRole.RAG_AGENT,             "ผู้ค้นหาความรู้ / RAG Agent"),
        ("api_integration",AgentRole.API_INTEGRATION,       "นักเชื่อมต่อ API / API Integration"),
    ]

    def __init__(self) -> None:
        self._clients: set = set()
        self._lock = asyncio.Lock()
        self._states: Dict[str, AgentRuntimeState] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        for agent_id, role, display_name in self.DEFAULT_ROSTER:
            self._states[agent_id] = AgentRuntimeState(
                agent_id=agent_id, role=role, display_name=display_name
            )

    # ---------------- snapshot / state -------------------------------------

    def snapshot(self) -> dict:
        """Return a full snapshot of all known agents."""
        return {
            "type": "snapshot",
            "agents": [s.model_dump(mode="json") for s in self._states.values()],
            "timestamp": time.time(),
        }

    def get_state(self, agent_id: str) -> Optional[AgentRuntimeState]:
        return self._states.get(agent_id)

    async def add_agent(self, agent_id: str, role: AgentRole, display_name: str) -> None:
        """Register a new agent dynamically in the dashboard roster."""
        state = AgentRuntimeState(agent_id=agent_id, role=role, display_name=display_name)
        self._states[agent_id] = state
        await self.broadcast(self.snapshot())

    async def update_agent(self, agent_id: str, display_name: str) -> None:
        """Update display name of an existing agent in the roster."""
        if agent_id in self._states:
            self._states[agent_id].display_name = display_name
            self._states[agent_id].touch()
            await self.broadcast(self.snapshot())

    async def delete_agent(self, agent_id: str) -> None:
        """Remove an agent dynamically from the dashboard roster."""
        if agent_id in self._states:
            del self._states[agent_id]
            await self.broadcast(self.snapshot())

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Bind the running event loop so sync callers can schedule emits."""
        self._loop = loop

    # ---------------- WebSocket lifecycle ----------------------------------

    async def connect(self, websocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._clients.add(websocket)
        # Hydrate the new client immediately.
        try:
            await websocket.send_text(json.dumps(self.snapshot()))
        except Exception as exc:
            logger.warning("Failed to hydrate dashboard client: %s", exc)

    async def disconnect(self, websocket) -> None:
        async with self._lock:
            self._clients.discard(websocket)

    async def disconnect_all(self) -> None:
        """Close every active client (used during graceful shutdown)."""
        async with self._lock:
            clients = list(self._clients)
            self._clients.clear()
        for ws in clients:
            try:
                await ws.close(code=1001)
            except Exception:  # pragma: no cover — best-effort
                pass

    async def broadcast_event(self, event: str, payload: dict) -> None:
        """Convenience wrapper for one-off named events."""
        await self.broadcast({"event": event, "payload": payload})

    # ---------------- emit ---------------------------------------------------

    async def broadcast(self, payload: dict) -> None:
        """Broadcast a JSON-serialisable payload to every connected client."""
        message = json.dumps(payload, default=str)
        stale: list = []
        async with self._lock:
            clients = list(self._clients)
        for ws in clients:
            try:
                await ws.send_text(message)
            except Exception as exc:
                logger.debug("Dropping stale dashboard client: %s", exc)
                stale.append(ws)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._clients.discard(ws)

    async def emit_state(
        self,
        agent_id: str,
        *,
        role: Optional[AgentRole] = None,
        micro_state: AgentMicroState = AgentMicroState.IDLE,
        status_message: str = "",
        metrics: Optional[AgentMetrics] = None,
        task_id: Optional[str] = None,
        exp_delta: int = 0,
    ) -> None:
        """Update local state, broadcast an ``agent_update`` event, and emit
        an additional ``exp_gained`` event if ``exp_delta > 0``.
        """
        state = self._states.get(agent_id)
        if state is None:
            if role is None:
                raise ValueError(
                    f"Unknown agent_id={agent_id!r} and no role provided to register it."
                )
            state = AgentRuntimeState(agent_id=agent_id, role=role)
            self._states[agent_id] = state

        state.current_micro_state = micro_state
        state.status_message = status_message
        if metrics is not None:
            state.metrics = metrics
        if task_id is not None:
            state.current_task_id = task_id
        if exp_delta:
            state.exp_points += exp_delta
        state.touch()

        event = DashboardEvent(
            event="agent_update",
            agent_id=agent_id,
            role=state.role,
            micro_state=state.current_micro_state,
            status_message=state.status_message,
            metrics=state.metrics,
            extra={"exp_points": state.exp_points, "task_id": state.current_task_id},
        )
        await self.broadcast(event.model_dump(mode="json"))

        if exp_delta:
            exp_event = DashboardEvent(
                event="exp_gained",
                agent_id=agent_id,
                role=state.role,
                micro_state=state.current_micro_state,
                status_message=f"+{exp_delta} EXP",
                metrics=state.metrics,
                extra={"exp_delta": exp_delta, "exp_points": state.exp_points},
            )
            await self.broadcast(exp_event.model_dump(mode="json"))

    # ---------------- sync bridge -------------------------------------------

    def emit_state_threadsafe(self, **kwargs: Any) -> None:
        """Thread-safe wrapper usable from synchronous orchestrator code.

        Schedules :meth:`emit_state` on the bound event loop. No-op if the
        loop has not been set yet (e.g. unit tests without FastAPI).
        """
        if self._loop is None or not self._loop.is_running():
            # Update local state anyway so REST snapshot endpoint stays accurate.
            agent_id = kwargs.get("agent_id")
            if agent_id and agent_id in self._states:
                s = self._states[agent_id]
                if "micro_state" in kwargs and kwargs["micro_state"] is not None:
                    s.current_micro_state = kwargs["micro_state"]
                if "status_message" in kwargs:
                    s.status_message = kwargs["status_message"] or ""
                if kwargs.get("exp_delta"):
                    s.exp_points += kwargs["exp_delta"]
                s.touch()
            return
        try:
            asyncio.run_coroutine_threadsafe(self.emit_state(**kwargs), self._loop)
        except RuntimeError as exc:
            logger.debug("Cannot schedule emit_state: %s", exc)

    async def emit_log(self, message: str, agent_id: str = "system", role: Optional[AgentRole] = None) -> None:
        """Emit a detailed log message to the dashboard."""
        event = DashboardEvent(
            event="log",
            agent_id=agent_id,
            role=role or AgentRole.PLANNER,  # Default fallback
            micro_state=AgentMicroState.IDLE,
            status_message=message,
        )
        await self.broadcast(event.model_dump(mode="json"))

    def emit_log_threadsafe(self, message: str, agent_id: str = "system", role: Optional[AgentRole] = None) -> None:
        """Thread-safe wrapper for emitting logs."""
        if self._loop is None or not self._loop.is_running():
            return
        try:
            asyncio.run_coroutine_threadsafe(self.emit_log(message, agent_id, role), self._loop)
        except RuntimeError as exc:
            logger.debug("Cannot schedule emit_log: %s", exc)


# Module-level singleton
dashboard_hub = DashboardHub()
