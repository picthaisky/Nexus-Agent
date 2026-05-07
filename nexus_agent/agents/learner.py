from typing import Any
import json
import uuid
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from nexus_agent.core.state import AgentState
from nexus_agent.core.memory import ProceduralMemory

class LearnerAgent:
    """
    Analyzes an execution trace to extract a reusable playbook rule (or anti-pattern)
    and saves it to ProceduralMemory.
    """
    def __init__(self, procedural_memory: ProceduralMemory):
        self.memory = procedural_memory
        self.llm = ChatOpenAI(model="gpt-4o", temperature=0.2)
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", "You are an AI Learner. Analyze the task execution trace.\n"
                       "If it was SUCCESSFUL, extract a generalized 'Best Practice/Skill' to reuse.\n"
                       "If it FAILED, extract an 'Anti-pattern' (what to avoid).\n"
                       "Output ONLY a JSON object with two keys:\n"
                       "'name': short descriptive title\n"
                       "'content': markdown detailing the rule/warning and context."),
            ("user", "Goal: {goal}\nPlan: {plan}\nActions Taken: {actions_taken}\nStatus: {status}\nFeedback: {feedback}")
        ])
        
    def run(self, state: AgentState) -> dict[str, Any]:
        goal = state.get("goal", "")
        plan = state.get("plan", [])
        actions_taken = state.get("actions_taken", [])
        status = state.get("validation_status", "pending")
        feedback = state.get("validation_feedback", "")
        
        if not actions_taken:
            return {"messages": [{"role": "learner", "content": "No actions taken, nothing to learn."}]}
            
        try:
            chain = self.prompt | self.llm
            response = chain.invoke({
                "goal": goal,
                "plan": json.dumps(plan),
                "actions_taken": json.dumps(actions_taken),
                "status": status,
                "feedback": feedback
            })
            
            content = response.content
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
