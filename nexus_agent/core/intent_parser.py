import json
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class IntentParser:
    """
    Parses unstructured user input into a standardized payload format
    suitable for the TechnicalArchitectAgent.
    """
    def __init__(self, inference_engine=None):
        self.inference_engine = inference_engine

    def parse(self, user_message: str) -> Dict[str, Any]:
        """
        In a production scenario, this would use the inference engine to 
        extract an intent JSON. Here we provide a mock/rule-based extraction 
        fallback.
        """
        logger.info(f"Parsing intent for message: {user_message[:50]}...")
        
        # Pseudo extraction logic
        payload = {
            "requirements_summary": user_message,
            "components": ["Frontend", "Backend", "Database"],
            "edge_cases": [
                {
                    "title": "Invalid Input",
                    "description": "User provides malformed data format.",
                    "impact": "System exception.",
                    "mitigation": "Add input validation middleware."
                }
            ],
            "failure_modes": [
                {
                    "title": "Database Timeout",
                    "description": "Database is unreachable under load.",
                    "probability": "Low",
                    "recovery_strategy": "Implement retry logic with exponential backoff."
                }
            ],
            "todo_items": [
                "Set up project scaffolding",
                "Implement core logic",
                "Write unit tests"
            ]
        }
        
        return payload

class ComplexityAnalyzer:
    """
    Evaluates the computational complexity of an intent to determine
    whether it should be executed locally or offloaded to the cloud.
    """
    @staticmethod
    def requires_cloud_fallback(intent_payload: Dict[str, Any]) -> bool:
        """
        Simple heuristic: if there are many components or todo items,
        it's a high-complexity task requiring cloud fallback.
        """
        complexity_score = len(intent_payload.get("components", [])) + len(intent_payload.get("todo_items", []))
        
        if complexity_score > 5:
            logger.info(f"Complexity Score: {complexity_score}. High complexity detected, routing to Cloud.")
            return True
            
        logger.info(f"Complexity Score: {complexity_score}. Low complexity, using Local GPU.")
        return False
