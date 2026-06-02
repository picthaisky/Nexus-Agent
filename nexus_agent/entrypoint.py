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

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect
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

# All persistent data lives under NEXUS_DATA_DIR (mounted Docker volume /app/data).
# Falls back to cwd so local dev still works without any env vars.
_DATA_DIR = Path(os.getenv("NEXUS_DATA_DIR", str(Path.cwd())))
_DATA_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_REPO_ROOT = os.getenv("NEXUS_REPO_ROOT", str(_DATA_DIR / "repos"))
NEXUS_DOCS_DIR    = Path(os.getenv("NEXUS_DOCS_DIR", str(_DATA_DIR / "docs")))

kg_engine = KnowledgeGraphEngine()
skill_vault = SkillVault(db_path=os.getenv("SKILL_VAULT_DB", str(_DATA_DIR / "nexus_skill_vault.db")))
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
    try:
        from nexus_agent.core.scheduler import start_scheduler
        start_scheduler()
    except Exception as _sch_exc:
        logging.getLogger("nexus.startup").warning("Scheduler init failed: %s", _sch_exc)
    
    yield

    # Shutdown
    try:
        from nexus_agent.core.scheduler import stop_scheduler
        stop_scheduler()
    except Exception:
        pass
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
    priority: int = Field(default=3, ge=1, le=5)  # 1=highest, 5=lowest


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


# ── New Specialist Agent Request Models ───────────────────────────────────────

class CodeReviewRequest(BaseModel):
    target: str
    context: str = ""

class DebugRequest(BaseModel):
    error: str
    context: str = ""

class QATestRequest(BaseModel):
    target: str
    framework: str = "pytest"

class DBArchitectRequest(BaseModel):
    task: str
    db_type: str = "PostgreSQL"

class DevOpsRequest(BaseModel):
    task: str
    stack: str = "Python/FastAPI"

class DataAnalyticsRequest(BaseModel):
    task: str

class ProjectManagerRequest(BaseModel):
    project: str
    context: str = ""

class SecurityAuditRequest(BaseModel):
    target: str
    scope: str = "application code"

class TaskTemplateCreate(BaseModel):
    name: str
    category: str = "general"
    description: str = ""
    goal_template: str
    tags: list[str] = Field(default_factory=list)


# ── New infrastructure request models ─────────────────────────────────────────

class StreamRequest(BaseModel):
    messages: list[dict[str, str]]
    provider: str | None = None
    temperature: float = 0.7
    max_tokens: int = 2048
    system: str = ""


class RAGRequest(BaseModel):
    question: str
    top_k: int = 5
    doc_id: str | None = None


class APIIntegrationRequest(BaseModel):
    task: str
    test_url: str = ""
    auth_type: str = "bearer_token"


class SchedulerJobCreate(BaseModel):
    name: str
    goal_template: str
    cron_expr: str  # e.g. "0 9 * * 1-5"
    timezone: str = "Asia/Bangkok"
    tags: list[str] = Field(default_factory=list)


class NotificationTestRequest(BaseModel):
    channel: str = "email"  # "email" | "line"
    to: str = ""


class PromptVersionCreate(BaseModel):
    agent_role: str
    name: str
    content: str
    notes: str = ""


class WorkspaceCreate(BaseModel):
    name: str
    description: str = ""


class WorkspaceKeyCreate(BaseModel):
    workspace_id: str
    label: str
    permission: str = "operator"  # viewer | operator | admin


class WebhookCreate(BaseModel):
    name: str
    goal_template: str


class ChatSessionCreate(BaseModel):
    title: str = "New Chat"
    agent_role: str = "planner"


class ChatMessageRequest(BaseModel):
    content: str
    stream: bool = False


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


# ── New Specialist Agent Endpoints ───────────────────────────────────────────

def _run_agent(agent_cls, payload: dict) -> dict:
    """Instantiate a standalone specialist agent and run it."""
    agent = agent_cls()
    result = agent.run(payload)
    return result.model_dump()


@app.post("/agents/code-review", tags=["specialist"])
async def code_review(request: CodeReviewRequest, _: Principal = Depends(require_api_key)):
    """Review code quality, security, and best practices via CodeReviewerAgent."""
    try:
        from nexus_agent.agents.code_reviewer import CodeReviewerAgent
        return _run_agent(CodeReviewerAgent, {"target": request.target, "context": request.context})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/debug", tags=["specialist"])
async def debug_error(request: DebugRequest, _: Principal = Depends(require_api_key)):
    """Diagnose errors and propose fixes via DebuggerAgent."""
    try:
        from nexus_agent.agents.debugger_agent import DebuggerAgent
        return _run_agent(DebuggerAgent, {"error": request.error, "context": request.context})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/qa-test", tags=["specialist"])
async def qa_test(request: QATestRequest, _: Principal = Depends(require_api_key)):
    """Generate comprehensive test suites via QATestingAgent."""
    try:
        from nexus_agent.agents.qa_testing_agent import QATestingAgent
        return _run_agent(QATestingAgent, {"target": request.target, "framework": request.framework})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/database-design", tags=["specialist"])
async def database_design(request: DBArchitectRequest, _: Principal = Depends(require_api_key)):
    """Design database schemas and migrations via DatabaseArchitectAgent."""
    try:
        from nexus_agent.agents.database_architect import DatabaseArchitectAgent
        return _run_agent(DatabaseArchitectAgent, {"task": request.task, "db_type": request.db_type})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/devops", tags=["specialist"])
async def devops_generate(request: DevOpsRequest, _: Principal = Depends(require_api_key)):
    """Generate Dockerfiles, CI/CD pipelines, and deployment configs via DevOpsAgent."""
    try:
        from nexus_agent.agents.devops_agent import DevOpsAgent
        return _run_agent(DevOpsAgent, {"task": request.task, "stack": request.stack})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/data-analytics", tags=["specialist"])
async def data_analytics(request: DataAnalyticsRequest, _: Principal = Depends(require_api_key)):
    """Analyse data and generate insights via DataAnalyticsAgent."""
    try:
        from nexus_agent.agents.data_analytics_agent import DataAnalyticsAgent
        return _run_agent(DataAnalyticsAgent, {"task": request.task})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/project-status", tags=["specialist"])
async def project_status(request: ProjectManagerRequest, _: Principal = Depends(require_api_key)):
    """Generate project status reports and task breakdowns via ProjectManagerAgent."""
    try:
        from nexus_agent.agents.project_manager_agent import ProjectManagerAgent
        return _run_agent(ProjectManagerAgent, {"project": request.project, "context": request.context})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/agents/security-audit", tags=["specialist"])
async def security_audit(request: SecurityAuditRequest, _: Principal = Depends(require_api_key)):
    """Run OWASP security audit via SecurityAuditAgent."""
    try:
        from nexus_agent.agents.security_audit_agent import SecurityAuditAgent
        return _run_agent(SecurityAuditAgent, {"target": request.target, "scope": request.scope})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Task Templates ────────────────────────────────────────────────────────────

@app.get("/templates", tags=["templates"])
async def list_templates(category: str | None = None, _: Principal = Depends(require_api_key)):
    return {"templates": task_store.list_templates(category=category)}

@app.post("/templates", tags=["templates"])
async def create_template(request: TaskTemplateCreate, _: Principal = Depends(require_api_key)):
    import uuid as _uuid2
    tid = str(_uuid2.uuid4())
    row = task_store.upsert_template(
        template_id=tid, name=request.name, category=request.category,
        description=request.description, goal_template=request.goal_template, tags=request.tags,
    )
    return row

@app.get("/templates/{template_id}", tags=["templates"])
async def get_template(template_id: str, _: Principal = Depends(require_api_key)):
    t = task_store.get_template(template_id)
    if not t: raise HTTPException(status_code=404, detail="Template not found")
    return t

@app.delete("/templates/{template_id}", tags=["templates"])
async def delete_template(template_id: str, _: Principal = Depends(require_api_key)):
    if not task_store.delete_template(template_id):
        raise HTTPException(status_code=404, detail="Template not found")
    return {"status": "deleted", "template_id": template_id}

@app.post("/templates/{template_id}/use", tags=["templates"])
async def use_template(
    template_id: str,
    variables: dict = {},
    background_tasks: BackgroundTasks = None,
    _: Principal = Depends(require_api_key),
):
    """Expand a template with variables and submit as a task."""
    t = task_store.get_template(template_id)
    if not t: raise HTTPException(status_code=404, detail="Template not found")
    goal = t["goal_template"]
    for k, v in (variables or {}).items():
        goal = goal.replace(f"{{{{{k}}}}}", str(v))
    task_store.increment_template_usage(template_id)
    import uuid as _uuid3
    from datetime import datetime as _dt2, timezone as _tz2
    task_id = str(_uuid3.uuid4())
    task_store.create_task(task_id=task_id, goal=goal)
    if background_tasks:
        background_tasks.add_task(_run_orchestrator, goal, task_id)
    return {"status": "accepted", "goal": goal, "task_id": task_id, "template_id": template_id}


# ── File Upload ───────────────────────────────────────────────────────────────

@app.post("/files/upload", tags=["files"])
async def upload_file(
    file: UploadFile = File(...),
    task_id: str | None = None,
    _: Principal = Depends(require_api_key),
):
    """Upload a file (PDF, CSV, text, code) for use by agents."""
    import uuid as _uuid4
    file_id = str(_uuid4.uuid4())
    upload_dir = _DATA_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "upload").suffix or ".bin"
    storage_path = str(upload_dir / f"{file_id}{suffix}")
    content = await file.read()
    Path(storage_path).write_bytes(content)
    row = task_store.register_upload(
        file_id=file_id,
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        storage_path=storage_path,
        task_id=task_id,
    )
    return {**row, "storage_path": None}  # omit internal path from response

@app.get("/files", tags=["files"])
async def list_files(task_id: str | None = None, _: Principal = Depends(require_api_key)):
    files = task_store.list_uploads(task_id=task_id)
    for f in files: f.pop("storage_path", None)
    return {"files": files}

@app.delete("/files/{file_id}", tags=["files"])
async def delete_file(file_id: str, _: Principal = Depends(require_api_key)):
    upload = task_store.get_upload(file_id)
    if not upload: raise HTTPException(status_code=404, detail="File not found")
    try: Path(upload["storage_path"]).unlink(missing_ok=True)
    except Exception: pass
    task_store.delete_upload(file_id)
    return {"status": "deleted", "file_id": file_id}

@app.get("/files/{file_id}/content", tags=["files"])
async def get_file_content(file_id: str, _: Principal = Depends(require_api_key)):
    """Return the text content of an uploaded file (for agent context injection)."""
    upload = task_store.get_upload(file_id)
    if not upload: raise HTTPException(status_code=404, detail="File not found")
    try:
        content = Path(upload["storage_path"]).read_text(encoding="utf-8", errors="replace")
        return {"file_id": file_id, "filename": upload["filename"], "content": content[:50000]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── API Cost Dashboard ────────────────────────────────────────────────────────

@app.get("/costs/summary", tags=["costs"])
async def cost_summary(since: str | None = None, _: Principal = Depends(require_api_key)):
    """Return aggregated API cost summary by provider/model."""
    return task_store.get_cost_summary(since_iso=since)

@app.get("/costs/log", tags=["costs"])
async def cost_log(limit: int = 100, _: Principal = Depends(require_api_key)):
    """Return raw API call log for detailed inspection."""
    return {"log": task_store.list_cost_log(limit=limit)}


# ── Streaming Task Output (SSE) ───────────────────────────────────────────────

@app.get("/tasks/{task_id}/stream", tags=["orchestrator"])
async def stream_task_logs(task_id: str, _: Principal = Depends(require_api_key)):
    """Stream live log events for a running task via Server-Sent Events."""
    from fastapi.responses import StreamingResponse
    import asyncio, json as _json

    async def event_generator():
        last_count = 0
        task = task_store.get_task(task_id)
        if not task:
            yield f"data: {_json.dumps({'error': 'Task not found'})}\n\n"
            return

        for _ in range(300):  # max 5 minutes
            task = task_store.get_task(task_id)
            if not task: break
            yield f"data: {_json.dumps({'status': task['status'], 'task_id': task_id})}\n\n"
            if task["status"] in ("completed", "failed", "cancelled"):
                yield f"data: {_json.dumps({'event': 'done', 'status': task['status']})}\n\n"
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


def _archive_dir() -> Path:
    """Returns the docs/archive directory, always inside NEXUS_DOCS_DIR (the volume)."""
    d = NEXUS_DOCS_DIR / "archive"
    d.mkdir(parents=True, exist_ok=True)
    return d


@app.post("/docs/archive", tags=["docs"])
async def archive_doc(request: ArchiveDocRequest):
    """Saves a Markdown document inside the persistent docs/archive directory."""
    filename = request.filename.strip()
    if not filename.endswith(".md"):
        filename += ".md"

    filepath = _archive_dir() / filename
    try:
        content = request.content
        if not content.startswith("#"):
            content = f"# {request.title}\n\n{content}"
        filepath.write_text(content, encoding="utf-8")
        return {"status": "archived", "filename": filename, "path": str(filepath)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/docs/archive", tags=["docs"])
async def list_archived_docs():
    """Lists all archived Markdown documents."""
    archive_dir = _archive_dir()
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
                "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            })
        except Exception:
            pass
    return {"documents": docs}


@app.get("/docs/archive/{filename}", tags=["docs"])
async def get_archived_doc(filename: str):
    """Retrieves a specific archived Markdown document."""
    filepath = _archive_dir() / filename
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        content = filepath.read_text(encoding="utf-8")
        title = filepath.stem.replace("-", " ").replace("_", " ").title()
        for line in content.splitlines():
            if line.strip().startswith("#"):
                title = line.lstrip("#").strip()
                break
        return {"filename": filename, "title": title, "content": content}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/docs/archive/{filename}", tags=["docs"])
async def delete_archived_doc(filename: str):
    """Deletes an archived Markdown document."""
    filepath = _archive_dir() / filename
    if not filepath.is_file():
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
        # Send completion notification (email / LINE) — non-blocking
        try:
            import asyncio as _aio
            from nexus_agent.core.notifications import notify_task_complete as _notify
            _aio.run_coroutine_threadsafe(
                _notify(task_id, goal, "completed"),
                dashboard_hub._loop,
            ) if dashboard_hub._loop and dashboard_hub._loop.is_running() else None
        except Exception as _ne:
            logger_.debug("Notification failed (non-critical): %s", _ne)
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
        # Send failure notification
        try:
            import asyncio as _aio2
            from nexus_agent.core.notifications import notify_task_complete as _notify2
            _aio2.run_coroutine_threadsafe(
                _notify2(task_id, goal, "failed", str(exc)[:200]),
                dashboard_hub._loop,
            ) if dashboard_hub._loop and dashboard_hub._loop.is_running() else None
        except Exception as _ne2:
            logger_.debug("Failure notification failed (non-critical): %s", _ne2)


@app.post("/tasks/run", tags=["orchestrator"])
async def run_task(
    request: RunTaskRequest,
    background_tasks: BackgroundTasks,
    _: Principal = Depends(require_api_key),
):
    """Submits a task to the Orchestrator for background execution."""
    task_id = str(_uuid.uuid4())
    task_store.create_task(task_id=task_id, goal=request.goal, priority=request.priority)
    background_tasks.add_task(_run_orchestrator, request.goal, task_id)
    return {"status": "accepted", "goal": request.goal, "task_id": task_id, "priority": request.priority}


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


# ── Scene Image Generation ────────────────────────────────────────────────────

class SceneGenerateRequest(BaseModel):
    visual_style: str = (
        "Highly detailed 3D isometric corporate diorama, premium technical visualization, "
        "clean white studio background, realistic scale, global illumination, soft shadows, "
        "subtle ambient occlusion, high-end consulting slide illustration."
    )
    scene_objects: str = (
        "Realistic corporate office and industrial objects: desks, laptops, monitors, "
        "server racks, glass boards, printed reports, paper documents, binders, "
        "floating spreadsheet panels, dashboard screens, warning icons, workflow cards."
    )
    color_system: str = (
        "Color palette: clean white, polished steel, soft grey, muted blue, "
        "with strong red accents only for alerts, risks, and critical indicators."
    )
    negative_prompt: str = (
        "No cartoon style, no pixel art, no game UI, no cyberpunk neon, "
        "no dark background, no low-poly objects, no watermark, no blurry details."
    )
    size: str = "1792x1024"
    quality: str = "hd"


@app.post("/scene/generate", tags=["scene"])
async def generate_scene(
    request: SceneGenerateRequest,
    _: Principal = Depends(require_api_key),
):
    """Generate a corporate diorama scene image via DALL-E 3.

    Assembles the structured prompt components into a single DALL-E 3 prompt
    and returns the generated image URL (valid for 1 hour from OpenAI CDN).
    """
    openai_key = settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
    if not openai_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not configured. Set it in your environment to use scene generation.",
        )

    prompt = (
        f"{request.visual_style.strip()}\n\n"
        f"Scene contents: {request.scene_objects.strip()}\n\n"
        f"{request.color_system.strip()}\n\n"
        f"Important constraints — avoid entirely: {request.negative_prompt.strip()}"
    )

    try:
        from openai import OpenAI as _OpenAI
        client = _OpenAI(api_key=openai_key)
        response = client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            size=request.size,          # type: ignore[arg-type]
            quality=request.quality,    # type: ignore[arg-type]
            n=1,
        )
        image_data = response.data[0]
        return {
            "url": image_data.url,
            "revised_prompt": getattr(image_data, "revised_prompt", None),
            "model": "dall-e-3",
            "size": request.size,
            "quality": request.quality,
        }
    except Exception as exc:
        logger.error("scene_generate_failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}") from exc


# ── Social Media Integration ──────────────────────────────────────────────────

class SocialConnectRequest(BaseModel):
    platform: str                  # "facebook" | "tiktok"
    access_token: str
    page_id: str | None = None     # Facebook Page ID (required for Facebook)
    account_name: str = ""
    account_id: str = ""


class SocialPostRequest(BaseModel):
    platform: str                  # "facebook" | "tiktok"
    message: str
    link: str | None = None        # Optional URL to attach (Facebook)
    image_url: str | None = None   # Optional image URL (Facebook photo post)
    video_url: str | None = None   # Optional MP4 URL (TikTok video post)


class TikTokOAuthRequest(BaseModel):
    redirect_uri: str


@app.post("/social/connect", tags=["social"])
async def social_connect(
    request: SocialConnectRequest,
    _: Principal = Depends(require_api_key),
):
    """Save social media credentials and verify they work.

    For Facebook: provide ``page_id`` + a Page Access Token.
    For TikTok: provide the user ``access_token`` from the OAuth callback.
    """
    from nexus_agent.tools.social_media import (
        facebook_verify_token,
        tiktok_get_user_info,
    )

    platform = request.platform.lower()

    try:
        if platform == "facebook":
            if not request.page_id:
                raise HTTPException(status_code=400, detail="page_id is required for Facebook")
            info = await facebook_verify_token(request.page_id, request.access_token)
            task_store.upsert_social_connection(
                platform="facebook",
                account_name=info.get("name", request.account_name),
                account_id=info.get("id", request.account_id),
                access_token=request.access_token,
                page_id=request.page_id,
                extra={"fan_count": info.get("fan_count", 0)},
            )
            return {
                "status": "connected",
                "platform": "facebook",
                "page_name": info.get("name"),
                "page_id": info.get("id"),
                "fan_count": info.get("fan_count", 0),
            }

        elif platform == "tiktok":
            info = await tiktok_get_user_info(request.access_token)
            task_store.upsert_social_connection(
                platform="tiktok",
                account_name=info.get("display_name", request.account_name),
                account_id=info.get("open_id", request.account_id),
                access_token=request.access_token,
                extra={"follower_count": info.get("follower_count", 0), "avatar_url": info.get("avatar_url", "")},
            )
            return {
                "status": "connected",
                "platform": "tiktok",
                "display_name": info.get("display_name"),
                "open_id": info.get("open_id"),
                "follower_count": info.get("follower_count", 0),
            }

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform!r}")

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("social_connect_failed platform=%s: %s", platform, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/social/connections", tags=["social"])
async def list_social_connections(_: Principal = Depends(require_api_key)):
    """Return all connected social media accounts (tokens NOT included in response)."""
    return {"connections": task_store.list_social_connections()}


@app.delete("/social/{platform}", tags=["social"])
async def disconnect_social(platform: str, _: Principal = Depends(require_api_key)):
    """Remove a social media connection."""
    deleted = task_store.delete_social_connection(platform.lower())
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No connection found for platform: {platform}")
    return {"status": "disconnected", "platform": platform}


@app.post("/social/post", tags=["social"])
async def social_post(
    request: SocialPostRequest,
    _: Principal = Depends(require_api_key),
):
    """Publish content to a connected social media platform.

    The saved access token is used automatically — no need to pass it again.
    """
    from nexus_agent.tools.social_media import (
        facebook_post_text,
        facebook_post_photo,
        tiktok_post_video,
    )

    platform = request.platform.lower()
    conn = task_store.get_social_connection(platform)
    if not conn:
        raise HTTPException(
            status_code=404,
            detail=f"Platform '{platform}' is not connected. Connect it first via POST /social/connect.",
        )

    log_id = task_store.log_social_post(
        platform=platform,
        content_snippet=request.message[:280],
        status="pending",
    )

    try:
        result: dict

        if platform == "facebook":
            page_id = conn.get("page_id") or ""
            if not page_id:
                raise RuntimeError("Facebook page_id is missing in the saved connection.")
            token = conn["access_token"]

            if request.image_url:
                result = await facebook_post_photo(
                    page_id=page_id, access_token=token,
                    message=request.message, image_url=request.image_url,
                )
            else:
                result = await facebook_post_text(
                    page_id=page_id, access_token=token,
                    message=request.message, link=request.link,
                )

        elif platform == "tiktok":
            if not request.video_url:
                raise HTTPException(
                    status_code=400,
                    detail="TikTok requires video_url. Attach an MP4 URL to post a video.",
                )
            result = await tiktok_post_video(
                access_token=conn["access_token"],
                video_url=request.video_url,
                caption=request.message,
            )

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform!r}")

        task_store.update_social_post(
            log_id,
            status="published",
            api_post_id=str(result.get("post_id") or result.get("publish_id") or ""),
            post_url=result.get("url", ""),
            posted_at=datetime.now(timezone.utc).isoformat(),
        )
        return {**result, "log_id": log_id}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("social_post_failed platform=%s: %s", platform, exc)
        task_store.update_social_post(log_id, status="failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/social/posts", tags=["social"])
async def list_social_posts(
    platform: str | None = None,
    limit: int = 50,
    _: Principal = Depends(require_api_key),
):
    """Return recent social media post history."""
    return {"posts": task_store.list_social_posts(platform=platform, limit=limit)}


@app.get("/social/tiktok/oauth-url", tags=["social"])
async def tiktok_oauth_url(
    redirect_uri: str,
    _: Principal = Depends(require_api_key),
):
    """Return the TikTok OAuth2 authorization URL for the connected app.

    The frontend should redirect the user to this URL to grant permissions.
    After approval, TikTok redirects to ``redirect_uri?code=<code>``.
    Call ``POST /social/tiktok/exchange-code`` with that code.
    """
    from nexus_agent.tools.social_media import tiktok_build_auth_url

    client_key = settings.openai_api_key  # reuse settings pattern
    tt_key = os.environ.get("TIKTOK_CLIENT_KEY", "")
    if not tt_key:
        raise HTTPException(
            status_code=503,
            detail="TIKTOK_CLIENT_KEY is not configured. Set it in your environment.",
        )
    url = tiktok_build_auth_url(client_key=tt_key, redirect_uri=redirect_uri)
    return {"auth_url": url}


@app.post("/social/tiktok/exchange-code", tags=["social"])
async def tiktok_exchange_code(
    code: str,
    redirect_uri: str,
    _: Principal = Depends(require_api_key),
):
    """Exchange a TikTok authorization code for an access token and save the connection."""
    from nexus_agent.tools.social_media import tiktok_exchange_code as _exchange, tiktok_get_user_info

    tt_key    = os.environ.get("TIKTOK_CLIENT_KEY", "")
    tt_secret = os.environ.get("TIKTOK_CLIENT_SECRET", "")
    if not tt_key or not tt_secret:
        raise HTTPException(status_code=503, detail="TikTok app credentials not configured.")

    try:
        token_data = await _exchange(
            client_key=tt_key, client_secret=tt_secret,
            code=code, redirect_uri=redirect_uri,
        )
        access_token  = token_data.get("access_token", "")
        refresh_token = token_data.get("refresh_token", "")
        expires_in    = token_data.get("expires_in", 0)

        info = await tiktok_get_user_info(access_token)
        task_store.upsert_social_connection(
            platform="tiktok",
            account_name=info.get("display_name", ""),
            account_id=info.get("open_id", ""),
            access_token=access_token,
            extra={
                "refresh_token": refresh_token,
                "expires_in": expires_in,
                "follower_count": info.get("follower_count", 0),
                "avatar_url": info.get("avatar_url", ""),
            },
        )
        return {
            "status": "connected",
            "platform": "tiktok",
            "display_name": info.get("display_name"),
            "follower_count": info.get("follower_count", 0),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("tiktok_exchange_code_failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ══════════════════════════════════════════════════════════════════════════════
# NEW INFRASTRUCTURE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

# ── Streaming LLM (SSE) ───────────────────────────────────────────────────────

from fastapi.responses import StreamingResponse as _StreamResp

@app.post("/inference/stream", tags=["inference"])
async def stream_inference_endpoint(
    request: StreamRequest,
    _: Principal = Depends(require_api_key),
):
    """Stream LLM tokens via Server-Sent Events (text/event-stream).

    Each event is a JSON object ``{"token": "..."}`` followed by ``[DONE]``.
    """
    from nexus_agent.core.streaming import stream_inference
    return _StreamResp(
        stream_inference(
            request.messages,
            provider=request.provider,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            system=request.system,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Vector Store / Knowledge Base ─────────────────────────────────────────────

@app.get("/kb/stats", tags=["knowledge-base"])
async def kb_stats(_: Principal = Depends(require_api_key)):
    from nexus_agent.core.vector_store import vector_store as vs
    return vs.stats()

@app.get("/kb/documents", tags=["knowledge-base"])
async def kb_list(_: Principal = Depends(require_api_key)):
    from nexus_agent.core.vector_store import vector_store as vs
    return {"documents": vs.list_documents()}

@app.delete("/kb/documents/{doc_id}", tags=["knowledge-base"])
async def kb_delete(doc_id: str, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.vector_store import vector_store as vs
    if not vs.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "deleted", "doc_id": doc_id}

@app.post("/kb/search", tags=["knowledge-base"])
async def kb_search(request: RAGRequest, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.vector_store import vector_store as vs
    results = vs.search(request.question, top_k=request.top_k)
    return {"query": request.question, "results": results}

@app.post("/kb/ask", tags=["knowledge-base"])
async def kb_ask(request: RAGRequest, _: Principal = Depends(require_api_key)):
    """Ask a question — retrieves context then generates an LLM answer."""
    from nexus_agent.agents.rag_agent import RAGAgent
    agent = RAGAgent()
    result = agent.run({"question": request.question, "top_k": request.top_k, "doc_id": request.doc_id})
    return result

@app.post("/kb/ingest-file/{file_id}", tags=["knowledge-base"])
async def kb_ingest_file(file_id: str, title: str = "", _: Principal = Depends(require_api_key)):
    """Ingest an uploaded file into the Knowledge Base for RAG retrieval."""
    upload = task_store.get_upload(file_id)
    if not upload:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        text = Path(upload["storage_path"]).read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    from nexus_agent.core.vector_store import vector_store as vs
    n_chunks = vs.add_document(
        doc_id=file_id,
        text=text,
        title=title or upload["filename"],
        source=upload["filename"],
        content_type=upload["content_type"],
    )
    return {"doc_id": file_id, "filename": upload["filename"], "chunks_indexed": n_chunks}


# ── RAG + API Integration Agents ──────────────────────────────────────────────

@app.post("/agents/api-integration", tags=["specialist"])
async def api_integration(request: APIIntegrationRequest, _: Principal = Depends(require_api_key)):
    """Generate API client code and validate an endpoint via APIIntegrationAgent."""
    from nexus_agent.agents.api_integration_agent import APIIntegrationAgent
    agent = APIIntegrationAgent()
    return agent.run({"task": request.task, "test_url": request.test_url, "auth_type": request.auth_type})


# ── Scheduler (Cron Jobs) ─────────────────────────────────────────────────────

@app.get("/scheduler/jobs", tags=["scheduler"])
async def list_jobs(_: Principal = Depends(require_api_key)):
    from nexus_agent.core.scheduler import scheduler_store
    return {"jobs": scheduler_store.list_jobs()}

@app.post("/scheduler/jobs", tags=["scheduler"])
async def create_job(request: SchedulerJobCreate, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.scheduler import add_job
    try:
        job = add_job(
            job_id=str(_uuid.uuid4()),
            name=request.name,
            goal_template=request.goal_template,
            cron_expr=request.cron_expr,
            timezone_str=request.timezone,
        )
        return job
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid cron expression or scheduler error: {exc}") from exc

@app.delete("/scheduler/jobs/{job_id}", tags=["scheduler"])
async def delete_job(job_id: str, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.scheduler import remove_job
    if not remove_job(job_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "deleted", "job_id": job_id}

@app.post("/scheduler/jobs/{job_id}/toggle", tags=["scheduler"])
async def toggle_job(job_id: str, enabled: bool = True, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.scheduler import scheduler_store, get_scheduler
    if not scheduler_store.toggle_job(job_id, enabled):
        raise HTTPException(status_code=404, detail="Job not found")
    sched = get_scheduler()
    if sched and sched.running:
        try:
            if enabled: sched.resume_job(job_id)
            else:       sched.pause_job(job_id)
        except Exception: pass
    return {"status": "enabled" if enabled else "disabled", "job_id": job_id}


# ── Notifications ─────────────────────────────────────────────────────────────

@app.post("/notifications/test", tags=["notifications"])
async def test_notification(request: NotificationTestRequest, _: Principal = Depends(require_api_key)):
    """Send a test notification to verify Email or LINE Notify configuration."""
    from nexus_agent.core.notifications import test_email, test_line
    if request.channel == "email":
        result = await test_email({"to": request.to} if request.to else None)
    elif request.channel == "line":
        result = await test_line()
    else:
        raise HTTPException(status_code=400, detail="channel must be 'email' or 'line'")
    return result

@app.get("/notifications/config", tags=["notifications"])
async def get_notification_config(_: Principal = Depends(require_api_key)):
    """Return current notification configuration (secrets masked)."""
    s = settings
    return {
        "email": {
            "configured": bool(s.smtp_host and s.smtp_user),
            "smtp_host":  s.smtp_host,
            "smtp_port":  s.smtp_port,
            "smtp_user":  s.smtp_user,
            "smtp_from":  s.smtp_from,
            "use_tls":    s.smtp_use_tls,
            "notification_email": s.notification_email,
        },
        "line": {
            "configured": bool(s.line_notify_token),
            "token_set":  bool(s.line_notify_token),
        },
    }


# ── Webhooks (incoming HTTP triggers) ────────────────────────────────────────

@app.get("/webhooks", tags=["webhooks"])
async def list_webhooks(_: Principal = Depends(require_api_key)):
    return {"webhooks": task_store.list_webhooks()}

@app.post("/webhooks", tags=["webhooks"])
async def create_webhook(request: WebhookCreate, _: Principal = Depends(require_api_key)):
    return task_store.create_webhook(request.name, request.goal_template)

@app.delete("/webhooks/{webhook_id}", tags=["webhooks"])
async def delete_webhook(webhook_id: str, _: Principal = Depends(require_api_key)):
    if not task_store.delete_webhook(webhook_id):
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"status": "deleted", "webhook_id": webhook_id}

@app.post("/hooks/{webhook_id}", tags=["webhooks"])
async def trigger_webhook(
    webhook_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    token: str | None = None,
):
    """Public webhook trigger endpoint (no auth header required — validated by secret token)."""
    wh = task_store.get_webhook(webhook_id)
    if not wh or not wh.get("enabled"):
        raise HTTPException(status_code=404, detail="Webhook not found or disabled")
    if token and token != wh.get("secret_token"):
        raise HTTPException(status_code=403, detail="Invalid webhook token")
    task_store.increment_webhook_hit(webhook_id)
    task_id = str(_uuid.uuid4())
    goal    = wh["goal_template"]
    task_store.create_task(task_id=task_id, goal=goal)
    background_tasks.add_task(_run_orchestrator, goal, task_id)
    return {"status": "accepted", "task_id": task_id, "goal": goal}


# ── Chat / Conversation Sessions ──────────────────────────────────────────────

@app.post("/chat/sessions", tags=["chat"])
async def create_chat_session(request: ChatSessionCreate, _: Principal = Depends(require_api_key)):
    return task_store.create_chat_session(request.title, request.agent_role)

@app.get("/chat/sessions", tags=["chat"])
async def list_chat_sessions(_: Principal = Depends(require_api_key)):
    return {"sessions": task_store.list_chat_sessions()}

@app.delete("/chat/sessions/{session_id}", tags=["chat"])
async def delete_chat_session(session_id: str, _: Principal = Depends(require_api_key)):
    if not task_store.delete_chat_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted", "session_id": session_id}

@app.get("/chat/sessions/{session_id}/messages", tags=["chat"])
async def get_chat_history(session_id: str, _: Principal = Depends(require_api_key)):
    return {"messages": task_store.get_chat_history(session_id)}

@app.post("/chat/sessions/{session_id}/messages", tags=["chat"])
async def chat_message(
    session_id: str,
    request: ChatMessageRequest,
    _: Principal = Depends(require_api_key),
):
    """Send a message and get a streaming or non-streaming LLM response."""
    task_store.add_chat_message(session_id, "user", request.content)
    history = task_store.get_chat_history(session_id, limit=20)
    messages = [{"role": m["role"], "content": m["content"]} for m in history]

    if request.stream:
        from nexus_agent.core.streaming import stream_inference
        async def _gen():
            import json as _json
            full = []
            async for chunk in stream_inference(messages):
                yield chunk
                try:
                    d = _json.loads(chunk.replace("data: ", "").strip())
                    if "token" in d: full.append(d["token"])
                except Exception: pass
            task_store.add_chat_message(session_id, "assistant", "".join(full))
        return _StreamResp(_gen(), media_type="text/event-stream",
                           headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # Non-streaming
    try:
        engine = get_inference_engine()
        resp_text = engine.generate(messages, temperature=0.7)
    except Exception as exc:
        resp_text = f"⚠️ LLM error: {exc}"
    task_store.add_chat_message(session_id, "assistant", resp_text)
    return {"role": "assistant", "content": resp_text, "session_id": session_id}


# ── Prompt Version Control ────────────────────────────────────────────────────

@app.get("/prompts", tags=["prompts"])
async def list_prompts(agent_role: str | None = None, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.prompt_store import prompt_store
    return {"versions": prompt_store.list_versions(agent_role)}

@app.post("/prompts", tags=["prompts"])
async def create_prompt(request: PromptVersionCreate, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.prompt_store import prompt_store
    return prompt_store.create_version(request.agent_role, request.name, request.content, request.notes)

@app.post("/prompts/{version_id}/activate", tags=["prompts"])
async def activate_prompt(version_id: str, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.prompt_store import prompt_store
    if not prompt_store.activate_version(version_id):
        raise HTTPException(status_code=404, detail="Version not found")
    return {"status": "activated", "version_id": version_id}

@app.delete("/prompts/{version_id}", tags=["prompts"])
async def delete_prompt(version_id: str, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.prompt_store import prompt_store
    if not prompt_store.delete_version(version_id):
        raise HTTPException(status_code=404, detail="Version not found")
    return {"status": "deleted", "version_id": version_id}


# ── Multi-workspace + RBAC ────────────────────────────────────────────────────

@app.get("/workspaces", tags=["workspaces"])
async def list_workspaces(_: Principal = Depends(require_api_key)):
    from nexus_agent.core.workspace import workspace_store
    return {"workspaces": workspace_store.list_workspaces()}

@app.post("/workspaces", tags=["workspaces"])
async def create_workspace(request: WorkspaceCreate, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.workspace import workspace_store
    return workspace_store.create_workspace(request.name, request.description)

@app.delete("/workspaces/{workspace_id}", tags=["workspaces"])
async def delete_workspace(workspace_id: str, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.workspace import workspace_store
    if not workspace_store.delete_workspace(workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"status": "deleted", "workspace_id": workspace_id}

@app.get("/workspaces/{workspace_id}/keys", tags=["workspaces"])
async def list_workspace_keys(workspace_id: str, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.workspace import workspace_store
    return {"keys": workspace_store.list_keys(workspace_id)}

@app.post("/workspaces/keys", tags=["workspaces"])
async def create_workspace_key(request: WorkspaceKeyCreate, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.workspace import workspace_store
    return workspace_store.create_key(request.workspace_id, request.label, request.permission)

@app.delete("/workspaces/keys/{key_id}", tags=["workspaces"])
async def revoke_workspace_key(key_id: str, _: Principal = Depends(require_api_key)):
    from nexus_agent.core.workspace import workspace_store
    if not workspace_store.revoke_key(key_id):
        raise HTTPException(status_code=404, detail="Key not found")
    return {"status": "revoked", "key_id": key_id}


# ── Model Provider Configuration (read-only inspection) ──────────────────────

@app.get("/models/providers", tags=["models"])
async def list_model_providers(_: Principal = Depends(require_api_key)):
    """Return active LLM providers with their status."""
    engine = get_inference_engine()
    providers_detail = engine.list_providers() if engine else []
    return {
        "providers": providers_detail,
        "env_configured": {
            "openai":     bool(os.environ.get("OPENAI_API_KEY")),
            "anthropic":  bool(os.environ.get("ANTHROPIC_API_KEY")),
            "gemini":     bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")),
            "vllm":       os.environ.get("VLLM_ENABLED","false").lower() in ("1","true","yes"),
        },
    }

@app.post("/models/test/{provider}", tags=["models"])
async def test_model_provider(provider: str, _: Principal = Depends(require_api_key)):
    """Send a minimal test message to a specific provider."""
    try:
        engine = get_inference_engine()
        resp = engine.generate_detailed(
            [{"role":"user","content":"Reply with exactly: OK"}],
            provider=provider, max_tokens=10, temperature=0.0,
        )
        return {"ok": True, "provider": provider, "response": resp.content,
                "tokens_in": resp.tokens_in, "tokens_out": resp.tokens_out}
    except Exception as exc:
        return {"ok": False, "provider": provider, "error": str(exc)}
