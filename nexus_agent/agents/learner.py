from typing import Any
import json
import uuid

from nexus_agent.core.state import AgentState
from nexus_agent.core.memory import ProceduralMemory

try:
    from nexus_agent.core.inference import InferenceEngine, InferenceConfig
except Exception:
    InferenceEngine = None  # type: ignore
    InferenceConfig = None  # type: ignore

class LearnerAgent:
    """
    Analyzes an execution trace to extract a reusable playbook rule (or anti-pattern)
    and saves it to ProceduralMemory.
    """
    def __init__(self, procedural_memory: ProceduralMemory):
        self.memory = procedural_memory
        try:
            self.engine = InferenceEngine(InferenceConfig()) if InferenceEngine else None
        except Exception:
            self.engine = None
        
    def run(self, state: AgentState) -> dict[str, Any]:
        goal = state.get("goal", "")
        plan = state.get("plan", [])
        actions_taken = state.get("actions_taken", [])
        status = state.get("validation_status", "pending")
        feedback = state.get("validation_feedback", "")
        
        if not actions_taken:
            return {"messages": [{"role": "learner", "content": "No actions taken, nothing to learn."}]}

        if self.engine is None or not getattr(self.engine, "_adapters", True):
            rule_name = f"fallback_{status}_pattern"
            rule_content = (
                f"Goal: {goal}\n"
                f"Status: {status}\n"
                f"Actions: {json.dumps(actions_taken)}\n"
                f"Feedback: {feedback or 'N/A'}"
            )
            rule_id = f"r-{str(uuid.uuid4())[:8]}"
            self.memory.add_rule(rule_id, rule_name, rule_content)
            return {
                "learned_skills": [rule_name],
                "messages": [{
                    "role": "learner",
                    "content": f"Saved fallback rule without LLM engine: {rule_name} (ID: {rule_id})",
                }],
            }
            
        try:
            system_prompt = (
                "You are an AI Learner. Analyze the task execution trace.\n"
                "If it was SUCCESSFUL, extract a generalized 'Best Practice/Skill' to reuse.\n"
                "If it FAILED, extract an 'Anti-pattern' (what to avoid).\n"
                "Output ONLY a JSON object with two keys:\n"
                "'name': short descriptive title\n"
                "'content': markdown detailing the rule/warning and context."
            )
            
            user_prompt = f"Goal: {goal}\nPlan: {json.dumps(plan)}\nActions Taken: {json.dumps(actions_taken)}\nStatus: {status}\nFeedback: {feedback}"
            
            resp = self.engine.generate_detailed(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2
            )
            
            content = resp.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].strip()
                
            data = json.loads(content)
            rule_name = data.get("name", "unknown_rule")
            rule_content = data.get("content", "No content generated.")
            rule_id = f"r-{str(uuid.uuid4())[:8]}"
            
            self.memory.add_rule(rule_id, rule_name, rule_content)
            
            return {
                "learned_skills": [rule_name],
                "messages": [{"role": "learner", "content": f"Extracted and saved rule: {rule_name} (ID: {rule_id})"}]
            }
        except Exception as e:
            return {
                "messages": [{"role": "learner", "content": f"Failed to learn rule: {str(e)}"}]
            }
