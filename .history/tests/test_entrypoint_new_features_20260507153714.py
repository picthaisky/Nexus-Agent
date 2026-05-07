"""Integration tests for new Knowledge Graph and Skill Vault API endpoints."""

from pathlib import Path

from fastapi.testclient import TestClient

import nexus_agent.entrypoint as entrypoint
from nexus_agent.core.skill_vault import SkillVault


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _create_repo(root: Path) -> None:
    _write(
        root / "app.py",
        "from service import run_service\n\n"
        "def main():\n"
        "    return run_service(21)\n",
    )
    _write(
        root / "service.py",
        "def run_service(value):\n"
        "    return value * 2\n",
    )


def test_kg_endpoints_build_trace_and_blast_radius(tmp_path: Path):
    repo_root = tmp_path / "repo"
    _create_repo(repo_root)

    # Reset cache to isolate test.
    entrypoint.KG_CACHE = None
    entrypoint.KG_CACHE_ROOT = None

    client = TestClient(entrypoint.app)

    build_resp = client.post(
        "/kg/build",
        json={"repo_root": str(repo_root), "include_tests": True},
    )
    assert build_resp.status_code == 200
    assert build_resp.json()["summary"]["module_count"] >= 2

    trace_resp = client.post(
        "/kg/trace",
        json={"entry_symbol": "app.main", "max_depth": 4},
    )
    assert trace_resp.status_code == 200
    assert any("app.main" in item for item in trace_resp.json()["visited_symbols"])

    blast_resp = client.post(
        "/kg/blast-radius",
        json={"changed_symbols": ["service.run_service"], "depth": 2},
    )
    assert blast_resp.status_code == 200
    assert any(path.endswith("service.py") for path in blast_resp.json()["impacted_files"])


def test_skill_endpoints_add_search_and_autonomous_plan(tmp_path: Path):
    entrypoint.skill_vault = SkillVault(db_path=str(tmp_path / "vault.db"))
    client = TestClient(entrypoint.app)

    add_resp = client.post(
        "/skills/add",
        json={
            "name": "Refactor Safety",
            "summary": "Analyze blast radius before changing identifiers",
            "description_md": "Use graph impact analysis before refactor.",
            "tags": ["refactor", "graph"],
            "steps": ["Build graph", "Analyze blast radius", "Apply refactor"],
        },
    )
    assert add_resp.status_code == 200
    assert add_resp.json()["name"] == "Refactor Safety"

    search_resp = client.post(
        "/skills/search",
        json={"query": "blast radius refactor", "top_k": 5},
    )
    assert search_resp.status_code == 200
    assert any(item["name"] == "Refactor Safety" for item in search_resp.json()["results"])

    plan_resp = client.post(
        "/skills/autonomous-plan",
        json={"task_text": "run blast radius check before refactor", "top_k": 3},
    )
    assert plan_resp.status_code == 200
    assert len(plan_resp.json()["plan_steps"]) >= 4

    def test_skill_import_github_endpoint_with_local_path(tmp_path: Path):
        entrypoint.skill_vault = SkillVault(db_path=tmp_path / "vault.db")

        skills_repo = tmp_path / "awesome-codex-skills"
        skills_repo.mkdir(parents=True, exist_ok=True)
        (skills_repo / "review.md").write_text(
            "# Review PR\n\n"
            "Checklist for pull request quality.\n\n"
            "- Run tests\n"
            "- Validate docs\n",
            encoding="utf-8",
        )

        response = client.post(
            "/skills/import-github",
            json={
                "repo_url": str(skills_repo),
                "source": "awesome-codex-skills",
                "default_tags": ["github", "checklist"],
            },
        )
        assert response.status_code == 200
        payload = response.json()

        assert payload["sync"]["mode"] == "local-path"
        assert payload["imported"] == 1
        assert payload["failed_count"] == 0
