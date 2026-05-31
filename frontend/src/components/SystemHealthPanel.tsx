import { useEffect, useState } from "react";
import { Activity, Database, Server, Cpu } from "lucide-react";

interface HealthData {
  status: string;
  checks: Record<string, string>;
}

function getApiKey(): string | null {
  return (window as unknown as { __NEXUS_API_KEY__?: string | null }).__NEXUS_API_KEY__ || null;
}

export function SystemHealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const apiKey = getApiKey();
        const headers: HeadersInit = {};
        if (apiKey) headers["X-API-Key"] = apiKey;
        
        const res = await fetch("/ready", { headers });
        if (res.ok || res.status === 503) {
          const data = await res.json();
          setHealth(data);
        }
      } catch (err) {
        console.error("Failed to fetch health", err);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!health) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-cyber-neon/20 bg-cyber-panel/30 p-4">
        <span className="text-sm text-slate-500 animate-pulse">Loading system telemetry...</span>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    if (status === "ok" || status === "configured") return "text-status-success";
    if (status === "error") return "text-status-error";
    return "text-status-warning";
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/30 overflow-hidden">
      <div className="border-b border-cyber-neon/20 bg-cyber-panel/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyber-neon" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-cyber-neon/80">
            System Health
          </h3>
        </div>
        <div className={`text-xs px-2 py-0.5 rounded-full border ${health.status === 'ready' ? 'border-status-success text-status-success' : 'border-status-error text-status-error'}`}>
          {health.status.toUpperCase()}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Database className="h-4 w-4 text-slate-500" />
            <span>PostgreSQL</span>
          </div>
          <span className={`font-mono text-xs ${getStatusColor(health.checks?.postgres || "unknown")}`}>
            {health.checks?.postgres || "unknown"}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Server className="h-4 w-4 text-slate-500" />
            <span>Redis Cache</span>
          </div>
          <span className={`font-mono text-xs ${getStatusColor(health.checks?.redis || "unknown")}`}>
            {health.checks?.redis || "unknown"}
          </span>
        </div>
        
        <div className="my-2 border-t border-cyber-neon/10" />
        
        <div className="text-xs font-bold text-slate-500 uppercase">AI Providers</div>
        
        {["openai", "claude", "gemini", "vllm_local"].map((provider) => (
           <div key={provider} className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300 capitalize">
              <Cpu className="h-4 w-4 text-slate-500" />
              <span>{provider.replace('_', ' ')}</span>
            </div>
            <span className={`font-mono text-xs ${getStatusColor(health.checks?.[provider] || "missing")}`}>
              {health.checks?.[provider] || "missing"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
