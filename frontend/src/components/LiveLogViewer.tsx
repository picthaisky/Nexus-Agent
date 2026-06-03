import { useEffect, useRef, useState } from "react";
import type { DashboardEvent } from "../types";
import { Terminal, Filter, ChevronDown } from "lucide-react";

interface LiveLogViewerProps {
  logs:          DashboardEvent[];
  activeTaskId?: string | null;
  onOpenTask?:   (taskId: string) => void;
}

type FilterMode = "all" | "system" | "agents" | "errors";

function logColor(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("❌") || m.includes("ล้มเหลว") || m.includes("failed") || m.includes("error"))
    return "text-status-error";
  if (m.includes("✅") || m.includes("สำเร็จ") || m.includes("completed") || m.includes("success"))
    return "text-status-success";
  if (m.includes("⚡") || m.includes("running") || m.includes("กำลัง") || m.includes("executing"))
    return "text-cyber-neon";
  if (m.includes("planner") || m.includes("executor") || m.includes("validator") || m.includes("learner"))
    return "text-cyber-gold/80";
  return "text-slate-300";
}

function agentBadgeColor(agentId: string): string {
  const map: Record<string, string> = {
    system:    "bg-slate-700/50 text-slate-400",
    planner:   "bg-blue-900/50 text-blue-400",
    architect: "bg-cyan-900/50 text-cyan-400",
    developer: "bg-green-900/50 text-green-400",
    validator: "bg-red-900/50 text-red-400",
    optimizer: "bg-amber-900/50 text-amber-400",
  };
  return map[agentId] || "bg-cyber-neon/10 text-cyber-neon";
}

// Extract task_id from log message like "[TASK:abc12345]"
function extractTaskId(msg: string): string | null {
  const m = msg.match(/\[TASK:([a-f0-9]{8})\]/);
  return m ? m[1] : null;
}

export function LiveLogViewer({ logs, activeTaskId, onOpenTask }: LiveLogViewerProps) {
  const scrollRef   = useRef<HTMLDivElement>(null);
  const [filter, setFilter]       = useState<FilterMode>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showFilter, setShowFilter] = useState(false);

  // Auto-scroll on new logs
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Pause auto-scroll when user scrolls up
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollTop + clientHeight >= scrollHeight - 20);
  };

  // Filter log entries
  const filtered = logs.filter(log => {
    switch (filter) {
      case "system": return log.agent_id === "system";
      case "agents": return log.agent_id !== "system";
      case "errors": return logColor(log.status_message) === "text-status-error";
      default:       return true;
    }
  });

  const errorCount = logs.filter(l => logColor(l.status_message) === "text-status-error").length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-cyber-neon/20 bg-cyber-panel/30">

      {/* Header */}
      <div className="border-b border-cyber-neon/20 bg-cyber-panel/50 px-3 py-2.5 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-cyber-neon flex-none" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-cyber-neon/80 flex-1">
          Live System Logs
        </h3>

        {/* Error badge */}
        {errorCount > 0 && (
          <button type="button"
            onClick={() => setFilter(f => f === "errors" ? "all" : "errors")}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono border transition-colors ${
              filter === "errors"
                ? "border-status-error/60 bg-status-error/20 text-status-error"
                : "border-status-error/30 text-status-error/70 hover:bg-status-error/10"
            }`}
          >
            {errorCount} err
          </button>
        )}

        {/* Count */}
        {logs.length > 0 && (
          <span className="text-[9px] font-mono text-slate-500">{logs.length}</span>
        )}

        {/* Filter toggle */}
        <button type="button" aria-label="Toggle log filter"
          onClick={() => setShowFilter(v => !v)}
          className="p-1 text-slate-500 hover:text-cyber-neon transition-colors">
          <Filter className="w-3 h-3" />
        </button>
      </div>

      {/* Filter pills */}
      {showFilter && (
        <div className="flex gap-1 px-3 py-1.5 border-b border-slate-800/60 bg-slate-900/30">
          {(["all","system","agents","errors"] as FilterMode[]).map(f => (
            <button key={f} type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-all ${
                filter === f
                  ? "border-cyber-neon/40 bg-cyber-neon/15 text-cyber-neon"
                  : "border-slate-700 text-slate-500 hover:border-slate-600"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <button type="button"
          onClick={() => {
            setAutoScroll(true);
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
          }}
          className="flex-none flex items-center justify-center gap-1 py-1 bg-cyber-neon/10 text-cyber-neon text-[9px] font-mono border-b border-cyber-neon/20 hover:bg-cyber-neon/20 transition-colors"
        >
          <ChevronDown className="w-3 h-3" /> scroll to latest
        </button>
      )}

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2.5 font-mono text-[10px] flex flex-col gap-0.5"
      >
        {filtered.length === 0 ? (
          <div className="text-slate-500 italic text-center my-auto text-xs py-6">
            {filter !== "all" ? `No ${filter} entries` : "Waiting for logs..."}
          </div>
        ) : (
          filtered.map((log, i) => {
            const time = new Date(log.timestamp * 1000).toLocaleTimeString("th-TH", {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            });
            const msgColor = logColor(log.status_message);
            const taskId   = extractTaskId(log.status_message);
            const badgeCls = agentBadgeColor(log.agent_id);

            return (
              <div key={i}
                className="flex items-start gap-1.5 leading-relaxed hover:bg-white/3 rounded px-1 py-0.5 group"
              >
                <span className="text-slate-600 shrink-0 tabular-nums text-[9px]">{time}</span>
                <span className={`shrink-0 px-1 rounded text-[8px] uppercase font-bold ${badgeCls}`}>
                  {log.agent_id === "system" ? "SYS" : log.agent_id.slice(0, 6)}
                </span>
                <span className={`flex-1 break-words leading-tight ${msgColor}`}>
                  {log.status_message}
                </span>
                {/* "View task" button for task-log lines */}
                {taskId && onOpenTask && (
                  <button type="button"
                    onClick={() => onOpenTask(taskId)}
                    className="opacity-0 group-hover:opacity-100 text-[8px] text-cyber-neon/60 hover:text-cyber-neon font-mono px-1 transition-all flex-none"
                    title="Open live task view"
                  >
                    view →
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
