"""Nexus-Agent — FastAPI Entrypoint for Container Deployment.

Provides health, readiness, and info endpoints for Docker / Portainer
orchestration, plus a future-ready mount point for the agent API.
"""

from __future__ import annotations

import os
import sys
import time
import asyncio
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler

from nexus_agent.core.knowledge_graph_engine import KnowledgeGraphEngine, RepoGraph
from nexus_agent.core.skill_vault import SkillVault
from nexus_agent.core.dashboard_hub import dashboard_hub
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

# ── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Multi-AI Agent Orchestration System",
    docs_url="/docs" if ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if ENVIRONMENT != "production" else None,
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
    import warnings
    warnings.warn(
        "CORS_ORIGINS='*' in production; set an allow-list of trusted origins.",
        stacklevel=2,
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Request-ID"],
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


@app.on_event("startup")
async def _bind_dashboard_loop() -> None:
    """Allow synchronous orchestrator code to schedule dashboard emits."""
    dashboard_hub.set_loop(asyncio.get_running_loop())


@app.on_event("shutdown")
async def _graceful_shutdown() -> None:
    """Drain WebSocket clients and dispose of pooled resources."""
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
        from nexus_agent.core.database import engine as db_engine

        db_engine.dispose()
    except Exception as exc:  # pragma: no cover
        logger.warning("db_dispose_failed", extra={"error": str(exc)})

    logger.info("shutdown_complete")


def _resolve_repo_root(repo_root: str | None) -> str:
    if repo_root and repo_root.strip():
        return str(Path(repo_root).resolve())
    return str(Path(DEFAULT_REPO_ROOT).resolve())


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

    from nexus_agent.core.database import engine as db_engine
    from nexus_agent.core.redis_client import ping_redis

    checks: dict[str, str] = {}
    healthy = True

    # Postgres
    if settings.database_url:
        try:
            with db_engine.connect() as conn:
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

    # Provider configuration (key presence only — no outbound calls)
    if settings.openai_api_key:
        checks["openai"] = "configured"
    if settings.anthropic_api_key:
        checks["claude"] = "configured"
    if settings.gemini_api_key or os.getenv("GOOGLE_API_KEY"):
        checks["gemini"] = "configured"
    if settings.vllm_enabled:
        checks["vllm_local"] = "configured"

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
