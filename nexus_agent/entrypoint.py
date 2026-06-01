"""Nexus-Agent — FastAPI Entrypoint for Container Deployment.

Provides health, readiness, and info endpoints for Docker / Portainer
orchestration, plus a future-ready mount point for the agent API.
"""

from __future__ import annotations

import os
import sys
import time
import asyncio
import logging
import warnings
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler

from nexus_agent.core.knowledge_graph_engine import KnowledgeGraphEngine, RepoGraph
from nexus_agent.core.skill_vault import SkillVault
from nexus_agent.core.dashboard_hub import dashboard_hub
from nexus_agent.core.task_store import task_store
from nexus_agent.core.inference import InferenceEngine
from nexus_agent.core.observability import metrics_registry, HardwareMonitor
from nexus_agent.core.state import AgentMicroState
from nexus_agent.core.settings import get_settings
from nexus_agent.core.security import (
    Principal,
    require_admin,
    require_api_key,
    verify_ws_token,
)
from nexus_agent.core.middleware import (
    AccessLogMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
)
from nexus_agent.core.logging_config import configure_logging
from nexus_agent.core.rate_limit import limiter
from nexus_agent.core.metrics import (
    PrometheusMiddleware,
    metrics_endpoint,
    record_inference_call,
)
from nexus_agent.core.cost import estimate_cost
from nexus_agent.core.sentry_init import init_sentry

# ── Application metadata ────────────────────────────────────────────────────
settings = get_settings()
configure_logging(level=settings.log_level, json_logs=settings.json_logs)
init_sentry()

APP_NAME = settings.app_name
APP_VERSION = settings.app_version
ENVIRONMENT = settings.environment
START_TIME = time.monotonic()
DEFAULT_REPO_ROOT = os.getenv("NEXUS_REPO_ROOT", str(Path.cwd()))

kg_engine = KnowledgeGraphEngine()
skill_vault = SkillVault(db_path=os.getenv("SKILL_VAULT_DB", "nexus_skill_vault.db"))
inference_engine: InferenceEngine | None = None


def get_inference_engine() -> InferenceEngine:
    """Lazy-init the inference engine after env vars are loaded."""
    global inference_engine
    if inference_engine is None:
        inference_engine = InferenceEngine()
    return inference_engine


KG_CACHE: RepoGraph | None = None
KG_CACHE_ROOT: str | None = None

# ── Server Events ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle events."""
    # Startup
    dashboard_hub.set_loop(asyncio.get_running_loop())
    
    yield
    
    # Shutdown
    logger = logging.getLogger("nexus.shutdown")
    try:
        await dashboard_hub.broadcast_event(
            "system.shutdown",
            {"message": "server shutting down"},
        )
        await dashboard_hub.disconnect_all()
    except Exception as exc:  # pragma: no cover — best-effort
        logger.warning("dashboard_drain_failed", extra={"error": str(exc)})

    try:
        from nexus_agent.core.database import get_engine

        get_engine().dispose()
    except Exception as exc:  # pragma: no cover
        logger.warning("db_dispose_failed", extra={"error": str(exc)})

    logger.info("shutdown_complete")

# ── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Multi-AI Agent Orchestration System",
    docs_url="/docs" if ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if ENVIRONMENT != "production" else None,
    lifespan=lifespan,
)

# ── Middleware stack (order matters — outermost first) ──────────────────────
app.add_middleware(AccessLogMiddleware)
app.add_middleware(SecurityHeadersMiddleware, enable_hsts=settings.is_production)
app.add_middleware(RequestIdMiddleware)
if settings.metrics_enabled:
    app.add_middleware(PrometheusMiddleware)
    app.add_route("/metrics", metrics_endpoint, include_in_schema=False)
if settings.rate_limit_enabled:
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ─────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = settings.cors_origins or ["*"]
if settings.is_production and ALLOWED_ORIGINS == ["*"]:
    # Refuse the dangerous wildcard in production — force operator to be explicit.
    warnings.warn(
        "CORS_ORIGINS='*' in production; set an allow-list of trusted origins.",
        stacklevel=2,
    )
is_wildcard = "*" in ALLOWED_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if not is_wildcard else [],
    allow_origin_regex=r".*" if is_wildcard else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Request-ID"],
)


class RunTaskRequest(BaseModel):
    goal: str


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


class SkillImportGitHubRequest(BaseModel):
    repo_url: str
    branch: str = "main"
    source: str = "awesome-codex-skills"
    default_tags: list[str] = Field(default_factory=list)
    cache_dir: str | None = None
    shallow_clone: bool = True


class SkillSearchRequest(BaseModel):
    query: str
    tags: list[str] = Field(default_factory=list)
    top_k: int = Field(default=10, ge=1, le=50)


class SkillExecutionRequest(BaseModel):
    skill_ref: str
    successful: bool
    feedback: str = ""



class InferenceRequest(BaseModel):
    messages: list[dict[str, str]] = Field(
        ..., description="OpenAI-style chat messages: [{role, content}, ...]"
    )
    provider: str | None = Field(
        default=None,
        description="Force a specific provider (e.g. 'openai', 'claude', 'gemini', 'local'). Omit to use the fallback chain.",
    )
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=1024, ge=1, le=32768)


class AgentEmitRequest(BaseModel):
    """Manually push an agent state change to the dashboard (testing / external use)."""

    agent_id: str
    micro_state: AgentMicroState
    status_message: str = ""
    exp_delta: int = 0

class SkillResearchRequest(BaseModel):
    topic: str
    top_k: int = Field(default=5, ge=1, le=20)
    include_repo_signals: bool = True
    repo_root: str | None = None


class AutonomousPlanRequest(BaseModel):
    task_text: str
    top_k: int = Field(default=5, ge=1, le=20)


class AgentspaceSearchRequest(BaseModel):
    query: str


class FinanceRequest(BaseModel):
    task: str


class ContentRequest(BaseModel):
    topic: str


class ConnectRepoRequest(BaseModel):
    repo_url: str
    branch: str = "main"


class RosterAddRequest(BaseModel):
    agent_id: str
    role: str
    display_name: str


class RosterUpdateRequest(BaseModel):
    agent_id: str
    display_name: str


class ArchiveDocRequest(BaseModel):
    filename: str
    title: str
    content: str


ACTIVE_REPO_INFO = {
    "repo_url": "",
    "branch": "main",
    "local_path": DEFAULT_REPO_ROOT,
    "status": "local"
}

# Repos are now persisted via task_store.connected_repos (SQLite)


def _resolve_repo_root(repo_root: str | None) -> str:
    if repo_root and repo_root.strip():
        return str(Path(repo_root).resolve())
    return str(Path(ACTIVE_REPO_INFO["local_path"]).resolve())


def _ensure_graph(repo_root: str | None, include_tests: bool = True) -> RepoGraph:
    global KG_CACHE
    global KG_CACHE_ROOT

    if repo_root is None and KG_CACHE is not None:
        return KG_CACHE

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
    """Readiness probe — returns 200 only when all configured dependencies are healthy."""
    from sqlalchemy import text  # local import to keep cold-start light

    from nexus_agent.core.database import get_engine
    from nexus_agent.core.redis_client import ping_redis

    checks: dict[str, str] = {}
    healthy = True

    # Postgres
    if settings.database_url:
        try:
            with get_engine().connect() as conn:
                conn.execute(text("SELECT 1"))
            checks["postgres"] = "ok"
        except Exception as exc:
            checks["postgres"] = f"error: {exc.__class__.__name__}"
            healthy = False

    # Redis
    if settings.redis_url:
        if await ping_redis():
            checks["redis"] = "ok"
        else:
            checks["redis"] = "error"
            healthy = False

    # LLM provider checks — fast key-existence check + optional ping
    any_llm = False
    if settings.openai_api_key and settings.openai_api_key not in ("", "sk-your-openai-api-key-here"):
        checks["openai"] = "configured"
        any_llm = True
    if settings.anthropic_api_key:
        checks["claude"] = "configured"
        any_llm = True
    if settings.gemini_api_key or os.getenv("GOOGLE_API_KEY"):
        checks["gemini"] = "configured"
        any_llm = True
    if settings.vllm_enabled:
        checks["vllm_local"] = "configured"
        any_llm = True
    if not any_llm:
        checks["llm_providers"] = "warning: no LLM provider configured — inference will fail"

    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "status": "ready" if healthy else "degraded",
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
                "anthropic_model": os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20240620"),
                "gemini_model": os.getenv("GEMINI_MODEL", "gemini-1.5-flash"),
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
            "skills_import_github": "/skills/import-github",
            "inference_providers": "/inference/providers",
            "inference_generate": "/inference/generate",
            "dashboard_snapshot": "/dashboard/snapshot",
            "dashboard_metrics": "/dashboard/metrics",
            "dashboard_ws": "/ws/dashboard",
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


@app.post("/skills/import-github", tags=["skills"])
async def skills_import_github(request: SkillImportGitHubRequest):
    """Imports markdown skill library from GitHub or a local git directory."""
    try:
        return skill_vault.import_skills_from_github(
            repo_url=request.repo_url,
            branch=request.branch,
            source=request.source,
            default_tags=request.default_tags,
            cache_dir=request.cache_dir,
            shallow_clone=request.shallow_clone,
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


# -- Multi-Provider Inference API -------------------------------------------
@app.get("/inference/providers", tags=["inference"])
async def inference_providers(_: Principal = Depends(require_api_key)):
    """List active LLM providers (OpenAI / Claude / Gemini / local / ...)."""
    try:
        return {"providers": get_inference_engine().list_providers()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/inference/generate", tags=["inference"])
@limiter.limit(settings.rate_limit_inference)
async def inference_generate(
    request: Request,
    payload: InferenceRequest,
    principal: Principal = Depends(require_api_key),
):
    """Send a chat-completion request through the configured provider chain."""
    request_id = getattr(request.state, "request_id", "")
    start = time.perf_counter()
    try:
        result = get_inference_engine().generate_detailed(
            payload.messages,
            temperature=payload.temperature,
            max_tokens=payload.max_tokens,
            provider=payload.provider,
        )
    except Exception as exc:
        elapsed = time.perf_counter() - start
        record_inference_call(
            provider=payload.provider or "auto",
            model="unknown",
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            latency_seconds=elapsed,
            error=exc.__class__.__name__,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    elapsed = time.perf_counter() - start
    cost = estimate_cost(result.model, result.tokens_in, result.tokens_out)
    record_inference_call(
        provider=result.provider,
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        cost_usd=cost.total_usd,
        latency_seconds=elapsed,
    )
    return {
        "content": result.content,
        "provider": result.provider,
        "model": result.model,
        "tokens_in": result.tokens_in,
        "tokens_out": result.tokens_out,
        "cost_usd": round(cost.total_usd, 6),
        "latency_ms": round(elapsed * 1000.0, 2),
        "request_id": request_id,
    }


# -- Agentspace API ---------------------------------------------------------
@app.post("/agentspace/search", tags=["agentspace"])
async def agentspace_search(
    request: AgentspaceSearchRequest,
    principal: Principal = Depends(require_api_key),
):
    """Run a search query through the SearchAgent."""
    try:
        from nexus_agent.core.orchestrator import Orchestrator
        # Instantiate orchestrator on the fly or we should use a global one.
        # But wait, we don't have a global orchestrator in entrypoint.
        # Let's just create one for this single run to stay stateless.
        orch = Orchestrator()
        result = orch.run_search({"query": request.query})
        
        # result is an AgentspaceSearchResult
        from dataclasses import asdict
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/finance/analyze", tags=["specialist"])
async def finance_analyze(
    request: FinanceRequest,
    principal: Principal = Depends(require_api_key),
):
    """Run a finance analysis task through the FinanceAgent."""
    try:
        from nexus_agent.core.orchestrator import Orchestrator
        orch = Orchestrator()
        result = orch.run_finance({"task": request.task})
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/content/generate", tags=["specialist"])
async def content_generate(
    request: ContentRequest,
    principal: Principal = Depends(require_api_key),
):
    """Run a content creation task through the ContentCreatorAgent."""
    try:
        from nexus_agent.core.orchestrator import Orchestrator
        orch = Orchestrator()
        result = orch.run_content({"topic": request.topic})
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# -- Cyber-Thai Command Center: Dashboard API -------------------------------
@app.get("/dashboard/snapshot", tags=["dashboard"])
async def dashboard_snapshot():
    """Return the current per-agent runtime state snapshot."""
    return dashboard_hub.snapshot()


@app.get("/dashboard/metrics", tags=["dashboard"])
async def dashboard_metrics():
    """Return aggregated per-agent metrics + GPU stats for the dashboard."""
    return {
        "agents": metrics_registry.snapshot(),
        "hardware": HardwareMonitor.get_gpu_metrics(),
    }


@app.post("/dashboard/emit", tags=["dashboard"])
async def dashboard_emit(
    request: AgentEmitRequest,
    _: Principal = Depends(require_admin),
):
    """Manually emit an agent-state event (handy for demos & integration tests)."""
    state = dashboard_hub.get_state(request.agent_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent_id '{request.agent_id}'")
    await dashboard_hub.emit_state(
        agent_id=request.agent_id,
        role=state.role,
        micro_state=request.micro_state,
        status_message=request.status_message,
        exp_delta=request.exp_delta,
    )
    return {"status": "ok", "agent_id": request.agent_id}


@app.websocket("/ws/dashboard")
async def ws_dashboard(
    websocket: WebSocket,
    _: Principal = Depends(verify_ws_token),
):
    """Real-time event stream consumed by the Cyber-Thai Command Center UI."""
    await dashboard_hub.connect(websocket)
    try:
        while True:
            # We only push; ignore incoming text but keep the socket alive.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await dashboard_hub.disconnect(websocket)


# -- Workspace Settings & Config APIs ----------------------------------------

@app.post("/repo/connect", tags=["repo"])
async def connect_repo(request: ConnectRepoRequest):
    """Clone or connect a GitHub repository and rebuild the Knowledge Graph."""
    import shutil
    import subprocess
    import re
    import hashlib
    from pathlib import Path
    global KG_CACHE
    global KG_CACHE_ROOT

    url = request.repo_url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Repository URL must not be empty")

    # Derive a local folder name in the repos directory
    suffix = url.rstrip("/").split("/")[-1]
    suffix = suffix[:-4] if suffix.endswith(".git") else suffix
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", suffix).strip("-") or "repo"
    
    repos_dir = Path("repos").resolve()
    repos_dir.mkdir(parents=True, exist_ok=True)
    
    # Add a digest to avoid collisions
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    local_path = repos_dir / f"{safe_name}-{digest}"

    git_binary = shutil.which("git")
    if not git_binary:
        raise HTTPException(status_code=500, detail="Git binary not found on the server path")

    try:
        if local_path.exists() and (local_path / ".git").exists():
            # Repo exists: fetch then checkout (create tracking branch if not yet local)
            subprocess.run([git_binary, "-C", str(local_path), "fetch", "--all"], check=True, capture_output=True)
            checkout_result = subprocess.run(
                [git_binary, "-C", str(local_path), "checkout", request.branch],
                capture_output=True,
            )
            if checkout_result.returncode != 0:
                # Branch only exists on remote — create a local tracking branch
                subprocess.run(
                    [git_binary, "-C", str(local_path), "checkout", "-b", request.branch, f"origin/{request.branch}"],
                    check=True, capture_output=True,
                )
            subprocess.run([git_binary, "-C", str(local_path), "pull", "origin", request.branch], check=True, capture_output=True)
        else:
            # Clone it
            if local_path.exists():
                shutil.rmtree(local_path)
            subprocess.run([git_binary, "clone", "--depth", "1", "--branch", request.branch, url, str(local_path)], check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        err = exc.stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(status_code=400, detail=f"Git operation failed: {err}")

    # Update active repo state
    ACTIVE_REPO_INFO["repo_url"] = url
    ACTIVE_REPO_INFO["branch"] = request.branch
    ACTIVE_REPO_INFO["local_path"] = str(local_path)
    ACTIVE_REPO_INFO["status"] = "connected"
    ACTIVE_REPO_INFO["repo_id"] = digest

    # Persist into SQLite connected-repos registry
    task_store.upsert_repo(
        repo_id=digest,
        repo_url=url,
        branch=request.branch,
        local_path=str(local_path),
        status="connected",
    )

    # Build the Knowledge Graph on the newly connected repo
    try:
        graph = _ensure_graph(repo_root=str(local_path), include_tests=True)
        summary = graph.summary()
    except Exception as exc:
        summary = {"error": f"Failed to build KG: {str(exc)}"}

    return {
        "status": "connected",
        "repo_url": url,
        "branch": request.branch,
        "local_path": str(local_path),
        "repo_id": digest,
        "graph_summary": summary,
    }


@app.get("/repo/active", tags=["repo"])
async def get_active_repo():
    """Returns details of the currently active repository."""
    return ACTIVE_REPO_INFO


@app.get("/repo/list", tags=["repo"])
async def list_repos():
    """Returns all repositories that have been connected this session."""
    active_id = ACTIVE_REPO_INFO.get("repo_id", "")
    return {
        "repos": [
            {**r, "is_active": r["repo_id"] == active_id}
            for r in task_store.list_repos()
        ]
    }


@app.post("/repo/activate/{repo_id}", tags=["repo"])
async def activate_repo(repo_id: str):
    """Switch the active repo to a previously connected one (no re-clone needed)."""
    entry = task_store.get_repo(repo_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"No connected repo with id '{repo_id}'")

    ACTIVE_REPO_INFO.update({
        "repo_id": entry["repo_id"],
        "repo_url": entry["repo_url"],
        "branch": entry["branch"],
        "local_path": entry["local_path"],
        "status": entry["status"],
    })

    # Re-point Knowledge Graph cache
    try:
        graph = _ensure_graph(repo_root=entry["local_path"], include_tests=True)
        summary = graph.summary()
    except Exception as exc:
        summary = {"error": str(exc)}

    return {"status": "activated", **entry, "graph_summary": summary}


@app.delete("/repo/{repo_id}", tags=["repo"])
async def remove_repo(repo_id: str, delete_local: bool = False):
    """Remove a repo from the connected-repos list (optionally delete local clone)."""
    import shutil as _shutil
    entry = task_store.get_repo(repo_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"No connected repo with id '{repo_id}'")

    task_store.delete_repo(repo_id)

    if delete_local:
        local = Path(entry["local_path"])
        if local.exists():
            _shutil.rmtree(local, ignore_errors=True)

    # If this was the active repo, reset to local mode
    if ACTIVE_REPO_INFO.get("repo_id") == repo_id:
        ACTIVE_REPO_INFO.update({
            "repo_id": "",
            "repo_url": "",
            "branch": "main",
            "local_path": DEFAULT_REPO_ROOT,
            "status": "local",
        })

    return {"status": "removed", "repo_id": repo_id, "deleted_local": delete_local}


@app.get("/skills", tags=["skills"])
async def list_skills():
    """List all skills in the persistent vault."""
    try:
        skills = skill_vault.list_skills(limit=250)
        return {"skills": [asdict(s) for s in skills]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/skills/{skill_id}", tags=["skills"])
async def delete_skill_endpoint(skill_id: str):
    """Delete a skill from the persistent vault by ID."""
    try:
        skill_vault.delete_skill(skill_id)
        return {"status": "deleted", "skill_id": skill_id}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/dashboard/roster", tags=["dashboard"])
async def get_roster():
    """Returns all agents registered in the dashboard roster."""
    return {
        "agents": [s.model_dump(mode="json") for s in dashboard_hub._states.values()]
    }


@app.post("/dashboard/roster/add", tags=["dashboard"])
async def add_roster_agent(request: RosterAddRequest):
    """Dynamically register a new agent in the dashboard roster."""
    from nexus_agent.core.models import AgentRole
    try:
        # Find matching role enum
        role_enum = None
        for r in AgentRole:
            if r.value == request.role:
                role_enum = r
                break
        if role_enum is None:
            role_enum = AgentRole.DEVELOPER
        
        await dashboard_hub.add_agent(
            agent_id=request.agent_id.strip(),
            role=role_enum,
            display_name=request.display_name.strip()
        )
        return {"status": "ok", "agent_id": request.agent_id}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/dashboard/roster/update", tags=["dashboard"])
async def update_roster_agent(request: RosterUpdateRequest):
    """Update display details of an agent in the dashboard roster."""
    try:
        await dashboard_hub.update_agent(
            agent_id=request.agent_id.strip(),
            display_name=request.display_name.strip()
        )
        return {"status": "ok", "agent_id": request.agent_id}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/dashboard/roster/{agent_id}", tags=["dashboard"])
async def delete_roster_agent(agent_id: str):
    """Remove an agent from the dashboard roster."""
    try:
        await dashboard_hub.delete_agent(agent_id)
        return {"status": "deleted", "agent_id": agent_id}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/docs/archive", tags=["docs"])
async def archive_doc(request: ArchiveDocRequest):
    """Saves a Markdown document inside docs/archive/."""
    from pathlib import Path
    filename = request.filename.strip()
    if not filename.endswith(".md"):
        filename += ".md"
    
    archive_dir = Path("docs/archive").resolve()
    archive_dir.mkdir(parents=True, exist_ok=True)
    
    filepath = archive_dir / filename
    try:
        content = request.content
        if not content.startswith("#"):
            content = f"# {request.title}\n\n{content}"
        
        filepath.write_text(content, encoding="utf-8")
        return {
            "status": "archived",
            "filename": filename,
            "path": str(filepath)
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/docs/archive", tags=["docs"])
async def list_archived_docs():
    """Lists all archived Markdown documents in the system."""
    from pathlib import Path
    archive_dir = Path("docs/archive").resolve()
    if not archive_dir.exists() or not archive_dir.is_dir():
        return {"documents": []}
    
    docs = []
    for f in archive_dir.glob("*.md"):
        try:
            content = f.read_text(encoding="utf-8")
            title = f.stem.replace("-", " ").replace("_", " ").title()
            for line in content.splitlines():
                if line.strip().startswith("#"):
                    title = line.lstrip("#").strip()
                    break
            
            stat = f.stat()
            docs.append({
                "filename": f.name,
                "title": title,
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
            })
        except Exception:
            pass
    return {"documents": docs}


@app.get("/docs/archive/{filename}", tags=["docs"])
async def get_archived_doc(filename: str):
    """Retrieves the title and content of an archived Markdown document."""
    from pathlib import Path
    archive_dir = Path("docs/archive").resolve()
    filepath = archive_dir / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Document not found")
    
    try:
        content = filepath.read_text(encoding="utf-8")
        title = filepath.stem.replace("-", " ").replace("_", " ").title()
        for line in content.splitlines():
            if line.strip().startswith("#"):
                title = line.lstrip("#").strip()
                break
        return {
            "filename": filename,
            "title": title,
            "content": content
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/docs/archive/{filename}", tags=["docs"])
async def delete_archived_doc(filename: str):
    """Deletes an archived Markdown document."""
    from pathlib import Path
    archive_dir = Path("docs/archive").resolve()
    filepath = archive_dir / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="Document not found")
    
    try:
        filepath.unlink()
        return {"status": "deleted", "filename": filename}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -- Orchestrator API --------------------------------------------------------

import uuid as _uuid
from datetime import datetime as _dt, timezone as _tz


def _run_orchestrator(goal: str, task_id: str) -> None:
    """Synchronous background runner for the LangGraph Orchestrator.

    Emits log immediately so the dashboard always gets feedback, even if the
    orchestrator import or initialisation fails.
    """
    import traceback
    from nexus_agent.core.state import AgentMicroState as _AMS
    from nexus_agent.core.models import AgentRole as _AR

    logger_ = logging.getLogger("nexus.orchestrator.runner")

    # Agent IDs in the default roster (must stay in sync with DashboardHub.DEFAULT_ROSTER)
    _ROSTER_AGENTS = [
        ("planner",   _AR.PLANNER,             _AMS.PLANNING),
        ("architect",  _AR.TECHNICAL_ARCHITECT, _AMS.DESIGNING),
        ("developer",  _AR.DEVELOPER,           _AMS.CODING),
        ("ui_weaver",  _AR.UI_WEAVER,           _AMS.DESIGNING),
        ("validator",  _AR.VALIDATOR,           _AMS.TESTING),
        ("optimizer",  _AR.AUTONOMOUS_OPTIMIZER,_AMS.OPTIMIZING),
    ]

    def _emit_all_agents(micro_state: _AMS, message: str) -> None:
        for aid, role, _ in _ROSTER_AGENTS:
            dashboard_hub.emit_state_threadsafe(
                agent_id=aid, role=role,
                micro_state=micro_state,
                status_message=message,
            )

    # Update registry: running
    task_store.update_task(task_id, status="running", started_at=_dt.now(_tz.utc).isoformat())

    # Broadcast immediately — before any imports that might fail
    dashboard_hub.emit_log_threadsafe(
        f"[TASK:{task_id[:8]}] เริ่มต้นงาน: {goal[:80]}{'...' if len(goal) > 80 else ''}",
        agent_id="system",
    )
    # Signal all agents: task started
    _emit_all_agents(_AMS.THINKING, f"Task: {goal[:60]}")

    try:
        from nexus_agent.core.orchestrator import Orchestrator  # lazy to catch ImportError
        orch = Orchestrator()
        logger_.info("Orchestrator initialised for task %s", task_id)
        dashboard_hub.emit_log_threadsafe(
            f"[TASK:{task_id[:8]}] Orchestrator พร้อมทำงาน — กำลังวิเคราะห์...",
            agent_id="system",
        )
        orch.run_task(goal)
        logger_.info("Orchestrator finished task %s", task_id)
        dashboard_hub.emit_log_threadsafe(
            f"[TASK:{task_id[:8]}] ✅ Task สำเร็จ!", agent_id="system"
        )
        task_store.update_task(task_id, status="completed", finished_at=_dt.now(_tz.utc).isoformat())
        # Reset all agents to IDLE
        _emit_all_agents(_AMS.COMPLETED, "Task completed ✅")
    except Exception as exc:
        tb = traceback.format_exc()
        logger_.error("Orchestrator failed task %s: %s\n%s", task_id, exc, tb)
        short_err = str(exc)[:200]
        dashboard_hub.emit_log_threadsafe(
            f"[TASK:{task_id[:8]}] ❌ ล้มเหลว: {short_err}", agent_id="system"
        )
        task_store.update_task(
            task_id,
            status="failed",
            error=str(exc),
            traceback=tb[:1000],
            finished_at=_dt.now(_tz.utc).isoformat(),
        )
        # Reset all agents to ERROR then IDLE
        _emit_all_agents(_AMS.ERROR, f"Task failed: {short_err[:60]}")


@app.post("/tasks/run", tags=["orchestrator"])
async def run_task(
    request: RunTaskRequest,
    background_tasks: BackgroundTasks,
    _: Principal = Depends(require_api_key),
):
    """Submits a task to the Orchestrator for background execution."""
    task_id = str(_uuid.uuid4())
    task_store.create_task(task_id=task_id, goal=request.goal)
    background_tasks.add_task(_run_orchestrator, request.goal, task_id)
    return {"status": "accepted", "goal": request.goal, "task_id": task_id}


@app.get("/tasks", tags=["orchestrator"])
async def list_tasks(_: Principal = Depends(require_api_key)):
    """Returns all tasks (newest first, persisted across restarts)."""
    return {"tasks": task_store.list_tasks()}


@app.get("/tasks/{task_id}", tags=["orchestrator"])
async def get_task(task_id: str, _: Principal = Depends(require_api_key)):
    """Returns status and details for a specific task."""
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return task


@app.post("/tasks/{task_id}/cancel", tags=["orchestrator"])
async def cancel_task(task_id: str, _: Principal = Depends(require_api_key)):
    """Mark a queued/running task as cancelled.

    Note: background threads cannot be force-killed in Python — this marks the
    task as cancelled in the registry so the UI can reflect the state. The
    background worker will still run to completion unless it checks the status.
    """
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    if task["status"] in ("completed", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Task already in terminal state: {task['status']}")

    task_store.update_task(
        task_id,
        status="cancelled",
        finished_at=_dt.now(_tz.utc).isoformat(),
        error="Cancelled by user",
    )
    dashboard_hub.emit_log_threadsafe(
        f"[TASK:{task_id[:8]}] 🚫 Task ถูกยกเลิกโดยผู้ใช้", agent_id="system"
    )
    return {"status": "cancelled", "task_id": task_id}
