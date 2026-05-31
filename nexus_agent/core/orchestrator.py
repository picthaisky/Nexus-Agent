"""Orchestrator – coordinates the Multi-Agent Control Loop using LangGraph.

This module incorporates the Observe -> Reason -> Decide -> Act -> Learn loop,
including the Learner node for automatic skill extraction.
"""

from __future__ import annotations

import json
import logging
from langgraph.graph import StateGraph, END
from pathlib import Path
from typing import Any, Callable, Dict, TypeVar

from nexus_agent.core.state import AgentState
from nexus_agent.core.dashboard_hub import dashboard_hub
from nexus_agent.core.state import AgentMicroState
from nexus_agent.agents.planner import PlannerAgent
from nexus_agent.agents.executor import ExecutorAgent
from nexus_agent.agents.validator import ValidatorAgent
from nexus_agent.agents.learner import LearnerAgent
from nexus_agent.agents.technical_architect import TechnicalArchitectAgent
from nexus_agent.agents.developer import DeveloperAgent
from nexus_agent.agents.autonomous_optimizer import AutonomousOptimizerAgent
from nexus_agent.agents.search_agent import SearchAgent
from nexus_agent.agents.finance_agent import FinanceAgent
from nexus_agent.agents.content_creator_agent import ContentCreatorAgent
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

logger = logging.getLogger(__name__)

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
        self.search_agent = SearchAgent()
        self.finance_agent = FinanceAgent()
        self.content_creator_agent = ContentCreatorAgent()
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
        agent_id: str | None = None,
        micro_state: AgentMicroState = AgentMicroState.EXECUTING,
        status_message: str = "",
    ) -> T:
        if agent_id:
            dashboard_hub.emit_state_threadsafe(
                agent_id=agent_id,
                role=sender,
                micro_state=micro_state,
                status_message=status_message or f"{sender.value} → {recipient.value}",
            )
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
            if agent_id:
                dashboard_hub.emit_state_threadsafe(
                    agent_id=agent_id,
                    role=sender,
                    micro_state=AgentMicroState.COMPLETED,
                    status_message="Task completed",
                    exp_delta=10,
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
            if agent_id:
                dashboard_hub.emit_state_threadsafe(
                    agent_id=agent_id,
                    role=sender,
                    micro_state=AgentMicroState.ERROR,
                    status_message="Task failed",
                )
            raise

    def run_architect(self, payload: dict[str, Any]) -> ArchitecturePlan:
        """Run technical architecture phase and log status."""
        return self._run_with_logging(
            sender=AgentRole.TECHNICAL_ARCHITECT,
            recipient=AgentRole.DEVELOPER,
            payload=payload,
            runner=self.architect_agent.run,
            agent_id="architect",
            micro_state=AgentMicroState.DESIGNING,
            status_message="Designing architecture",
        )

    def run_developer(self, payload: dict[str, Any]) -> ImplementationPlan:
        """Run implementation phase and log status."""
        return self._run_with_logging(
            sender=AgentRole.DEVELOPER,
            recipient=AgentRole.AUTONOMOUS_OPTIMIZER,
            payload=payload,
            runner=self.developer_agent.run,
            agent_id="developer",
            micro_state=AgentMicroState.CODING,
            status_message="Generating implementation",
        )

    def run_optimizer(self, payload: dict[str, Any]) -> OptimizationResult:
        """Run autonomous optimization phase and log status."""
        return self._run_with_logging(
            sender=AgentRole.AUTONOMOUS_OPTIMIZER,
            recipient=AgentRole.TECHNICAL_ARCHITECT,
            payload=payload,
            runner=self.optimizer_agent.run,
            agent_id="optimizer",
            micro_state=AgentMicroState.OPTIMIZING,
            status_message="Optimizing prompts",
        )
    def run_search(self, payload: dict[str, Any]) -> Any:
        """Run search agent and log status."""
        from nexus_agent.core.models import AgentspaceSearchResult
        
        # We define a custom return type signature using typing.Any in run_with_logging to avoid circular imports.
        # But we know it returns AgentspaceSearchResult.
        return self._run_with_logging(
            sender=AgentRole.SEARCH_AGENT,
            recipient=AgentRole.DEVELOPER, # Just routing it somewhere, UI is the real recipient
            payload=payload,
            runner=self.search_agent.run,
            agent_id="search_agent",
            micro_state=AgentMicroState.PLANNING,
            status_message=f"Searching: {payload.get('query', '')[:20]}...",
        )

    def run_finance(self, payload: dict[str, Any]) -> Any:
        """Run finance agent and log status."""
        return self._run_with_logging(
            sender=AgentRole.FINANCE_AGENT,
            recipient=AgentRole.DEVELOPER,
            payload=payload,
            runner=self.finance_agent.run,
            agent_id="finance_agent",
            micro_state=AgentMicroState.PLANNING,
            status_message=f"Analyzing Finance Data: {payload.get('task', '')[:20]}...",
        )

    def run_content(self, payload: dict[str, Any]) -> Any:
        """Run content creator agent and log status."""
        return self._run_with_logging(
            sender=AgentRole.CONTENT_CREATOR_AGENT,
            recipient=AgentRole.DEVELOPER,
            payload=payload,
            runner=self.content_creator_agent.run,
            agent_id="content_creator_agent",
            micro_state=AgentMicroState.CODING,
            status_message=f"Drafting Content: {payload.get('topic', '')[:20]}...",
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

        node_to_agent: dict[str, tuple[str, AgentRole, AgentMicroState]] = {
            "planner": ("planner", AgentRole.PLANNER, AgentMicroState.PLANNING),
            "executor": ("developer", AgentRole.DEVELOPER, AgentMicroState.EXECUTING),
            "validator": ("validator", AgentRole.VALIDATOR, AgentMicroState.TESTING),
            "learner": ("optimizer", AgentRole.AUTONOMOUS_OPTIMIZER, AgentMicroState.OPTIMIZING),
        }
        self._node_to_agent = node_to_agent

        # Learner decides whether to loop back to the planner or finish.
        workflow.add_conditional_edges(
            "learner",
            self._after_learning,
            {
                "continue": "planner",  # Retry with lessons learned
                "end": END,              # End workflow on success
            },
        )

        return workflow.compile()
        
    def _after_learning(self, state: AgentState) -> str:
        """Routing function that determines if the loop should continue after learning."""
        status = state.get("validation_status", "failed")
        if status == "success":
            return "end"

        # Guard against infinite loops
        actions = state.get("actions_taken", [])
        if len(actions) > 5:  # Maximum 5 iterations
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
                logger.info("node_executed", extra={"node": node_name})
                mapping = getattr(self, "_node_to_agent", {}).get(node_name)
                if mapping:
                    agent_id, role, micro = mapping
                    dashboard_hub.emit_state_threadsafe(
                        agent_id=agent_id,
                        role=role,
                        micro_state=micro,
                        status_message=f"Executed node: {node_name}",
                    )
                    
                    if "messages" in state_update and state_update["messages"]:
                        # Extract the last message content
                        msg = state_update["messages"][-1]
                        content = msg.get("content", f"Finished {node_name}") if isinstance(msg, dict) else msg.content
                        dashboard_hub.emit_log_threadsafe(f"[{node_name.upper()}] {content}", agent_id=agent_id, role=role)
                    else:
                        dashboard_hub.emit_log_threadsafe(f"Executed node: {node_name}", agent_id=agent_id, role=role)
                        
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
