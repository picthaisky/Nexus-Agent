"""Nexus-Agent: Multi-AI Agent orchestration system."""

from nexus_agent.core.knowledge_graph_engine import KnowledgeGraphEngine
from nexus_agent.core.skill_vault import SkillVault
from nexus_agent.agents.technical_architect import TechnicalArchitectAgent
from nexus_agent.agents.developer import DeveloperAgent
from nexus_agent.agents.autonomous_optimizer import AutonomousOptimizerAgent

try:
    from nexus_agent.core.orchestrator import Orchestrator
except ModuleNotFoundError:
    # Orchestrator requires optional LLM stack at runtime.
    Orchestrator = None  # type: ignore[assignment]

__all__ = [
    "Orchestrator",
    "KnowledgeGraphEngine",
    "SkillVault",
    "TechnicalArchitectAgent",
    "DeveloperAgent",
    "AutonomousOptimizerAgent",
]
