from typing import Callable, Any, Dict, List
from langchain_core.tools import BaseTool

class ToolRegistry:
    """Registry to manage and retrieve tools available to the Agent."""
    
    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        
    def register(self, tool: BaseTool):
        """Registers a LangChain BaseTool."""
        self._tools[tool.name] = tool
        
    def get_tool(self, name: str) -> BaseTool:
        if name not in self._tools:
            raise ValueError(f"Tool {name} not found in registry.")
        return self._tools[name]
        
    def get_all_tools(self) -> List[BaseTool]:
        """Returns all registered tools."""
        return list(self._tools.values())
