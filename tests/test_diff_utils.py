"""Tests for diff utilities."""

import pytest

from nexus_agent.utils.diff_utils import generate_unified_diff, apply_unified_diff


class TestGenerateUnifiedDiff:
    def test_new_file(self):
        diff = generate_unified_diff("", "hello\n", from_file="a/f.py", to_file="b/f.py")
        assert "--- a/f.py" in diff
        assert "+++ b/f.py" in diff
        assert "+hello" in diff

    def test_modified_file(self):
        original = "line1\nline2\nline3\n"
        modified = "line1\nchanged\nline3\n"
        diff = generate_unified_diff(original, modified)
        assert "-line2" in diff
        assert "+changed" in diff

    def test_identical_files_produces_empty_diff(self):
        content = "no change\n"
        diff = generate_unified_diff(content, content)
        assert diff == ""

    def test_context_lines_respected(self):
        original = "\n".join(str(i) for i in range(20)) + "\n"
        modified = original.replace("10\n", "TEN\n")
        diff_3 = generate_unified_diff(original, modified, context_lines=3)
        diff_0 = generate_unified_diff(original, modified, context_lines=0)
        assert len(diff_3) > len(diff_0)

    def test_custom_labels_in_header(self):
        diff = generate_unified_diff("a\n", "b\n", from_file="old.py", to_file="new.py")
        assert "--- old.py" in diff
        assert "+++ new.py" in diff


class TestApplyUnifiedDiff:
    def test_empty_diff_returns_original(self):
        original = "unchanged\n"
        assert apply_unified_diff(original, "") == original

    def test_apply_modification(self):
        original = "hello\nworld\n"
        modified = "hello\nearth\n"
        diff = generate_unified_diff(original, modified)
        result = apply_unified_diff(original, diff)
        assert result == modified

    def test_apply_new_file(self):
        diff = generate_unified_diff("", "new content\n")
        result = apply_unified_diff("", diff)
        assert result == "new content\n"

    def test_roundtrip(self):
        original = "alpha\nbeta\ngamma\n"
        modified = "alpha\nBETA\ngamma\n"
        diff = generate_unified_diff(original, modified)
        assert apply_unified_diff(original, diff) == modified
