"""Core package."""
from nexus_agent.core.models import (
    AgentMessage,
    AgentRole,
    ArchitecturePlan,
    CodeChange,
    EdgeCase,
    FailureMode,
    ImplementationPlan,
    OptimizationResult,
    PromptVariant,
    TaskStatus,
    UnitTest,
)
from nexus_agent.core.knowledge_graph_engine import KnowledgeGraphEngine
from nexus_agent.core.skill_vault import SkillVault

try:
    from nexus_agent.core.orchestrator import Orchestrator
except ModuleNotFoundError:
    # Orchestrator requires optional LLM stack at runtime.
    Orchestrator = None  # type: ignore[assignment]

__all__ = [
    "AgentRole",
    "TaskStatus",
    "EdgeCase",
    "FailureMode",
    "ArchitecturePlan",
    "CodeChange",
    "UnitTest",
    "ImplementationPlan",
    "PromptVariant",
    "OptimizationResult",
    "AgentMessage",
    "Orchestrator",
    "KnowledgeGraphEngine",
    "SkillVault",
]
