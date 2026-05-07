"""Tests for persistent SkillVault and local deep-research planning."""

from pathlib import Path

from nexus_agent.core.skill_vault import SkillVault


def _make_vault(tmp_path: Path) -> SkillVault:
    return SkillVault(db_path=str(tmp_path / "skill_vault.db"))


def test_add_and_search_skill(tmp_path: Path):
    vault = _make_vault(tmp_path)

    record = vault.add_skill(
        name="Blast Radius Analysis",
        summary="Analyze impact before editing code",
        description_md="Use dependency and call graph to find impacted files.",
        tags=["graph", "impact", "refactor"],
        steps=["Build graph", "Compute impact", "Review risky symbols"],
    )

    assert record.name == "Blast Radius Analysis"
    assert record.skill_id.startswith("sk-")

    results = vault.search_skills("blast radius", top_k=5)
    assert any(item["name"] == "Blast Radius Analysis" for item in results)


def test_record_execution_updates_maturity(tmp_path: Path):
    vault = _make_vault(tmp_path)

    record = vault.add_skill(
        name="Execution Flow Tracing",
        summary="Trace call paths from entrypoint",
        description_md="Track call chain depth-by-depth.",
        tags=["trace", "flow"],
    )

    for _ in range(10):
        vault.record_execution(record.skill_id, successful=True)

    refreshed = vault.get_skill(record.skill_id)
    assert refreshed.maturity == "proven"
    assert refreshed.usage_count == 10
    assert refreshed.success_count == 10


def test_import_markdown_and_deep_research(tmp_path: Path):
    vault = _make_vault(tmp_path)

    skills_dir = tmp_path / "skills_src"
    skills_dir.mkdir(parents=True, exist_ok=True)

    (skills_dir / "kg.md").write_text(
        "# Knowledge Graph Build\n\n"
        "Build AST graph for repository level analysis.\n\n"
        "- Parse files\n"
        "- Extract dependencies\n"
        "- Save graph\n",
        encoding="utf-8",
    )
    (skills_dir / "wiki.md").write_text(
        "# Auto Wiki\n\n"
        "Generate markdown wiki from graph metadata.\n\n"
        "1. Group by module\n"
        "2. Render pages\n",
        encoding="utf-8",
    )

    result = vault.import_skills_from_markdown_dir(str(skills_dir))
    assert result["imported"] == 2
    assert result["failed_count"] == 0

    brief = vault.deep_research(topic="execution flow and dependencies", top_k=3)
    assert brief.topic == "execution flow and dependencies"
    assert len(brief.suggested_skills) >= 1
    assert len(brief.automation_plan) >= 3


def test_autonomous_rule_planning(tmp_path: Path):
    vault = _make_vault(tmp_path)

    record = vault.add_skill(
        name="Safe Refactor",
        summary="Run blast radius before synchronized rename",
        description_md="Use graph checks before multi-file refactor.",
        tags=["refactor", "blast-radius"],
    )

    vault.create_automation_rule(
        name="Refactor Guard",
        trigger_query="blast radius refactor",
        skill_ref=record.skill_id,
        priority=1,
    )

    plan = vault.plan_autonomous_task("Please do blast radius check before refactor", top_k=3)
    assert len(plan["matched_rules"]) >= 1
    assert len(plan["plan_steps"]) >= 4
