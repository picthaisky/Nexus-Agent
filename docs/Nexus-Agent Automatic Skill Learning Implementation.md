# Nexus-Agent Automatic Skill Learning Implementation

This walkthrough summarizes the integration of the "Skill Repository" and "Automatic Learning" capabilities using the real `langchain_openai.ChatOpenAI` models.

## 1. Skill Repository Enhancement
The `ProceduralMemory` class has been upgraded from just a skill reader to a complete repository manager.
- Added `save_skill()` to automatically write new `.md` files to the `skills/` directory.
- Added `search_skills(query)` which performs basic keyword scoring to rank and retrieve relevant skills, ensuring the Planner Agent is only fed relevant context rather than the entire skill base.

## 2. Dynamic Planner (LLM Integration)
The Planner Agent is now powered by `gpt-4o`.
- Before planning, it calls `search_skills(goal)`.
- It injects the top 2 most relevant skills into its system prompt.
- It dynamically generates the JSON array of execution steps rather than using hardcoded mocks.

## 3. The Learner Agent
A brand new `LearnerAgent` was introduced to close the `Learn` phase of the control loop.
- Powered by `gpt-4o`, it triggers **only if** the Validator Agent marks the execution as `success`.
- It analyzes the `goal`, the `plan`, and the `actions_taken` to synthesize an abstract, reusable "Skill" (a markdown document detailing the best practices and steps used).
- It immediately persists this skill via `save_skill()`, which makes it instantly available for the Planner Agent on subsequent runs.

## 4. Orchestrator Loop Update
The LangGraph `StateGraph` now reflects the full Enterprise Production Loop:
- `planner` ➔ `executor` ➔ `validator`
- **Condition:** 
  - If Validator = Success ➔ `learner` ➔ `END`
  - If Validator = Failed ➔ `executor`

> [!CAUTION]
> **API Key Required:** To run this new loop, the system now requires a valid `OPENAI_API_KEY` set in your environment (or inside `Stack.env` if running via Docker). Please ensure the key is exported before invoking the orchestrator.

## How to Test
You can test this end-to-end learning process by running a Python snippet with your API key active:

```python
import os
os.environ["OPENAI_API_KEY"] = "sk-..."

from nexus_agent.core.orchestrator import Orchestrator

# Initialize and run
orch = Orchestrator()
result = orch.run_task("Create a basic fastAPI hello-world server in a file called app.py")

# Check the skills directory afterwards
print(os.listdir("skills"))
```
