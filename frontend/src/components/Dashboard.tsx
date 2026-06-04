import { useMemo, useState, useCallback } from "react";
import {
  Activity, Cpu, Wifi, WifiOff, LayoutGrid, Box, Sliders,
  Search, Briefcase, LogOut, DollarSign, Tag, MessageSquare,
  Database, Settings, ChevronDown, ChevronRight, Zap,
} from "lucide-react";
import { useAgentSocket } from "../hooks/useAgentSocket";
import { useAuth } from "../auth";
import { AgentMonitorCell }      from "./AgentMonitorCell";
import { CommandInput }          from "./CommandInput";
import { SystemHealthPanel }     from "./SystemHealthPanel";
import { LiveLogViewer }         from "./LiveLogViewer";
import { IsometricRoom }         from "./IsometricRoom";
import { WorkspacePanel }        from "./WorkspacePanel";
import { AgentspacePanel }       from "./AgentspacePanel";
import { SpecialistOfficePanel } from "./SpecialistOfficePanel";
import { CostDashboard }         from "./CostDashboard";
import { TaskTemplates }         from "./TaskTemplates";
import { ChatPanel }             from "./ChatPanel";
import { KnowledgeBasePanel }    from "./KnowledgeBasePanel";
import { AdminPanel }            from "./AdminPanel";
import { LiveTaskProgress }      from "./LiveTaskProgress";
import { NotificationCenter }   from "./NotificationCenter";
import { ParticleBackground }   from "./ParticleBackground";
import { ErrorBoundary }        from "./ErrorBoundary";

type ViewMode =
  | "isometric" | "grid" | "workspace" | "agentspace"
  | "specialists" | "costs" | "templates"
  | "chat" | "knowledge-base" | "admin";

// All 16 registered agent IDs — matches DEFAULT_ROSTER in dashboard_hub.py.
// Core agents first, then specialist agents in alphabetical groups.
const ORDER = [
  // Core orchestration agents
  "planner", "architect", "developer", "ui_weaver", "validator", "optimizer",
  // Specialist agents
  "code_reviewer", "debugger", "qa_tester", "db_architect",
  "devops", "data_analyst", "project_mgr", "security",
  "rag_agent", "api_integration",
];

// ── View definitions ──────────────────────────────────────────────────────────
const VIEW_GROUPS = [
  {
    label: "Office",
    views: [
      { id: "isometric" as ViewMode, icon: <Box className="w-3.5 h-3.5" />,         label: "Isometric Office" },
      { id: "grid"      as ViewMode, icon: <LayoutGrid className="w-3.5 h-3.5" />,  label: "Grid View" },
      { id: "workspace" as ViewMode, icon: <Sliders className="w-3.5 h-3.5" />,     label: "Workspace Config" },
      { id: "agentspace"as ViewMode, icon: <Search className="w-3.5 h-3.5" />,      label: "Agentspace" },
    ],
  },
  {
    label: "Agents",
    views: [
      { id: "specialists"   as ViewMode, icon: <Briefcase className="w-3.5 h-3.5" />,     label: "Specialists (11)" },
      { id: "chat"          as ViewMode, icon: <MessageSquare className="w-3.5 h-3.5" />, label: "Chat" },
      { id: "knowledge-base"as ViewMode, icon: <Database className="w-3.5 h-3.5" />,      label: "Knowledge Base" },
    ],
  },
  {
    label: "System",
    views: [
      { id: "costs"     as ViewMode, icon: <DollarSign className="w-3.5 h-3.5" />,  label: "Cost Monitor" },
      { id: "templates" as ViewMode, icon: <Tag className="w-3.5 h-3.5" />,         label: "Templates" },
      { id: "admin"     as ViewMode, icon: <Settings className="w-3.5 h-3.5" />,    label: "Admin" },
    ],
  },
];

export default function Dashboard() {
  const { setApiKey } = useAuth();
  const { agents, connected, expEffects, logs } = useAgentSocket();
  const [viewMode, setViewMode] = useState<ViewMode>("isometric");
  const [navExpanded, setNavExpanded] = useState<Record<string,boolean>>({ Office: true, Agents: true, System: true });
  const [liveTaskId,   setLiveTaskId]   = useState<string | null>(null);
  const [liveTaskGoal, setLiveTaskGoal] = useState("");

  const cells = useMemo(() => ORDER.map(id => agents[id]).filter(Boolean), [agents]);

  const fxByAgent = useMemo(() => {
    const map: Record<string, { delta: number }> = {};
    expEffects.forEach(fx => (map[fx.agent_id] = { delta: fx.delta }));
    return map;
  }, [expEffects]);

  const totalCost = Object.values(agents).reduce((a, ag) => a + (ag.metrics?.cost_usd || 0), 0);
  const totalExp  = Object.values(agents).reduce((a, ag) => a + (ag.exp_points || 0), 0);

  const handleRunTask = async (goal: string): Promise<{ task_id?: string }> => {
    const key = (window as any).__NEXUS_API_KEY__ || "";
    const url = import.meta.env?.VITE_NEXUS_API_URL ? `${import.meta.env.VITE_NEXUS_API_URL}/tasks/run` : "/tasks/run";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify({ goal }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    // Auto-open live task monitor
    if (data.task_id) {
      setLiveTaskId(data.task_id);
      setLiveTaskGoal(goal);
      // Notify IsometricRoom so it can subscribe to task-step progress events
      const { EventBus } = await import("../game/EventBus");
      EventBus.emit("task-started", data.task_id);
    }
    return data;
  };

  const openLiveTask = useCallback((taskId: string, goal = "") => {
    setLiveTaskId(taskId); setLiveTaskGoal(goal);
  }, []);

  // Full-width views (no sidebar)
  const isFullWidth = viewMode === "chat" || viewMode === "knowledge-base" || viewMode === "admin";

  return (
    <div className="flex h-screen overflow-hidden bg-cyber-bg text-slate-300 relative">

      {/* ── Particle background (full-screen, behind everything) ──── */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <ParticleBackground mode="neural" count={45} opacity={0.35} speed={0.25} interactive={false} />
      </div>

      {/* ── Left Nav (collapsible sidebar) ─────────────────────────────── */}
      <nav className="relative z-10 flex-none w-48 flex flex-col border-r border-cyber-neon/20 bg-cyber-bg/90 overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center gap-2 px-3 py-4 border-b border-cyber-neon/15">
          <Activity className="h-5 w-5 text-cyber-gold shrink-0" />
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.2em] text-cyber-neon/80 truncate">Cyber-Thai CC</div>
            <div className="text-[8px] text-slate-500 truncate">Nexus-Agent</div>
          </div>
        </div>

        {/* View groups */}
        <div className="flex-1 py-2">
          {VIEW_GROUPS.map(group => (
            <div key={group.label} className="mb-1">
              <button type="button"
                onClick={() => setNavExpanded(e => ({ ...e, [group.label]: !e[group.label] }))}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[9px] uppercase font-mono text-slate-500 hover:text-slate-400 tracking-widest">
                {group.label}
                {navExpanded[group.label] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {navExpanded[group.label] && group.views.map(v => (
                <button key={v.id} type="button"
                  onClick={() => setViewMode(v.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] font-mono transition-all ${
                    viewMode === v.id
                      ? "bg-cyber-neon/15 text-cyber-neon border-r-2 border-cyber-neon font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <span className={viewMode === v.id ? "text-cyber-neon" : "text-slate-600"}>{v.icon}</span>
                  {v.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Stats, Notifications & Logout */}
        <div className="border-t border-cyber-neon/15 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
            <Cpu className="w-3 h-3 text-status-processing" />
            {cells.length} agents
          </div>
          <div className="text-[9px] font-mono text-slate-500">EXP {totalExp} · ${totalCost.toFixed(4)}</div>
          <div className={`flex items-center gap-1 text-[9px] font-mono ${connected ? "text-status-success" : "text-status-error"}`}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? "LIVE" : "OFFLINE"}
          </div>
          {/* Notification bell */}
          <div className="flex items-center justify-between mt-1">
            <button type="button" title="Logout"
              onClick={() => { if (confirm("ออกจากระบบ?")) setApiKey(null); }}
              className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500 hover:text-status-error transition-colors">
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
            <NotificationCenter />
          </div>
        </div>
      </nav>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col overflow-hidden">

        {/* Full-width views */}
        {isFullWidth && (
          <div className="flex-1 overflow-hidden p-4">
            <ErrorBoundary>
              {viewMode === "chat"          && <ChatPanel />}
              {viewMode === "knowledge-base"&& <KnowledgeBasePanel />}
              {viewMode === "admin"         && <AdminPanel />}
            </ErrorBoundary>
          </div>
        )}

        {/* Standard 3-column layout */}
        {!isFullWidth && (
          <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden px-4 py-4 lg:px-5 lg:py-5 gap-5">
            {/* Left sidebar */}
            <aside className="w-full lg:w-60 flex-none order-2 lg:order-1">
              <SystemHealthPanel />
            </aside>

            {/* Center — scrollable for all views except isometric (which needs overflow-visible) */}
            <section
              className={`flex-1 min-w-0 order-1 lg:order-2 ${
                viewMode === "isometric"
                  ? "overflow-visible"
                  : "overflow-y-auto pr-1"
              }`}
            >
              {viewMode === "isometric" ? (
                <ErrorBoundary>
                  <IsometricRoom agents={agents} expEffects={expEffects} />
                </ErrorBoundary>
              ) : viewMode === "grid" ? (
                <ErrorBoundary>
                  {cells.length === 0 ? (
                    <div className="rounded-2xl border border-cyber-neon/20 bg-cyber-panel/50 p-12 text-center text-slate-400 text-sm">
                      Waiting for agent telemetry… <br />
                      <span className="text-[10px] text-slate-600">Connect to the backend WebSocket to see live agent data.</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 pb-4">
                      {cells.map(a => (
                        <AgentMonitorCell key={a.agent_id} agent={a} expFx={fxByAgent[a.agent_id]} />
                      ))}
                    </div>
                  )}
                </ErrorBoundary>
              ) : viewMode === "workspace" ? (
                <ErrorBoundary><WorkspacePanel agents={agents} /></ErrorBoundary>
              ) : viewMode === "agentspace" ? (
                <ErrorBoundary><AgentspacePanel /></ErrorBoundary>
              ) : viewMode === "specialists" ? (
                <ErrorBoundary><SpecialistOfficePanel /></ErrorBoundary>
              ) : viewMode === "costs" ? (
                <ErrorBoundary><CostDashboard /></ErrorBoundary>
              ) : (
                <ErrorBoundary><TaskTemplates onRunTask={handleRunTask} /></ErrorBoundary>
              )}
            </section>

            {/* Right sidebar */}
            <aside className="w-full h-72 lg:h-auto lg:w-72 flex-none order-3">
              <LiveLogViewer
                logs={logs}
                activeTaskId={liveTaskId}
                onOpenTask={(tid) => openLiveTask(tid)}
              />
            </aside>
          </main>
        )}

        {/* Command Input (all non-full views) */}
        {!isFullWidth && (
          <footer className="flex-none border-t border-cyber-neon/15">
            <CommandInput onRunTask={handleRunTask} disabled={!connected} />
          </footer>
        )}
      </div>

      {/* ── Floating Live Task Monitor ────────────────────────────────────────── */}
      {liveTaskId && (
        <div className="fixed right-6 bottom-20 z-40 w-[420px] h-[520px] shadow-2xl animate-in slide-in-from-right-4 fade-in duration-300">
          <ErrorBoundary>
            <LiveTaskProgress
              taskId={liveTaskId}
              taskGoal={liveTaskGoal}
              onClose={() => setLiveTaskId(null)}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
