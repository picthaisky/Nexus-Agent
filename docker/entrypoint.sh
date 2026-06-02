#!/usr/bin/env bash
# Nexus-Agent container entrypoint.
#
# 1. Creates persistent data directories inside the named Docker volume.
# 2. Runs Alembic migrations (idempotent).
# 3. Exec's the application command.

set -euo pipefail

# ── Ensure persistent data directories exist inside the volume ────────────────
DATA_DIR="${NEXUS_DATA_DIR:-/app/data}"
mkdir -p "${DATA_DIR}"
mkdir -p "${DATA_DIR}/repos"
mkdir -p "${DATA_DIR}/docs/archive"

echo "[nexus-entrypoint] Data directory: ${DATA_DIR}"

# ── Alembic migrations ────────────────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "[nexus-entrypoint] Running Alembic migrations against ${DATABASE_URL%%\?*}"
    alembic upgrade head || {
        echo "[nexus-entrypoint] migration failed" >&2
        exit 1
    }
else
    echo "[nexus-entrypoint] DATABASE_URL unset — skipping migrations."
fi

exec "$@"
