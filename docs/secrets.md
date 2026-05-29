# Secrets Management

Nexus-Agent never reads secrets from disk in production — everything is
injected via environment variables that the orchestrator pulls from the
configured secrets backend.

## Supported backends

| Backend                    | Env injection mechanism                              |
|----------------------------|-------------------------------------------------------|
| HashiCorp Vault (preferred)| `vault agent` template renders into `/run/secrets/`   |
| Azure Key Vault            | Azure Container Apps secret references                |
| Portainer Secrets          | `docker compose` `secrets:` block (file → env shim)   |
| GitHub Actions             | `${{ secrets.* }}` → `--env` for ad-hoc CI runs       |

## Required secrets

| Variable                  | Sensitivity | Purpose                                |
|---------------------------|-------------|----------------------------------------|
| `NEXUS_API_KEYS`          | high        | Viewer-tier API keys (CSV)             |
| `NEXUS_ADMIN_API_KEYS`    | high        | Admin-tier API keys (CSV)              |
| `NEXUS_WS_TOKEN`          | high        | Shared dashboard websocket token       |
| `DATABASE_URL`            | high        | Postgres DSN (incl. password)          |
| `REDIS_URL`               | medium      | Redis DSN                              |
| `OPENAI_API_KEY`          | high        | OpenAI vendor key                      |
| `ANTHROPIC_API_KEY`       | high        | Claude vendor key                      |
| `GEMINI_API_KEY`          | high        | Google AI vendor key                   |
| `SENTRY_DSN`              | medium      | Sentry ingest URL (optional)           |

## Rotation policy

* **High**: rotate every 90 days, or immediately on suspected leak.
* **Medium**: rotate every 180 days.
* Always rotate after personnel changes on the on-call roster.

## Local development

For local development, copy `Stack.env.example` (if present) to `Stack.env`
and fill in real values.  `Stack.env` is git-ignored.  Never commit real
secrets — use placeholders.

## Verification

After rotating a key, confirm the deployment picked it up:

```bash
docker compose exec nexus-agent printenv NEXUS_API_KEYS | head -c 16
curl -sf -H "X-API-Key: <new-key>" http://localhost:5190/inference/providers
```
