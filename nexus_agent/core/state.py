from typing import TypedDict, Annotated, Any
import operator
from pydantic import BaseModel
from nexus_agent.core.models import AgentMessage

class AgentState(TypedDict):
    """
    The shared state for the Nexus-Agent Control Loop (LangGraph).
    This state flows between Planner -> Executor -> Validator.
    """
    # Using operator.add to append messages to the list
    messages: Annotated[list[AgentMessage], operator.add]
    
    # The original objective from the user
    goal: str
    
    # The execution plan created by the Planner
    plan: list[str]
    
    # The current active step in the plan
    current_step: str
    
    # Tool calls / actions taken in the current loop
    actions_taken: Annotated[list[str], operator.add]
    
    # Feedback from the Validator (success, failed, pending)
    validation_status: str
    validation_feedback: str
    
    # Rules retrieved and used by the Planner in this execution
    used_rule_ids: Annotated[list[str], operator.add]
    
    # Skills learned from this execution
    learned_skills: Annotated[list[str], operator.add]
    
    # The final deliverable / output
    final_output: Any
