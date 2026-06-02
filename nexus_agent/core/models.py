"""Core data models for JSON-based agent communication."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class AgentRole(str, Enum):
    """All agent roles known to the orchestrator and the dashboard.

    The first three are the modern role-based pipeline (architect → developer →
    optimizer). The remaining four are control-loop / dashboard agents used by
    the LangGraph workflow and the Cyber-Thai Command Center.
    """

    TECHNICAL_ARCHITECT = "technical_architect"

    DEVELOPER = "developer"
    AUTONOMOUS_OPTIMIZER = "autonomous_optimizer"
    PLANNER = "planner"
    EXECUTOR = "executor"
    VALIDATOR = "validator"
    UI_WEAVER = "ui_weaver"
    LEARNER = "learner"
    SEARCH_AGENT = "search_agent"
    FINANCE_AGENT = "finance_agent"
    CONTENT_CREATOR_AGENT = "content_creator_agent"
    # New specialist agents
    CODE_REVIEWER       = "code_reviewer"
    DEBUGGER            = "debugger"
    QA_TESTER           = "qa_tester"
    DATABASE_ARCHITECT  = "database_architect"
    DEVOPS_AGENT        = "devops_agent"
    DATA_ANALYST        = "data_analyst"
    PROJECT_MANAGER     = "project_manager"
    SECURITY_AUDITOR    = "security_auditor"
    RAG_AGENT           = "rag_agent"
    API_INTEGRATION     = "api_integration"


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

class AgentspaceSearchResult(BaseModel):
    """Output produced by the Search Agent."""
    
    query: str
    summary_md: str
    sources: list[dict[str, str]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class FinanceAnalysisResult(BaseModel):
    """Output produced by the Finance Agent."""
    task: str
    analysis_md: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ContentCreationResult(BaseModel):
    """Output produced by the Content Creator Agent."""
    topic: str
    content_md: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── New Specialist Agent Result Models ────────────────────────────────────────

class CodeIssue(BaseModel):
    """A single code review finding."""
    severity: str  # critical / major / minor / info
    file_path: str
    line: str
    category: str  # security / performance / style / logic / maintainability
    description: str
    suggestion: str


class CodeReviewResult(BaseModel):
    """Output produced by the Code Reviewer Agent."""
    target: str
    summary_md: str
    issues: list[CodeIssue] = Field(default_factory=list)
    score: int = 0         # 0-100
    approved: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DebugReport(BaseModel):
    """Output produced by the Debugger Agent."""
    error_input: str
    root_cause: str
    analysis_md: str
    fix_suggestions: list[str] = Field(default_factory=list)
    affected_files: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TestCase(BaseModel):
    """A generated test case."""
    name: str
    test_type: str   # unit / integration / e2e
    description: str
    code: str
    file_path: str


class QATestingResult(BaseModel):
    """Output produced by the QA Testing Agent."""
    target: str
    summary_md: str
    test_cases: list[TestCase] = Field(default_factory=list)
    coverage_estimate: str = ""
    commands: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DBTable(BaseModel):
    """A database table definition."""
    name: str
    columns: list[str]
    indexes: list[str] = Field(default_factory=list)
    relationships: list[str] = Field(default_factory=list)


class DatabaseSchemaResult(BaseModel):
    """Output produced by the Database Architect Agent."""
    task: str
    summary_md: str
    tables: list[DBTable] = Field(default_factory=list)
    migration_sql: str = ""
    er_diagram_md: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DevOpsReport(BaseModel):
    """Output produced by the DevOps Agent."""
    task: str
    summary_md: str
    artifacts: dict[str, str] = Field(default_factory=dict)  # filename → content
    commands: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DataAnalyticsReport(BaseModel):
    """Output produced by the Data Analytics Agent."""
    task: str
    summary_md: str
    insights: list[str] = Field(default_factory=list)
    chart_specs: list[dict[str, Any]] = Field(default_factory=list)  # vega-lite specs
    recommendations: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProjectTask(BaseModel):
    """A project management task item."""
    id: str
    title: str
    status: str   # todo / in_progress / done / blocked
    priority: str # high / medium / low
    assignee: str = ""
    due_date: str = ""
    notes: str = ""


class ProjectStatusReport(BaseModel):
    """Output produced by the Project Manager Agent."""
    project: str
    summary_md: str
    tasks: list[ProjectTask] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    progress_pct: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SecurityFinding(BaseModel):
    """A single security vulnerability finding."""
    severity: str      # critical / high / medium / low / info
    cwe_id: str        # e.g. CWE-89
    owasp: str         # e.g. A03:2021 Injection
    title: str
    description: str
    location: str
    remediation: str


class SecurityAuditReport(BaseModel):
    """Output produced by the Security Audit Agent."""
    target: str
    summary_md: str
    findings: list[SecurityFinding] = Field(default_factory=list)
    risk_score: int = 0   # 0-100
    pass_audit: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
