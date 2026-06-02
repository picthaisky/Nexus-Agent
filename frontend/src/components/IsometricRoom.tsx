import { useEffect, useRef, useState, useCallback } from "react";
import type { AgentRuntimeState, MicroState } from "../types";
import { ExpFx } from "../hooks/useAgentSocket";
import { PhaserGame, IRefPhaserGame } from "../game/PhaserGame";
import { EventBus } from "../game/EventBus";
import { SCENE_DEFAULTS, type SceneGenerateResponse } from "../game/sceneConfig";

interface IsometricRoomProps {
  agents: Record<string, AgentRuntimeState>;
  expEffects: ExpFx[];
}

// ─── Static Tailwind class lookup maps (no inline styles) ─────────────────────

const ZONE_LEGEND = [
  { name: "Developer Zone", dot: "bg-blue-700",   text: "text-blue-700" },
  { name: "Design Zone",    dot: "bg-violet-700", text: "text-violet-700" },
  { name: "Meeting Room",   dot: "bg-green-800",  text: "text-green-800" },
  { name: "Lounge",         dot: "bg-amber-800",  text: "text-amber-800" },
  { name: "Pantry",         dot: "bg-orange-700", text: "text-orange-700" },
];

interface StateStyle {
  label:       string;
  text:        string;   // text-*
  dot:         string;   // bg-*
  badgeBg:     string;   // bg-* + border-*
  msgBg:       string;   // bg-*
  leftBorder:  string;   // border-l-*
}

const STATE_STYLES: Record<MicroState, StateStyle> = {
  idle:             { label: "Available",   text: "text-slate-500",   dot: "bg-slate-400",   badgeBg: "bg-slate-50 border-slate-200",   msgBg: "bg-slate-50",   leftBorder: "border-l-slate-400" },
  thinking:         { label: "Thinking",    text: "text-blue-600",    dot: "bg-blue-500",    badgeBg: "bg-blue-50 border-blue-200",     msgBg: "bg-blue-50",    leftBorder: "border-l-blue-500" },
  planning:         { label: "Planning",    text: "text-blue-600",    dot: "bg-blue-500",    badgeBg: "bg-blue-50 border-blue-200",     msgBg: "bg-blue-50",    leftBorder: "border-l-blue-500" },
  designing:        { label: "Designing",   text: "text-violet-600",  dot: "bg-violet-500",  badgeBg: "bg-violet-50 border-violet-200", msgBg: "bg-violet-50",  leftBorder: "border-l-violet-500" },
  coding:           { label: "Coding",      text: "text-cyan-700",    dot: "bg-cyan-500",    badgeBg: "bg-cyan-50 border-cyan-200",     msgBg: "bg-cyan-50",    leftBorder: "border-l-cyan-500" },
  executing:        { label: "Executing",   text: "text-cyan-700",    dot: "bg-cyan-500",    badgeBg: "bg-cyan-50 border-cyan-200",     msgBg: "bg-cyan-50",    leftBorder: "border-l-cyan-500" },
  optimizing:       { label: "Optimizing",  text: "text-amber-600",   dot: "bg-amber-500",   badgeBg: "bg-amber-50 border-amber-200",   msgBg: "bg-amber-50",   leftBorder: "border-l-amber-500" },
  testing:          { label: "Testing",     text: "text-emerald-700", dot: "bg-emerald-500", badgeBg: "bg-emerald-50 border-emerald-200",msgBg: "bg-emerald-50", leftBorder: "border-l-emerald-500" },
  completed:        { label: "Completed",   text: "text-green-600",   dot: "bg-green-500",   badgeBg: "bg-green-50 border-green-200",   msgBg: "bg-green-50",   leftBorder: "border-l-green-500" },
  waiting_for_human:{ label: "Waiting",     text: "text-amber-600",   dot: "bg-amber-500",   badgeBg: "bg-amber-50 border-amber-200",   msgBg: "bg-amber-50",   leftBorder: "border-l-amber-500" },
  error:            { label: "Issue",       text: "text-red-600",     dot: "bg-red-500",     badgeBg: "bg-red-50 border-red-200",       msgBg: "bg-red-50",     leftBorder: "border-l-red-500" },
  walking:          { label: "In Transit",  text: "text-blue-600",    dot: "bg-blue-500",    badgeBg: "bg-blue-50 border-blue-200",     msgBg: "bg-blue-50",    leftBorder: "border-l-blue-500" },
};

interface RoleStyle {
  stripe:  string;   // bg-* for top stripe
  text:    string;   // text-*
  dot:     string;   // bg-*
}

const ROLE_STYLES: Record<string, RoleStyle> = {
  planner:             { stripe: "bg-blue-700",   text: "text-blue-700",   dot: "bg-blue-700" },
  technical_architect: { stripe: "bg-cyan-700",   text: "text-cyan-700",   dot: "bg-cyan-700" },
  developer:           { stripe: "bg-green-800",  text: "text-green-800",  dot: "bg-green-800" },
  ui_weaver:           { stripe: "bg-violet-700", text: "text-violet-700", dot: "bg-violet-700" },
  validator:           { stripe: "bg-red-700",    text: "text-red-700",    dot: "bg-red-700" },
  autonomous_optimizer:{ stripe: "bg-amber-800",  text: "text-amber-800",  dot: "bg-amber-800" },
};
const DEFAULT_ROLE_STYLE: RoleStyle = { stripe: "bg-slate-600", text: "text-slate-600", dot: "bg-slate-600" };

// ─── Component ────────────────────────────────────────────────────────────────

export function IsometricRoom({ agents, expEffects }: IsometricRoomProps) {
  const phaserRef = useRef<IRefPhaserGame | null>(null);
  const [proximityAgentId, setProximityAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRuntimeState | null>(null);

  // Scene generation state
  const [genState, setGenState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [sceneImage, setSceneImage] = useState<SceneGenerateResponse | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const handleGenerateScene = useCallback(async () => {
    setGenState("loading");
    setGenError(null);
    try {
      const key = (window as any).__NEXUS_API_KEY__ || "";
      const base = (import.meta as any).env?.VITE_NEXUS_API_URL || "";
      const res = await fetch(`${base}/scene/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: JSON.stringify(SCENE_DEFAULTS),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).detail || `HTTP ${res.status}`);
      }
      const data: SceneGenerateResponse = await res.json();
      setSceneImage(data);
      setGenState("done");
      setShowModal(true);
    } catch (e: any) {
      setGenError(e.message || "Generation failed");
      setGenState("error");
    }
  }, []);

  useEffect(() => {
    EventBus.emit("update-agents", agents);
    const onReady = () => EventBus.emit("update-agents", agents);
    EventBus.on("current-scene-ready", onReady);
    return () => { EventBus.removeListener("current-scene-ready", onReady); };
  }, [agents]);

  useEffect(() => {
    if (expEffects.length > 0) EventBus.emit("exp-effects", expEffects);
  }, [expEffects]);

  useEffect(() => {
    const onProximity = (id: string | null) => setProximityAgentId(id);
    const onInteract  = (id: string) => { const a = agents[id]; if (a) setSelectedAgent(a); };
    EventBus.on("agent-proximity", onProximity);
    EventBus.on("agent-interact",  onInteract);
    return () => {
      EventBus.removeListener("agent-proximity", onProximity);
      EventBus.removeListener("agent-interact",  onInteract);
    };
  }, [agents]);

  useEffect(() => {
    if (selectedAgent) {
      const live = agents[selectedAgent.agent_id];
      if (live) setSelectedAgent(live);
    }
  }, [agents, selectedAgent]);

  const proximityAgent = proximityAgentId ? agents[proximityAgentId] : null;

  return (
    <div className="relative w-full h-[500px] md:h-[620px] lg:h-[720px] flex items-center justify-center overflow-hidden border border-slate-200 bg-white rounded-2xl shadow-lg">

      {/* Header — clean corporate badge */}
      <div className="absolute top-3 left-4 z-10 pointer-events-none select-none">
        <div className="flex items-center gap-1.5 bg-white/90 border border-slate-200 rounded-md px-2.5 py-1 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          <span className="text-[9px] font-semibold text-slate-500 tracking-wide uppercase">
            Virtual Workspace · Corporate Operations
          </span>
        </div>
      </div>

      {/* Zone Legend — top right */}
      <div className="absolute top-3 right-4 z-10 flex flex-col gap-1 pointer-events-none">
        {ZONE_LEGEND.map((z) => (
          <div key={z.name} className="flex items-center gap-1.5 bg-white/85 border border-slate-100 rounded px-2 py-0.5 shadow-sm">
            <span className={`w-2 h-2 rounded-full flex-none ${z.dot}`} />
            <span className={`text-[8px] font-medium tracking-wide ${z.text}`}>{z.name}</span>
          </div>
        ))}
      </div>

      {/* Phaser Canvas */}
      <div className="w-full h-full relative">
        <PhaserGame ref={phaserRef} />
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-3 left-4 z-10 pointer-events-none select-none">
        <div className="flex items-center gap-2 bg-white/80 border border-slate-200 rounded px-2.5 py-1 shadow-sm">
          {([ ["WASD", "Move"], ["E", "Profile"], ["Scroll", "Zoom"] ] as const).map(([key, desc]) => (
            <span key={key} className="flex items-center gap-1 text-[8px] text-slate-400">
              <kbd className="px-1 py-0.5 rounded border border-slate-300 bg-slate-50 text-slate-500 font-mono text-[7px]">{key}</kbd>
              <span>{desc}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Proximity prompt */}
      {proximityAgent && !selectedAgent && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-white border border-blue-200 rounded-lg px-4 py-2 shadow-md animate-pulse">
          <kbd className="px-1.5 py-0.5 rounded border border-blue-300 bg-blue-50 text-blue-700 font-mono text-[9px] font-bold">E</kbd>
          <span className="text-[10px] text-slate-600">
            View profile —{" "}
            <span className="font-semibold text-blue-700">{proximityAgent.display_name}</span>
          </span>
        </div>
      )}

      {/* Agent Detail Card */}
      {selectedAgent && (
        <AgentDetailCard agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}

      {/* Generate Corporate Scene button — bottom right */}
      <div className="absolute bottom-3 right-4 z-10">
        {genState === "error" && genError && (
          <div className="mb-1 text-[9px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-48 text-right">
            {genError}
          </div>
        )}
        <button
          type="button"
          onClick={genState === "loading" ? undefined : handleGenerateScene}
          disabled={genState === "loading"}
          className="flex items-center gap-1.5 bg-white border border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-3 py-1.5 rounded-lg text-[10px] font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {genState === "loading" ? (
            <>
              <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-none" />
              Generating…
            </>
          ) : (
            <>
              <span className="text-[11px]">✦</span>
              Generate Corporate Scene
            </>
          )}
        </button>
      </div>

      {/* Generated image modal */}
      {showModal && sceneImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative max-w-5xl w-full mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <div className="text-sm font-bold text-slate-800">Corporate Operations Diorama</div>
                <div className="text-[9px] text-slate-400 mt-0.5">
                  Generated by DALL-E 3 · {sceneImage.size} · {sceneImage.quality.toUpperCase()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={sceneImage.url}
                  download="corporate-diorama.png"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded px-2.5 py-1 transition-colors"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-lg transition-colors"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Image */}
            <img
              src={sceneImage.url}
              alt="Corporate Operations Diorama"
              className="w-full object-contain max-h-[70vh]"
            />

            {/* Revised prompt */}
            {sceneImage.revised_prompt && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
                <div className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Refined Prompt (by DALL-E 3)
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-3">
                  {sceneImage.revised_prompt}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agent Detail Card ────────────────────────────────────────────────────────

function AgentDetailCard({ agent, onClose }: { agent: AgentRuntimeState; onClose: () => void }) {
  const ss   = STATE_STYLES[agent.current_micro_state] ?? STATE_STYLES.idle;
  const rs   = ROLE_STYLES[agent.role] ?? DEFAULT_ROLE_STYLE;
  const isActive = agent.current_micro_state !== "idle";
  const [firstName, title] = agent.display_name.split(" / ");

  return (
    <div className="absolute right-4 top-10 bottom-10 w-60 z-30 flex flex-col bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">

      {/* Role-colored top stripe */}
      <div className={`h-1 w-full flex-none ${rs.stripe}`} />

      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`w-2.5 h-2.5 rounded-full flex-none ${rs.dot}`} />
            <span className={`text-[9px] font-semibold uppercase tracking-widest ${rs.text}`}>
              {agent.role.replace(/_/g, " ")}
            </span>
          </div>
          <div className="text-sm font-bold text-slate-800 leading-tight">{firstName}</div>
          {title && <div className="text-[10px] text-slate-400 mt-0.5">{title}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 transition-colors text-base leading-none mt-0.5"
        >×</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {/* Status badge */}
        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${ss.badgeBg}`}>
          <span className={`w-2 h-2 rounded-full flex-none ${ss.dot} ${isActive ? "animate-pulse" : ""}`} />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${ss.text}`}>{ss.label}</span>
        </div>

        {/* Status message */}
        {agent.status_message && (
          <div className={`rounded-md p-2.5 border-l-2 ${ss.msgBg} ${ss.leftBorder}`}>
            <div className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Current Activity</div>
            <div className="text-[10px] text-slate-700 leading-relaxed">{agent.status_message}</div>
          </div>
        )}

        <div className="border-t border-slate-100" />

        {/* Metrics */}
        <div>
          <div className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Performance</div>
          <div className="space-y-1.5">
            <MetricRow label="Experience"  value={`${agent.exp_points ?? 0} pts`}                          cls={rs.text} />
            <MetricRow label="Processing"  value={`${(agent.metrics?.processing_time_ms ?? 0).toFixed(0)} ms`} cls="text-cyan-600" />
            <MetricRow label="API Cost"    value={`$${(agent.metrics?.cost_usd ?? 0).toFixed(4)}`}         cls="text-amber-600" />
            <MetricRow label="Tokens In"   value={String(agent.metrics?.tokens_in ?? 0)}                    cls="text-slate-500" />
            <MetricRow label="Tokens Out"  value={String(agent.metrics?.tokens_out ?? 0)}                   cls="text-slate-500" />
            {agent.metrics?.cpu_percent != null && (
              <MetricRow label="CPU"       value={`${agent.metrics.cpu_percent.toFixed(1)}%`}               cls="text-green-700" />
            )}
          </div>
        </div>

        {/* Task ID */}
        {agent.current_task_id && (
          <>
            <div className="border-t border-slate-100" />
            <div>
              <div className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Task Reference</div>
              <div className="text-[9px] text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 truncate">
                {agent.current_task_id}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MetricRow({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="flex justify-between items-center text-[10px]">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}
