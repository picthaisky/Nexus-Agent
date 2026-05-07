# Evolving Nexus-Agent into a Task-Oriented Multi-Agent System

This plan outlines the architectural shift to upgrade Nexus-Agent from a linear pipeline (Architect -> Developer -> Optimizer) to a robust, loop-driven agentic system capable of managing tasks to completion. The redesign is heavily inspired by the "AI Agent Cheat Sheet" blueprint provided.

## User Review Required

> [!WARNING]
> **Dependency Additions:** This plan proposes introducing **LangGraph** (`langgraph` and `langchain-core`) into the technology stack to manage the stateful control loop. Please confirm if adding these dependencies is acceptable.

> [!IMPORTANT]
> **Paradigm Shift:** The current Orchestrator is linear. We will replace it with a **State Graph** (using LangGraph), which allows conditional routing (e.g., looping back to the Executor if the Validator fails the result).

## Open Questions

1. **Vector DB Preference:** The blueprint mentions FAISS/Chroma for Long-Term Memory. Currently, `SemanticMemory` is just a stub. Do you want to implement a specific Vector DB right now, or should we focus strictly on the Workflow and Tools first?
2. **Tools Authorization:** When agents execute CLI commands or write to databases, do we want a "human-in-the-loop" approval step (Governance), or should the system run fully autonomously in a sandbox?

## Proposed Changes

---

### Orchestration Layer (LangGraph Integration)

We will replace the linear orchestrator with a state graph that handles the core loop: **Observe → Reason → Decide → Act → Learn**.

#### [MODIFY] pyproject.toml
- Add `langgraph` and `langchain-core` to dependencies.

#### [NEW] nexus_agent/core/state.py
- Define `AgentState` (TypedDict or Pydantic model) to track messages, current task, tool calls, and validation results. This acts as the short-term memory passed between graph nodes.

#### [MODIFY] nexus_agent/core/orchestrator.py
- Refactor the `Orchestrator` to compile a LangGraph workflow.
- Define nodes: `Planner`, `Executor`, `Validator`.
- Define conditional edges: e.g., if `Validator` finds errors, route back to `Executor` or `Planner`; if success, route to `END`.

---

### Tool Layer

Tools are what allow the LLM to take real action rather than just outputting text.

#### [NEW] nexus_agent/tools/base.py
- Define a base interface for Tools (e.g., name, description, parameters schema).
- Implement a `ToolRegistry` to expose available tools to the LLM.

#### [NEW] nexus_agent/tools/system_tools.py
- Implement basic tools for the Execution Layer:
  - `execute_cli_command`: Runs safe shell scripts.
  - `read_file` / `write_file`: Interacts with the filesystem.

---

### Agent Layer (Roles)

We will align the agents with the Multi-Agent Role Templates from the blueprint.

#### [NEW] nexus_agent/agents/planner.py
- `PlannerAgent`: Breaks down the user's goal into an execution strategy and decomposes goals into discrete steps.

#### [MODIFY] nexus_agent/agents/developer.py
- Rename to/act as the `ExecutorAgent`: Receives the plan, selects appropriate tools, and executes actions (writes code, runs pipelines).

#### [NEW] nexus_agent/agents/validator.py
- `ValidatorAgent`: Checks the correctness of the execution against the original goal. Provides feedback to close the "Validate -> Update" loop.

---

### Memory Layer

#### [MODIFY] nexus_agent/core/memory.py
- Integrate Short-term memory directly with the LangGraph state.
- Ensure `EpisodicMemory` correctly logs each step of the LangGraph execution for the "Learn" phase and Observability.

## Verification Plan

### Automated Tests
- Write a unit test for the LangGraph state machine to ensure the loop `Planner -> Executor -> Validator -> (Executor/End)` routes correctly based on mock validation results.
- Test the `ToolRegistry` to ensure tool schemas are correctly formatted for the LLM.

### Manual Verification
- Run the agent through a sample task (e.g., "Create a python script that calculates fibonacci and run it").
- Verify through logs that the agent detects the goal, plans it, uses the `write_file` tool, uses the `execute_cli_command` tool, validates the output, and returns a successful state.
