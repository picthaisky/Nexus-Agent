import { useEffect, useRef } from "react";
import type { DashboardEvent } from "../types";
import { Terminal } from "lucide-react";

interface LiveLogViewerProps {
  logs: DashboardEvent[];
}

export function LiveLogViewer({ logs }: LiveLogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-cyber-neon/20 bg-cyber-panel/30">
      <div className="border-b border-cyber-neon/20 bg-cyber-panel/50 px-4 py-3 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-cyber-neon" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-cyber-neon/80">
          Live System Logs
        </h3>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs flex flex-col-reverse"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 italic text-center my-auto">Waiting for logs...</div>
        ) : (
          logs.map((log, i) => {
            const time = new Date(log.timestamp * 1000).toLocaleTimeString();
            return (
              <div key={i} className="mb-2 flex items-start gap-3">
                <span className="text-slate-500 shrink-0">[{time}]</span>
                <span className="text-cyber-neon shrink-0 w-16 truncate">[{log.agent_id}]</span>
                <span className="text-slate-300 break-words">{log.status_message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
