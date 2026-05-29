import { useMemo } from "react";
import { Activity, Cpu, Wifi, WifiOff } from "lucide-react";
import { useAgentSocket } from "../hooks/useAgentSocket";
import { AgentMonitorCell } from "./AgentMonitorCell";

const ORDER = ["planner", "architect", "developer", "ui_weaver", "validator", "optimizer"];

export default function Dashboard() {
  const { agents, connected, expEffects } = useAgentSocket();

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

  return (
    <div className="min-h-full">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-cyber-neon/20 bg-cyber-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
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

      {/* Trading Office grid (3x2) */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {cells.length === 0 ? (
          <div className="rounded-2xl border border-cyber-neon/20 bg-cyber-panel/50 p-12 text-center text-slate-400">
            Waiting for agent telemetry…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {cells.map((a) => (
              <AgentMonitorCell key={a.agent_id} agent={a} expFx={fxByAgent[a.agent_id]} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
