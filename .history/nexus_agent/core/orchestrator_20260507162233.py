"""Orchestrator – coordinates the Multi-Agent Control Loop using LangGraph.

This module incorporates the Observe -> Reason -> Decide -> Act -> Learn loop,
including the Learner node for automatic skill extraction.
"""

from __future__ import annotations

import json
from langgraph.graph import StateGraph, END
from pathlib import Path
from typing import Any, Callable, Dict, TypeVar

from nexus_agent.core.state import AgentState
from nexus_agent.agents.planner import PlannerAgent
from nexus_agent.agents.executor import ExecutorAgent
from nexus_agent.agents.validator import ValidatorAgent
from nexus_agent.agents.learner import LearnerAgent
from nexus_agent.agents.technical_architect import TechnicalArchitectAgent
from nexus_agent.agents.developer import DeveloperAgent
from nexus_agent.agents.autonomous_optimizer import AutonomousOptimizerAgent
from nexus_agent.tools.base import ToolRegistry
from nexus_agent.tools.system_tools import execute_cli_command, read_file, write_file
from nexus_agent.core.memory import ProceduralMemory
from nexus_agent.core.knowledge_graph_engine import KnowledgeGraphEngine, RepoGraph
from nexus_agent.core.models import (
    AgentMessage,
    AgentRole,
    ArchitecturePlan,
    ImplementationPlan,
    OptimizationResult,
    TaskStatus,
)
from nexus_agent.core.skill_vault import SkillVault

T = TypeVar("T")


class Orchestrator:
    """Central coordinator that compiles and runs the LangGraph workflow.
    
    Usage::
        orch = Orchestrator()
        result_state = orch.run_task("Create a python script that calculates fibonacci and run it")
    """

    def __init__(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[2]

        # Initialize Memory
        self.procedural_memory = ProceduralMemory(
            db_path=str(self.repo_root / "nexus_playbook.db"),
            skill_dir=str(self.repo_root / "skills"),
        )
        self.skill_vault = SkillVault(db_path=str(self.repo_root / "nexus_skill_vault.db"))
        self.knowledge_graph_engine = KnowledgeGraphEngine()
        self.latest_graph: RepoGraph | None = None

        # Modern role-based orchestrator agents
        self.architect_agent = TechnicalArchitectAgent()
        self.developer_agent = DeveloperAgent()
        self.optimizer_agent = AutonomousOptimizerAgent()
        self._message_log: list[AgentMessage] = []
        
        # Initialize Tools
        self.tool_registry = ToolRegistry()
        self.tool_registry.register(execute_cli_command)
        self.tool_registry.register(read_file)
        self.tool_registry.register(write_file)
        
        # Initialize Agents
        self.planner = PlannerAgent(self.procedural_memory)
        self.executor = ExecutorAgent(self.tool_registry)
        self.validator = ValidatorAgent(self.procedural_memory)
        self.learner = LearnerAgent(self.procedural_memory)
        
        # Build Graph
        self.graph = self._build_graph()

    @property
    def message_log(self) -> list[AgentMessage]:
        """Read-only view of the agent message log."""
        return list(self._message_log)

    def message_log_json(self) -> str:
        """Serialize message log as JSON for API/UI use."""
        payload = [msg.model_dump(mode="json") for msg in self._message_log]
        return json.dumps(payload, ensure_ascii=False)

    def _run_with_logging(
        self,
        *,
        sender: AgentRole,
        recipient: AgentRole,
        payload: dict[str, Any],
        runner: Callable[[dict[str, Any]], T],
    ) -> T:
        try:
            result = runner(payload)
            self._message_log.append(
                AgentMessage(
                    sender=sender,
                    recipient=recipient,
                    payload=payload,
                    status=TaskStatus.COMPLETED,
                )
            )
            return result
        except Exception:
            self._message_log.append(
                AgentMessage(
                    sender=sender,
                    recipient=recipient,
                    payload=payload,
                    status=TaskStatus.FAILED,
                )
            )
            raise

    def run_architect(self, payload: dict[str, Any]) -> ArchitecturePlan:
        """Run technical architecture phase and log status."""
        return self._run_with_logging(
            sender=AgentRole.TECHNICAL_ARCHITECT,
            recipient=AgentRole.DEVELOPER,
            payload=payload,
            runner=self.architect_agent.run,
        )

    def run_developer(self, payload: dict[str, Any]) -> ImplementationPlan:
        """Run implementation phase and log status."""
        return self._run_with_logging(
            sender=AgentRole.DEVELOPER,
            recipient=AgentRole.AUTONOMOUS_OPTIMIZER,
            payload=payload,
            runner=self.developer_agent.run,
        )

    def run_optimizer(self, payload: dict[str, Any]) -> OptimizationResult:
        """Run autonomous optimization phase and log status."""
        return self._run_with_logging(
            sender=AgentRole.AUTONOMOUS_OPTIMIZER,
            recipient=AgentRole.TECHNICAL_ARCHITECT,
            payload=payload,
            runner=self.optimizer_agent.run,
        )

    def run_pipeline(
        self,
        *,
        architect_payload: dict[str, Any],
        developer_payload: dict[str, Any],
        optimizer_payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute architect -> developer -> optimizer flow."""
        architecture = self.run_architect(architect_payload)
        implementation = self.run_developer(developer_payload)
        optimization = self.run_optimizer(optimizer_payload)
        return {
            "architecture": architecture,
            "implementation": implementation,
            "optimization": optimization,
        }

    def _build_graph(self):
        """Compiles the StateGraph representing the control loop."""
        workflow = StateGraph(AgentState)
        
        # Define Nodes
        workflow.add_node("planner", self.planner.run)
        workflow.add_node("executor", self.executor.run)
        workflow.add_node("validator", self.validator.run)
        workflow.add_node("learner", self.learner.run)
        
        # Set Entry Point
        workflow.set_entry_point("planner")
        
        # Define Edges
        workflow.add_edge("planner", "executor")
        workflow.add_edge("executor", "validator")
        
        # Validator always goes to Learner to extract lessons (or anti-patterns)
        workflow.add_edge("validator", "learner")
        
        # Conditional Edge after Learner
        workflow.add_conditional_edges(
            "learner",
            self._after_learning,
            {
                "continue": "executor", # Loop back to executor on fail
                "end": END              # End workflow on success
            }
        )
        
        return workflow.compile()
        
    def _after_learning(self, state: AgentState) -> str:
        """Routing function that determines if the loop should continue after learning."""
        status = state.get("validation_status", "failed")
        if status == "success":
            return "end"
        return "continue"

    def run_task(self, goal: str) -> Dict[str, Any]:
        """Runs the LangGraph control loop for a given goal."""
        initial_state = {
            "goal": goal,
            "messages": [],
            "plan": [],
            "current_step": "",
            "actions_taken": [],
            "validation_status": "pending",
            "validation_feedback": "",
            "used_rule_ids": [],
            "learned_skills": [],
            "final_output": None
        }
        
        final_state = None
        for output in self.graph.stream(initial_state):
            # We log state transitions here
            for node_name, state_update in output.items():
                print(f"--- Node Executed: {node_name} ---")
            final_state = output
            
        return final_state

    # ------------------------------------------------------------------
    # Knowledge Graph Operations
    # ------------------------------------------------------------------

    def build_knowledge_graph(self, repo_root: str | None = None, include_tests: bool = True) -> dict[str, Any]:
        """Build and cache the repository graph for further analysis."""
        target_root = repo_root or str(self.repo_root)
        self.latest_graph = self.knowledge_graph_engine.build_repo_graph(
            repo_root=target_root,
            include_tests=include_tests,
        )
        return self.latest_graph.summary()

    def trace_execution_flow(self, entry_symbol: str, max_depth: int = 6) -> dict[str, Any]:
        """Trace execution flow from an entry symbol using the cached graph."""
        if self.latest_graph is None:
            self.build_knowledge_graph()
        return self.knowledge_graph_engine.trace_execution_flow(
            graph=self.latest_graph,
            entry_symbol=entry_symbol,
            max_depth=max_depth,
        )

    def analyze_blast_radius(self, changed_symbols: list[str], depth: int = 2) -> dict[str, Any]:
        """Analyze probable impact area before making edits."""
        if self.latest_graph is None:
            self.build_knowledge_graph()
        return self.knowledge_graph_engine.analyze_blast_radius(
            graph=self.latest_graph,
            changed_symbols=changed_symbols,
            depth=depth,
        )

    def plan_sync_refactor(
        self,
        rename_map: dict[str, str],
        repo_root: str | None = None,
        include_tests: bool = True,
        apply_changes: bool = False,
    ) -> dict[str, Any]:
        """Create or apply synchronized cross-file identifier refactor plan."""
        target_root = repo_root or str(self.repo_root)
        plan = self.knowledge_graph_engine.plan_sync_refactor(
            repo_root=target_root,
            rename_map=rename_map,
            include_tests=include_tests,
        )

        result: dict[str, Any] = {
            "plan": plan.summary(),
            "applied": None,
        }
        if apply_changes:
            result["applied"] = self.knowledge_graph_engine.apply_refactor_plan(plan)
            self.latest_graph = self.knowledge_graph_engine.build_repo_graph(
                repo_root=target_root,
                include_tests=include_tests,
            )
        return result

    def generate_graph_wiki(
        self,
        output_dir: str,
        repo_root: str | None = None,
        include_tests: bool = True,
    ) -> dict[str, Any]:
        """Generate graph-driven wiki pages from the latest repository state."""
        target_root = repo_root or str(self.repo_root)
        if self.latest_graph is None:
            self.latest_graph = self.knowledge_graph_engine.build_repo_graph(
                repo_root=target_root,
                include_tests=include_tests,
            )
        return self.knowledge_graph_engine.generate_wiki(
            graph=self.latest_graph,
            output_dir=output_dir,
        )

    # ------------------------------------------------------------------
    # Skill Vault Operations
    # ------------------------------------------------------------------

    def import_skill_library(
        self,
        directory: str,
        source: str = "awesome-codex-skills",
        default_tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Import markdown-based skills into persistent vault."""
        return self.skill_vault.import_skills_from_markdown_dir(
            directory=directory,
            source=source,
            default_tags=default_tags,
        )

    def import_skill_library_from_github(
        self,
        repo_url: str,
        branch: str = "main",
        source: str = "awesome-codex-skills",
        default_tags: list[str] | None = None,
        cache_dir: str | None = None,
        shallow_clone: bool = True,
    ) -> dict[str, Any]:
        """Import markdown skills from a GitHub repository into persistent vault."""
        return self.skill_vault.import_skills_from_github(
            repo_url=repo_url,
            branch=branch,
            source=source,
            default_tags=default_tags,
            cache_dir=cache_dir,
            shallow_clone=shallow_clone,
        )

    def search_skills(self, query: str, tags: list[str] | None = None, top_k: int = 10) -> list[dict[str, Any]]:
        """Search for relevant skills in the persistent vault."""
        return self.skill_vault.search_skills(query=query, tags=tags, top_k=top_k)

    def run_local_deep_research(self, topic: str, top_k: int = 5) -> dict[str, Any]:
        """Build local deep-research brief using skills, notes, and graph signals."""
        if self.latest_graph is None:
            self.build_knowledge_graph()
        brief = self.skill_vault.deep_research(topic=topic, top_k=top_k, repo_graph=self.latest_graph)
        return {
            "topic": brief.topic,
            "hypotheses": brief.hypotheses,
            "suggested_skills": brief.suggested_skills,
            "related_notes": brief.related_notes,
            "repo_signals": brief.repo_signals,
            "automation_plan": brief.automation_plan,
        }

    def plan_autonomous_execution(self, task_text: str, top_k: int = 5) -> dict[str, Any]:
        """Generate a human-like autonomous execution plan for a task."""
        return self.skill_vault.plan_autonomous_task(task_text=task_text, top_k=top_k)
