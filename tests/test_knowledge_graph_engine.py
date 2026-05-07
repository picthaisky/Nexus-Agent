"""Tests for the KnowledgeGraphEngine."""

from pathlib import Path

from nexus_agent.core.knowledge_graph_engine import KnowledgeGraphEngine


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _create_sample_repo(root: Path) -> None:
    _write(
        root / "app.py",
        "from utils.helpers import helper\n"
        "from service import run_service\n\n"
        "def main():\n"
        "    data = helper()\n"
        "    return run_service(data)\n",
    )
    _write(
        root / "service.py",
        "def run_service(data):\n"
        "    return process(data)\n\n"
        "def process(value):\n"
        "    return value * 2\n",
    )
    _write(
        root / "utils" / "__init__.py", "")
    _write(
        root / "utils" / "helpers.py",
        "def helper():\n"
        "    return 21\n",
    )


def test_build_graph_and_trace_flow(tmp_path: Path):
    _create_sample_repo(tmp_path)
    engine = KnowledgeGraphEngine()

    graph = engine.build_repo_graph(str(tmp_path))
    summary = graph.summary()

    assert summary["module_count"] >= 3
    assert summary["function_count"] >= 4

    trace = engine.trace_execution_flow(graph=graph, entry_symbol="app.main", max_depth=4)
    visited = "\n".join(trace["visited_symbols"])

    assert "app.main" in visited
    assert "service.run_service" in visited


def test_blast_radius_detects_related_symbols(tmp_path: Path):
    _create_sample_repo(tmp_path)
    engine = KnowledgeGraphEngine()

    graph = engine.build_repo_graph(str(tmp_path))
    blast = engine.analyze_blast_radius(
        graph=graph,
        changed_symbols=["service.process"],
        depth=2,
    )

    impacted = "\n".join(blast["impacted_symbols"])
    assert "service.process" in impacted
    assert "service.run_service" in impacted
    assert any(file_path.endswith("service.py") for file_path in blast["impacted_files"])


def test_refactor_plan_and_apply_sync(tmp_path: Path):
    _create_sample_repo(tmp_path)
    engine = KnowledgeGraphEngine()

    plan = engine.plan_sync_refactor(
        repo_root=str(tmp_path),
        rename_map={"process": "transform_data"},
    )

    assert plan.total_replacements >= 1
    assert any(change.file_path == "service.py" for change in plan.changes)

    apply_result = engine.apply_refactor_plan(plan)
    assert apply_result["applied_files"] >= 1

    service_content = (tmp_path / "service.py").read_text(encoding="utf-8")
    assert "def transform_data(value):" in service_content
    assert "return transform_data(data)" in service_content


def test_generate_wiki_outputs_markdown(tmp_path: Path):
    _create_sample_repo(tmp_path)
    engine = KnowledgeGraphEngine()

    graph = engine.build_repo_graph(str(tmp_path))
    output_dir = tmp_path / "wiki"
    result = engine.generate_wiki(graph=graph, output_dir=str(output_dir))

    assert result["module_pages"] >= 1
    assert (output_dir / "index.md").exists()
    assert any(name.startswith("module_") for name in result["files_created"])
