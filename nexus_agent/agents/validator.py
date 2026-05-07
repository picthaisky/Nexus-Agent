from typing import Any
from nexus_agent.core.state import AgentState
from nexus_agent.core.memory import ProceduralMemory

class ValidatorAgent:
    """
    Responsible for validating the output of the Executor.
    Returns success if the task is complete, or failed to loop back.
    Also records feedback for any used rules in the Playbook.
    """
    
    def __init__(self, procedural_memory: ProceduralMemory):
        self.memory = procedural_memory
        
    def run(self, state: AgentState) -> dict[str, Any]:
        # In a real implementation, the LLM would review the actions taken and final output.
        actions = state.get("actions_taken", [])
        used_rule_ids = state.get("used_rule_ids", [])
        
        is_success = len(actions) > 0
        
        # Record feedback for the rules we used
        for rule_id in used_rule_ids:
            self.memory.record_feedback(rule_id, is_helpful=is_success)
            
        if is_success:
            return {
                "validation_status": "success",
                "validation_feedback": "All steps executed successfully.",
                "messages": [{"role": "validator", "content": "Validation passed. Feedback recorded."}]
            }
        else:
            return {
                "validation_status": "failed",
                "validation_feedback": "No actions were taken by the executor.",
                "messages": [{"role": "validator", "content": "Validation failed: No actions taken. Negative feedback recorded."}]
            }
