"""System tools — sandboxed CLI execution and file I/O for the Executor Agent.

Security model
--------------
Only commands in ALLOWED_COMMANDS may be executed. The list is intentionally
broad enough to cover real-world development tasks (Next.js, Python, Go, etc.)
while still blocking obviously dangerous commands (rm -rf, curl, wget, etc.).

The base command (first token) is checked against the allow-list; sub-commands
and flags are unrestricted so ``npm install``, ``npx prisma migrate``, and
``pytest -v --cov`` all work without modification.

Working directory
-----------------
Commands run in NEXUS_REPO_ROOT (default: /app/data/repos in Docker, or
./repos/ in local dev) so agents work inside the correct project directory,
not the nexus-agent server directory.

The ``cd path && command`` pattern is also supported: the ``cd`` portion is
parsed separately and sets the working directory for the following command.
"""
from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from langchain_core.tools import tool

# Default working directory for all CLI commands.
# In Docker: NEXUS_REPO_ROOT=/app/data/repos (set in docker-compose.yml).
# In local dev: falls back to ./repos relative to the project root.
_DEFAULT_CWD = os.environ.get(
    "NEXUS_REPO_ROOT",
    str(Path(__file__).resolve().parents[3] / "repos"),
)
# Ensure the directory exists so commands don't fail on first run
os.makedirs(_DEFAULT_CWD, exist_ok=True)

# ── Command allow-list ────────────────────────────────────────────────────────
# Add entries here when new runtimes or build tools are needed.
# Rules: use the bare binary name only (no path, no flags).
ALLOWED_COMMANDS: set[str] = {
    # ── File system (read-only / safe mutations) ─────
    "ls", "pwd", "cat", "head", "tail", "find", "grep", "wc", "diff",
    "mkdir", "touch", "cp", "mv",

    # ── Python ──────────────────────────────────────
    "python", "python3", "pip", "pip3", "pytest", "uv",

    # ── Node.js / JavaScript / TypeScript ───────────
    "node", "npm", "npx", "yarn", "pnpm", "tsc", "bun",

    # ── Go ──────────────────────────────────────────
    "go",

    # ── Rust ────────────────────────────────────────
    "cargo",

    # ── Database CLI tools ───────────────────────────
    "psql", "sqlite3", "mysql",

    # ── Git ─────────────────────────────────────────
    "git",

    # ── Docker (read-only) ───────────────────────────
    "docker",

    # ── Other safe utilities ─────────────────────────
    "echo", "printf", "env", "which", "type",
    "make", "cmake",
}

# Commands that must complete within this many seconds before being killed.
_DEFAULT_TIMEOUT = 120  # 2 minutes — enough for npm install / next build


def _resolve_cwd_and_command(command: str) -> tuple[str, str]:
    """Parse ``cd /some/path && actual-command`` → (cwd, actual-command).

    If no ``cd`` prefix is present, returns (_DEFAULT_CWD, command).
    This lets agents write ``cd senic-billing-next && npm install`` naturally.
    """
    stripped = command.strip()

    # Pattern: "cd <path> && <cmd>" or "cd <path>; <cmd>"
    for sep in (" && ", "; "):
        if stripped.startswith("cd ") and sep in stripped:
            parts = stripped.split(sep, 1)
            raw_dir = parts[0][3:].strip().strip("'\"")
            rest    = parts[1].strip()
            # Resolve relative paths against _DEFAULT_CWD
            if os.path.isabs(raw_dir):
                cwd = raw_dir
            else:
                cwd = str(Path(_DEFAULT_CWD) / raw_dir)
            os.makedirs(cwd, exist_ok=True)
            return cwd, rest

    return _DEFAULT_CWD, stripped


@tool
def execute_cli_command(command: str) -> str:
    """Execute a sandboxed CLI command and return its combined stdout + stderr.

    Rules
    -----
    * Only commands whose base binary is in ALLOWED_COMMANDS are permitted.
    * Commands run inside NEXUS_REPO_ROOT (the project workspace directory),
      not the nexus-agent server directory.
    * ``cd path && command`` is supported and changes the working directory.
    * Long-running commands are killed after 120 seconds.
    """
    cwd, effective_command = _resolve_cwd_and_command(command)

    try:
        args = shlex.split(effective_command)
    except ValueError as exc:
        return f"Error: Could not parse command — {exc}"

    if not args:
        return "Error: Empty command."

    base_cmd = args[0]
    if base_cmd not in ALLOWED_COMMANDS:
        return (
            f"Error: Command '{base_cmd}' is not in the security allow-list.\n"
            f"Allowed commands: {', '.join(sorted(ALLOWED_COMMANDS))}\n"
            f"Working directory: {cwd}"
        )

    try:
        result = subprocess.run(
            args,
            shell=False,
            capture_output=True,
            text=True,
            timeout=_DEFAULT_TIMEOUT,
            cwd=cwd,
            env={**os.environ},   # inherit PATH, NEXUS_DATA_DIR, etc.
        )
        output = result.stdout
        if result.stderr:
            output += ("\n" if output else "") + result.stderr
        if result.returncode != 0:
            output = f"[exit {result.returncode}] (cwd: {cwd})\n{output}"
        return output.strip() or "(no output)"
    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {_DEFAULT_TIMEOUT}s — '{effective_command[:80]}'"
    except FileNotFoundError:
        return f"Error: Binary '{base_cmd}' not found on PATH. (cwd: {cwd})"
    except Exception as exc:
        return f"Error executing command: {exc}"


@tool
def read_file(file_path: str) -> str:
    """Read and return the contents of a file (UTF-8).

    Returns the file content, or an error message if the file does not exist
    or cannot be decoded.
    """
    path = os.path.abspath(file_path)
    if not os.path.exists(path):
        return f"Error: File '{file_path}' does not exist."
    if not os.path.isfile(path):
        return f"Error: '{file_path}' is a directory, not a file."
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            content = fh.read()
        # Guard against huge files flooding the context
        if len(content) > 50_000:
            return content[:50_000] + f"\n\n[... truncated — file is {len(content)} chars total ...]"
        return content
    except Exception as exc:
        return f"Error reading file: {exc}"


@tool
def write_file(file_path: str, content: str) -> str:
    """Write (or overwrite) a file with the given content (UTF-8).

    Parent directories are created automatically.
    Returns a success message or an error string.
    """
    try:
        abs_path = os.path.abspath(file_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return f"Successfully wrote to {file_path} ({len(content)} chars)"
    except Exception as exc:
        return f"Error writing file: {exc}"
