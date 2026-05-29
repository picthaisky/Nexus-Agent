#!/usr/bin/env bash
# Nexus-Agent container entrypoint.
#
# Runs database migrations (idempotent, safe to retry) before launching the
# command passed in via Dockerfile CMD.

set -euo pipefail

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
