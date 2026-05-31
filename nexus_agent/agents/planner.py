from typing import Any
import json
from langchain_core.prompts import ChatPromptTemplate
from nexus_agent.core.state import AgentState
from nexus_agent.core.memory import ProceduralMemory

from nexus_agent.core.inference import InferenceEngine, InferenceConfig

class PlannerAgent:
    """
    Responsible for breaking down the high-level goal into a sequence of actionable steps.
    It retrieves relevant skills from ProceduralMemory to guide the planning process.
    """
    def __init__(self, procedural_memory: ProceduralMemory):
        self.memory = procedural_memory
        try:
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None
    
    def run(self, state: AgentState) -> dict[str, Any]:
        goal = state.get("goal", "")
        
        # 1. Search for relevant rules from the playbook
        search_results = self.memory.search_playbook(goal)
        
        skills_context = "No relevant rules found."
        used_rule_ids = []
        if search_results:
            # Take top 3 rules
            top_rules = search_results[:3]
            used_rule_ids = [r['rule_id'] for r in top_rules]
            
            context_blocks = []
            for r in top_rules:
                header = f"--- Rule: {r['name']} (Maturity: {r['maturity']}, Score: {r['effective_score']:.1f}) ---"
                if r['is_antipattern']:
                    header = f"--- ANTI-PATTERN WARNING: {r['name']} ---"
                context_blocks.append(f"{header}\n{r['content']}")
                
            skills_context = "\n\n".join(context_blocks)

        if self.engine is None or not getattr(self.engine, "_adapters", True):
            plan = [f"Attempt to solve: {goal}"] if goal else ["Clarify goal and gather requirements"]
            return {
                "plan": plan,
                "current_step": plan[0],
                "used_rule_ids": used_rule_ids,
                "messages": [{
                    "role": "planner",
                    "content": "Fallback plan used because LLM engine is unavailable in this environment.",
                }],
            }
            
        # 2. Generate Plan using LLM
        try:
            system_prompt = (
                "You are an AI Planner. Break down the user's Goal into a discrete list of actionable steps.\n"
                "You have access to the following known Skills/Best Practices which may help you format your plan:\n"
                f"{skills_context}\n\n"
                "Output ONLY a JSON array of strings representing the steps. Example: [\"step 1\", \"step 2\"]"
            )
            
            resp = self.engine.generate_detailed(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Goal: {goal}"}
                ],
                temperature=0.2
            )
            
            content = resp.content
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].strip()
                
            plan = json.loads(content)
            if not isinstance(plan, list):
                plan = [str(plan)]
                
            return {
                "plan": plan,
                "current_step": plan[0] if plan else "No plan generated",
                "used_rule_ids": used_rule_ids,
                "messages": [{"role": "planner", "content": f"Created plan using {len(used_rule_ids)} playbook rules."}]
            }
            
        except Exception as e:
            # Fallback plan if LLM fails
            plan = [f"Attempt to solve: {goal}"]
            return {
                "plan": plan,
                "current_step": plan[0],
                "used_rule_ids": used_rule_ids,
                "messages": [{"role": "planner", "content": f"Fallback plan used due to error: {str(e)}"}]
            }
