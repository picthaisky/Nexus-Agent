/**
 * usePresence — connects to /ws/presence and tracks online users.
 */
import { useEffect, useRef, useState, useCallback } from "react";

export interface PresenceUser {
  session_id:   string;
  name:         string;
  avatar_color: string;
  status:       "online" | "away" | "busy";
  activity:     string;
  connected_at: number;
  last_seen:    number;
}

interface UsePresenceResult {
  users:         PresenceUser[];
  onlineCount:   number;
  mySessionId:   string | null;
  connected:     boolean;
  updateStatus:  (status: string, activity?: string) => void;
}

function getWsUrl(): string {
  try {
    const api = (import.meta as any).env?.VITE_NEXUS_API_URL as string | undefined;
    if (api) {
      const u = new URL(api);
      return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/ws/presence`;
    }
  } catch { /* ignore */ }
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/presence`;
}

export function usePresence(userName = ""): UsePresenceResult {
  const [users,       setUsers]       = useState<PresenceUser[]>([]);
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [connected,   setConnected]   = useState(false);
  const wsRef    = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const updateStatus = useCallback((status: string, activity = "") => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "status", status, activity }));
    }
  }, []);

  useEffect(() => {
    let retry = 0;

    function connect() {
      const url = `${getWsUrl()}${userName ? `?name=${encodeURIComponent(userName)}` : ""}`;
      const ws  = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen  = () => { setConnected(true); retry = 0; };
      ws.onclose = () => {
        setConnected(false);
        retry++;
        timerRef.current = window.setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          switch (data.event) {
            case "snapshot":
              setUsers(data.users || []);
              setSessionId(data.your_session_id || null);
              break;
            case "user_joined":
              setUsers(prev => {
                if (prev.find(u => u.session_id === data.payload.session_id)) return prev;
                return [...prev, data.payload];
              });
              break;
            case "user_left":
              setUsers(prev => prev.filter(u => u.session_id !== data.payload.session_id));
              break;
            case "user_status":
              setUsers(prev => prev.map(u =>
                u.session_id === data.payload.session_id ? { ...u, ...data.payload } : u
              ));
              break;
          }
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [userName]);

  return { users, onlineCount: users.length, mySessionId: sessionId, connected, updateStatus };
}
