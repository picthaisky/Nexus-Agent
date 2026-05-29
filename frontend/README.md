# Cyber-Thai Command Center · Frontend

Real-time dashboard for the Nexus-Agent multi-AI orchestrator.
Built with **React 19 + Vite + TypeScript + Tailwind CSS**.

## Run locally

```bash
cd frontend
npm install
npm run dev      # opens http://localhost:5173
```

Vite dev server proxies:

- `/api/*` → `http://localhost:8080` (FastAPI REST)
- `/ws/*`  → `ws://localhost:8080`  (WebSocket dashboard)

so make sure the backend is running:

```bash
uvicorn nexus_agent.entrypoint:app --reload --port 8080
```

## Triggering avatar animations manually

```bash
curl -X POST http://localhost:8080/dashboard/emit \
     -H "Content-Type: application/json" \
     -d '{"agent_id":"developer","micro_state":"coding","status_message":"Generating API handler","exp_delta":15}'
```

## Folder structure

```
src/
  hooks/useAgentSocket.ts     # WebSocket client + state hydration
  components/
    Dashboard.tsx             # Trading-office grid layout
    AgentMonitorCell.tsx      # Per-agent panel (header · avatar · metrics · ticker)
    avatars/Avatars.tsx       # 6 Cyber-Thai avatar components
  utils/microStyle.ts         # micro-state → Tailwind palette
  types.ts                    # mirrors backend DashboardEvent schema
```

## Avatar roster

| ID         | Role                 | Thai-Sci-Fi Concept            |
| ---------- | -------------------- | ------------------------------ |
| planner    | PLANNER              | เสนาบดีไซเบอร์ (Cyber Minister) |
| architect  | TECHNICAL_ARCHITECT  | พระวิศวกรรม (Vishnukam)        |
| developer  | DEVELOPER            | วานรล้ำยุค (Future Vanara)     |
| ui_weaver  | UI_WEAVER            | นางอัปสรทอแสง (Glowing Apsara) |
| validator  | VALIDATOR            | ยักษ์ทวารบาล (Guardian Yaksha) |
| optimizer  | AUTONOMOUS_OPTIMIZER | ฤาษีดิจิทัล (Digital Rishi)    |
