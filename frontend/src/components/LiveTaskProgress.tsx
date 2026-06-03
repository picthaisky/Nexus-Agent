/**
 * LiveTaskProgress — real-time task execution monitor.
 *
 * Shows:
 *  • Connection status badge
 *  • Step-by-step progress with animated indicators
 *  • Execution output terminal
 *  • File events (created / modified / deleted)
 *  • Agent thoughts panel
 */
import { useState } from "react";
import {
  CheckCircle2, XCircle, Loader2, Clock, Wifi, WifiOff,
  Terminal, FileCode2, Brain, ChevronDown, ChevronRight,
  AlertTriangle, Zap,
} from "lucide-react";
import { useTaskSocket, type TaskStepState, type OutputLine, type FileEventItem } from "../hooks/useTaskSocket";

// ── Step status indicator ─────────────────────────────────────────────────────
function StepIcon({ status }: { status: TaskStepState["status"] }) {
  switch (status) {
    case "running":  return <Loader2 className="w-4 h-4 text-cyber-neon animate-spin flex-none" />;
    case "done":     return <CheckCircle2 className="w-4 h-4 text-status-success flex-none" />;
    case "error":    return <XCircle className="w-4 h-4 text-status-error flex-none" />;
    default:         return <Clock className="w-4 h-4 text-slate-600 flex-none" />;
  }
}

const STEP_COLORS: Record<TaskStepState["status"], string> = {
  pending: "border-slate-700/40 bg-black/10 opacity-50",
  running: "border-cyber-neon/40 bg-cyber-neon/5 shadow-[0_0_12px_rgba(95,225,255,0.1)]",
  done:    "border-status-success/30 bg-status-success/5",
  error:   "border-status-error/30 bg-status-error/5",
};

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  taskId:   string | null;
  taskGoal: string;
  onClose?: () => void;
}

export function LiveTaskProgress({ taskId, taskGoal, onClose }: Props) {
  const { steps, output, fileEvents, thoughts, status, connected, error, progress } =
    useTaskSocket(taskId);
  const [activeTab, setActiveTab] = useState<"steps" | "terminal" | "files" | "thoughts">("steps");
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const isActive = status === "running";

  return (
    <div className="flex flex-col h-full rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">

      {/* ── Header ── */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-cyber-neon/15 bg-cyber-bg/50">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Connection badge */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono border ${
            connected ? "border-status-success/40 bg-status-success/10 text-status-success"
                      : "border-slate-700 bg-slate-900/50 text-slate-500"
          }`}>
            {connected
              ? <><Wifi className="w-2.5 h-2.5" /> LIVE</>
              : <><WifiOff className="w-2.5 h-2.5" /> OFFLINE</>
            }
          </div>

          {/* Status badge */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono border ${
            status === "running"   ? "border-cyber-neon/40 bg-cyber-neon/10 text-cyber-neon"
          : status === "completed" ? "border-status-success/40 bg-status-success/10 text-status-success"
          : status === "failed"    ? "border-status-error/40 bg-status-error/10 text-status-error"
          : "border-slate-700 text-slate-500"
          }`}>
            {status === "running"   && <Zap className="w-2.5 h-2.5 animate-pulse" />}
            {status === "completed" && <CheckCircle2 className="w-2.5 h-2.5" />}
            {status === "failed"    && <AlertTriangle className="w-2.5 h-2.5" />}
            <span>{status.toUpperCase()}</span>
          </div>

          <span className="text-[10px] text-slate-400 font-mono truncate">{taskGoal.slice(0, 60)}</span>
        </div>

        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close task monitor"
            className="text-slate-500 hover:text-slate-300 text-lg leading-none ml-2">×</button>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div className="flex-none h-1.5 bg-slate-800">
        <div
          className={`h-full transition-all duration-700 ${
            status === "completed" ? "bg-status-success"
          : status === "failed"    ? "bg-status-error"
          : "bg-cyber-neon animate-pulse"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* ── Tab bar ── */}
      <div className="flex-none flex border-b border-cyber-neon/10 bg-cyber-bg/30 text-[10px] font-mono">
        {([
          { id: "steps",    icon: <Zap className="w-3 h-3" />,          label: "Steps",    count: steps.length },
          { id: "terminal", icon: <Terminal className="w-3 h-3" />,     label: "Terminal", count: output.length },
          { id: "files",    icon: <FileCode2 className="w-3 h-3" />,   label: "Files",    count: fileEvents.length },
          { id: "thoughts", icon: <Brain className="w-3 h-3" />,        label: "Thoughts", count: thoughts.length },
        ] as const).map(tab => (
          <button key={tab.id} type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 transition-all ${
              activeTab === tab.id
                ? "text-cyber-neon border-b border-cyber-neon"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab.icon} {tab.label}
            {tab.count > 0 && (
              <span className="text-[8px] bg-slate-700 px-1 rounded">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab body ── */}
      <div className="flex-1 overflow-hidden">

        {/* STEPS */}
        {activeTab === "steps" && (
          <div className="h-full overflow-y-auto px-4 py-3 space-y-2">
            {steps.length === 0 && status === "idle" && (
              <div className="text-center text-slate-600 text-xs font-mono py-8">
                กำลังรอ task…
              </div>
            )}
            {steps.length === 0 && isActive && (
              <div className="flex items-center gap-2 text-xs text-cyber-neon/70 font-mono py-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Initialising orchestrator…
              </div>
            )}
            {steps.map(step => (
              <div key={step.step} className={`rounded-xl border transition-all ${STEP_COLORS[step.status]}`}>
                <button type="button"
                  onClick={() => setExpandedStep(expandedStep === step.step ? null : step.step)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                >
                  <StepIcon status={step.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-mono font-bold text-slate-200 truncate">
                      {step.description}
                    </div>
                    <div className="text-[9px] text-slate-500 font-mono">
                      Step {step.stepIndex}/{step.totalSteps}
                      {step.completedAt && step.startedAt && (
                        <span className="ml-2 text-slate-600">
                          {((step.completedAt - step.startedAt)).toFixed(1)}s
                        </span>
                      )}
                    </div>
                  </div>
                  {expandedStep === step.step
                    ? <ChevronDown className="w-3 h-3 text-slate-500 flex-none" />
                    : <ChevronRight className="w-3 h-3 text-slate-500 flex-none" />
                  }
                </button>
                {expandedStep === step.step && step.output && (
                  <div className="px-3 pb-2.5">
                    <pre className="text-[9px] font-mono text-slate-400 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
                      {step.output}
                    </pre>
                  </div>
                )}
              </div>
            ))}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl border border-status-error/30 bg-status-error/5 text-xs text-status-error">
                <XCircle className="w-4 h-4 flex-none mt-0.5" />
                <div>{error}</div>
              </div>
            )}
          </div>
        )}

        {/* TERMINAL */}
        {activeTab === "terminal" && (
          <TerminalView lines={output} />
        )}

        {/* FILES */}
        {activeTab === "files" && (
          <div className="h-full overflow-y-auto px-4 py-3 space-y-1.5">
            {fileEvents.length === 0 ? (
              <div className="text-center text-slate-600 text-xs font-mono py-8">
                ยังไม่มี file events…
              </div>
            ) : fileEvents.map(f => (
              <div key={f.id} className={`flex items-start gap-2 p-2 rounded-lg border text-[10px] font-mono ${
                f.fileEventType === "created"  ? "border-status-success/20 bg-status-success/5" :
                f.fileEventType === "deleted"  ? "border-status-error/20 bg-status-error/5" :
                "border-slate-700 bg-slate-900/30"
              }`}>
                <span className={`font-bold flex-none ${
                  f.fileEventType === "created" ? "text-status-success" :
                  f.fileEventType === "deleted" ? "text-status-error"   : "text-cyber-neon"
                }`}>
                  {f.fileEventType === "created" ? "+" : f.fileEventType === "deleted" ? "-" : "~"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200 truncate">{f.path}</div>
                  {f.preview && <div className="text-slate-600 truncate mt-0.5">{f.preview}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* THOUGHTS */}
        {activeTab === "thoughts" && (
          <div className="h-full overflow-y-auto px-4 py-3 space-y-2">
            {thoughts.length === 0 ? (
              <div className="text-center text-slate-600 text-xs font-mono py-8">
                ยังไม่มี agent thoughts…
              </div>
            ) : thoughts.map((t, i) => (
              <div key={i} className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Brain className="w-3 h-3 text-cyber-neon/60" />
                  <span className="text-[9px] font-mono text-cyber-neon/80 uppercase">{t.agent}</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">{t.thought}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Terminal sub-component ────────────────────────────────────────────────────
function TerminalView({ lines }: { lines: OutputLine[] }) {
  return (
    <div className="h-full flex flex-col bg-black/60 font-mono text-[10px]">
      {/* Terminal header */}
      <div className="flex-none flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800/60 bg-slate-900/60">
        <div className="w-2.5 h-2.5 rounded-full bg-status-error/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-cyber-gold/70" />
        <div className="w-2.5 h-2.5 rounded-full bg-status-success/70" />
        <span className="text-slate-600 text-[8px] ml-1">EXECUTION OUTPUT</span>
        <span className="ml-auto text-slate-700">{lines.length} lines</span>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {lines.length === 0 ? (
          <div className="text-slate-700 py-4 text-center">
            กำลังรอ output…
          </div>
        ) : lines.map(l => (
          <div key={l.id} className={`flex gap-2 ${l.stream === "stderr" ? "text-status-error/80" : "text-slate-300"}`}>
            <span className="flex-none text-slate-700 select-none w-8 text-right tabular-nums">
              {l.id % 10000}
            </span>
            <span className="flex-1 break-all whitespace-pre-wrap">{l.line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
