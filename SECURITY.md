# Security Policy

## Supported Versions

We only release security fixes for the `main` branch. Pin to a specific image
digest (not the `latest` tag) in production.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Report privately using GitHub's [Security Advisories](https://github.com/picthaisky/Nexus-Agent/security/advisories/new)
form, or email **security@picthaisky.dev** with:

1. A description of the vulnerability and its impact.
2. Steps to reproduce (proof of concept welcome).
3. Affected component and version / commit SHA.
4. Your suggested fix (optional but appreciated).

We aim to acknowledge reports within **2 business days** and to issue a fix or
mitigation within **14 days** for high-severity issues.

## Security Posture (Production)

- All REST endpoints require an `X-API-Key` header (see `NEXUS_API_KEYS`).
- Mutating endpoints (`/dashboard/emit`, `/skills/import-github`, `/kg/refactor`)
  require an admin-tier key (`NEXUS_ADMIN_API_KEYS`).
- WebSocket `/ws/dashboard` requires `?token=…` matching `NEXUS_WS_TOKEN`.
- Per-key rate limiting via `slowapi` (default 60 req/min, 20 req/min for `/inference/generate`).
- Security headers applied to every response (HSTS, XFO, CSP, Permissions-Policy).
- CORS allow-list — wildcard `*` is rejected in production.
- Container runs as a non-root user.
- Dependencies tracked by Dependabot + scanned by CodeQL weekly.
