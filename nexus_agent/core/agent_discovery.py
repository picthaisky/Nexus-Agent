import json
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

class AgentCard:
    """Represents the A2A Protocol standard format for agent definitions."""
    def __init__(self, name: str, role: str, capabilities: List[str], endpoint_url: str):
        self.name = name
        self.role = role
        self.capabilities = capabilities
        self.endpoint_url = endpoint_url

    def to_json(self) -> str:
        """Outputs the format for /.well-known/agent-card.json"""
        return json.dumps({
            "agent_name": self.name,
            "role": self.role,
            "capabilities": self.capabilities,
            "endpoint": self.endpoint_url,
            "protocol_version": "1.0",
            "status": "online"
        }, indent=2)

class AgentRegistry:
    """Manages Agent discovery and routing using the A2A protocol."""
    def __init__(self):
        self.agents: Dict[str, AgentCard] = {}

    def register_agent(self, card: AgentCard):
        """Registers a worker agent with its specific capabilities."""
        self.agents[card.role] = card
        logger.info(f"Registered agent {card.name} with role {card.role}")

    def get_agent_card(self, role: str) -> str:
        """Retrieve the well-known JSON definition of a specific role."""
        if role in self.agents:
            return self.agents[role].to_json()
        return json.dumps({"error": "Agent not found"})

    def dynamic_agent_assignment(self, task_requirements: List[str]) -> str:
        """
        Calculates Jaccard-like overlap to determine the best worker agent 
        based on capabilities matching the task requirements.
        """
        best_match = None
        max_overlap = -1
        
        for role, card in self.agents.items():
            overlap = len(set(card.capabilities) & set(task_requirements))
            if overlap > max_overlap:
                max_overlap = overlap
                best_match = role
                
        if best_match and max_overlap > 0:
            logger.info(f"Dynamically assigned task to agent role: {best_match}")
            return best_match
            
        logger.warning("No highly suitable agent found. Falling back to default Developer.")
        return "Developer"
