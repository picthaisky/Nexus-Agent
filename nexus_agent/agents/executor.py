"""Executor Agent — runs a plan step using the tool registry, guided by an LLM."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from nexus_agent.core.state import AgentState
from nexus_agent.tools.base import ToolRegistry

logger = logging.getLogger(__name__)

# Prompt that asks the LLM to choose a tool and arguments
_TOOL_SELECTION_PROMPT = """You are an Executor Agent. Your job is to carry out ONE action step using the available tools.

Available tools:
- execute_cli_command(command: str) — Run a shell command (allowed: ls, pwd, echo, python, pytest, npm)
- read_file(file_path: str) — Read contents of a file
- write_file(file_path: str, content: str) — Write content to a file

Current step to execute:
{step}

Respond ONLY with a JSON object like:
{{"tool": "execute_cli_command", "args": {{"command": "ls -la"}}}}
or
{{"tool": "read_file", "args": {{"file_path": "src/main.py"}}}}
or
{{"tool": "write_file", "args": {{"file_path": "output.txt", "content": "hello"}}}}
or if no tool applies:
{{"tool": "none", "args": {{}}, "note": "Completed conceptually"}}
"""


class ExecutorAgent:
    """Executes the current step of the plan using available tools.

    Uses an LLM to parse the step description and choose the right tool
    from the registry, then invokes it and returns the real output.
    Falls back to a simulation when no LLM is available.
    """

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self.tool_registry = tool_registry
        try:
            from nexus_agent.core.inference import InferenceEngine, InferenceConfig
            self.engine = InferenceEngine(InferenceConfig())
        except Exception:
            self.engine = None

    # ------------------------------------------------------------------
    def run(self, state: AgentState) -> dict[str, Any]:
        step = state.get("current_step", "No step provided")
        logger.info("ExecutorAgent running step: %s", step[:80])

        tool_name, tool_args, tool_output = self._select_and_run_tool(step)

        action_summary = f"[{tool_name}] {step[:60]} → {str(tool_output)[:120]}"
        return {
            "actions_taken": [action_summary],
            "final_output": tool_output,
            "messages": [
                {
                    "role": "executor",
                    "content": f"Tool '{tool_name}' executed for step: {step}. Output: {str(tool_output)[:300]}",
                }
            ],
        }

    # ------------------------------------------------------------------
    def _select_and_run_tool(self, step: str) -> tuple[str, dict, str]:
        """Ask LLM which tool to call, then call it. Falls back to heuristic."""
        decision = self._llm_decide(step)
        tool_name = decision.get("tool", "none")
        tool_args = decision.get("args", {})

        if tool_name == "none" or not tool_name:
            return "none", {}, decision.get("note", f"Conceptually completed: {step}")

        try:
            tool = self.tool_registry.get_tool(tool_name)
            output = tool.invoke(tool_args)
            return tool_name, tool_args, str(output)
        except Exception as exc:
            logger.warning("Tool '%s' failed: %s", tool_name, exc)
            return tool_name, tool_args, f"Tool error: {exc}"

    def _llm_decide(self, step: str) -> dict:
        """Use LLM (or heuristic) to decide which tool to call."""
        if self.engine is not None:
            try:
                prompt = _TOOL_SELECTION_PROMPT.format(step=step)
                resp = self.engine.generate_detailed(
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                )
                raw = resp.content.strip()
                # Extract JSON from possible markdown block
                match = re.search(r"\{.*\}", raw, re.DOTALL)
                if match:
                    return json.loads(match.group())
            except Exception as exc:
                logger.debug("LLM tool selection failed: %s", exc)

        # Heuristic fallback
        return self._heuristic_decide(step)

    @staticmethod
    def _heuristic_decide(step: str) -> dict:
        """Simple keyword-based tool selection when LLM is unavailable."""
        sl = step.lower()
        if any(k in sl for k in ("run ", "execute ", "npm ", "pytest", "python ")):
            cmd = step.split(":", 1)[-1].strip() if ":" in step else step
            return {"tool": "execute_cli_command", "args": {"command": cmd[:200]}}
        if any(k in sl for k in ("read ", "open ", "load file", "view file")):
            path = re.search(r"[\w./\\-]+\.\w+", step)
            if path:
                return {"tool": "read_file", "args": {"file_path": path.group()}}
        if any(k in sl for k in ("write ", "create file", "save file", "generate file")):
            path = re.search(r"[\w./\\-]+\.\w+", step)
            if path:
                return {"tool": "write_file", "args": {"file_path": path.group(), "content": f"# Auto-generated\n# Step: {step}\n"}}
        return {"tool": "none", "args": {}, "note": f"No matching tool for: {step}"}
