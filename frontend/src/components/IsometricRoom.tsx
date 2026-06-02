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
  { name: "Risk Monitoring", dot: "bg-red-700",    text: "text-red-700" },
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

const STATIC_HD_SCENE_URL = ((import.meta as any).env?.VITE_OFFICE_MAP_IMAGE_URL as string | undefined) || "";
const HD_SCENE_STORAGE_KEY = "nexus.officeMapHdUrl";

function getStoredHdSceneUrl() {
  try {
    return window.localStorage.getItem(HD_SCENE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function getSceneGenerateUrl() {
  const base = ((import.meta as any).env?.VITE_NEXUS_API_URL as string | undefined)?.replace(/\/$/, "");
  return base ? `${base}/scene/generate` : "/api/scene/generate";
}

const HD_AGENT_MARKERS: Record<string, string> = {
  planner: "left-[45%] top-[38%]",
  architect: "left-[43%] top-[17%]",
  developer: "left-[60%] top-[23%]",
  ui_weaver: "left-[72%] top-[43%]",
  validator: "left-[62%] top-[70%]",
  optimizer: "left-[20%] top-[72%]",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function IsometricRoom({ agents, expEffects }: IsometricRoomProps) {
  const phaserRef = useRef<IRefPhaserGame | null>(null);
  const [proximityAgentId, setProximityAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRuntimeState | null>(null);

  // Scene generation state
  const [genState, setGenState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [sceneImage, setSceneImage] = useState<SceneGenerateResponse | null>(null);
  const [storedHdSceneUrl, setStoredHdSceneUrl] = useState(getStoredHdSceneUrl);
  const [genError, setGenError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [renderMode, setRenderMode] = useState<"interactive" | "hd">(
    STATIC_HD_SCENE_URL || getStoredHdSceneUrl() ? "hd" : "interactive",
  );

  const handleGenerateScene = useCallback(async () => {
    setGenState("loading");
    setGenError(null);
    try {
      const key = (window as any).__NEXUS_API_KEY__ || "";
      const res = await fetch(getSceneGenerateUrl(), {
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
      setStoredHdSceneUrl(data.url);
      try {
        window.localStorage.setItem(HD_SCENE_STORAGE_KEY, data.url);
      } catch {
        /* ignore storage errors */
      }
      setGenState("done");
      setRenderMode("hd");
      setShowModal(false);
    } catch (e: any) {
      const message = e instanceof TypeError && e.message === "Failed to fetch"
        ? "Cannot reach the scene generation API. Check that the backend is running and VITE_NEXUS_API_URL or the /api proxy is configured."
        : e.message || "Generation failed";
      setGenError(message);
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
  const hdSceneUrl = sceneImage?.url || STATIC_HD_SCENE_URL || storedHdSceneUrl;

  return (
    <div className="relative w-full h-[500px] md:h-[620px] lg:h-[720px] flex items-center justify-center overflow-hidden border border-slate-200 bg-white rounded-2xl shadow-lg">

      {/* Header — clean corporate badge */}
      <div className="absolute z-10 pointer-events-none select-none top-3 left-4">
        <div className="flex items-center gap-1.5 bg-white/90 border border-slate-200 rounded-md px-2.5 py-1 shadow-sm">
          <span className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
          <span className="text-[9px] font-semibold text-slate-500 tracking-wide uppercase">
            Virtual Workspace · 3D Isometric Office Map
          </span>
        </div>
      </div>

      {/* Zone Legend — top right */}
      <div className="absolute z-10 flex flex-col gap-1 pointer-events-none top-3 right-4">
        {ZONE_LEGEND.map((z) => (
          <div key={z.name} className="flex items-center gap-1.5 bg-white/85 border border-slate-100 rounded px-2 py-0.5 shadow-sm">
            <span className={`w-2 h-2 rounded-full flex-none ${z.dot}`} />
            <span className={`text-[8px] font-medium tracking-wide ${z.text}`}>{z.name}</span>
          </div>
        ))}
      </div>

      {/* Phaser Canvas */}
      <div className="relative w-full h-full">
        {renderMode === "hd" && hdSceneUrl ? (
          <div className="absolute inset-0 bg-[#f8f9fb]">
            <img
              src={hdSceneUrl}
              alt="High fidelity 3D isometric office map"
              className="h-full w-full object-contain drop-shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
            />
            {Object.entries(agents).map(([agentId, agent]) => {
              const marker = HD_AGENT_MARKERS[agentId];
              const rs = ROLE_STYLES[agent.role] ?? DEFAULT_ROLE_STYLE;
              if (!marker) return null;
              return (
                <button
                  key={agentId}
                  type="button"
                  onClick={() => setSelectedAgent(agent)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-white/90 p-1 shadow-lg shadow-slate-900/15 backdrop-blur transition-transform hover:scale-110 ${marker}`}
                  title={agent.display_name}
                >
                  <span className={`block h-2.5 w-2.5 rounded-full ${rs.dot} ${agent.current_micro_state !== "idle" ? "animate-pulse" : ""}`} />
                </button>
              );
            })}
          </div>
        ) : (
          <PhaserGame ref={phaserRef} />
        )}
      </div>

      {/* Controls hint */}
      <div className="absolute z-10 pointer-events-none select-none bottom-3 left-4">
        <div className="flex items-center gap-2 bg-white/80 border border-slate-200 rounded px-2.5 py-1 shadow-sm">
          {([ ["WASD", "Move"], ["Drag", "Pan"], ["E", "Profile"], ["Scroll", "Zoom"] ] as const).map(([key, desc]) => (
            <span key={key} className="flex items-center gap-1 text-[8px] text-slate-400">
              <kbd className="px-1 py-0.5 rounded border border-slate-300 bg-slate-50 text-slate-500 font-mono text-[7px]">{key}</kbd>
              <span>{desc}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Proximity prompt */}
      {proximityAgent && !selectedAgent && (
        <div className="absolute z-20 flex items-center gap-2 px-4 py-2 -translate-x-1/2 bg-white border border-blue-200 rounded-lg shadow-md bottom-12 left-1/2 animate-pulse">
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

      {/* Render controls — bottom right */}
      <div className="absolute bottom-3 right-4 z-10 flex flex-col items-end gap-1.5">
        <div className="flex rounded-lg border border-slate-200 bg-white/90 p-0.5 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => setRenderMode("interactive")}
            className={`rounded-md px-2 py-1 text-[9px] font-semibold transition-colors ${renderMode === "interactive" ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            Interactive
          </button>
          <button
            type="button"
            onClick={() => hdSceneUrl && setRenderMode("hd")}
            disabled={!hdSceneUrl}
            className={`rounded-md px-2 py-1 text-[9px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${renderMode === "hd" ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:text-slate-700"}`}
          >
            HD Render
          </button>
        </div>
        {genState === "error" && genError && (
          <div className="mb-1 text-[9px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-48 text-right">
            {genError}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {hdSceneUrl && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="bg-white border border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-3 py-1.5 rounded-lg text-[10px] font-semibold shadow-sm transition-all"
            >
              Open Render
            </button>
          )}
          <button
            type="button"
            onClick={genState === "loading" ? undefined : handleGenerateScene}
            disabled={genState === "loading"}
            className="flex items-center gap-1.5 bg-white border border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-3 py-1.5 rounded-lg text-[10px] font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {genState === "loading" ? (
              <>
                <span className="flex-none w-3 h-3 border-2 border-blue-400 rounded-full border-t-transparent animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <span className="text-[11px]">✦</span>
                Generate HD Render
              </>
            )}
          </button>
        </div>
      </div>

      {/* Generated image modal */}
      {showModal && hdSceneUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative w-full max-w-5xl mx-4 overflow-hidden bg-white shadow-2xl rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <div className="text-sm font-bold text-slate-800">HD 3D Isometric Office Map</div>
                <div className="text-[9px] text-slate-400 mt-0.5">
                  {sceneImage
                    ? `Generated by DALL-E 3 · ${sceneImage.size} · ${sceneImage.quality.toUpperCase()}`
                    : "Configured HD render · static image source"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={hdSceneUrl}
                  download="nexus-office-map-hd.png"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded px-2.5 py-1 transition-colors"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex items-center justify-center text-lg transition-colors rounded-full w-7 h-7 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Image */}
            <img
              src={hdSceneUrl}
              alt="HD 3D Isometric Office Map"
              className="w-full object-contain max-h-[70vh]"
            />

            {/* Revised prompt */}
            {sceneImage?.revised_prompt && (
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
    <div className="absolute z-30 flex flex-col overflow-hidden bg-white border shadow-xl right-4 top-10 bottom-10 w-60 border-slate-200 rounded-xl">

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
          <div className="text-sm font-bold leading-tight text-slate-800">{firstName}</div>
          {title && <div className="text-[10px] text-slate-400 mt-0.5">{title}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 transition-colors text-base leading-none mt-0.5"
        >×</button>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto">

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
