import { useState } from "react";
import { Search, Loader2, ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface SearchResult {
  query: string;
  summary_md: string;
  sources: { title: string; url: string }[];
  created_at: string;
}

export function AgentspacePanel() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const key = (window as any).__NEXUS_API_KEY__ || "";
    const base = (import.meta as any).env?.VITE_NEXUS_API_URL || "";

    try {
      const res = await fetch(`${base}/agentspace/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": key,
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || `Search failed with status ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-cyber-neon/20 bg-cyber-bg/50">
        <div className="p-2 rounded-lg bg-cyber-neon/10">
          <Search className="h-5 w-5 text-cyber-neon" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-100 tracking-wider font-mono">
            AGENTSPACE
          </h2>
          <p className="text-xs text-cyber-neon/80">Intelligent Data Research Assistant</p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <form onSubmit={handleSearch} className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-500" />
          </div>
          <input
            type="text"
            className="w-full bg-slate-900/50 border border-cyber-neon/30 rounded-xl py-4 pl-12 pr-16 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon focus:ring-1 focus:ring-cyber-neon transition-all"
            placeholder="Ask the Search Agent..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute inset-y-2 right-2 px-4 bg-cyber-neon/20 hover:bg-cyber-neon/40 text-cyber-neon rounded-lg flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
              <ReactMarkdown>{result.summary_md}</ReactMarkdown>
            </div>
            
            {result.sources && result.sources.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs uppercase tracking-widest text-slate-500 font-bold">Sources</h3>
                <div className="flex flex-wrap gap-2">
                  {result.sources.map((src, idx) => (
                    <a
                      key={idx}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-full border border-cyber-gold/30 bg-cyber-gold/10 text-cyber-gold hover:bg-cyber-gold/20 transition-all truncate max-w-xs"
                      title={src.title}
                    >
                      {src.title || src.url}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !result && !error && (
          <div className="h-48 flex flex-col items-center justify-center text-slate-500 space-y-4">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center animate-[spin_10s_linear_infinite]">
              <Search className="h-6 w-6 text-slate-600" />
            </div>
            <p className="text-sm">Enter a query to begin deep research.</p>
          </div>
        )}
      </div>
    </div>
  );
}
