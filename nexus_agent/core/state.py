"""Runtime state primitives for the Nexus-Agent control loop.

Contains both the LangGraph ``AgentState`` (the shared blackboard used by the
planner/executor/validator/learner pipeline) and the per-agent *runtime* state
objects consumed by the Cyber-Thai Command Center dashboard.
"""

from __future__ import annotations

import operator
import time
from enum import Enum
from typing import Annotated, Any, Optional, TypedDict

from pydantic import BaseModel, Field

from nexus_agent.core.models import AgentMessage, AgentRole


class AgentState(TypedDict):
    """Shared state for the Nexus-Agent control loop (LangGraph)."""

    messages: Annotated[list[AgentMessage], operator.add]
    goal: str
    plan: list[str]
    current_step: str
    actions_taken: Annotated[list[str], operator.add]
    validation_status: str
    validation_feedback: str
    used_rule_ids: Annotated[list[str], operator.add]
    learned_skills: Annotated[list[str], operator.add]
    final_output: Any


class AgentMicroState(str, Enum):
    """Fine-grained activity states emitted by each agent.

    Mapped 1:1 to avatar animations in the Cyber-Thai Command Center UI.
    """

    IDLE = "idle"
    THINKING = "thinking"
    PLANNING = "planning"
    CODING = "coding"
    DESIGNING = "designing"
    TESTING = "testing"
    EXECUTING = "executing"
    OPTIMIZING = "optimizing"
    WAITING_FOR_HUMAN = "waiting_for_human"
    ERROR = "error"
    COMPLETED = "completed"
    WALKING = "walking"


class AgentMetrics(BaseModel):
    """Lightweight per-agent metric snapshot used by the dashboard."""

    processing_time_ms: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    cpu_percent: float = 0.0
    memory_mb: float = 0.0


class AgentRuntimeState(BaseModel):
    """Public, dashboard-facing snapshot of one agent.

    ``current_micro_state`` and ``status_message`` are the two fields the UI
    reads on every WebSocket event to decide which animation/banner to render.
    """

    agent_id: str
    role: AgentRole
    display_name: str = ""
    current_micro_state: AgentMicroState = AgentMicroState.IDLE
    status_message: str = ""
    last_updated: float = Field(default_factory=lambda: time.time())
    metrics: AgentMetrics = Field(default_factory=AgentMetrics)
    current_task_id: Optional[str] = None
    exp_points: int = 0  # Gamification: incremented on successful task completion

    def touch(self) -> None:
        """Refresh ``last_updated`` timestamp."""
        self.last_updated = time.time()
