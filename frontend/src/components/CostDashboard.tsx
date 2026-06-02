import { useState, useEffect, useCallback } from "react";
import { RefreshCw, DollarSign, Zap, Clock, TrendingUp, AlertTriangle } from "lucide-react";

interface ProviderCost {
  provider:      string;
  model:         string;
  tokens_in:     number;
  tokens_out:    number;
  cost_usd:      number;
  calls:         number;
  avg_latency_ms:number;
}

interface CostSummary {
  total_cost_usd: number;
  by_provider:    ProviderCost[];
}

interface CostLogEntry {
  id:          number;
  provider:    string;
  model:       string;
  agent_id:    string;
  task_id:     string | null;
  tokens_in:   number;
  tokens_out:  number;
  cost_usd:    number;
  latency_ms:  number;
  status:      string;
  created_at:  string;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai:    "text-emerald-400",
  claude:    "text-orange-400",
  gemini:    "text-blue-400",
  local:     "text-slate-400",
  vllm:      "text-purple-400",
};

function pColor(provider: string) {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? "text-slate-400";
}

export function CostDashboard() {
  const [summary, setSummary]       = useState<CostSummary | null>(null);
  const [log, setLog]               = useState<CostLogEntry[]>([]);
  const [loading, setLoading]       = useState(false);
  const [since, setSince]           = useState<"today" | "7d" | "30d" | "all">("7d");
  const [showLog, setShowLog]       = useState(false);

  const headers = () => ({
    "Content-Type": "application/json",
    "X-API-Key": (window as any).__NEXUS_API_KEY__ || "",
  });
  const base = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/, "");

  const sinceIso = (): string | undefined => {
    const now = new Date();
    if (since === "today") { now.setHours(0,0,0,0); return now.toISOString(); }
    if (since === "7d")    { now.setDate(now.getDate() - 7); return now.toISOString(); }
    if (since === "30d")   { now.setDate(now.getDate() - 30); return now.toISOString(); }
    return undefined;
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const iso = sinceIso();
      const url = `${base()}/costs/summary${iso ? `?since=${encodeURIComponent(iso)}` : ""}`;
      const [sumRes, logRes] = await Promise.all([
        fetch(url, { headers: headers() }),
        fetch(`${base()}/costs/log?limit=50`, { headers: headers() }),
      ]);
      if (sumRes.ok) setSummary(await sumRes.json());
      if (logRes.ok) setLog((await logRes.json()).log || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [since]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalCalls   = summary?.by_provider.reduce((a, p) => a + p.calls, 0) ?? 0;
  const totalTokensIn  = summary?.by_provider.reduce((a, p) => a + p.tokens_in, 0) ?? 0;
  const totalTokensOut = summary?.by_provider.reduce((a, p) => a + p.tokens_out, 0) ?? 0;
  const avgLatency   = summary?.by_provider.length
    ? summary.by_provider.reduce((a, p) => a + p.avg_latency_ms, 0) / summary.by_provider.length
    : 0;

  const RATE_LIMIT_THRESHOLD = 0.10; // warn above $0.10

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">

      {/* Header */}
      <div className="flex-none flex items-center justify-between px-5 py-3.5 border-b border-cyber-neon/15 bg-cyber-bg/40">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-cyber-gold" />
          <span className="text-sm font-bold font-mono text-slate-100 uppercase tracking-wider">API Cost Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex gap-1 border border-cyber-neon/20 rounded-lg p-0.5">
            {(["today","7d","30d","all"] as const).map(p => (
              <button key={p} type="button"
                onClick={() => setSince(p)}
                className={`px-2 py-1 rounded text-[10px] font-mono transition-all ${since === p ? "bg-cyber-neon/20 text-cyber-neon" : "text-slate-400 hover:text-slate-200"}`}
              >{p}</button>
            ))}
          </div>
          <button type="button" aria-label="Refresh cost data" onClick={fetchData}
            className={`p-1.5 text-slate-500 hover:text-cyber-neon rounded transition-colors ${loading ? "animate-spin" : ""}`}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Total Cost",    value: `$${(summary?.total_cost_usd ?? 0).toFixed(4)}`, icon: <DollarSign className="w-4 h-4" />, color: "text-cyber-gold",
              warn: (summary?.total_cost_usd ?? 0) > RATE_LIMIT_THRESHOLD },
            { label: "API Calls",     value: totalCalls.toLocaleString(),                     icon: <Zap className="w-4 h-4" />,         color: "text-cyber-neon" },
            { label: "Total Tokens",  value: (totalTokensIn + totalTokensOut).toLocaleString(),icon: <TrendingUp className="w-4 h-4" />,  color: "text-emerald-400" },
            { label: "Avg Latency",   value: `${avgLatency.toFixed(0)} ms`,                   icon: <Clock className="w-4 h-4" />,       color: "text-blue-400" },
          ].map(kpi => (
            <div key={kpi.label} className={`rounded-xl border p-4 flex flex-col gap-1.5 ${kpi.warn ? "border-cyber-gold/40 bg-cyber-gold/5" : "border-cyber-neon/15 bg-cyber-panel/40"}`}>
              <div className="flex items-center justify-between">
                <span className={`${kpi.color} opacity-70`}>{kpi.icon}</span>
                {kpi.warn && <AlertTriangle className="w-3.5 h-3.5 text-cyber-gold animate-pulse" />}
              </div>
              <div className={`text-xl font-bold font-mono ${kpi.color}`}>{kpi.value}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* Provider breakdown table */}
        {summary && summary.by_provider.length > 0 ? (
          <div className="rounded-xl border border-cyber-neon/15 overflow-hidden">
            <div className="px-4 py-2.5 bg-cyber-bg/40 border-b border-cyber-neon/10">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono">Breakdown by Provider</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-cyber-neon/10 text-[9px] text-slate-500 uppercase">
                    {["Provider","Model","Calls","Tokens In","Tokens Out","Cost USD","Avg ms"].map(h => (
                      <th key={h} className="text-left px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.by_provider.map((p, i) => (
                    <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                      <td className={`px-4 py-2.5 font-bold ${pColor(p.provider)}`}>{p.provider}</td>
                      <td className="px-4 py-2.5 text-slate-400 text-[10px]">{p.model || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-300">{p.calls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-slate-300">{p.tokens_in.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-slate-300">{p.tokens_out.toLocaleString()}</td>
                      <td className={`px-4 py-2.5 font-bold ${p.cost_usd > 0.01 ? "text-cyber-gold" : "text-slate-300"}`}>
                        ${p.cost_usd.toFixed(6)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{p.avg_latency_ms.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-cyber-neon/20 bg-cyber-bg/30 text-slate-300 font-bold">
                    <td className="px-4 py-2.5" colSpan={2}>TOTAL</td>
                    <td className="px-4 py-2.5">{totalCalls.toLocaleString()}</td>
                    <td className="px-4 py-2.5">{totalTokensIn.toLocaleString()}</td>
                    <td className="px-4 py-2.5">{totalTokensOut.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-cyber-gold">${(summary.total_cost_usd).toFixed(6)}</td>
                    <td className="px-4 py-2.5">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : !loading && (
          <div className="text-center text-slate-500 text-sm py-8 font-mono">
            ยังไม่มีข้อมูล API calls — เริ่มใช้งาน agents เพื่อดู cost tracking ที่นี่
          </div>
        )}

        {/* Cost bar chart (simple CSS) */}
        {summary && summary.by_provider.length > 1 && (
          <div className="rounded-xl border border-cyber-neon/15 p-4 space-y-2.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-3">Cost Distribution</div>
            {summary.by_provider.map((p, i) => {
              const pct = summary.total_cost_usd > 0 ? (p.cost_usd / summary.total_cost_usd) * 100 : 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className={pColor(p.provider)}>{p.provider} / {p.model || "default"}</span>
                    <span className="text-slate-400">{pct.toFixed(1)}%  ${p.cost_usd.toFixed(6)}</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${
                      p.provider.toLowerCase() === "openai"  ? "bg-emerald-500" :
                      p.provider.toLowerCase() === "claude"  ? "bg-orange-500" :
                      p.provider.toLowerCase() === "gemini"  ? "bg-blue-500" : "bg-slate-500"
                    }`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Raw log toggle */}
        <div>
          <button type="button"
            onClick={() => setShowLog(v => !v)}
            className="flex items-center gap-2 text-[10px] font-mono text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {showLog ? "Hide" : "Show"} raw call log ({log.length} recent calls)
          </button>
          {showLog && log.length > 0 && (
            <div className="mt-2 rounded-xl border border-slate-700 overflow-hidden">
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="border-b border-slate-700 text-[9px] text-slate-500 uppercase">
                      {["Time","Provider","Agent","Tokens↑","Tokens↓","Cost","Status"].map(h => (
                        <th key={h} className="text-left px-3 py-1.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {log.map(entry => (
                      <tr key={entry.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{new Date(entry.created_at).toLocaleTimeString("th-TH")}</td>
                        <td className={`px-3 py-1.5 font-bold ${pColor(entry.provider)}`}>{entry.provider}</td>
                        <td className="px-3 py-1.5 text-slate-400">{entry.agent_id}</td>
                        <td className="px-3 py-1.5 text-slate-300">{entry.tokens_in}</td>
                        <td className="px-3 py-1.5 text-slate-300">{entry.tokens_out}</td>
                        <td className="px-3 py-1.5 text-cyber-gold">${entry.cost_usd.toFixed(6)}</td>
                        <td className={`px-3 py-1.5 ${entry.status === "success" ? "text-status-success" : "text-status-error"}`}>{entry.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading cost data…
          </div>
        )}
      </div>
    </div>
  );
}
