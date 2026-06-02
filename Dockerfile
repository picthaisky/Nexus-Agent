# ============================================================
# Nexus-Agent — Multi-stage Production Dockerfile
# ============================================================
# Build:  docker build -t nexus-agent:latest .
# Run:    docker run -p 8080:8080 --env-file Stack.env nexus-agent:latest
# ============================================================

# ── Stage 1: Builder ─────────────────────────────────────────
FROM python:3.14-slim AS builder

WORKDIR /build

# Install system dependencies required for building wheels
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files first (layer caching)
COPY requirements.txt .

# Create virtual environment and install dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# ── Stage 2: Production ─────────────────────────────────────
FROM python:3.14-slim AS production

LABEL maintainer="picthaisky <picthaisky@github.com>"
LABEL org.opencontainers.image.source="https://github.com/picthaisky/Nexus-Agent"
LABEL org.opencontainers.image.description="Nexus-Agent: Multi-AI Agent Orchestration System"

# Install runtime dependencies + Node.js 20 LTS
# Node.js is required so the Executor Agent can run npm / npx / tsc commands
# when building or initialising JavaScript/TypeScript projects.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl tini git ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    node --version && npm --version

# Create non-root user
RUN groupadd --gid 1001 nexus && \
    useradd --uid 1001 --gid nexus --create-home --shell /bin/bash nexus

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copy application source
COPY pyproject.toml .
COPY requirements.txt .
COPY alembic.ini .
COPY alembic/ ./alembic/
COPY nexus_agent/ ./nexus_agent/
COPY docker/entrypoint.sh /usr/local/bin/nexus-entrypoint
RUN chmod +x /usr/local/bin/nexus-entrypoint

# Install the package itself (non-editable for production)
RUN pip install --no-cache-dir .

# Create the persistent data directory that Docker will mount as a named volume.
# Everything that must survive a redeploy lives here:
#   /app/data/nexus_local.db        — task history, connected repos registry
#   /app/data/nexus_playbook.db     — procedural memory / learned skills
#   /app/data/nexus_skill_vault.db  — skill vault
#   /app/data/repos/                — cloned Git repositories
#   /app/data/docs/archive/         — archived Markdown documents
RUN mkdir -p /app/data/repos /app/data/docs/archive

# Set ownership
RUN chown -R nexus:nexus /app

# Switch to non-root user
USER nexus

# Expose API port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["tini", "--", "nexus-entrypoint"]

# Start the application
CMD ["python", "-m", "uvicorn", "nexus_agent.entrypoint:app", \
     "--host", "0.0.0.0", "--port", "8080", \
     "--workers", "2", "--log-level", "info"]
