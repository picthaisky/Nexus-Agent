import { useEffect, useRef } from "react";
import type { DashboardEvent } from "../types";
import { Terminal } from "lucide-react";

interface LiveLogViewerProps {
  logs: DashboardEvent[];
}

function logColor(msg: string): string {
  if (msg.includes("❌") || msg.includes("ล้มเหลว") || msg.includes("failed") || msg.includes("error"))
    return "text-status-error";
  if (msg.includes("✅") || msg.includes("สำเร็จ") || msg.includes("completed") || msg.includes("success"))
    return "text-status-success";
  if (msg.includes("เริ่มต้น") || msg.includes("initiated") || msg.includes("กำลัง"))
    return "text-cyber-neon";
  return "text-slate-300";
}

export function LiveLogViewer({ logs }: LiveLogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-cyber-neon/20 bg-cyber-panel/30">
      <div className="border-b border-cyber-neon/20 bg-cyber-panel/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-cyber-neon" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-cyber-neon/80">
            Live System Logs
          </h3>
        </div>
        {logs.length > 0 && (
          <span className="text-[9px] font-mono text-slate-500">{logs.length} entries</span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-[10px] flex flex-col gap-1"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 italic text-center my-auto text-xs">
            Waiting for logs...
          </div>
        ) : (
          [...logs].reverse().map((log, i) => {
            const time = new Date(log.timestamp * 1000).toLocaleTimeString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const isSystem = log.agent_id === "system";
            const msgColor = logColor(log.status_message);
            return (
              <div
                key={i}
                className={`flex items-start gap-2 leading-relaxed ${
                  isSystem ? "opacity-90" : "opacity-75"
                }`}
              >
                <span className="text-slate-600 shrink-0 tabular-nums">{time}</span>
                <span
                  className={`shrink-0 px-1 rounded text-[8px] uppercase font-bold ${
                    isSystem
                      ? "bg-slate-700/50 text-slate-400"
                      : "bg-cyber-neon/10 text-cyber-neon"
                  }`}
                >
                  {isSystem ? "SYS" : log.agent_id.slice(0, 6)}
                </span>
                <span className={`break-words ${msgColor}`}>{log.status_message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
