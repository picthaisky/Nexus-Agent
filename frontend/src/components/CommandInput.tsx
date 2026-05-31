import { useState, KeyboardEvent } from "react";
import { Send, Terminal } from "lucide-react";

interface CommandInputProps {
  onRunTask: (goal: string) => Promise<void>;
  disabled?: boolean;
}

export function CommandInput({ onRunTask, disabled }: CommandInputProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || disabled) return;
    
    const commandToRun = input.trim();
    
    setHistory((prev) => [...prev, commandToRun]);
    setHistoryIndex(-1);
    setInput("");
    
    setLoading(true);
    try {
      await onRunTask(commandToRun);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex !== -1) {
        const nextIndex = historyIndex + 1;
        if (nextIndex >= history.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(nextIndex);
          setInput(history[nextIndex]);
        }
      }
    }
  };

  return (
    <div className="border-t border-cyber-neon/20 bg-cyber-bg/95 p-4 backdrop-blur">
      <div className="mx-auto max-w-7xl">
        <form onSubmit={handleSubmit} className="relative flex items-center">
          <Terminal className="absolute left-4 h-5 w-5 text-cyber-neon" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || loading}
            placeholder={loading ? "Executing task..." : "Enter command or task description..."}
            className="w-full rounded-lg border border-cyber-neon/30 bg-cyber-panel/50 py-4 pl-12 pr-16 text-slate-200 placeholder-slate-500 focus:border-cyber-neon focus:outline-none focus:ring-1 focus:ring-cyber-neon disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || disabled || loading}
            className="absolute right-3 rounded-md bg-cyber-neon/20 p-2 text-cyber-neon hover:bg-cyber-neon/40 disabled:opacity-50 transition-colors"
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
