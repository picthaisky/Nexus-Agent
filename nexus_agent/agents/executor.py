"""Executor Agent — runs ALL plan steps using the tool registry, guided by an LLM."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from nexus_agent.core.state import AgentState
from nexus_agent.tools.base import ToolRegistry

logger = logging.getLogger(__name__)

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
    """Executes ALL steps of the plan, not just current_step.

    Previously the agent only ran ``state["current_step"]`` (plan[0]), which
    caused the orchestrator to loop back to the Planner every iteration and
    repeat the same first step.  Now it iterates through every step in
    ``state["plan"]`` so the full goal is completed in one Executor pass.
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
        plan: list[str] = state.get("plan", [])
        fallback_step: str = state.get("current_step", "No step provided")

        # Execute every step in the plan.  If the plan is empty, fall back to
        # the single current_step so existing callers still work.
        steps = plan if plan else [fallback_step]

        all_actions: list[str] = list(state.get("actions_taken", []))  # preserve prior progress
        all_outputs: list[str] = []
        messages: list[dict] = []

        for step in steps:
            logger.info("ExecutorAgent running step: %s", step[:80])
            tool_name, _tool_args, tool_output = self._select_and_run_tool(step)

            action_summary = f"[{tool_name}] {step[:60]} → {str(tool_output)[:120]}"
            all_actions.append(action_summary)
            all_outputs.append(str(tool_output))
            messages.append({
                "role": "executor",
                "content": (
                    f"Tool '{tool_name}' executed for step: {step}. "
                    f"Output: {str(tool_output)[:300]}"
                ),
            })

        return {
            "actions_taken": all_actions,
            "final_output": "\n\n".join(all_outputs),
            "messages": messages,
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
                match = re.search(r"\{.*\}", raw, re.DOTALL)
                if match:
                    return json.loads(match.group())
            except Exception as exc:
                logger.debug("LLM tool selection failed, using heuristic: %s", exc)

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
        if any(k in sl for k in ("write ", "create file", "save file", "generate file", "initialize", "setup")):
            path = re.search(r"[\w./\\-]+\.\w+", step)
            if path:
                return {
                    "tool": "write_file",
                    "args": {
                        "file_path": path.group(),
                        "content": f"# Auto-generated\n# Step: {step}\n",
                    },
                }
        return {"tool": "none", "args": {}, "note": f"No matching tool for: {step}"}
