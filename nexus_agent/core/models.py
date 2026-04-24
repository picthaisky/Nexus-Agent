"""Core data models for JSON-based agent communication."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class AgentRole(str, Enum):
    TECHNICAL_ARCHITECT = "technical_architect"
    DEVELOPER = "developer"
    AUTONOMOUS_OPTIMIZER = "autonomous_optimizer"


class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class EdgeCase(BaseModel):
    """Describes a single edge case identified during requirements analysis."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    impact: str
    mitigation: str


class FailureMode(BaseModel):
    """Describes a potential failure mode and its recovery strategy."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    probability: str  # high / medium / low
    recovery_strategy: str


class ArchitecturePlan(BaseModel):
    """Output produced by the Technical Architect Agent."""

    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    requirements_summary: str
    components: list[str]
    edge_cases: list[EdgeCase] = Field(default_factory=list)
    failure_modes: list[FailureMode] = Field(default_factory=list)
    todo_items: list[str] = Field(default_factory=list)
    notes: str = ""

    def is_ready_for_implementation(self) -> bool:
        """Return True only when edge cases and failure modes are both non-empty."""
        return bool(self.edge_cases) and bool(self.failure_modes)

    def render_todo_md(self) -> str:
        """Render the plan as a TODO_.md document."""
        lines: list[str] = [
            f"# TODO – {self.requirements_summary}",
            "",
            f"_Generated: {self.created_at.strftime('%Y-%m-%d %H:%M UTC')}_",
            "",
            "## Components",
            *[f"- {c}" for c in self.components],
            "",
            "## Edge Cases",
        ]
        if self.edge_cases:
            for ec in self.edge_cases:
                lines += [
                    f"### {ec.title}",
                    f"- **Description**: {ec.description}",
                    f"- **Impact**: {ec.impact}",
                    f"- **Mitigation**: {ec.mitigation}",
                    "",
                ]
        else:
            lines.append("_No edge cases identified yet._")
            lines.append("")

        lines.append("## Failure Modes")
        if self.failure_modes:
            for fm in self.failure_modes:
                lines += [
                    f"### {fm.title}",
                    f"- **Description**: {fm.description}",
                    f"- **Probability**: {fm.probability}",
                    f"- **Recovery**: {fm.recovery_strategy}",
                    "",
                ]
        else:
            lines.append("_No failure modes identified yet._")
            lines.append("")

        lines.append("## TODO Items")
        for item in self.todo_items:
            lines.append(f"- [ ] {item}")

        if self.notes:
            lines += ["", "## Notes", self.notes]

        return "\n".join(lines)


class CodeChange(BaseModel):
    """A single code change expressed as a unified diff."""

    file_path: str
    diff: str
    description: str


class UnitTest(BaseModel):
    """A generated unit test."""

    name: str
    file_path: str
    content: str


class ImplementationPlan(BaseModel):
    """Output produced by the Developer Agent."""

    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    summary: str
    code_changes: list[CodeChange] = Field(default_factory=list)
    unit_tests: list[UnitTest] = Field(default_factory=list)
    sandbox_steps: list[str] = Field(default_factory=list)


class PromptVariant(BaseModel):
    """A candidate system-prompt variant produced by the Autonomous Optimizer."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    version: int
    system_prompt: str
    rationale: str
    eval_score: float | None = None


class OptimizationResult(BaseModel):
    """Output produced by the Autonomous Optimizer Agent."""

    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    execution_trace_summary: str
    deviation_points: list[str] = Field(default_factory=list)
    prompt_variants: list[PromptVariant] = Field(default_factory=list)
    selected_variant_id: str | None = None

    def select_best_variant(self) -> PromptVariant | None:
        """Return the variant with the highest eval_score."""
        scored = [v for v in self.prompt_variants if v.eval_score is not None]
        if not scored:
            return None
        best = max(scored, key=lambda v: v.eval_score)  # type: ignore[arg-type]
        self.selected_variant_id = best.id
        return best


class AgentMessage(BaseModel):
    """Envelope used when agents exchange data."""

    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    sender: AgentRole
    recipient: AgentRole
    payload: dict[str, Any]
    status: TaskStatus = TaskStatus.PENDING
