# Nexus-Agent · Operations Runbook

This runbook covers the most common production incidents and the corresponding
response procedures for the Cyber-Thai Command Center stack.

## 1. Service map

| Component          | Container        | Host port | Internal port | Healthcheck         |
|--------------------|------------------|-----------|---------------|---------------------|
| API gateway        | `nexus-agent`    | 5190      | 8080          | `GET /health`       |
| React dashboard    | `nexus-dashboard`| 3990      | 80            | `GET /`             |
| Redis cache        | `nexus-redis`    | 6399      | 6379          | `redis-cli ping`    |
| Postgres database  | `nexus-postgres` | 5492      | 5432          | `pg_isready`        |

## 2. Standard health checks

```bash
curl -sf http://<host>:5190/health      # liveness
curl -sf http://<host>:5190/ready       # readiness (DB + Redis + providers)
curl -sf http://<host>:5190/metrics     # Prometheus exposition
```

`/ready` returns `503` if any configured dependency is failing.

## 3. Incident playbooks

### 3.1 API returns 503 from `/ready`

1. Inspect `checks` section in the response body — identify the failing dep.
2. **Postgres unavailable** → `docker compose ps nexus-postgres`, then
   `docker compose logs --tail=200 nexus-postgres`.
3. **Redis unavailable** → `docker compose restart nexus-redis`.
4. If migrations failed at boot: `docker compose logs nexus-agent | grep alembic`.
5. Roll back by redeploying the previous image tag from GHCR:
   ```bash
   docker compose pull nexus-agent && docker compose up -d nexus-agent
   ```

### 3.2 Inference circuit breaker is open

Symptom: `nexus_inference_errors_total{reason="CircuitBreakerError"}` rising.

1. Check the provider status page (OpenAI / Anthropic / Google).
2. Force a single provider via API: `POST /inference/generate {"provider":"local"}`.
3. The breaker auto-resets after `CIRCUIT_BREAKER_RESET_SECONDS` (default 60s).
4. To trip manually for maintenance, unset the provider's API key and restart.

### 3.3 Rate-limit storm

Symptom: spike in HTTP 429 responses.

1. Identify offender via `request_id` in JSON access logs (`logger=nexus.access`).
2. Rotate the abusing API key (remove from `NEXUS_API_KEYS`, redeploy).
3. Lower `RATE_LIMIT_DEFAULT` (e.g. `30/minute`) if the spike is broad.

### 3.4 Database restore (Postgres)

```bash
# 1. stop traffic
docker compose stop nexus-agent

# 2. restore
docker compose exec -T nexus-postgres \
    psql -U nexus -d nexus < backups/nexus-YYYYMMDD.sql

# 3. run migrations + restart
docker compose run --rm nexus-agent alembic upgrade head
docker compose start nexus-agent
```

## 4. Key rotation

* **API keys** — edit `NEXUS_API_KEYS` / `NEXUS_ADMIN_API_KEYS` in the secrets
  store (Vault / Portainer secret), then `docker compose up -d nexus-agent`.
* **LLM provider keys** — same procedure; circuit breaker will recover on the
  next successful call.
* **WebSocket token** — `NEXUS_WS_TOKEN`; all live clients will be disconnected
  on restart, which is intended.

## 5. Routine maintenance

* Weekly: review Dependabot PRs, merge security updates.
* Monthly: run `alembic upgrade head` against staging from a fresh snapshot.
* Quarterly: rotate every secret, run the k6 load test in `tests/load/`.

## 6. Useful commands

```bash
docker compose logs -f nexus-agent | jq .
docker compose exec nexus-agent alembic current
docker compose exec nexus-redis redis-cli info stats
docker compose exec nexus-postgres psql -U nexus -d nexus -c '\dt'
```
