# Automatic Skill Learning & Repository Implementation

This plan outlines the changes needed to implement an automatic skill learning system (Procedural Memory). The goal is to allow the agent to extract successful execution patterns and save them as reusable "skills" for future tasks.

## User Review Required

> [!IMPORTANT]
> **Learning Node Placement:** The new `LearnerAgent` will be placed in the graph immediately after a **successful** validation. This means the system will only extract a "skill" once a task is confirmed to be fully completed and correct.
> 
> **Skill Format:** Skills will be saved as markdown (`.md`) files in the `skills/` directory.

## Open Questions

1. **Skill Integration:** Should the `PlannerAgent` automatically inject all existing skills into its prompt when planning a new task, or should the Planner explicitly query the `ProceduralMemory` only when it needs help?
2. **LLM Dependency:** Currently, the system uses mocked responses for the agents. To truly extract abstract skills from action traces, we will need to integrate an LLM (e.g., `langchain_openai.ChatOpenAI`). Do you want me to mock the Learner's output for now, or proceed to integrate a real LLM hook?

## Proposed Changes

---

### Memory Layer Enhancement

#### [MODIFY] nexus_agent/core/memory.py
- Enhance the `ProceduralMemory` class:
  - Add `save_skill(skill_name: str, content: str)`: Saves the extracted skill to disk.
  - Add `list_skills() -> list[str]`: Retrieves all available skills.
  - Add `search_skills(query: str) -> str`: Basic keyword-based retrieval.

---

### Agent Layer (The Learner)

#### [NEW] nexus_agent/agents/learner.py
- Create `LearnerAgent` with a `run(state: AgentState)` method.
- **Responsibility:** If `validation_status` is success, the Learner analyzes the original `goal`, the `plan`, and the `actions_taken`.
- It synthesizes a "Best Practice/Skill" document (e.g., "How to create a python script") and calls `ProceduralMemory.save_skill()` to store it.

---

### Orchestration Layer (LangGraph update)

#### [MODIFY] nexus_agent/core/orchestrator.py
- Add `LearnerAgent` to the state graph.
- Update the conditional edges from the Validator:
  - If `success` → Route to `learner`
  - If `continue` (failed) → Route to `executor`
- Add edge from `learner` → `END`.

#### [MODIFY] nexus_agent/core/state.py
- Add a new field: `learned_skills: list[str]` to the `AgentState` to track what was learned during the session.

## Verification Plan

### Automated Tests
- Run `test_graph.py` (or a similar script) to simulate a full task completion.
- Verify that a new `.md` file is generated in the `skills/` directory containing the extracted skill.
- Verify that the graph output includes the `learned_skills` field.
