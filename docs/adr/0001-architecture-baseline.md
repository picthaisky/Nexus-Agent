# ADR 0001 — Production Architecture Baseline

* **Status**: Accepted
* **Date**: 2026-05-29
* **Deciders**: Nexus-Agent core maintainers

## Context

The Nexus-Agent platform began as a single-process research prototype.  To run
it as the Cyber-Thai Command Center production workload we needed a clear set
of architectural decisions covering security, observability, reliability and
data persistence.

## Decision

We adopt the following baseline for all production deployments:

1. **API surface** — FastAPI (`nexus_agent.entrypoint:app`) behind nginx in the
   dashboard container.  All cross-cutting concerns are implemented as ASGI
   middleware so they remain composable and testable.
2. **Authentication** — Header-based API keys (`X-API-Key`) with two tiers
   (viewer + admin).  WebSocket connections authenticate via short-lived
   `?token=` query parameter.  Keys are compared with `hmac.compare_digest`.
3. **Rate limiting** — `slowapi` backed by Redis when available, in-memory
   otherwise.  Limits are per-key with IP fallback for unauthenticated calls.
4. **Persistence** — SQLAlchemy 2.0 ORM against Postgres in production
   (SQLite for local dev).  Schema migrations via Alembic, applied at
   container start through `docker/entrypoint.sh`.
5. **Cache & pub/sub** — Redis used for rate-limit counters today, ready to
   carry the inference cache and job queue (Sprint 7+).
6. **Reliability** — Outbound LLM calls go through `resilient_call` which
   combines `tenacity` retries with a per-provider `pybreaker` circuit
   breaker, all driven by `Settings`.
7. **Observability**
   * Structured JSON logging via stdlib + custom formatter.
   * Prometheus metrics exposed at `/metrics`.
   * Optional Sentry integration; never sends PII (`send_default_pii=False`).
8. **Frontend** — Vite + React 19 + Tailwind, hosted by nginx with strict CSP
   and security headers.  Auth handled by an `AuthProvider` storing the API
   key in `localStorage` and injecting it into REST + WS calls.
9. **Compliance** — PDPA-friendly audit log table records mutating actions
   without request bodies; pricing/cost tracking persisted per inference call
   in the `inference_calls` table.
10. **Supply chain** — Dependabot weekly updates, CodeQL security scanning,
    SECURITY.md disclosure policy.

## Consequences

* **Positive**: clear boundaries, idiomatic FastAPI patterns, all secrets and
  pricing centralised in `Settings`, deterministic CI matrix.
* **Negative**: more dependencies (slowapi, tenacity, pybreaker, prometheus,
  sentry).  Mitigated by pinning and Dependabot.
* **Trade-off**: Sentry and Postgres are *optional* at runtime — the service
  must still start when their env vars are unset (verified by smoke tests).

## Alternatives considered

* Custom auth via JWT — overkill for the current internal user base; revisit
  when external partners onboard.
* Pure async SQLAlchemy — deferred until we move queue workers off-process.
* OpenTelemetry instead of Prometheus + Sentry — heavier ops burden; revisit
  once we have a managed OTel collector.
