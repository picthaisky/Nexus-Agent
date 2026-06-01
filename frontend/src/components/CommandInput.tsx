import { useState, KeyboardEvent } from "react";
import { Send, Terminal, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

interface TaskResult {
  task_id?: string;
}

interface CommandInputProps {
  onRunTask: (goal: string) => Promise<TaskResult | void>;
  disabled?: boolean;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; taskId: string }
  | { kind: "error"; message: string };

export function CommandInput({ onRunTask, disabled }: CommandInputProps) {
  const [input, setInput] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const isLoading = submitState.kind === "loading";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || disabled) return;

    const commandToRun = input.trim();
    setHistory((prev) => [...prev, commandToRun]);
    setHistoryIndex(-1);
    setInput("");
    setSubmitState({ kind: "loading" });

    try {
      const result = await onRunTask(commandToRun);
      const taskId = (result as TaskResult | undefined)?.task_id ?? "—";
      setSubmitState({ kind: "success", taskId });
      // Auto-clear after 8 s
      setTimeout(() => setSubmitState({ kind: "idle" }), 8000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSubmitState({ kind: "error", message: msg });
      setTimeout(() => setSubmitState({ kind: "idle" }), 10000);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const next = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(next);
        setInput(history[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex !== -1) {
        const next = historyIndex + 1;
        if (next >= history.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(next);
          setInput(history[next]);
        }
      }
    }
  };

  return (
    <div className="border-t border-cyber-neon/20 bg-cyber-bg/95 backdrop-blur">
      {/* Status banner — shown above the input when a task was submitted */}
      {submitState.kind !== "idle" && submitState.kind !== "loading" && (
        <div
          className={`flex items-center gap-2 px-6 py-1.5 text-xs font-mono border-b ${
            submitState.kind === "success"
              ? "bg-status-success/10 border-status-success/20 text-status-success"
              : "bg-status-error/10 border-status-error/20 text-status-error"
          }`}
        >
          {submitState.kind === "success" ? (
            <>
              <CheckCircle className="w-3.5 h-3.5 flex-none" />
              <span>
                Task accepted — กำลังทำงานในพื้นหลัง
                {submitState.taskId !== "—" && (
                  <span className="ml-2 opacity-60">ID: {submitState.taskId.slice(0, 8)}</span>
                )}
              </span>
              <span className="ml-auto opacity-50">ดูความคืบหน้าในช่อง Live System Logs →</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 flex-none" />
              <span>{submitState.message}</span>
            </>
          )}
        </div>
      )}

      <div className="mx-auto max-w-7xl p-4">
        <form onSubmit={handleSubmit} className="relative flex items-center">
          {isLoading ? (
            <Loader2
              aria-hidden="true"
              className="absolute left-4 h-5 w-5 text-cyber-neon animate-spin"
            />
          ) : (
            <Terminal
              aria-hidden="true"
              className="absolute left-4 h-5 w-5 text-cyber-neon"
            />
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || isLoading}
            aria-label="พิมพ์คำสั่งหรืออธิบายงาน"
            placeholder={
              isLoading
                ? "กำลังส่งคำสั่ง..."
                : disabled
                ? "ไม่ได้เชื่อมต่อ — รอการเชื่อมต่อ WebSocket..."
                : "พิมพ์คำสั่งหรืออธิบายงานที่ต้องการ..."
            }
            className="w-full rounded-lg border border-cyber-neon/30 bg-cyber-panel/50 py-4 pl-12 pr-16 text-slate-200 placeholder-slate-500 focus:border-cyber-neon focus:outline-none focus:ring-1 focus:ring-cyber-neon disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || disabled || isLoading}
            aria-label="ส่งคำสั่ง"
            title="ส่งคำสั่ง (Enter)"
            className="absolute right-3 rounded-md bg-cyber-neon/20 p-2 text-cyber-neon hover:bg-cyber-neon/40 disabled:opacity-50 transition-colors"
          >
            <Send aria-hidden="true" className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
