/**
 * NotificationCenter
 * ──────────────────
 * • Bell icon with unread badge in the nav bar
 * • Dropdown panel with notification list
 * • Toast pop-ups for new incoming notifications
 * • Presence strip showing online users
 */
import { useState, useEffect, useRef } from "react";
import {
  Bell, CheckCircle2, XCircle, AlertTriangle, Info,
  X, CheckCheck, Users, Wifi,
} from "lucide-react";
import { useNotifications, type Notification } from "../hooks/useNotifications";
import { usePresence } from "../hooks/usePresence";

// ── Category meta ─────────────────────────────────────────────────────────────
const CAT_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  task_completed: { icon: <CheckCircle2 className="w-4 h-4" />, color: "text-status-success", bg: "bg-status-success/10" },
  task_failed:    { icon: <XCircle      className="w-4 h-4" />, color: "text-status-error",   bg: "bg-status-error/10" },
  agent_error:    { icon: <AlertTriangle className="w-4 h-4" />, color: "text-status-error",   bg: "bg-status-error/10" },
  system_alert:   { icon: <AlertTriangle className="w-4 h-4" />, color: "text-cyber-gold",     bg: "bg-cyber-gold/10" },
  info:           { icon: <Info         className="w-4 h-4" />, color: "text-cyber-neon",     bg: "bg-cyber-neon/10" },
  mention:        { icon: <Bell         className="w-4 h-4" />, color: "text-cyber-neon",     bg: "bg-cyber-neon/10" },
};

// ── Toast component ────────────────────────────────────────────────────────────
function Toast({ n, onDismiss }: { n: Notification; onDismiss: () => void }) {
  const meta = CAT_META[n.category] ?? CAT_META.info;
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-xl border border-white/10 shadow-xl backdrop-blur-md ${meta.bg} animate-in slide-in-from-right-4 fade-in duration-300 max-w-xs`}>
      <span className={`flex-none mt-0.5 ${meta.color}`}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-100 leading-tight">{n.title}</div>
        {n.body && <div className="text-[10px] text-slate-400 mt-0.5 leading-snug truncate">{n.body}</div>}
      </div>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss} className="text-slate-500 hover:text-slate-300 flex-none">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Notification row ──────────────────────────────────────────────────────────
function NotifRow({ n, onRead, onDismiss }: { n: Notification; onRead: () => void; onDismiss: () => void }) {
  const meta = CAT_META[n.category] ?? CAT_META.info;
  const time = new Date(n.created_at).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-white/5 transition-colors cursor-pointer group ${n.is_read ? "opacity-60" : ""}`}
      onClick={() => { if (!n.is_read) onRead(); }}
    >
      {/* Unread dot */}
      <span className={`w-1.5 h-1.5 rounded-full flex-none mt-1.5 ${n.is_read ? "bg-transparent" : "bg-cyber-neon animate-pulse"}`} />
      <span className={`flex-none mt-0.5 ${meta.color}`}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-200 leading-tight">{n.title}</div>
        {n.body && <div className="text-[10px] text-slate-500 mt-0.5 leading-snug line-clamp-2">{n.body}</div>}
        <div className="text-[8px] text-slate-600 mt-1 font-mono">{time}</div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 hover:text-slate-400 transition-all flex-none"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Main NotificationCenter ───────────────────────────────────────────────────
interface NotificationCenterProps {
  showPresence?: boolean;
}

export function NotificationCenter({ showPresence = true }: NotificationCenterProps) {
  const { notifications, unreadCount, markRead, markAllRead, dismiss } = useNotifications();
  const { users, connected: presenceConnected }                         = usePresence();
  const [open, setOpen]       = useState(false);
  const [toasts, setToasts]   = useState<Notification[]>([]);
  const prevCountRef          = useRef(0);
  const panelRef              = useRef<HTMLDivElement>(null);

  // Show toast for each new notification
  useEffect(() => {
    const prevIds = new Set(toasts.map(t => t.id));
    const newOnes = notifications.filter(n => !n.is_read && !prevIds.has(n.id) && n.id !== notifications[0]?.id);
    // Only show toast for the very latest unread when count increases
    if (unreadCount > prevCountRef.current && notifications[0] && !notifications[0].is_read) {
      setToasts(prev => [notifications[0], ...prev.filter(t => t.id !== notifications[0].id)].slice(0, 3));
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount, notifications, toasts]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const STATUS_COLORS: Record<string, string> = {
    online: "bg-status-success",
    away:   "bg-cyber-gold",
    busy:   "bg-status-error",
  };

  return (
    <>
      {/* ── Bell button ── */}
      <div className="relative" ref={panelRef}>
        <button
          type="button"
          aria-label={`Notifications (${unreadCount} unread)`}
          onClick={() => setOpen(v => !v)}
          className={`relative p-1.5 rounded-lg transition-colors ${open ? "bg-cyber-neon/20 text-cyber-neon" : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"}`}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 bg-status-error text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* ── Dropdown panel ── */}
        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 z-50 bg-cyber-bg/95 border border-cyber-neon/25 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-cyber-neon/15">
              <span className="text-xs font-bold font-mono text-slate-200 flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-cyber-neon" />
                Notifications
                {unreadCount > 0 && (
                  <span className="bg-status-error text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>
                )}
              </span>
              {unreadCount > 0 && (
                <button type="button" onClick={markAllRead}
                  className="flex items-center gap-1 text-[9px] font-mono text-cyber-neon/70 hover:text-cyber-neon transition-colors">
                  <CheckCheck className="w-3 h-3" /> Mark all read
                </button>
              )}
            </div>

            {/* Presence strip */}
            {showPresence && users.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60 bg-black/20">
                <Users className="w-3 h-3 text-slate-500 flex-none" />
                <div className="flex items-center gap-1.5 flex-1 overflow-hidden">
                  {users.slice(0, 6).map(u => (
                    <div key={u.session_id} title={`${u.name} — ${u.status}`}
                      className="relative flex-none">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                        style={{ backgroundColor: u.avatar_color }}>
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-cyber-bg ${STATUS_COLORS[u.status] || "bg-slate-500"}`} />
                    </div>
                  ))}
                  {users.length > 6 && (
                    <span className="text-[8px] text-slate-500 font-mono">+{users.length - 6}</span>
                  )}
                </div>
                <span className={`text-[8px] font-mono flex items-center gap-0.5 ${presenceConnected ? "text-status-success" : "text-slate-600"}`}>
                  <Wifi className="w-2.5 h-2.5" /> {users.length} online
                </span>
              </div>
            )}

            {/* Notification list */}
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/40">
              {notifications.length === 0 ? (
                <div className="text-center py-8 text-slate-600 text-xs font-mono">No notifications</div>
              ) : notifications.map(n => (
                <NotifRow
                  key={n.id}
                  n={n}
                  onRead={() => markRead(n.id)}
                  onDismiss={() => dismiss(n.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Toast stack ── */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <Toast n={t} onDismiss={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
          </div>
        ))}
      </div>
    </>
  );
}
