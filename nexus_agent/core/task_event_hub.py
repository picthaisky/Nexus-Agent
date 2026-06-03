"""Per-task real-time event hub.

Provides fine-grained task execution events over WebSocket:

Event types
-----------
task_start          Task accepted and queued for execution.
task_step_start     LangGraph node entered (planner, executor, validator, …).
task_step_complete  LangGraph node exited with output.
execution_output    One line of CLI command stdout/stderr.
task_complete       Task finished successfully.
task_failed         Task finished with an error.
file_event          A file was created/modified/deleted inside the project workspace.
agent_thought       Short reasoning snippet from an LLM agent.

Consumers
---------
* ``/ws/tasks/{task_id}``  — task-specific WebSocket channel (frontend live view)
* ``/ws/dashboard``        — also receives aggregated log events for the log panel

Usage
-----
    from nexus_agent.core.task_event_hub import task_event_hub

    # Emit a step event from inside the orchestrator
    task_event_hub.emit_threadsafe(task_id, "task_step_start", {
        "step": "planner",
        "step_index": 1,
        "total_steps": 5,
        "description": "Breaking down goal into actionable steps",
    })

    # Stream a line of CLI output
    task_event_hub.emit_threadsafe(task_id, "execution_output", {
        "line": "Successfully created senic-billing-next/",
        "stream": "stdout",
        "command": "npx create-next-app",
    })
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

_MAX_BUFFER = 500    # Max events buffered per task (for late-connecting clients)


class TaskEvent:
    """Immutable event envelope."""
    __slots__ = ("task_id", "event", "payload", "timestamp")

    def __init__(self, task_id: str, event: str, payload: dict[str, Any]) -> None:
        self.task_id  = task_id
        self.event    = event
        self.payload  = payload
        self.timestamp = time.time()

    def to_json(self) -> str:
        return json.dumps({
            "task_id":   self.task_id,
            "event":     self.event,
            "payload":   self.payload,
            "timestamp": self.timestamp,
        }, ensure_ascii=False, default=str)


class TaskEventHub:
    """In-process pub/sub for task-level WebSocket events.

    Each active task gets its own subscriber set and a rolling buffer so that
    clients connecting after task start still receive recent history.
    """

    def __init__(self) -> None:
        self._subscribers: Dict[str, Set]           = defaultdict(set)
        self._buffers: Dict[str, Deque[TaskEvent]]  = defaultdict(lambda: deque(maxlen=_MAX_BUFFER))
        self._lock    = asyncio.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ── Loop binding ──────────────────────────────────────────────────────────

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ── Subscribe / unsubscribe ───────────────────────────────────────────────

    async def subscribe(self, task_id: str, websocket) -> None:
        async with self._lock:
            self._subscribers[task_id].add(websocket)
        # Replay buffered events to the new subscriber
        buf = list(self._buffers.get(task_id, []))
        for evt in buf:
            try:
                await websocket.send_text(evt.to_json())
            except Exception:
                break

    async def unsubscribe(self, task_id: str, websocket) -> None:
        async with self._lock:
            self._subscribers[task_id].discard(websocket)
            if not self._subscribers[task_id]:
                del self._subscribers[task_id]

    # ── Emit ─────────────────────────────────────────────────────────────────

    async def emit(self, task_id: str, event: str, payload: dict[str, Any]) -> None:
        """Broadcast an event to all subscribers of this task."""
        evt  = TaskEvent(task_id, event, payload)
        self._buffers[task_id].append(evt)
        msg  = evt.to_json()

        async with self._lock:
            subs = set(self._subscribers.get(task_id, set()))
        stale: list = []
        for ws in subs:
            try:
                await ws.send_text(msg)
            except Exception as exc:
                logger.debug("task_ws_send_failed task=%s: %s", task_id, exc)
                stale.append(ws)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._subscribers[task_id].discard(ws)

    def emit_threadsafe(self, task_id: str, event: str, payload: dict[str, Any]) -> None:
        """Schedule :meth:`emit` from a synchronous background thread."""
        if self._loop is None or not self._loop.is_running():
            # Buffer only — no connected subscribers yet
            evt = TaskEvent(task_id, event, payload)
            self._buffers[task_id].append(evt)
            return
        try:
            asyncio.run_coroutine_threadsafe(self.emit(task_id, event, payload), self._loop)
        except RuntimeError as exc:
            logger.debug("Cannot schedule task event: %s", exc)

    # ── Convenience helpers ───────────────────────────────────────────────────

    def step_start(self, task_id: str, step: str, index: int, total: int, description: str = "") -> None:
        self.emit_threadsafe(task_id, "task_step_start", {
            "step": step, "step_index": index, "total_steps": total,
            "description": description,
        })

    def step_complete(self, task_id: str, step: str, index: int, output: str = "") -> None:
        self.emit_threadsafe(task_id, "task_step_complete", {
            "step": step, "step_index": index,
            "output": output[:500] if output else "",
        })

    def execution_line(self, task_id: str, line: str, stream: str = "stdout", command: str = "") -> None:
        self.emit_threadsafe(task_id, "execution_output", {
            "line": line, "stream": stream, "command": command[:80],
        })

    def file_event(self, task_id: str, event_type: str, path: str, content_preview: str = "") -> None:
        self.emit_threadsafe(task_id, "file_event", {
            "file_event_type": event_type,   # created | modified | deleted
            "path": path,
            "preview": content_preview[:200],
        })

    def agent_thought(self, task_id: str, agent: str, thought: str) -> None:
        self.emit_threadsafe(task_id, "agent_thought", {
            "agent": agent, "thought": thought[:300],
        })

    def task_start(self, task_id: str, goal: str) -> None:
        self.emit_threadsafe(task_id, "task_start", {"goal": goal[:300]})

    def task_complete(self, task_id: str, summary: str = "") -> None:
        self.emit_threadsafe(task_id, "task_complete", {"summary": summary[:300]})
        # Clean up buffer after short delay (allow late clients to read)
        if self._loop and self._loop.is_running():
            async def _cleanup():
                await asyncio.sleep(300)  # keep buffer for 5 minutes
                self._buffers.pop(task_id, None)
            asyncio.run_coroutine_threadsafe(_cleanup(), self._loop)

    def task_failed(self, task_id: str, error: str) -> None:
        self.emit_threadsafe(task_id, "task_failed", {"error": error[:500]})

    def get_buffer(self, task_id: str) -> List[dict]:
        return [json.loads(e.to_json()) for e in self._buffers.get(task_id, [])]


# Module-level singleton
task_event_hub = TaskEventHub()
