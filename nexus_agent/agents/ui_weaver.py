import logging
import json
from typing import Dict, Any, Callable

# nexus_agent.core.models needs an AgentRole definition, assumes DEVELOPER or custom UI_WEAVER
logger = logging.getLogger(__name__)

class UIWeaverAgent:
    """
    Frontend Design Agent operating within a Paperclip-style visual framework.
    Outputs HTML5 and Tailwind CSS for rapid prototyping and live rendering.
    """
    def __init__(self):
        self.system_prompt = """
You are UI-Weaver, an expert Frontend Design Agent.
Your goal is to bridge design and code. You must produce a production-ready UI component using HTML5 and Tailwind CSS.
CONSTRAINTS:
- Use Tailwind CSS utility classes exclusively.
- The code must be completely self-contained so it can be rendered instantly in a live preview iframe.
- Output ONLY the raw HTML code without markdown formatting.
"""
        self.active_components: Dict[str, str] = {}

    def generate_ui(self, ui_description: str) -> str:
        """Processes layout descriptions and outputs valid raw Tailwind HTML."""
        logger.info(f"UI-Weaver designing component from description: {ui_description[:30]}...")
        
        # In actual usage, calls the InferenceEngine
        html_output = f"""<!-- Generated UI for: {ui_description} -->
<div class='p-6 bg-gradient-to-br from-indigo-50 to-blue-100 rounded-xl shadow-lg border border-indigo-200'>
  <h1 class='text-3xl font-extrabold text-indigo-900 tracking-tight'>Generated UI Component</h1>
  <p class='mt-2 text-indigo-700 leading-relaxed'>Built automatically by Nexus-Agent.</p>
</div>"""
        
        # Save to syncing memory
        self.active_components["latestView"] = html_output
        return html_output

class RealTimeRenderer:
    """
    Manages the synchronization between Agent generated code and the frontend Live Preview iframe.
    Integrates Interactive Component Sync.
    """
    def __init__(self):
        logger.info("Real-time HTML rendering pipeline initialized.")
        self.listeners = []

    def register_listener(self, callback: Callable[[str], None]):
        """Register frontend WebSocket clients or UI event hooks."""
        self.listeners.append(callback)

    def sync_component(self, component_html: str):
        """Pushes new generated HTML to all attached preview clients."""
        logger.info("Syncing updated component HTML to Live Preview listeners...")
        for listener in self.listeners:
            listener(component_html)
