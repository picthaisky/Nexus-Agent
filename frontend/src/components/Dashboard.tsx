import { useMemo } from "react";
import { Activity, Cpu, Wifi, WifiOff } from "lucide-react";
import { useAgentSocket } from "../hooks/useAgentSocket";
import { AgentMonitorCell } from "./AgentMonitorCell";
import { CommandInput } from "./CommandInput";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { LiveLogViewer } from "./LiveLogViewer";

const ORDER = ["planner", "architect", "developer", "ui_weaver", "validator", "optimizer"];

export default function Dashboard() {
  const { agents, connected, expEffects, logs } = useAgentSocket();

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

  const handleRunTask = async (goal: string) => {
    const key = (window as unknown as { __NEXUS_API_KEY__?: string | null }).__NEXUS_API_KEY__ || "";
    // Note: in dev mode, fetch proxy might not prepend /api or might go direct to /tasks/run if configured
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
      throw new Error(`Failed to submit task: ${res.status}`);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-cyber-bg text-slate-300">
      {/* Top bar */}
      <header className="flex-none z-10 border-b border-cyber-neon/20 bg-cyber-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-cyber-gold" />
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-cyber-neon/80">
                Cyber-Thai Command Center
              </div>
              <div className="text-xs text-slate-400">Nexus-Agent · Multi-AI Trading Office</div>
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs text-slate-300">
            <div className="flex items-center gap-1">
              <Cpu className="h-4 w-4 text-status-processing" />
              <span className="font-mono">{cells.length} agents</span>
            </div>
            <div className="font-mono">EXP {totalExp}</div>
            <div className="font-mono">${totalCost.toFixed(4)}</div>
            <div
              className={`flex items-center gap-1 ${
                connected ? "text-status-success" : "text-status-error"
              }`}
            >
              {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              <span>{connected ? "LIVE" : "OFFLINE"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden mx-auto w-full max-w-[1600px] px-6 py-6 gap-6">
        {/* Left Sidebar: Health */}
        <aside className="w-64 flex-none hidden lg:block">
          <SystemHealthPanel />
        </aside>

        {/* Center Grid: Agents */}
        <section className="flex-1 overflow-y-auto min-w-0 pr-2">
          {cells.length === 0 ? (
            <div className="rounded-2xl border border-cyber-neon/20 bg-cyber-panel/50 p-12 text-center text-slate-400">
              Waiting for agent telemetry…
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {cells.map((a) => (
                <AgentMonitorCell key={a.agent_id} agent={a} expFx={fxByAgent[a.agent_id]} />
              ))}
            </div>
          )}
        </section>

        {/* Right Sidebar: Logs */}
        <aside className="w-80 flex-none hidden xl:block">
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
