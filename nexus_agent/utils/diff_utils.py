"""Unified-diff utilities for the Developer Agent."""

from __future__ import annotations

import difflib


def generate_unified_diff(
    original: str,
    modified: str,
    from_file: str = "original",
    to_file: str = "modified",
    context_lines: int = 3,
) -> str:
    """Return a unified diff string comparing *original* to *modified*.

    Parameters
    ----------
    original:
        The original file content (or empty string for new files).
    modified:
        The new file content.
    from_file:
        Label used in the ``---`` header line.
    to_file:
        Label used in the ``+++`` header line.
    context_lines:
        Number of unchanged lines to include around each change.
    """
    original_lines = original.splitlines(keepends=True)
    modified_lines = modified.splitlines(keepends=True)
    diff_lines = list(
        difflib.unified_diff(
            original_lines,
            modified_lines,
            fromfile=from_file,
            tofile=to_file,
            n=context_lines,
        )
    )
    return "".join(diff_lines)


def apply_unified_diff(original: str, diff: str) -> str:
    """Apply a unified diff to *original* and return the patched content.

    This is a lightweight implementation suitable for testing and preview.
    For production patching, use the system ``patch`` command or a dedicated
    library such as ``whatthepatch``.

    The algorithm walks through each hunk line-by-line:

    * Context lines (`` ``): copied as-is from the original.
    * Removal lines (``-``): the corresponding original line is skipped.
    * Addition lines (``+``): the new line is emitted.
    """
    if not diff.strip():
        return original

    original_lines = original.splitlines(keepends=True)
    diff_lines = diff.splitlines(keepends=True)

    # Parse hunks: list of (orig_start_0indexed, hunk_lines)
    hunks: list[tuple[int, list[str]]] = []
    current_hunk_lines: list[str] = []
    orig_start = 0
    in_hunk = False

    for line in diff_lines:
        if line.startswith("@@"):
            if in_hunk and current_hunk_lines:
                hunks.append((orig_start, current_hunk_lines))
            current_hunk_lines = []
            in_hunk = True
            # Extract original start line from @@ -<start>[,<count>] ... @@
            parts = line.split()
            orig_info = parts[1]  # e.g. "-3,7" or "-3"
            orig_start = abs(int(orig_info.split(",")[0])) - 1
        elif line.startswith("---") or line.startswith("+++"):
            in_hunk = False
        elif in_hunk:
            current_hunk_lines.append(line)

    if current_hunk_lines:
        hunks.append((orig_start, current_hunk_lines))

    # Walk hunks and reconstruct the patched file
    output: list[str] = []
    orig_idx = 0  # cursor into original_lines

    for hunk_start, hunk_lines in hunks:
        # Emit any original lines that precede this hunk unchanged
        while orig_idx < hunk_start:
            output.append(original_lines[orig_idx])
            orig_idx += 1

        for hline in hunk_lines:
            if hline.startswith(" "):
                # Context line – copy from original
                if orig_idx < len(original_lines):
                    output.append(original_lines[orig_idx])
                orig_idx += 1
            elif hline.startswith("-"):
                # Removal – skip the original line
                orig_idx += 1
            elif hline.startswith("+"):
                # Addition – emit the new line
                output.append(hline[1:])
            # Other markers (e.g. "\ No newline at end of file") are ignored.

    # Emit any remaining original lines after the last hunk
    output.extend(original_lines[orig_idx:])

    return "".join(output)
