"""Base agent class shared by all Nexus-Agent roles."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from nexus_agent.core.models import AgentRole


class BaseAgent(ABC):
    """Abstract base for all Nexus-Agent agents.

    Each concrete agent must declare its :attr:`role` and implement
    :meth:`run`, which accepts a dictionary payload and returns a
    Pydantic model (or plain dict) that can be serialised to JSON.
    """

    role: AgentRole

    def __init__(self, system_prompt: str) -> None:
        self.system_prompt = system_prompt

    @abstractmethod
    def run(self, payload: dict[str, Any]) -> Any:
        """Execute the agent with the given payload and return a result."""

    def describe(self) -> str:
        """Return a human-readable description of the agent."""
        return f"[{self.role.value}] {self.__class__.__name__}"
