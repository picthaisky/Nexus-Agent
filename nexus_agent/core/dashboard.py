import logging
from typing import Dict, Any
from .observability import HardwareMonitor

logger = logging.getLogger(__name__)

class DashboardServer:
    """
    Real-time Operations Dashboard data provider.
    Aggregates Agent statuses and Hardware limitations for UI visualization.
    """
    def __init__(self):
        self.agent_statuses: Dict[str, str] = {
            "TechnicalArchitect": "Idle",
            "Developer": "Busy",
            "UIWeaver": "Idle",
            "QA": "Idle"
        }

    def update_agent_status(self, role: str, status: str):
        """Sets an agent's current state (Idle, Busy, Error)."""
        if role in self.agent_statuses:
            self.agent_statuses[role] = status
            logger.info(f"Dashboard: Agent {role} is now {status}")

    def get_dashboard_state(self) -> Dict[str, Any]:
        """Provides a cohesive snapshot for the frontend Dashboard."""
        return {
            "active_agents": self.agent_statuses,
            "system_metrics": HardwareMonitor.get_gpu_metrics(),
            "notifications": [
                {"level": "info", "message": "System running smoothly."}
            ]
        }
