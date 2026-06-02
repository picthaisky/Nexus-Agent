import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send, Plus, Trash2, RefreshCw, MessageSquare, Bot, User,
  Zap, Copy, ChevronDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

interface Message  { message_id: number; role: "user" | "assistant" | "system"; content: string; created_at: string }
interface Session  { session_id: string; title: string; agent_role: string; message_count: number; updated_at: string }

const AGENT_ROLES = [
  { value: "planner",          label: "Planner" },
  { value: "technical_architect", label: "Architect" },
  { value: "developer",        label: "Developer" },
  { value: "code_reviewer",    label: "Code Reviewer" },
  { value: "debugger",         label: "Debugger" },
  { value: "qa_tester",        label: "QA Tester" },
  { value: "database_architect", label: "DB Architect" },
  { value: "devops_agent",     label: "DevOps" },
  { value: "data_analyst",     label: "Data Analyst" },
  { value: "project_manager",  label: "Project Manager" },
  { value: "security_auditor", label: "Security" },
  { value: "finance_agent",    label: "Finance" },
  { value: "content_creator_agent", label: "Content" },
];

export function ChatPanel() {
  const [sessions, setSessions]     = useState<Session[]>([]);
  const [activeId, setActiveId]     = useState<string | null>(null);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [streaming, setStreaming]   = useState(false);
  const [streamBuf, setStreamBuf]   = useState("");
  const [useStream, setUseStream]   = useState(true);
  const [newRole, setNewRole]       = useState("planner");
  const [loadingHist, setLoadingHist] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  const headers = () => ({ "Content-Type":"application/json", "X-API-Key": (window as any).__NEXUS_API_KEY__ || "" });
  const base    = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/,"");

  const fetchSessions = useCallback(async () => {
    const r = await fetch(`${base()}/chat/sessions`, { headers: headers() });
    if (r.ok) setSessions((await r.json()).sessions || []);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const loadHistory = async (sid: string) => {
    setLoadingHist(true);
    setActiveId(sid); setMessages([]);
    const r = await fetch(`${base()}/chat/sessions/${sid}/messages`, { headers: headers() });
    if (r.ok) setMessages((await r.json()).messages || []);
    setLoadingHist(false);
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamBuf]);

  const createSession = async () => {
    const r = await fetch(`${base()}/chat/sessions`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ title: "New Chat", agent_role: newRole }),
    });
    if (r.ok) {
      const s = await r.json();
      await fetchSessions();
      await loadHistory(s.session_id);
    }
  };

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${base()}/chat/sessions/${sid}`, { method: "DELETE", headers: headers() });
    if (activeId === sid) { setActiveId(null); setMessages([]); }
    await fetchSessions();
  };

  const send = async () => {
    if (!input.trim() || !activeId || streaming) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(m => [...m, { message_id: Date.now(), role: "user", content: userMsg, created_at: new Date().toISOString() }]);

    if (useStream) {
      setStreaming(true); setStreamBuf("");
      abortRef.current = new AbortController();
      try {
        const r = await fetch(`${base()}/chat/sessions/${activeId}/messages`, {
          method: "POST", headers: headers(),
          body: JSON.stringify({ content: userMsg, stream: true }),
          signal: abortRef.current.signal,
        });
        if (!r.body) throw new Error("No stream body");
        const reader = r.body.getReader();
        const dec    = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = dec.decode(value).split("\n");
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (raw === "[DONE]") break;
            try {
              const d = JSON.parse(raw);
              if (d.token) { full += d.token; setStreamBuf(full); }
              if (d.error) { full += `\n⚠️ ${d.error}`; setStreamBuf(full); }
            } catch { /* skip malformed */ }
          }
        }
        setMessages(m => [...m, { message_id: Date.now()+1, role: "assistant", content: full, created_at: new Date().toISOString() }]);
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setMessages(m => [...m, { message_id: Date.now()+1, role: "assistant", content: `⚠️ ${e.message}`, created_at: new Date().toISOString() }]);
        }
      } finally {
        setStreaming(false); setStreamBuf("");
        await fetchSessions();
      }
    } else {
      // Non-streaming
      try {
        const r = await fetch(`${base()}/chat/sessions/${activeId}/messages`, {
          method: "POST", headers: headers(),
          body: JSON.stringify({ content: userMsg, stream: false }),
        });
        const d = await r.json();
        if (r.ok) setMessages(m => [...m, { message_id: Date.now()+1, role: "assistant", content: d.content, created_at: new Date().toISOString() }]);
      } catch (e: any) {
        setMessages(m => [...m, { message_id: Date.now()+1, role: "assistant", content: `⚠️ ${e.message}`, created_at: new Date().toISOString() }]);
      }
      await fetchSessions();
    }
  };

  const stopStream = () => { abortRef.current?.abort(); };

  const activeSession = sessions.find(s => s.session_id === activeId);

  return (
    <div className="h-full flex overflow-hidden rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md">

      {/* ── Sidebar ── */}
      <div className="w-56 flex-none flex flex-col border-r border-cyber-neon/15 bg-cyber-bg/50">
        <div className="flex items-center justify-between px-3 py-3 border-b border-cyber-neon/10">
          <span className="text-[10px] font-bold font-mono text-cyber-neon uppercase tracking-widest flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Conversations
          </span>
          <button type="button" aria-label="Refresh sessions" onClick={fetchSessions} className="p-1 text-slate-500 hover:text-cyber-neon">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {/* New chat */}
        <div className="px-2 py-2 border-b border-cyber-neon/10 space-y-1.5">
          <select
            aria-label="Agent role for new chat"
            value={newRole} onChange={e => setNewRole(e.target.value)}
            className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 focus:outline-none focus:border-cyber-neon"
          >
            {AGENT_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button type="button" onClick={createSession}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 text-cyber-neon rounded text-[10px] font-mono transition-all">
            <Plus className="w-3 h-3" /> New Chat
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-1">
          {sessions.length === 0 ? (
            <div className="text-[10px] text-slate-600 font-mono italic px-3 py-2">ไม่มี conversation</div>
          ) : sessions.map(s => (
            <button key={s.session_id} type="button"
              onClick={() => loadHistory(s.session_id)}
              className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-all group ${
                s.session_id === activeId ? "bg-cyber-neon/10 border-r-2 border-cyber-neon" : "hover:bg-slate-800/40"
              }`}
            >
              <Bot className="w-3.5 h-3.5 flex-none mt-0.5 text-cyber-neon/60" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono text-slate-200 truncate">{s.title}</div>
                <div className="text-[8px] text-slate-500">{s.agent_role.replace(/_/g," ")} · {s.message_count} msg</div>
              </div>
              <button type="button" aria-label={`Delete ${s.title}`}
                onClick={e => deleteSession(s.session_id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 hover:text-status-error transition-all">
                <Trash2 className="w-3 h-3" />
              </button>
            </button>
          ))}
        </div>

        {/* Stream toggle */}
        <div className="px-3 py-2 border-t border-cyber-neon/10">
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => setUseStream(v => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors ${useStream ? "bg-cyber-neon/40" : "bg-slate-700"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${useStream ? "translate-x-4" : ""}`} />
            </div>
            <span className="text-[9px] text-slate-400 font-mono flex items-center gap-1">
              <Zap className="w-2.5 h-2.5 text-cyber-neon/70" /> Streaming
            </span>
          </label>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4">
            <MessageSquare className="w-12 h-12 opacity-20" />
            <div className="text-sm font-mono">เลือก conversation หรือสร้างใหม่</div>
            <button type="button" onClick={createSession}
              className="flex items-center gap-2 px-4 py-2 bg-cyber-neon/10 border border-cyber-neon/30 text-cyber-neon rounded-lg text-xs font-mono hover:bg-cyber-neon/20 transition-all">
              <Plus className="w-3.5 h-3.5" /> New Chat
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-cyber-neon/15 bg-cyber-bg/30">
              <Bot className="w-4 h-4 text-cyber-neon" />
              <span className="text-xs font-mono font-bold text-slate-200">
                {activeSession?.agent_role.replace(/_/g," ").toUpperCase() || "Agent"}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-[10px] text-slate-500">{activeSession?.title}</span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {loadingHist ? (
                <div className="flex justify-center"><RefreshCw className="w-4 h-4 animate-spin text-cyber-neon" /></div>
              ) : messages.map(msg => (
                <MessageBubble key={msg.message_id} msg={msg} />
              ))}

              {/* Streaming bubble */}
              {streaming && streamBuf && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-cyber-neon/20 flex items-center justify-center flex-none">
                    <Bot className="w-4 h-4 text-cyber-neon" />
                  </div>
                  <div className="flex-1 bg-slate-800/60 rounded-2xl rounded-tl-none px-4 py-3 text-sm text-slate-200 max-w-[80%]">
                    <ReactMarkdown>{streamBuf}</ReactMarkdown>
                    <span className="inline-block w-2 h-4 bg-cyber-neon ml-0.5 animate-pulse" />
                  </div>
                </div>
              )}

              {streaming && !streamBuf && (
                <div className="flex gap-3 items-center">
                  <div className="w-7 h-7 rounded-full bg-cyber-neon/20 flex items-center justify-center flex-none">
                    <Bot className="w-4 h-4 text-cyber-neon" />
                  </div>
                  <div className="flex gap-1">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2 h-2 bg-cyber-neon/60 rounded-full animate-bounce"
                        style={{ animationDelay: `${i*150}ms` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="flex-none border-t border-cyber-neon/15 bg-cyber-bg/30 p-3">
              <div className="flex gap-2">
                <textarea
                  aria-label="Chat message input"
                  className="flex-1 bg-slate-900/50 border border-cyber-neon/30 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon transition-all resize-none"
                  placeholder="พิมพ์ข้อความ... (Shift+Enter เพื่อขึ้นบรรทัดใหม่)"
                  rows={2}
                  value={input}
                  disabled={streaming}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                {streaming ? (
                  <button type="button" onClick={stopStream}
                    className="px-3 py-2 bg-status-error/20 border border-status-error/40 text-status-error rounded-xl text-xs font-mono self-end">
                    Stop
                  </button>
                ) : (
                  <button type="button" onClick={send} disabled={!input.trim()}
                    className="px-3 py-2 bg-cyber-neon/20 hover:bg-cyber-neon/40 border border-cyber-neon/40 text-cyber-neon rounded-xl transition-all disabled:opacity-40 self-end">
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-none ${isUser ? "bg-slate-700" : "bg-cyber-neon/20"}`}>
        {isUser ? <User className="w-3.5 h-3.5 text-slate-300" /> : <Bot className="w-3.5 h-3.5 text-cyber-neon" />}
      </div>
      <div className={`max-w-[80%] group relative ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm ${
          isUser
            ? "bg-cyber-neon/15 border border-cyber-neon/30 text-slate-100 rounded-tr-none"
            : "bg-slate-800/60 text-slate-200 rounded-tl-none"
        }`}>
          <div className="prose prose-invert prose-sm max-w-none prose-p:text-slate-200 prose-a:text-cyber-neon">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[8px] text-slate-600">{new Date(msg.created_at).toLocaleTimeString("th-TH")}</span>
          <button type="button" aria-label="Copy message"
            onClick={() => navigator.clipboard.writeText(msg.content)}
            className="opacity-0 group-hover:opacity-100 transition-opacity">
            <Copy className="w-2.5 h-2.5 text-slate-600 hover:text-slate-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
