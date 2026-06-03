/**
 * useNotifications — connects to /ws/notifications for real-time push,
 * and exposes helpers to mark read and manage the local notification list.
 */
import { useEffect, useRef, useState, useCallback } from "react";

export interface Notification {
  id:          string;
  category:    "task_completed" | "task_failed" | "agent_error" | "system_alert" | "info" | "mention";
  title:       string;
  body:        string;
  action_url:  string | null;
  is_read:     boolean;
  created_at:  string;
}

interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount:   number;
  connected:     boolean;
  markRead:      (id: string) => void;
  markAllRead:   () => void;
  dismiss:       (id: string) => void;
}

function getWsUrl(): string {
  try {
    const api = (import.meta as any).env?.VITE_NEXUS_API_URL as string | undefined;
    if (api) {
      const u = new URL(api);
      return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/ws/notifications`;
    }
  } catch { /* ignore */ }
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/notifications`;
}

export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connected, setConnected]         = useState(false);
  const wsRef  = useRef<WebSocket | null>(null);
  const retry  = useRef(0);
  const timer  = useRef<number | undefined>(undefined);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;
      ws.onopen  = () => { setConnected(true); retry.current = 0; };
      ws.onclose = () => {
        setConnected(false);
        retry.current++;
        timer.current = window.setTimeout(connect, Math.min(1000 * 2 ** retry.current, 15000));
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        try {
          const d = JSON.parse(msg.data);
          if (d.event === "notification") {
            setNotifications(prev => {
              // Upsert (avoid duplicates from replay)
              const exists = prev.find(n => n.id === d.payload.id);
              if (exists) return prev.map(n => n.id === d.payload.id ? d.payload : n);
              return [d.payload, ...prev].slice(0, 100);
            });
          }
        } catch { /* ignore */ }
      };
    }
    connect();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      wsRef.current?.close();
    };
  }, []);

  const sendWs = useCallback((obj: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }, []);

  const markRead = useCallback((id: string) => {
    sendWs({ type: "read", id });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }, [sendWs]);

  const markAllRead = useCallback(() => {
    sendWs({ type: "read_all" });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }, [sendWs]);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return { notifications, unreadCount, connected, markRead, markAllRead, dismiss };
}
