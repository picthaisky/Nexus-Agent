import { useState } from "react";
import { Loader2, ArrowRight, FileText, Briefcase, FileSignature } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface SpecialistResult {
  markdown: string;
}

export function SpecialistOfficePanel() {
  const [activeDesk, setActiveDesk] = useState<"finance" | "content">("finance");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpecialistResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const key = (window as any).__NEXUS_API_KEY__ || "";
    const base = (import.meta as any).env?.VITE_NEXUS_API_URL || "";
    
    const endpoint = activeDesk === "finance" ? "/agents/finance/analyze" : "/agents/content/generate";
    const payload = activeDesk === "finance" ? { task: input } : { topic: input };

    try {
      const res = await fetch(`${base}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": key,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      setResult({ markdown: data.analysis_md || data.content_md });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchDesk = (desk: "finance" | "content") => {
    setActiveDesk(desk);
    setInput("");
    setResult(null);
    setError(null);
  };

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">
      {/* Header Tabs */}
      <div className="flex border-b border-cyber-neon/20 bg-cyber-bg/50 px-4 pt-4 gap-2">
        <button
          onClick={() => switchDesk("finance")}
          className={`flex items-center gap-2 px-4 py-3 rounded-t-lg transition-all font-mono text-sm ${
            activeDesk === "finance"
              ? "bg-cyber-neon/20 border-t border-l border-r border-cyber-neon/40 text-cyber-neon font-bold"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <Briefcase className="h-4 w-4" />
          Finance Desk
        </button>
        <button
          onClick={() => switchDesk("content")}
          className={`flex items-center gap-2 px-4 py-3 rounded-t-lg transition-all font-mono text-sm ${
            activeDesk === "content"
              ? "bg-cyber-neon/20 border-t border-l border-r border-cyber-neon/40 text-cyber-neon font-bold"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <FileSignature className="h-4 w-4" />
          Content Creator Desk
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-cyber-neon/10">
            {activeDesk === "finance" ? <Briefcase className="h-5 w-5 text-cyber-neon" /> : <FileSignature className="h-5 w-5 text-cyber-neon" />}
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100 tracking-wider font-mono">
              {activeDesk === "finance" ? "FINANCIAL ANALYST" : "CONTENT STRATEGIST"}
            </h2>
            <p className="text-xs text-cyber-neon/80">
              {activeDesk === "finance" 
                ? "Analyze numbers, corporate accounting files, and month-end closings." 
                : "Draft standard-length articles and engaging social media posts."}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 pt-4 pointer-events-none">
            <FileText className="h-5 w-5 text-slate-500" />
          </div>
          <textarea
            className="w-full h-32 bg-slate-900/50 border border-cyber-neon/30 rounded-xl py-4 pl-12 pr-16 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon focus:ring-1 focus:ring-cyber-neon transition-all resize-none"
            placeholder={activeDesk === "finance" ? "Describe the financial task or data..." : "Enter topic or keywords for content generation..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="absolute bottom-4 right-4 px-4 py-2 bg-cyber-neon/20 hover:bg-cyber-neon/40 text-cyber-neon rounded-lg flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
          </button>
        </form>

        {error && (
          <div className="p-4 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-6 rounded-xl border border-cyber-neon/20 bg-slate-900/40 prose prose-invert prose-p:text-slate-300 prose-a:text-cyber-neon max-w-none">
              <ReactMarkdown>{result.markdown}</ReactMarkdown>
            </div>
          </div>
        )}

        {!loading && !result && !error && (
          <div className="h-48 flex flex-col items-center justify-center text-slate-500 space-y-4">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center animate-[spin_10s_linear_infinite]">
              {activeDesk === "finance" ? <Briefcase className="h-6 w-6 text-slate-600" /> : <FileSignature className="h-6 w-6 text-slate-600" />}
            </div>
            <p className="text-sm font-mono text-center max-w-md">
              {activeDesk === "finance" 
                ? "Awaiting financial data or instructions to process."
                : "Awaiting topic or context to begin writing."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
