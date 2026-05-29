import { useEffect, useRef, useState, useCallback } from "react";
import type {
  AgentRuntimeState,
  DashboardEvent,
  DashboardSnapshot,
  MicroState,
} from "../types";

const DEFAULT_WS_URL =
  (import.meta as any).env?.VITE_NEXUS_WS_URL ||
  // Vite dev proxy forwards /ws → ws://localhost:8080/ws.
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/dashboard`;

function withAuthToken(base: string): string {
  try {
    const key = (window as unknown as { __NEXUS_API_KEY__?: string | null }).__NEXUS_API_KEY__;
    if (!key) return base;
    const u = new URL(base, location.href);
    if (!u.searchParams.has("token")) u.searchParams.set("token", key);
    return u.toString();
  } catch {
    return base;
  }
}

export interface ExpFx {
  id: number;
  agent_id: string;
  delta: number;
}

export interface UseAgentSocketResult {
  agents: Record<string, AgentRuntimeState>;
  connected: boolean;
  lastEvent: DashboardEvent | null;
  expEffects: ExpFx[];
  consumeExp: (id: number) => void;
}

/**
 * useAgentSocket — connects to /ws/dashboard, hydrates initial snapshot, and
 * updates the per-agent state map as `agent_update` events stream in.
 * `exp_gained` events spawn short-lived effects the UI can render above avatars.
 */
export function useAgentSocket(url: string = DEFAULT_WS_URL): UseAgentSocketResult {
  const [agents, setAgents] = useState<Record<string, AgentRuntimeState>>({});
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<DashboardEvent | null>(null);
  const [expEffects, setExpEffects] = useState<ExpFx[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const fxIdRef = useRef(0);

  const consumeExp = useCallback((id: number) => {
    setExpEffects((xs) => xs.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    let retry = 0;
    let timer: number | undefined;

    function connect() {
      const ws = new WebSocket(withAuthToken(url));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retry = 0;
      };
      ws.onclose = () => {
        setConnected(false);
        retry += 1;
        const backoff = Math.min(1000 * 2 ** retry, 10_000);
        timer = window.setTimeout(connect, backoff);
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "snapshot") {
            const snap = data as DashboardSnapshot;
            const next: Record<string, AgentRuntimeState> = {};
            snap.agents.forEach((a) => (next[a.agent_id] = a));
            setAgents(next);
            return;
          }

          const ev = data as DashboardEvent;
          setLastEvent(ev);

          setAgents((prev) => {
            const existing = prev[ev.agent_id];
            const updated: AgentRuntimeState = {
              agent_id: ev.agent_id,
              role: ev.role,
              display_name: existing?.display_name || ev.agent_id,
              current_micro_state: ev.micro_state as MicroState,
              status_message: ev.status_message,
              last_updated: ev.timestamp,
              metrics: ev.metrics,
              current_task_id: (ev.extra?.task_id as string) ?? null,
              exp_points:
                (ev.extra?.exp_points as number) ?? existing?.exp_points ?? 0,
            };
            return { ...prev, [ev.agent_id]: updated };
          });

          if (ev.event === "exp_gained") {
            const delta = Number(ev.extra?.exp_delta ?? 0);
            if (delta > 0) {
              fxIdRef.current += 1;
              const id = fxIdRef.current;
              setExpEffects((xs) => [...xs, { id, agent_id: ev.agent_id, delta }]);
              window.setTimeout(() => consumeExp(id), 1500);
            }
          }
        } catch {
          // Ignore malformed payloads.
        }
      };
    }

    connect();
    return () => {
      if (timer) window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [url, consumeExp]);

  return { agents, connected, lastEvent, expEffects, consumeExp };
}
