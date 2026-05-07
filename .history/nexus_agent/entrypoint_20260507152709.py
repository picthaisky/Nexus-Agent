"""Nexus-Agent — FastAPI Entrypoint for Container Deployment.

Provides health, readiness, and info endpoints for Docker / Portainer
orchestration, plus a future-ready mount point for the agent API.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from nexus_agent.core.knowledge_graph_engine import KnowledgeGraphEngine, RepoGraph
from nexus_agent.core.skill_vault import SkillVault

# ── Application metadata ────────────────────────────────────────────────────
APP_NAME = "Nexus-Agent"
APP_VERSION = os.getenv("APP_VERSION", "0.1.0")
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")
START_TIME = time.monotonic()
DEFAULT_REPO_ROOT = os.getenv("NEXUS_REPO_ROOT", str(Path.cwd()))

kg_engine = KnowledgeGraphEngine()
skill_vault = SkillVault(db_path=os.getenv("SKILL_VAULT_DB", "nexus_skill_vault.db"))
KG_CACHE: RepoGraph | None = None
KG_CACHE_ROOT: str | None = None

# ── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Multi-AI Agent Orchestration System",
    docs_url="/docs" if ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if ENVIRONMENT != "production" else None,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BuildGraphRequest(BaseModel):
    repo_root: str | None = None
    include_tests: bool = True


class TraceFlowRequest(BaseModel):
    entry_symbol: str
    max_depth: int = Field(default=6, ge=1, le=20)


class BlastRadiusRequest(BaseModel):
    changed_symbols: list[str]
    depth: int = Field(default=2, ge=1, le=10)


class RefactorRequest(BaseModel):
    repo_root: str | None = None
    rename_map: dict[str, str]
    include_tests: bool = True
    apply_changes: bool = False


class WikiRequest(BaseModel):
    repo_root: str | None = None
    include_tests: bool = True
    output_dir: str = "docs/graph-wiki"


class SkillAddRequest(BaseModel):
    name: str
    summary: str
    description_md: str
    tags: list[str] = Field(default_factory=list)
    source: str = "manual"
    steps: list[str] = Field(default_factory=list)


class SkillImportRequest(BaseModel):
    directory: str
    source: str = "awesome-codex-skills"
    default_tags: list[str] = Field(default_factory=list)


class SkillSearchRequest(BaseModel):
    query: str
    tags: list[str] = Field(default_factory=list)
    top_k: int = Field(default=10, ge=1, le=50)


class SkillExecutionRequest(BaseModel):
    skill_ref: str
    successful: bool
    feedback: str = ""


class SkillResearchRequest(BaseModel):
    topic: str
    top_k: int = Field(default=5, ge=1, le=20)
    include_repo_signals: bool = True
    repo_root: str | None = None


class AutonomousPlanRequest(BaseModel):
    task_text: str
    top_k: int = Field(default=5, ge=1, le=20)


def _resolve_repo_root(repo_root: str | None) -> str:
    if repo_root and repo_root.strip():
        return str(Path(repo_root).resolve())
    return str(Path(DEFAULT_REPO_ROOT).resolve())


def _ensure_graph(repo_root: str | None, include_tests: bool = True) -> RepoGraph:
    global KG_CACHE
    global KG_CACHE_ROOT

    target_root = _resolve_repo_root(repo_root)
    if KG_CACHE is None or KG_CACHE_ROOT != target_root:
        KG_CACHE = kg_engine.build_repo_graph(repo_root=target_root, include_tests=include_tests)
        KG_CACHE_ROOT = target_root
    return KG_CACHE


# ── Health & Readiness ───────────────────────────────────────────────────────
@app.get("/health", tags=["ops"])
async def health_check():
    """Liveness probe — returns 200 if the process is running."""
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": APP_NAME,
            "version": APP_VERSION,
            "uptime_seconds": round(time.monotonic() - START_TIME, 2),
        },
    )


@app.get("/ready", tags=["ops"])
async def readiness_check():
    """Readiness probe — returns 200 when the service is ready to serve."""
    # TODO: add dependency checks (Redis, Postgres, inference engine)
    checks: dict[str, str] = {}

    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        checks["redis"] = "configured"

    postgres_url = os.getenv("DATABASE_URL")
    if postgres_url:
        checks["postgres"] = "configured"

    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        checks["inference"] = "configured"

    return JSONResponse(
        status_code=200,
        content={
            "status": "ready",
            "service": APP_NAME,
            "environment": ENVIRONMENT,
            "checks": checks,
        },
    )


@app.get("/info", tags=["ops"])
async def system_info():
    """Returns system metadata for monitoring & debugging."""
    return JSONResponse(
        status_code=200,
        content={
            "service": APP_NAME,
            "version": APP_VERSION,
            "environment": ENVIRONMENT,
            "python_version": sys.version,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "uptime_seconds": round(time.monotonic() - START_TIME, 2),
            "config": {
                "openai_base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                "openai_model": os.getenv("OPENAI_MODEL", "gpt-4"),
                "log_level": os.getenv("LOG_LEVEL", "INFO"),
                "workers": os.getenv("WEB_CONCURRENCY", "2"),
            },
        },
    )


# ── Root ─────────────────────────────────────────────────────────────────────
@app.get("/", tags=["root"])
async def root():
    """Root endpoint with service discovery links."""
    return {
        "service": APP_NAME,
        "version": APP_VERSION,
        "endpoints": {
            "health": "/health",
            "ready": "/ready",
            "info": "/info",
            "kg_build": "/kg/build",
            "skills_search": "/skills/search",
            "docs": "/docs" if ENVIRONMENT != "production" else "disabled",
        },
    }


# -- Knowledge Graph API -----------------------------------------------------
@app.post("/kg/build", tags=["knowledge-graph"])
async def kg_build(request: BuildGraphRequest):
    """Builds AST graph from repository and caches it in memory."""
    try:
        graph = _ensure_graph(repo_root=request.repo_root, include_tests=request.include_tests)
        return {
            "status": "ok",
            "repo_root": _resolve_repo_root(request.repo_root),
            "summary": graph.summary(),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/kg/trace", tags=["knowledge-graph"])
async def kg_trace(request: TraceFlowRequest):
    """Traces function call flow from entry symbol."""
    try:
        graph = _ensure_graph(repo_root=None)
        return kg_engine.trace_execution_flow(
            graph=graph,
            entry_symbol=request.entry_symbol,
            max_depth=request.max_depth,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/kg/blast-radius", tags=["knowledge-graph"])
async def kg_blast_radius(request: BlastRadiusRequest):
    """Computes blast radius for changed symbols before editing."""
    try:
        graph = _ensure_graph(repo_root=None)
        return kg_engine.analyze_blast_radius(
            graph=graph,
            changed_symbols=request.changed_symbols,
            depth=request.depth,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/kg/refactor", tags=["knowledge-graph"])
async def kg_refactor(request: RefactorRequest):
    """Plans or applies synchronized multi-file refactor operations."""
    global KG_CACHE
    global KG_CACHE_ROOT

    try:
        repo_root = _resolve_repo_root(request.repo_root)
        plan = kg_engine.plan_sync_refactor(
            repo_root=repo_root,
            rename_map=request.rename_map,
            include_tests=request.include_tests,
        )
        payload: dict[str, Any] = {
            "plan": plan.summary(),
            "applied": None,
        }

        if request.apply_changes:
            payload["applied"] = kg_engine.apply_refactor_plan(plan)
            KG_CACHE = kg_engine.build_repo_graph(repo_root=repo_root, include_tests=request.include_tests)
            KG_CACHE_ROOT = repo_root

        return payload
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/kg/wiki", tags=["knowledge-graph"])
async def kg_wiki(request: WikiRequest):
    """Generates automatic wiki pages from the repository graph."""
    try:
        graph = _ensure_graph(repo_root=request.repo_root, include_tests=request.include_tests)
        result = kg_engine.generate_wiki(graph=graph, output_dir=request.output_dir)
        return {
            "status": "ok",
            "wiki": result,
            "graph_summary": graph.summary(),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# -- Skill Vault API ---------------------------------------------------------
@app.post("/skills/add", tags=["skills"])
async def skills_add(request: SkillAddRequest):
    """Adds or updates one skill in persistent vault."""
    try:
        record = skill_vault.add_skill(
            name=request.name,
            summary=request.summary,
            description_md=request.description_md,
            tags=request.tags,
            source=request.source,
            steps=request.steps,
        )
        payload = asdict(record)
        payload["success_rate"] = record.success_rate
        return payload
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/skills/import", tags=["skills"])
async def skills_import(request: SkillImportRequest):
    """Imports markdown skill library directory into persistent vault."""
    try:
        return skill_vault.import_skills_from_markdown_dir(
            directory=request.directory,
            source=request.source,
            default_tags=request.default_tags,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/skills/search", tags=["skills"])
async def skills_search(request: SkillSearchRequest):
    """Searches skill memory with lexical relevance and tags."""
    try:
        return {
            "query": request.query,
            "results": skill_vault.search_skills(
                query=request.query,
                tags=request.tags,
                top_k=request.top_k,
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/skills/suggest", tags=["skills"])
async def skills_suggest(request: SkillSearchRequest):
    """Suggests best matching skills for a target task."""
    try:
        return {
            "task": request.query,
            "suggestions": skill_vault.suggest_skills_for_task(request.query, top_k=request.top_k),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/skills/execution", tags=["skills"])
async def skills_execution_feedback(request: SkillExecutionRequest):
    """Records skill execution outcome and updates maturity."""
    try:
        record = skill_vault.record_execution(
            skill_ref=request.skill_ref,
            successful=request.successful,
            feedback=request.feedback,
        )
        payload = asdict(record)
        payload["success_rate"] = record.success_rate
        return payload
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/skills/research", tags=["skills"])
async def skills_research(request: SkillResearchRequest):
    """Builds local deep research brief from skill vault and optional repo graph."""
    try:
        graph = _ensure_graph(repo_root=request.repo_root) if request.include_repo_signals else None
        brief = skill_vault.deep_research(
            topic=request.topic,
            top_k=request.top_k,
            repo_graph=graph,
        )
        return asdict(brief)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/skills/autonomous-plan", tags=["skills"])
async def skills_autonomous_plan(request: AutonomousPlanRequest):
    """Generates autonomous human-like task plan from persistent skill memory."""
    try:
        return skill_vault.plan_autonomous_task(task_text=request.task_text, top_k=request.top_k)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
