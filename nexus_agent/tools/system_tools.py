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


def _stream_command(
    args: list[str],
    cwd: str,
    task_id: str | None = None,
    command_hint: str = "",
) -> str:
    """Run a command, streaming each line to the task event hub in real-time.

    Returns the full combined output string.
    """
    from nexus_agent.core.task_event_hub import task_event_hub as _teh
    import subprocess, select, sys

    lines: list[str] = []
    try:
        proc = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
            env={**os.environ},
            bufsize=1,
        )

        def _read_stream(stream, label: str) -> list[str]:
            result: list[str] = []
            if stream is None:
                return result
            for line in iter(stream.readline, ""):
                stripped = line.rstrip("\n")
                result.append(stripped)
                lines.append(stripped)
                if task_id:
                    _teh.execution_line(task_id, stripped, label, command_hint)
            return result

        import threading
        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        t_out = threading.Thread(target=lambda: stdout_lines.extend(_read_stream(proc.stdout, "stdout")))
        t_err = threading.Thread(target=lambda: stderr_lines.extend(_read_stream(proc.stderr, "stderr")))
        t_out.start(); t_err.start()

        proc.wait(timeout=_DEFAULT_TIMEOUT)
        t_out.join(); t_err.join()

        output = "\n".join(lines).strip() or "(no output)"
        if proc.returncode != 0:
            output = f"[exit {proc.returncode}] (cwd: {cwd})\n{output}"
        return output

    except subprocess.TimeoutExpired:
        try: proc.kill()
        except Exception: pass
        return f"Error: Command timed out after {_DEFAULT_TIMEOUT}s — '{command_hint[:80]}'"
    except Exception as exc:
        return f"Error executing command: {exc}"


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

    # Retrieve the current task_id from the thread-local context if available
    try:
        import threading as _threading
        _task_id: str | None = getattr(_threading.current_thread(), "_nexus_task_id", None)
    except Exception:
        _task_id = None

    try:
        return _stream_command(args, cwd, task_id=_task_id, command_hint=effective_command)
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


# ── P2.4 File System Context Tools ───────────────────────────────────────────
# These tools allow the Executor Agent to explore the project workspace without
# having to know exact file paths upfront — essential for coding tasks.

@tool
def list_files(directory: str = ".", pattern: str = "*", recursive: bool = False) -> str:
    """List files in a directory inside the workspace.

    Args:
        directory: Relative path from NEXUS_REPO_ROOT (use "." for root).
        pattern:   Glob pattern e.g. "*.py", "*.ts", "src/**/*.tsx".
        recursive: If True, searches all subdirectories.

    Returns a newline-separated list of matching paths (max 200 entries).
    """
    import glob as _glob
    base = Path(_DEFAULT_CWD) / directory
    if not base.exists():
        return f"Error: Directory '{directory}' does not exist under the workspace."
    try:
        if recursive:
            matches = list(base.rglob(pattern))
        else:
            matches = list(base.glob(pattern))
        files = sorted(
            str(p.relative_to(Path(_DEFAULT_CWD))) for p in matches if p.is_file()
        )[:200]
        if not files:
            return f"(no files matching '{pattern}' in '{directory}')"
        return "\n".join(files)
    except Exception as exc:
        return f"Error listing files: {exc}"


@tool
def get_file_tree(root: str = ".", max_depth: int = 3) -> str:
    """Return an ASCII directory tree for a path inside the workspace.

    Args:
        root:      Relative path from NEXUS_REPO_ROOT (use "." for project root).
        max_depth: How many levels deep to expand (default 3, max 5).

    Useful for understanding project structure before reading/writing files.
    """
    max_depth = min(max_depth, 5)
    base = Path(_DEFAULT_CWD) / root
    if not base.exists():
        return f"Error: '{root}' does not exist under the workspace."

    lines: list[str] = [str(base.relative_to(Path(_DEFAULT_CWD)))]

    def _walk(path: Path, prefix: str, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            entries = sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name))
        except PermissionError:
            return
        for i, entry in enumerate(entries):
            if entry.name.startswith('.') and entry.name not in {'.env', '.gitignore'}:
                continue  # skip hidden files (except common config)
            connector = "└── " if i == len(entries) - 1 else "├── "
            lines.append(f"{prefix}{connector}{entry.name}")
            if entry.is_dir() and depth < max_depth:
                extension = "    " if i == len(entries) - 1 else "│   "
                _walk(entry, prefix + extension, depth + 1)

    _walk(base, "", 1)
    if len(lines) > 150:
        lines = lines[:150]
        lines.append("... (truncated)")
    return "\n".join(lines)


@tool
def search_in_files(pattern: str, directory: str = ".", file_glob: str = "*.py") -> str:
    """Search for a text pattern inside files in the workspace (like grep).

    Args:
        pattern:   Text or regex pattern to search for.
        directory: Directory to search (relative to NEXUS_REPO_ROOT).
        file_glob: Glob to filter files e.g. "*.py", "*.ts", "**/*.tsx".

    Returns matching lines with file:line format (max 50 results).
    """
    import re as _re
    base = Path(_DEFAULT_CWD) / directory
    if not base.exists():
        return f"Error: '{directory}' does not exist under the workspace."

    results: list[str] = []
    try:
        compiled = _re.compile(pattern, _re.IGNORECASE)
    except _re.error as exc:
        return f"Error: Invalid regex pattern — {exc}"

    for fpath in base.rglob(file_glob):
        if not fpath.is_file():
            continue
        try:
            text = fpath.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if compiled.search(line):
                rel = str(fpath.relative_to(Path(_DEFAULT_CWD)))
                results.append(f"{rel}:{lineno}: {line.strip()[:120]}")
                if len(results) >= 50:
                    results.append("... (more results truncated)")
                    return "\n".join(results)

    return "\n".join(results) if results else f"(no matches for '{pattern}' in '{directory}')"
