import { useMemo, useState } from "react";
import { Activity, Cpu, Wifi, WifiOff, LayoutGrid, Box, Sliders, Search, Briefcase, LogOut } from "lucide-react";
import { useAgentSocket } from "../hooks/useAgentSocket";
import { useAuth } from "../auth";
import { AgentMonitorCell } from "./AgentMonitorCell";
import { CommandInput } from "./CommandInput";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { LiveLogViewer } from "./LiveLogViewer";
import { IsometricRoom } from "./IsometricRoom";
import { WorkspacePanel } from "./WorkspacePanel";
import { AgentspacePanel } from "./AgentspacePanel";
import { SpecialistOfficePanel } from "./SpecialistOfficePanel";
import { ErrorBoundary } from "./ErrorBoundary";

const ORDER = ["planner", "architect", "developer", "ui_weaver", "validator", "optimizer"];

export default function Dashboard() {
  const { setApiKey } = useAuth();
  const { agents, connected, expEffects, logs } = useAgentSocket();
  const [viewMode, setViewMode] = useState<"grid" | "isometric" | "workspace" | "agentspace" | "specialists">("isometric");

  const cells = useMemo(() => {
    return ORDER.map((id) => agents[id]).filter(Boolean);
  }, [agents]);

  const fxByAgent = useMemo(() => {
    const map: Record<string, { delta: number }> = {};
    expEffects.forEach((fx) => (map[fx.agent_id] = { delta: fx.delta }));
    return map;
  }, [expEffects]);

  const totalCost = Object.values(agents).reduce(
    (acc, a) => acc + (a.metrics?.cost_usd || 0),
    0
  );
  const totalExp = Object.values(agents).reduce((acc, a) => acc + (a.exp_points || 0), 0);

  const handleRunTask = async (goal: string): Promise<{ task_id?: string }> => {
    const key = (window as unknown as { __NEXUS_API_KEY__?: string | null }).__NEXUS_API_KEY__ || "";
    const targetUrl = import.meta.env?.VITE_NEXUS_API_URL ? `${import.meta.env.VITE_NEXUS_API_URL}/tasks/run` : "/tasks/run";
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key
      },
      body: JSON.stringify({ goal })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail || `Failed to submit task: ${res.status}`);
    }
    return res.json();
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-cyber-bg text-slate-300">
      {/* Top bar */}
      <header className="flex-none z-10 border-b border-cyber-neon/20 bg-cyber-bg/80 backdrop-blur">
        <div className="mx-auto flex flex-col md:flex-row max-w-[1600px] items-center justify-between px-4 py-3 gap-3">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 md:h-6 md:w-6 text-cyber-gold shrink-0" />
            <div className="text-center md:text-left">
              <div className="text-xs md:text-sm uppercase tracking-[0.1em] sm:tracking-[0.2em] md:tracking-[0.3em] text-cyber-neon/80">
                Cyber-Thai Command Center
              </div>
              <div className="text-[10px] md:text-xs text-slate-400">Nexus-Agent · Multi-AI Trading Office</div>
            </div>
          </div>
          
          <div className="flex flex-wrap justify-center items-center gap-4 md:gap-6 text-[10px] md:text-xs text-slate-300">
            {/* View Toggle */}
            <div className="flex border border-cyber-neon/20 rounded-lg p-0.5 bg-cyber-panel/40">
              <button
                onClick={() => setViewMode("isometric")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] md:text-xs rounded-md transition-all font-mono ${
                  viewMode === "isometric"
                    ? "bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/40 shadow-[0_0_10px_rgba(95,225,255,0.25)] font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>Isometric Office</span>
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] md:text-xs rounded-md transition-all font-mono ${
                  viewMode === "grid"
                    ? "bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/40 shadow-[0_0_10px_rgba(95,225,255,0.25)] font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Grid View</span>
              </button>
              <button
                onClick={() => setViewMode("workspace")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] md:text-xs rounded-md transition-all font-mono ${
                  viewMode === "workspace"
                    ? "bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/40 shadow-[0_0_10px_rgba(95,225,255,0.25)] font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Workspace Config</span>
              </button>
              <button
                onClick={() => setViewMode("agentspace")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] md:text-xs rounded-md transition-all font-mono ${
                  viewMode === "agentspace"
                    ? "bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/40 shadow-[0_0_10px_rgba(95,225,255,0.25)] font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Agentspace</span>
              </button>
              <button
                onClick={() => setViewMode("specialists")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[10px] md:text-xs rounded-md transition-all font-mono ${
                  viewMode === "specialists"
                    ? "bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/40 shadow-[0_0_10px_rgba(95,225,255,0.25)] font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                <span>Specialists Office</span>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <Cpu className="h-3 w-3 md:h-4 md:w-4 text-status-processing shrink-0" />
              <span className="font-mono">{cells.length} agents</span>
            </div>
            <div className="font-mono">EXP {totalExp}</div>
            <div className="font-mono">${totalCost.toFixed(4)}</div>
            <div
              className={`flex items-center gap-1 ${
                connected ? "text-status-success" : "text-status-error"
              }`}
            >
              {connected ? <Wifi className="h-3 w-3 md:h-4 md:w-4 shrink-0" /> : <WifiOff className="h-3 w-3 md:h-4 md:w-4 shrink-0" />}
              <span>{connected ? "LIVE" : "OFFLINE"}</span>
            </div>

            {/* Logout */}
            <button
              type="button"
              onClick={() => { if (confirm("ออกจากระบบ?")) setApiKey(null); }}
              title="Logout"
              className="p-1.5 rounded-md border border-slate-700 text-slate-500 hover:text-status-error hover:border-status-error/40 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden mx-auto w-full max-w-[1600px] px-4 py-4 lg:px-6 lg:py-6 gap-6">
        {/* Left Sidebar: Health */}
        <aside className="w-full lg:w-64 flex-none order-2 lg:order-1">
          <SystemHealthPanel />
        </aside>

        {/* Center Section: Agents/Isometric/Workspace */}
        <section className="flex-1 overflow-visible min-w-0 pr-0 lg:pr-2 order-1 lg:order-2">
          {cells.length === 0 ? (
            <div className="rounded-2xl border border-cyber-neon/20 bg-cyber-panel/50 p-6 md:p-12 text-center text-slate-400 text-sm md:text-base">
              Waiting for agent telemetry…
            </div>
          ) : viewMode === "isometric" ? (
            <ErrorBoundary>
              <IsometricRoom agents={agents} expEffects={expEffects} />
            </ErrorBoundary>
          ) : viewMode === "grid" ? (
            <ErrorBoundary>
              <div className="grid grid-cols-1 gap-4 md:gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {cells.map((a) => (
                  <AgentMonitorCell key={a.agent_id} agent={a} expFx={fxByAgent[a.agent_id]} />
                ))}
              </div>
            </ErrorBoundary>
          ) : viewMode === "workspace" ? (
            <ErrorBoundary>
              <WorkspacePanel agents={agents} />
            </ErrorBoundary>
          ) : viewMode === "agentspace" ? (
            <ErrorBoundary>
              <AgentspacePanel />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary>
              <SpecialistOfficePanel />
            </ErrorBoundary>
          )}
        </section>

        {/* Right Sidebar: Logs */}
        <aside className="w-full h-80 lg:h-auto lg:w-80 flex-none order-3 lg:order-3">
          <LiveLogViewer logs={logs} />
        </aside>
      </main>

      {/* Bottom Command Input */}
      <footer className="flex-none">
        <CommandInput onRunTask={handleRunTask} disabled={!connected} />
      </footer>
    </div>
  );
}
