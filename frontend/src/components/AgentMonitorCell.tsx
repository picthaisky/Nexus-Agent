import { useEffect, useState } from "react";
import type { AgentRuntimeState } from "../types";
import { microStyle } from "../utils/microStyle";
import { AVATAR_MAP } from "./avatars/Avatars";

interface Props {
  agent: AgentRuntimeState;
  expFx?: { delta: number };
}

/** One agent monitor: header · avatar · metrics · log ticker. */
export function AgentMonitorCell({ agent, expFx }: Props) {
  const Avatar = AVATAR_MAP[agent.agent_id] ?? AVATAR_MAP.planner;
  const s = microStyle(agent.current_micro_state);

  // Typewriter effect for status_message
  const [typed, setTyped] = useState(agent.status_message);
  useEffect(() => {
    setTyped("");
    let i = 0;
    const msg = agent.status_message ?? "";
    const id = window.setInterval(() => {
      i += 1;
      setTyped(msg.slice(0, i));
      if (i >= msg.length) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [agent.status_message]);

  return (
    <div className="group relative flex flex-col rounded-2xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-sm shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cyber-neon/10 px-4 py-2">
        <div>
          <div className="text-xs uppercase tracking-widest text-cyber-neon/70">
            {agent.role.replace(/_/g, " ")}
          </div>
          <div className="text-base font-semibold text-slate-100">{agent.display_name || agent.agent_id}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono ${s.badge}`}>{s.label}</span>
      </div>

      {/* Avatar stage */}
      <div className="relative flex h-56 items-center justify-center">
        <Avatar microState={agent.current_micro_state} />
        {expFx && (
          <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 text-2xl font-bold text-status-success animate-exp-popup">
            +{expFx.delta} EXP
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 border-t border-cyber-neon/10 px-4 py-2 text-[11px] text-slate-300">
        <div>
          <div className="text-cyber-neon/70">EXP</div>
          <div className="font-mono">{agent.exp_points}</div>
        </div>
        <div>
          <div className="text-cyber-neon/70">Time</div>
          <div className="font-mono">{agent.metrics.processing_time_ms?.toFixed(0) || 0} ms</div>
        </div>
        <div>
          <div className="text-cyber-neon/70">Cost</div>
          <div className="font-mono">${agent.metrics.cost_usd?.toFixed(4) || "0.0000"}</div>
        </div>
      </div>

      {/* Log ticker */}
      <div className="relative h-7 overflow-hidden rounded-b-2xl border-t border-cyber-neon/10 bg-black/40 px-3">
        <div className="absolute inset-y-0 right-0 flex items-center font-mono text-[11px] text-cyber-neon/90">
          <span className="mr-2 text-cyber-gold/70">»</span>
          {typed}
          <span className="ml-0.5 animate-pulse">▍</span>
        </div>
      </div>
    </div>
  );
}
