# Feature: Interactive Command Center & Comprehensive System Monitoring

This plan extends the Command Center (Dashboard) to become a fully interactive and comprehensive monitoring hub. Users will be able to submit tasks directly from the UI, and monitor every aspect of the system's health, metrics, and workflow progression.

## Proposed Changes

### 1. Command Input Interface (Frontend & Backend)
We will add an interactive terminal/input area to send tasks directly to the agents.
- **Backend ([entrypoint.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/entrypoint.py)):** Add a `POST /tasks/run` endpoint using FastAPI `BackgroundTasks` to execute the Orchestrator loop asynchronously without blocking the UI.
- **Frontend ([Dashboard.tsx](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/frontend/src/components/Dashboard.tsx)):** Add a sleek "Command Input" bar fixed at the bottom of the screen.

### 2. Comprehensive System Health Panel (Frontend)
The system currently has `/health` and `/info` API endpoints that check PostgreSQL, Redis, and AI Models. We will display these visually.
- **Frontend Panel:** Create a new sidebar or top-level widgets showing:
  - Database Status (PostgreSQL, Redis)
  - LLM Providers Status (OpenAI, Claude, Gemini, Local vLLM)
  - API Rate limits and Circuit Breaker statuses.
- **Data Fetching:** The dashboard will periodically poll `/health` and `/info` (or listen via WebSockets) to update these indicators in real-time.

### 3. Task Progression & Log Viewer (Frontend)
Currently, agents show their micro-state (e.g., THINKING, CODING). We will add a view to see the actual logs and the overarching task progress.
- **Frontend Panel:** Add a "Live Terminal" or "System Logs" section that streams the steps the Orchestrator is taking (e.g., "Architect completed design", "Developer resolving dependencies").
- **Backend:** Update the WebSocket emitter in `orchestrator.py` to push detailed log messages and overarching task status updates to the UI.

### 4. System Metrics Dashboard (Frontend)
- Leverage the existing `/dashboard/metrics` to show real-time Token Usage and Total API Costs aggregated across all agents.

---

## User Review Required

> [!IMPORTANT]
> Adding these comprehensive panels will change the layout of the current Dashboard. To fit the new "System Health Panel" and "Log Viewer", the Agent Grid (the 6 avatars) might need to be resized or placed in the center while the new panels sit on the left/right sides or bottom.

## Open Questions

1. **Layout Design:** 
   - Option A: **Command Center Style** - Agents in the center, System Health on the left sidebar, Live Logs on the right sidebar, and Command Input at the bottom.
   - Option B: **Terminal Style** - Agents at the top (smaller), and a large terminal-like view at the bottom for Logs and Command Input.
   Which layout style do you prefer?
2. **Clear previous state:** When a new task is submitted, should the system clear the logs and reset all agent states to "STANDBY" automatically?

Please approve this plan or let me know which layout option you prefer, and I will begin the development immediately!
