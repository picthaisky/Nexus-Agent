import { useEffect, useRef, useState } from "react";
import type { AgentRuntimeState, MicroState } from "../types";
import { ExpFx } from "../hooks/useAgentSocket";
import { PhaserGame, IRefPhaserGame } from "../game/PhaserGame";
import { EventBus } from "../game/EventBus";

interface IsometricRoomProps {
  agents: Record<string, AgentRuntimeState>;
  expEffects: ExpFx[];
}

const ZONE_LEGEND = [
  { name: "Dev Zone",     color: "#1d83b8" },
  { name: "Design Zone",  color: "#9b59b6" },
  { name: "Meeting",      color: "#36c987" },
  { name: "Lounge",       color: "#d4af37" },
  { name: "Pantry",       color: "#c2783a" },
];

const STATE_LABELS: Record<MicroState, string> = {
  idle:             "Idle",
  thinking:         "Thinking",
  planning:         "Planning",
  designing:        "Designing",
  coding:           "Coding",
  executing:        "Executing",
  optimizing:       "Optimizing",
  testing:          "Testing",
  completed:        "Completed",
  waiting_for_human:"Waiting",
  error:            "Error",
  walking:          "Walking",
};

const STATE_COLORS: Record<MicroState, string> = {
  idle:             "#1d83b8",
  thinking:         "#5fe1ff",
  planning:         "#5fe1ff",
  designing:        "#5fe1ff",
  coding:           "#c2783a",
  executing:        "#c2783a",
  optimizing:       "#c2783a",
  testing:          "#c2783a",
  completed:        "#36c987",
  waiting_for_human:"#d4af37",
  error:            "#d94d4d",
  walking:          "#5fe1ff",
};

export function IsometricRoom({ agents, expEffects }: IsometricRoomProps) {
  const phaserRef = useRef<IRefPhaserGame | null>(null);
  const [proximityAgentId, setProximityAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRuntimeState | null>(null);

  // Sync React → Phaser
  useEffect(() => {
    EventBus.emit("update-agents", agents);
    const onReady = () => EventBus.emit("update-agents", agents);
    EventBus.on("current-scene-ready", onReady);
    return () => { EventBus.removeListener("current-scene-ready", onReady); };
  }, [agents]);

  useEffect(() => {
    if (expEffects.length > 0) EventBus.emit("exp-effects", expEffects);
  }, [expEffects]);

  // Listen for Phaser → React events
  useEffect(() => {
    const onProximity = (id: string | null) => setProximityAgentId(id);
    const onInteract = (id: string) => {
      const agent = agents[id];
      if (agent) setSelectedAgent(agent);
    };
    EventBus.on("agent-proximity", onProximity);
    EventBus.on("agent-interact",  onInteract);
    return () => {
      EventBus.removeListener("agent-proximity", onProximity);
      EventBus.removeListener("agent-interact",  onInteract);
    };
  }, [agents]);

  // Keep selectedAgent in sync with live data
  useEffect(() => {
    if (selectedAgent) {
      const live = agents[selectedAgent.agent_id];
      if (live) setSelectedAgent(live);
    }
  }, [agents, selectedAgent]);

  const proximityAgent = proximityAgentId ? agents[proximityAgentId] : null;

  return (
    <div className="relative w-full h-[500px] md:h-[620px] lg:h-[720px] flex items-center justify-center overflow-hidden border border-cyber-neon/15 bg-cyber-panel/30 rounded-2xl shadow-2xl backdrop-blur-sm">

      {/* Header badge */}
      <div className="absolute top-3 left-4 text-[10px] font-mono text-cyber-neon/60 select-none pointer-events-none uppercase tracking-[0.15em] flex items-center gap-2 z-10">
        <span className="w-1.5 h-1.5 bg-cyber-neon rounded-full animate-ping" />
        <span>VIRTUAL WORKSPACE // CYBER-THAI OFFICE</span>
      </div>

      {/* Zone Legend (top-right) */}
      <div className="absolute top-3 right-4 z-10 flex flex-col gap-0.5 pointer-events-none">
        {ZONE_LEGEND.map((z) => (
          <div key={z.name} className="flex items-center gap-1.5 text-[9px] font-mono opacity-70">
            <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: z.color }} />
            <span style={{ color: z.color }}>{z.name}</span>
          </div>
        ))}
      </div>

      {/* Phaser Canvas */}
      <div className="w-full h-full relative">
        <PhaserGame ref={phaserRef} />
      </div>

      {/* Controls hint (bottom-left) */}
      <div className="absolute bottom-3 left-4 text-[9px] font-mono text-slate-500 select-none pointer-events-none z-10 flex items-center gap-3">
        <span>WASD / ↑↓←→ Move</span>
        <span className="text-slate-600">|</span>
        <span>E Interact</span>
        <span className="text-slate-600">|</span>
        <span>Scroll Zoom</span>
      </div>

      {/* Proximity prompt (center-bottom, animated) */}
      {proximityAgent && !selectedAgent && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-cyber-bg/90 border border-cyber-neon/40 rounded-lg px-4 py-2 backdrop-blur shadow-[0_0_20px_rgba(95,225,255,0.3)] animate-pulse">
          <span className="text-[10px] font-mono text-slate-300">
            Press{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/40 text-[9px]">E</kbd>
            {" "}to talk with{" "}
            <span className="text-cyber-neon font-bold">{proximityAgent.display_name}</span>
          </span>
        </div>
      )}

      {/* Agent Detail Card (right side overlay) */}
      {selectedAgent && (
        <AgentDetailCard
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}

// ─── Agent Detail Card ────────────────────────────────────────────────────────

function AgentDetailCard({
  agent,
  onClose,
}: {
  agent: AgentRuntimeState;
  onClose: () => void;
}) {
  const state = agent.current_micro_state;
  const stateColor = STATE_COLORS[state] ?? "#888";
  const stateLabel = STATE_LABELS[state] ?? state;

  return (
    <div className="absolute right-4 top-10 bottom-10 w-56 z-30 flex flex-col bg-cyber-bg/95 border border-cyber-neon/30 rounded-xl shadow-[0_0_30px_rgba(95,225,255,0.2)] backdrop-blur overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-cyber-neon/20">
        <span className="text-[10px] font-mono text-cyber-neon/70 uppercase tracking-widest">Agent Profile</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-200 text-lg leading-none"
        >×</button>
      </div>

      {/* Agent info */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-xs font-mono">
        {/* Name + Role */}
        <div>
          <div className="text-white font-bold text-sm truncate">{agent.display_name}</div>
          <div className="text-slate-400 text-[10px] uppercase tracking-widest mt-0.5">{agent.role}</div>
        </div>

        {/* State badge */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-none animate-pulse" style={{ backgroundColor: stateColor }} />
          <span style={{ color: stateColor }} className="font-bold uppercase text-[10px]">{stateLabel}</span>
        </div>

        {/* Status message */}
        {agent.status_message && (
          <div className="bg-cyber-panel/60 border border-cyber-neon/10 rounded-lg p-2">
            <div className="text-[9px] text-slate-400 mb-1">Status</div>
            <div className="text-slate-300 text-[10px] leading-relaxed">{agent.status_message}</div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-cyber-neon/10" />

        {/* Metrics */}
        <div className="space-y-1.5 text-[10px]">
          <div className="text-slate-400 uppercase tracking-widest text-[9px]">Metrics</div>
          <MetricRow label="EXP"       value={String(agent.exp_points ?? 0)}        color="#d4af37" />
          <MetricRow label="Cost"      value={`$${(agent.metrics?.cost_usd ?? 0).toFixed(4)}`} color="#c2783a" />
          <MetricRow label="Tokens ↑" value={String(agent.metrics?.tokens_in ?? 0)} color="#5fe1ff" />
          <MetricRow label="Tokens ↓" value={String(agent.metrics?.tokens_out ?? 0)} color="#5fe1ff" />
          {agent.metrics?.processing_time_ms != null && (
            <MetricRow label="Time"    value={`${agent.metrics.processing_time_ms}ms`} color="#9b59b6" />
          )}
          {agent.metrics?.cpu_percent != null && (
            <MetricRow label="CPU"     value={`${agent.metrics.cpu_percent.toFixed(1)}%`} color="#36c987" />
          )}
        </div>

        {/* Task ID */}
        {agent.current_task_id && (
          <>
            <div className="border-t border-cyber-neon/10" />
            <div className="text-[9px] text-slate-400 uppercase tracking-widest">Task</div>
            <div className="text-slate-300 text-[9px] truncate">{agent.current_task_id}</div>
          </>
        )}
      </div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400">{label}</span>
      <span style={{ color }} className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
