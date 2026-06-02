"""Executor Agent — runs ALL plan steps using the tool registry, guided by an LLM."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from nexus_agent.core.state import AgentState
from nexus_agent.tools.base import ToolRegistry

logger = logging.getLogger(__name__)

_TOOL_SELECTION_PROMPT = """You are an Executor Agent. Your job is to carry out ONE concrete action step.

WORKING DIRECTORY: All commands run inside NEXUS_REPO_ROOT (the project workspace).
Use "cd <project-folder> && <command>" to run inside a sub-directory.

Available tools:
- execute_cli_command(command: str) — Run a shell command.
  Allowed: ls, pwd, cat, find, grep, mkdir, touch, cp, mv,
           python, python3, pip, pip3, pytest, uv,
           node, npm, npx, yarn, pnpm, tsc, bun,
           go, cargo, git, docker, make, echo
- read_file(file_path: str)         — Read the contents of a file.
- write_file(file_path: str, content: str) — Create or overwrite a file.

STEP TO EXECUTE:
{step}

DECISION RULES (pick the FIRST that matches):
1. Step mentions "create project" / "scaffold" / "init" / "initialize project"
   → execute_cli_command: npx create-next-app@latest <name> --typescript --tailwind --app --no-git
2. Step mentions "install" / "dependencies" / "packages"
   → execute_cli_command: cd <project> && npm install (or pip install)
3. Step mentions "migration" / "prisma" / "database schema"
   → execute_cli_command: cd <project> && npx prisma migrate dev --name init
4. Step mentions "run test" / "testing" / "validation" / "verify" / "pytest" / "jest"
   → execute_cli_command: cd <project> && pytest tests/ -v  (or npm test)
5. Step mentions "build" / "compile" / "tsc"
   → execute_cli_command: cd <project> && npm run build
6. Step mentions "deploy" / "start server" / "launch"
   → execute_cli_command: cd <project> && npm run start
7. Step mentions "write file" / "create file" / "implement" / "add component"
   → write_file with file_path and full content
8. Step mentions "read" / "view" / "check" / "inspect" a file
   → read_file with the file path
9. Otherwise → {{"tool": "none", "args": {{}}, "note": "Step is conceptual/planning"}}

EXAMPLES:
{{"tool": "execute_cli_command", "args": {{"command": "npx create-next-app@latest senic-billing-next --typescript --tailwind --app --no-git"}}}}
{{"tool": "execute_cli_command", "args": {{"command": "cd senic-billing-next && npm install prisma @prisma/client"}}}}
{{"tool": "execute_cli_command", "args": {{"command": "cd senic-billing-next && npx prisma migrate dev --name init"}}}}
{{"tool": "execute_cli_command", "args": {{"command": "cd senic-billing-next && pytest tests/ -v"}}}}
{{"tool": "write_file", "args": {{"file_path": "senic-billing-next/src/app/page.tsx", "content": "export default function Page() {{ return <h1>Hello</h1>; }}"}}}}
{{"tool": "read_file", "args": {{"file_path": "senic-billing-next/package.json"}}}}

Respond ONLY with ONE valid JSON object. No explanation, no markdown.
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
        """Priority-ordered keyword matching when LLM is unavailable or fails.

        Ordered from most specific → most general to avoid false-positive matches
        (e.g. "validation" must not map to ``ls``).
        """
        sl   = step.lower()
        # Extract a project name hint from the step text if present
        proj = re.search(r"[\w-]+-(?:next|app|project|api|service|web)", sl)
        proj_name = proj.group(0) if proj else ""

        # ── 1. Project initialisation ────────────────────────────────────────
        if any(k in sl for k in ("create project", "initialize project", "scaffold project",
                                  "init project", "npx create", "create-next-app",
                                  "create-react-app", "django-admin startproject")):
            name = proj_name or "my-project"
            return {"tool": "execute_cli_command",
                    "args": {"command": f"npx create-next-app@latest {name} --typescript --tailwind --app --no-git"}}

        # ── 2. Package installation ──────────────────────────────────────────
        if any(k in sl for k in ("npm install", "yarn add", "pip install", "pnpm install",
                                  "install dependencies", "install packages", "install library")):
            base = f"cd {proj_name} && " if proj_name else ""
            return {"tool": "execute_cli_command",
                    "args": {"command": f"{base}npm install"}}

        # ── 3. Database / migration ──────────────────────────────────────────
        if any(k in sl for k in ("prisma migrate", "alembic upgrade", "run migration",
                                  "database migration", "migrate dev", "init db")):
            base = f"cd {proj_name} && " if proj_name else ""
            return {"tool": "execute_cli_command",
                    "args": {"command": f"{base}npx prisma migrate dev --name init"}}

        # ── 4. Testing / validation ──────────────────────────────────────────
        # IMPORTANT: "validation" and "testing" → run test suite, NOT ls!
        if any(k in sl for k in ("run test", "run tests", "execute test", "testing",
                                  "validation", "validate", "verify", "pytest",
                                  "jest test", "npm test", "unit test", "test suite",
                                  "qa test", "test coverage")):
            base = f"cd {proj_name} && " if proj_name else ""
            # Python project
            if any(k in sl for k in ("pytest", "python", "django", "flask", "fastapi")):
                return {"tool": "execute_cli_command",
                        "args": {"command": f"{base}pytest tests/ -v"}}
            # Default to npm test for JS/TS projects
            return {"tool": "execute_cli_command",
                    "args": {"command": f"{base}npm test -- --passWithNoTests"}}

        # ── 5. Build / compile ───────────────────────────────────────────────
        if any(k in sl for k in ("build project", "compile", "tsc ", "npm run build",
                                  "next build", "vite build")):
            base = f"cd {proj_name} && " if proj_name else ""
            return {"tool": "execute_cli_command",
                    "args": {"command": f"{base}npm run build"}}

        # ── 6. Deployment / start ────────────────────────────────────────────
        if any(k in sl for k in ("deploy", "start server", "launch", "npm start",
                                  "npm run start", "uvicorn", "gunicorn")):
            base = f"cd {proj_name} && " if proj_name else ""
            return {"tool": "execute_cli_command",
                    "args": {"command": f"{base}npm run start"}}

        # ── 7. Git operations ────────────────────────────────────────────────
        if any(k in sl for k in ("git init", "git commit", "git add", "git push",
                                  "initialize repository", "create repository")):
            base = f"cd {proj_name} && " if proj_name else ""
            return {"tool": "execute_cli_command",
                    "args": {"command": f"{base}git init"}}

        # ── 8. Generic CLI execution keywords ───────────────────────────────
        GENERIC_CLI = (
            "npm ", "npx ", "yarn ", "pnpm ", "pip ", "pip3 ",
            "python ", "python3 ", "node ", "tsc ", "go run", "go build",
            "cargo ", "docker ", "make ", "mkdir ", "touch ", "cp ", "mv ",
        )
        if any(k in sl for k in GENERIC_CLI):
            # Try to extract a command after a colon or from first code-like line
            cmd = step
            if ":" in step:
                cmd = step.split(":", 1)[-1].strip()
            elif "\n" in step:
                for line in step.split("\n"):
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#"):
                        cmd = stripped
                        break
            cmd = cmd.strip("`'\"").strip()
            if cmd:
                return {"tool": "execute_cli_command", "args": {"command": cmd[:300]}}

        # ── 9. File read ──────────────────────────────────────────────────────
        if any(k in sl for k in ("read ", "open ", "load file", "view file", "inspect file")):
            path = re.search(r"[\w./\\-]+\.\w+", step)
            if path:
                return {"tool": "read_file", "args": {"file_path": path.group()}}

        # ── 10. File write ────────────────────────────────────────────────────
        WRITE_KEYWORDS = (
            "write ", "create file", "save file", "generate file",
            "add file", "update file", "implement ", "define ", "add component",
        )
        if any(k in sl for k in WRITE_KEYWORDS):
            path = re.search(r"[\w./\\-]+\.\w+", step)
            if path:
                return {
                    "tool": "write_file",
                    "args": {
                        "file_path": path.group(),
                        "content": f"# Auto-generated placeholder\n# Step: {step[:120]}\n",
                    },
                }

        return {"tool": "none", "args": {}, "note": f"Conceptual step — no CLI action needed: {step[:80]}"}
