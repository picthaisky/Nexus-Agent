<!-- markdownlint-disable MD033 MD041 MD036 MD051 MD022 MD032 MD040 -->

# Nexus-Agent

<div align="center">

**Cyber-Thai Command Center · Multi-AI Agent Orchestration Platform**

*Plan · Build · Validate · Learn — continuously, autonomously, observably.*

[![Python](https://img.shields.io/badge/Python-3.10%20|%203.11%20|%203.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Orchestration-1C3D5A)](https://github.com/langchain-ai/langgraph)
[![Phaser](https://img.shields.io/badge/Phaser-3.70-8A3324?logo=phaser)](https://phaser.io/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docs.docker.com/compose/)
[![Tests](https://img.shields.io/badge/Tests-157%20passing-16a34a)](tests/)
[![License](https://img.shields.io/badge/License-MIT-555555)](LICENSE)

</div>

---

## Overview

Nexus-Agent คือ **Multi-AI Agent Orchestration Platform** พร้อม **Cyber-Thai Command Center** — interactive 2.5D isometric office ที่ให้คุณเห็น AI agents ทำงานจริงแบบ real-time

ระบบรับเป้าหมายภาษาธรรมชาติ แล้วส่งผ่านวงจร **Observe → Reason → Decide → Act → Learn** โดย agents 22 ตัวทำงานร่วมกัน พร้อม Knowledge Graph, Skill Vault, Streaming WebSocket และ Social Media integration

---

## Screenshots

### Isometric Office — Cyber-Thai Command Center
- **30×22 grid** พร้อม 10 zones: Dev, Design, Meeting, Lounge, Risk Monitoring, Pantry, Analytics, Security, QA Lab, DevOps Bay
- **16 specialist agents** แสดงผลใน office พร้อม tool-specific animations (TYPING/READING/ACTIVE)
- **Matrix spawn/despawn effects** เมื่อ agents เข้า/ออก
- **A* pathfinding** — agents เดินหลีกสิ่งกีดขวาง
- **Zone activity lighting** — zones เปล่งแสงเมื่อ agents กำลังทำงาน
- **Live progress bars** เหนือแต่ละ agent ขณะ task ดำเนิน

### Grid View
แสดง 16 agents พร้อม real-time micro-state badges, EXP counter, cost metrics

### Specialist Office
11 tabs: Finance · Content · Code Review · Debugger · QA · DB Architect · DevOps · Analytics · Project Manager · Security · Social Media

---

## Architecture

```
Browser (React 19 + Phaser 3.70)
  │
  ├─ /ws/dashboard    ── DashboardHub ──── Agent state broadcast (all 22 agents)
  ├─ /ws/tasks/{id}   ── TaskEventHub ──── Per-task step streaming + CLI output
  ├─ /ws/presence     ── PresenceHub ───── Online user tracking
  └─ /ws/notifications ─ NotificationStore ─ Push notifications

FastAPI Backend (Python 3.10+)
  │
  ├─ Orchestrator (LangGraph)
  │   Planner → Executor → Validator → Learner
  │
  ├─ 22 Agents
  │   Core: Planner, Executor, Validator, Learner, Architect, Developer, UI Weaver, Optimizer
  │   Specialist: Code Reviewer, Debugger, QA Tester, DB Architect, DevOps, Data Analyst,
  │               Project Manager, Security Auditor, RAG Agent, API Integration,
  │               Search, Finance, Content Creator
  │
  ├─ Knowledge Graph Engine (AST analysis, blast radius, refactor planner)
  ├─ Skill Vault (SQLite FTS5, deep research, autonomous planning)
  ├─ Vector Store (SQLite FTS5 — RAG knowledge base)
  └─ Multi-provider LLM (OpenAI → Claude → Gemini → vLLM fallback chain)

Persistent Storage
  ├─ PostgreSQL  — audit logs, LLM cost records
  ├─ Redis       — rate limiting, pub/sub
  └─ SQLite      — tasks, skills, social connections, templates, webhooks,
                   chat sessions, notifications, scheduler jobs, workspaces, vector store
```

---

## Agent Roster (22 Agents)

### Core Pipeline
| Agent | Role | MicroStates |
|-------|------|-------------|
| Planner | Break goal into steps using playbook rules | planning, thinking |
| Executor | Run each step (CLI, file read/write, list_files, get_file_tree) | executing, coding |
| Validator | LLM-judge success/partial/failed | testing |
| Learner | Extract reusable rules to procedural memory | optimizing |
| Technical Architect | Design systems, edge cases, failure modes | designing |
| Developer | Code diffs + unit tests | coding |
| Autonomous Optimizer | GEPA prompt evolution | optimizing |
| UI Weaver | HTML/Tailwind components | designing |

### Specialist Agents
| Agent | Capability | Output |
|-------|-----------|--------|
| Code Reviewer | OWASP security scan, code quality score | `CodeReviewResult` |
| Debugger | Root cause analysis, fix suggestions | `DebugReport` |
| QA Tester | Unit/integration/E2E test generation | `QATestingResult` |
| DB Architect | Schema design, ER diagram, migration SQL | `DatabaseSchemaResult` |
| DevOps | Dockerfile, CI/CD, GitHub Actions | `DevOpsReport` |
| Data Analyst | Insights, chart specs, recommendations | `DataAnalyticsReport` |
| Project Manager | Task breakdown, risks, progress % | `ProjectStatusReport` |
| Security Auditor | CWE/OWASP Top 10, risk score | `SecurityAuditReport` |
| RAG Agent | Retrieve + augment + answer from KB | answer + sources |
| API Integration | Generate Python/TS client code, probe endpoint | client code |
| Search Agent | DuckDuckGo search with summary | `AgentspaceSearchResult` |
| Finance Agent | Financial analysis + metrics | `FinanceAnalysisResult` |
| Content Creator | Articles, social posts (Facebook/TikTok) | `ContentCreationResult` |

---

## Feature Map

### 🏢 Cyber-Thai Command Center
- **Isometric 2.5D Office** — Phaser.js canvas, 30×22 grid, 10 zones
- **All 22 agents visualized** — each has home desk, zone-specific accent color
- **Tool-specific animations** — TYPING (fast keyboard tap), READING (document pose), ACTIVE (standing)
- **Matrix spawn/despawn** — digital rain effect on agent appear/disappear  
- **A* pathfinding** — collision-free navigation around furniture
- **Permission bubble delay** — 5-second debounce before showing "waiting" bubble
- **Zone activity lighting** — pulsing overlay when agents active in zone
- **Live progress bar** — task step progress above each agent nameplate
- **Thought bubbles** — cloud-style bubbles when LLM reasons
- **Drag-to-pan** — grab cursor, drag to explore office; camera freezes until WASD
- **Integer zoom snapping** — [0.35, 0.5, 0.66, 0.85, 1.0, 1.25, 1.5, 2.0, 2.5]
- **Sitting pose** — agents sit at desk with proper chair for coding/reading states
- **HD Render mode** — DALL-E 3 generated corporate diorama as static background

### ⚡ Real-time WebSocket Streaming
- **`/ws/dashboard`** — 22-agent state broadcast, EXP effects, log stream
- **`/ws/tasks/{id}`** — per-task: step start/complete, CLI stdout/stderr line-by-line, file events, agent thoughts, task complete/fail
- **`/ws/presence`** — online users, status (online/away/busy), avatar colors
- **`/ws/notifications`** — push notifications (task_completed, task_failed, system_alert, etc.)
- **Event buffer** — 500-event rolling buffer; late-joining clients receive recent history
- **`/ws/tasks/{id}/replay`** — REST endpoint to replay buffered events

### 🤖 Orchestration & Execution
- **LangGraph pipeline** — Planner → Executor → Validator → Learner with smart `_after_learning` routing
- **Real-time step streaming** — each LangGraph node emits step start/complete events via TaskEventHub
- **Live CLI output** — `execute_cli_command` streams stdout/stderr line-by-line via subprocess + threading
- **File system tools** — `list_files(glob, recursive)`, `get_file_tree(depth)`, `search_in_files(regex)`
- **30+ CLI commands allowed** — npm, npx, pip, git, docker, make, pytest, go, cargo, tsc…
- **Working directory** — NEXUS_REPO_ROOT (`/app/data/repos`) for all CLI operations
- **Automatic fallback chain** — vLLM → OpenAI → Claude → Gemini (non-retryable billing errors skip immediately)
- **Playbook learning** — LearnerAgent extracts best practices / anti-patterns to SQLite

### 💬 Chat & Knowledge Base
- **Chat sessions** — multi-turn conversation with any of 22 agent roles; persistent history
- **Streaming chat** — token-by-token SSE stream with provider indicator badge
- **Knowledge Base (RAG)** — upload files → SQLite FTS5 index → semantic search → AI answer with citations
- **File upload** — attach `.py`, `.ts`, `.json`, `.csv`, `.sql`, `.md`, `.pdf` to tasks or KB
- **`/kb/ask`** — retrieves relevant chunks → LLM generates answer with source references

### 📱 Social Media
- **Facebook Page posting** — Graph API v19.0, verify token, text + photo posts
- **TikTok video posting** — Content Posting API v2, OAuth2 flow
- **Auto-post from Content Creator** — generated content → one-click post to connected platforms
- **Post history** — log of all posts with status (published/failed) and direct URL links

### 💰 Cost & Operations
- **API Cost Dashboard** — per-provider/model breakdown, total cost, avg latency, bar chart
- **Cost tracking** — every LLM call auto-logged to `api_cost_log` table with tokens + USD
- **Scheduler (APScheduler)** — cron jobs persist to SQLite; start/stop/toggle/run-count tracking
- **Notifications** — Email (SMTP) + LINE Notify; triggered on task complete/fail; test button in Admin
- **Webhooks** — incoming HTTP triggers → auto-submit task; secret token validation; hit counter
- **Task Templates** — 11 built-in templates + custom, variable substitution (`{{var}}`), usage count
- **Multi-workspace** — workspace isolation, RBAC (viewer/operator/admin), API key management

### 🛡️ Production Hardening
- API-key auth (`X-API-Key`) + WebSocket token
- SlowAPI rate limiting (Redis-backed when `REDIS_URL` set)
- Security headers + HSTS + CSP
- Prometheus `/metrics` + Sentry (optional)
- `tenacity` retries + per-provider `pybreaker` circuit breaker
- Alembic migrations auto-run at container startup
- PDPA-friendly audit logging

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- An API key from at least one LLM provider (OpenAI / Anthropic / Gemini)

### 1. Clone & Configure

```bash
git clone https://github.com/picthaisky/Nexus-Agent.git
cd Nexus-Agent
cp Stack.env.example Stack.env
```

Edit `Stack.env` — minimum required:
```env
NEXUS_API_KEYS=your-secret-api-key
OPENAI_API_KEY=sk-...          # or GEMINI_API_KEY / ANTHROPIC_API_KEY
```

### 2. Deploy with Docker Compose

```bash
docker compose --env-file Stack.env up -d
```

Services:
| Service | URL | Description |
|---------|-----|-------------|
| Dashboard (UI) | http://localhost:3990 | React frontend + nginx |
| Backend API | http://localhost:5190 | FastAPI |
| PostgreSQL | localhost:5492 | Persistent storage |
| Redis | localhost:6399 | Cache + rate limiting |

### 3. First Task

Open http://localhost:3990 → login with your `NEXUS_API_KEYS` value → type in the command bar:

```
@Planner design and build a REST API project in Python with FastAPI
```

Watch the isometric office spring to life as agents plan, code, test, and learn.

---

## Configuration Reference

All settings are driven by environment variables. See [Stack.env.example](Stack.env.example) for the full reference.

### LLM Providers
```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini           # default
OPENAI_BASE_URL=https://api.openai.com/v1

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash

# Local inference (optional)
VLLM_ENABLED=false
VLLM_BASE_URL=http://localhost:8000/v1
VLLM_MODEL_NAME=meta-llama/Meta-Llama-3-8B-Instruct
```

### Notifications
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASSWORD=app-password
NOTIFICATION_EMAIL=alerts@example.com
LINE_NOTIFY_TOKEN=...
```

### Data Persistence (Docker volumes)
```env
NEXUS_DATA_DIR=/app/data          # all SQLite DBs, uploads, repos, docs
NEXUS_REPO_ROOT=/app/data/repos   # CLI command working directory
NEXUS_DOCS_DIR=/app/data/docs     # archived markdown documents
```

### Social Media
```env
# Facebook: get token from https://developers.facebook.com/tools/explorer
# (permissions: pages_manage_posts)

# TikTok OAuth
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
```

---

## API Reference

The backend exposes **70+ REST endpoints** plus 4 WebSocket channels. Interactive docs at `http://localhost:5190/docs` (development mode).

### Core
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness (DB + Redis + LLM) |
| `POST` | `/tasks/run` | Submit a goal to the orchestrator |
| `GET` | `/tasks` | Task history (priority-ordered) |
| `DELETE` | `/tasks?deduplicate=true` | Remove duplicate tasks |
| `WS` | `/ws/dashboard` | Real-time agent state stream |
| `WS` | `/ws/tasks/{id}` | Per-task step + output stream |

### Knowledge & Skills
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/kg/build` | Build AST knowledge graph |
| `POST` | `/kg/blast-radius` | Impact analysis |
| `POST` | `/skills/search` | Semantic skill search |
| `POST` | `/kb/ingest-file/{id}` | Index uploaded file for RAG |
| `POST` | `/kb/ask` | Ask a question with RAG |

### Specialist Agents
| Path | Agent |
|------|-------|
| `POST /agents/code-review` | Code Reviewer |
| `POST /agents/debug` | Debugger |
| `POST /agents/qa-test` | QA Tester |
| `POST /agents/database-design` | DB Architect |
| `POST /agents/devops` | DevOps |
| `POST /agents/data-analytics` | Data Analyst |
| `POST /agents/project-status` | Project Manager |
| `POST /agents/security-audit` | Security Auditor |

### Operations
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/costs/summary` | API cost by provider |
| `GET/POST` | `/scheduler/jobs` | Cron job management |
| `GET/POST` | `/notifications` | Push notification CRUD |
| `POST` | `/social/connect` | Link Facebook / TikTok |
| `POST` | `/social/post` | Publish to social platform |
| `GET/POST` | `/chat/sessions` | Conversation sessions |
| `GET/POST` | `/templates` | Task templates |
| `GET/POST` | `/workspaces` | Multi-workspace + RBAC |

---

## Dashboard Views

| View | Description |
|------|-------------|
| **Isometric Office** | 2.5D game-like office with 22 animated agents |
| **Grid View** | 22 agent monitor cards with live metrics |
| **Workspace Config** | Git repos, skills, roster, templates, task history |
| **Agentspace** | Web search via DuckDuckGo |
| **Specialists (11)** | Run any specialist agent with file attachment |
| **Chat** | Multi-turn conversation with any agent role |
| **Knowledge Base** | Upload → index → search/ask RAG |
| **Cost Monitor** | API cost by provider, tokens, latency chart |
| **Templates** | 11 built-in + custom task templates |
| **Admin** | Scheduler · Notifications · Prompts · Workspaces · Webhooks · Model Config |

---

## Repository Layout

```
Nexus-Agent/
├── nexus_agent/
│   ├── agents/              22 agent implementations
│   ├── core/
│   │   ├── orchestrator.py  LangGraph pipeline
│   │   ├── dashboard_hub.py WebSocket broadcast hub
│   │   ├── task_event_hub.py Per-task streaming hub
│   │   ├── presence_hub.py  Online user presence
│   │   ├── notification_store.py Push notifications
│   │   ├── scheduler.py     APScheduler cron jobs
│   │   ├── vector_store.py  SQLite FTS5 RAG store
│   │   ├── workspace.py     Multi-workspace + RBAC
│   │   ├── prompt_store.py  Prompt version control
│   │   ├── streaming.py     Token-by-token LLM streaming
│   │   ├── notifications.py Email + LINE Notify
│   │   └── ...              inference, settings, memory, skills...
│   ├── tools/
│   │   ├── system_tools.py  CLI + file I/O + file system tools
│   │   └── social_media.py  Facebook + TikTok APIs
│   └── entrypoint.py        FastAPI app (70+ endpoints)
│
├── frontend/
│   ├── src/
│   │   ├── components/      25 React components
│   │   ├── game/
│   │   │   └── scenes/OfficeScene.ts  Phaser isometric engine
│   │   └── hooks/           useAgentSocket, useTaskSocket, usePresence, useNotifications
│   └── nginx.conf           Reverse proxy + routing
│
├── tests/                   157 tests (9 test files)
├── docker-compose.yml       4-service stack
├── Dockerfile               Multi-stage Python build + Node.js
└── Stack.env.example        All environment variables
```

---

## Testing

```bash
# Run full test suite
python -m pytest tests/ -q

# With coverage
python -m pytest tests/ --cov=nexus_agent --cov-report=term-missing

# TypeScript check
cd frontend && npx tsc --noEmit
```

**Test coverage areas**: agents, models, orchestrator, knowledge graph, skill vault, dashboard hub, inference engine, production hardening, diff utils, new features (task store extensions, notification store, scheduler, workspace, vector store, file system tools).

---

## Deployment

### Docker Compose (recommended)
```bash
docker compose --env-file Stack.env up -d

# View logs
docker compose logs -f nexus-agent

# Update after code change
docker compose pull && docker compose up -d
```

### Portainer Stack
1. Copy `Stack.env.example` → fill in your keys
2. In Portainer: Stacks → Add Stack → upload `docker-compose.yml` + `Stack.env`
3. Deploy and access the dashboard at port 3990

### Environment: Persistent Data
All data survives redeploys via Docker named volumes:
- `nexus-agent-data` → `/app/data` (SQLite databases, repos, uploads, docs)
- `nexus-redis-data` → Redis AOF persistence
- `nexus-postgres-data` → PostgreSQL data

### CI/CD (GitHub Actions)
Push to `main` triggers:
1. Backend tests (pytest) + frontend type-check
2. Docker build + push to GitHub Container Registry (`ghcr.io`)
3. Portainer webhook redeploy
4. Health probe on `DEPLOY_URL/health`

Dependabot PRs are excluded from the CI/CD pipeline.

---

## Roadmap

- [ ] Sprite-based character system (replace procedural graphics with PNG spritesheets)
- [ ] Multi-tenant isolation per workspace
- [ ] Agent-to-agent direct message passing
- [ ] Human-in-the-loop approval gate (pause/resume pipeline)
- [ ] Specialist Agent DAG pipeline (architect → developer → code_reviewer → qa → security)
- [ ] Session persistence across server restarts

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All PRs require:
- `pytest tests/` — 0 failures
- `cd frontend && npx tsc --noEmit` — 0 errors
- Conventional commit title

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built with ❤️ by the Nexus-Agent team · Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents)*
