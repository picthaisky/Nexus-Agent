"""Nexus-Agent — FastAPI Entrypoint for Container Deployment.

Provides health, readiness, and info endpoints for Docker / Portainer
orchestration, plus a future-ready mount point for the agent API.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Application metadata ────────────────────────────────────────────────────
APP_NAME = "Nexus-Agent"
APP_VERSION = os.getenv("APP_VERSION", "0.1.0")
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")
START_TIME = time.monotonic()

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
            "python_version": os.sys.version,
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
            "docs": "/docs" if ENVIRONMENT != "production" else "disabled",
        },
    }
