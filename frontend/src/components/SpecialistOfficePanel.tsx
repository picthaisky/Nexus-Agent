import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, ArrowRight, FileText, Briefcase, FileSignature, Share2,
  Link2, CheckCircle2, XCircle, RefreshCw, Copy, ExternalLink,
  Trash2, Clock, Zap, Shield, Bug, TestTube, Database, Server,
  BarChart3, ClipboardList, Upload, X, ChevronDown, ChevronRight,
  Download,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ExportModal } from "./ExportModal";
import { CodeBlock }   from "./CodeEditor";

// ─── Facebook icon ─────────────────────────────────────────────────────────
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type DeskId = "finance" | "content" | "code-review" | "debug" | "qa" | "database"
            | "devops" | "analytics" | "project" | "security" | "social";

interface FileItem { file_id: string; filename: string; content_type: string; size_bytes: number; created_at: string }
interface SocialConnection { platform: string; account_name: string; account_id: string; page_id: string | null; connected_at: string }
interface SocialPost { id: number; platform: string; content_snippet: string; api_post_id: string | null; post_url: string | null; status: string; posted_at: string | null; error: string | null; created_at: string }

// ─── API helper ──────────────────────────────────────────────────────────────
function useApi() {
  const k  = () => (window as any).__NEXUS_API_KEY__ || "";
  const b  = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/, "");
  const h  = () => ({ "Content-Type": "application/json", "X-API-Key": k() });
  const fh = () => ({ "X-API-Key": k() });
  return {
    get:    (p: string)             => fetch(`${b()}${p}`, { headers: h() }),
    post:   (p: string, body: unknown) => fetch(`${b()}${p}`, { method: "POST", headers: h(), body: JSON.stringify(body) }),
    del:    (p: string)             => fetch(`${b()}${p}`, { method: "DELETE", headers: h() }),
    upload: (p: string, fd: FormData) => fetch(`${b()}${p}`, { method: "POST", headers: fh(), body: fd }),
  };
}

// ─── Desk definitions ─────────────────────────────────────────────────────────
const DESKS: Array<{ id: DeskId; icon: React.ReactNode; label: string; subtitle: string; endpoint?: string; bodyKey?: string; inputLabel?: string; inputField?: string; extraFields?: { name: string; label: string; default: string }[] }> = [
  { id: "finance",     icon: <Briefcase className="h-4 w-4" />,      label: "Finance Analyst",      subtitle: "Analyse numbers, accounting, cash flow",                           endpoint: "/agents/finance/analyze",   bodyKey: "analysis_md", inputField: "task",   inputLabel: "Financial task or data..." },
  { id: "content",     icon: <FileSignature className="h-4 w-4" />,   label: "Content Strategist",   subtitle: "Draft articles, social media posts, campaigns",                   endpoint: "/agents/content/generate",  bodyKey: "content_md",  inputField: "topic",  inputLabel: "Topic or keywords..." },
  { id: "code-review", icon: <CheckCircle2 className="h-4 w-4" />,    label: "Code Reviewer",        subtitle: "Review code quality, security, best practices",                   endpoint: "/agents/code-review",       bodyKey: "summary_md",  inputField: "target", inputLabel: "Paste code or describe what to review..." },
  { id: "debug",       icon: <Bug className="h-4 w-4" />,             label: "Debugger",             subtitle: "Diagnose errors, log analysis, fix suggestions",                  endpoint: "/agents/debug",             bodyKey: "analysis_md", inputField: "error",  inputLabel: "Paste error message, stack trace, or log..." },
  { id: "qa",          icon: <TestTube className="h-4 w-4" />,        label: "QA Tester",            subtitle: "Generate unit, integration & E2E test suites",                    endpoint: "/agents/qa-test",           bodyKey: "summary_md",  inputField: "target", inputLabel: "Describe feature or paste code to test...", extraFields: [{ name: "framework", label: "Framework", default: "pytest" }] },
  { id: "database",    icon: <Database className="h-4 w-4" />,        label: "DB Architect",         subtitle: "Design schemas, migrations, ER diagrams",                         endpoint: "/agents/database-design",   bodyKey: "summary_md",  inputField: "task",   inputLabel: "Describe data requirements...", extraFields: [{ name: "db_type", label: "Database", default: "PostgreSQL" }] },
  { id: "devops",      icon: <Server className="h-4 w-4" />,          label: "DevOps Engineer",      subtitle: "Dockerfile, CI/CD pipelines, deployment configs",                 endpoint: "/agents/devops",            bodyKey: "summary_md",  inputField: "task",   inputLabel: "Describe project or deployment requirement...", extraFields: [{ name: "stack", label: "Tech Stack", default: "Python/FastAPI" }] },
  { id: "analytics",   icon: <BarChart3 className="h-4 w-4" />,       label: "Data Analyst",         subtitle: "Insights, chart specs, recommendations from data",                endpoint: "/agents/data-analytics",    bodyKey: "summary_md",  inputField: "task",   inputLabel: "Paste data or describe analytics question..." },
  { id: "project",     icon: <ClipboardList className="h-4 w-4" />,   label: "Project Manager",      subtitle: "Task breakdowns, status reports, risk management",                endpoint: "/agents/project-status",    bodyKey: "summary_md",  inputField: "project",inputLabel: "Describe project or current status...", extraFields: [{ name: "context", label: "Context / notes", default: "" }] },
  { id: "security",    icon: <Shield className="h-4 w-4" />,          label: "Security Auditor",     subtitle: "OWASP Top 10 scan, vulnerability report",                         endpoint: "/agents/security-audit",    bodyKey: "summary_md",  inputField: "target", inputLabel: "Paste code or architecture to audit...", extraFields: [{ name: "scope", label: "Scope", default: "application code" }] },
  { id: "social",      icon: <Share2 className="h-4 w-4" />,          label: "Social Media",         subtitle: "Connect Facebook / TikTok, auto-post content" },
];

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  facebook: { label: "Facebook", color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", icon: <FacebookIcon className="w-4 h-4" /> },
  tiktok:   { label: "TikTok",   color: "text-slate-800", bg: "bg-slate-50", border: "border-slate-200", icon: <span className="font-bold text-[10px]">TT</span> },
};

// ─── Main Component ───────────────────────────────────────────────────────────
export function SpecialistOfficePanel() {
  const api = useApi();
  const [activeDesk, setActiveDesk] = useState<DeskId>("finance");
  const [input, setInput]     = useState("");
  const [extras, setExtras]   = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<any | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // Files
  const [files, setFiles]         = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Social
  const [connections, setConnections]   = useState<SocialConnection[]>([]);
  const [posts, setPosts]               = useState<SocialPost[]>([]);
  const [connectForm, setConnectForm]   = useState({ platform: "facebook", access_token: "", page_id: "", account_name: "" });
  const [socialLoading, setSocialLoading] = useState(false);
  const [connectMsg, setConnectMsg]     = useState<{type:"ok"|"err"; text:string} | null>(null);
  const [postingTo, setPostingTo]       = useState<string | null>(null);
  const [postMsgs, setPostMsgs]         = useState<Record<string, {type:"ok"|"err"; text:string}>>({});
  const [showExport, setShowExport]     = useState(false);

  const desk = DESKS.find(d => d.id === activeDesk)!;

  // Reset on desk switch
  const switchDesk = (id: DeskId) => {
    setActiveDesk(id);
    setInput(""); setExtras({}); setResult(null); setError(null);
    const d = DESKS.find(x => x.id === id)!;
    const init: Record<string,string> = {};
    d.extraFields?.forEach(f => { init[f.name] = f.default; });
    setExtras(init);
  };

  const fetchFiles       = useCallback(async () => { const r = await api.get("/files"); if (r.ok) setFiles((await r.json()).files || []); }, []);
  const fetchSocialData  = useCallback(async () => {
    const [cr, pr] = await Promise.all([api.get("/social/connections"), api.get("/social/posts?limit=20")]);
    if (cr.ok) setConnections((await cr.json()).connections || []);
    if (pr.ok) setPosts((await pr.json()).posts || []);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => { if (activeDesk === "social") fetchSocialData(); }, [activeDesk, fetchSocialData]);

  // ── Generic submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !desk.endpoint) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const body: Record<string, string> = { [desk.inputField!]: input, ...extras };
      const res  = await api.post(desk.endpoint, body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  // ── File upload ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await api.upload("/files/upload", fd);
      if (res.ok) { await fetchFiles(); }
    } catch { /* ignore */ } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleDeleteFile = async (id: string) => {
    await api.del(`/files/${id}`); await fetchFiles();
  };

  const injectFileContent = async (fileId: string) => {
    const res = await api.get(`/files/${fileId}/content`);
    if (res.ok) {
      const d = await res.json();
      setInput(prev => `${prev}\n\n--- File: ${d.filename} ---\n${d.content}`);
    }
  };

  // ── Social ──
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault(); setSocialLoading(true); setConnectMsg(null);
    try {
      const body: Record<string, string> = { platform: connectForm.platform, access_token: connectForm.access_token, account_name: connectForm.account_name };
      if (connectForm.platform === "facebook") body.page_id = connectForm.page_id;
      const res = await api.post("/social/connect", body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setConnectMsg({ type: "ok", text: `เชื่อมต่อสำเร็จ: ${data.page_name || data.display_name || connectForm.platform}` });
      setConnectForm({ platform: "facebook", access_token: "", page_id: "", account_name: "" });
      await fetchSocialData();
    } catch (e: any) { setConnectMsg({ type: "err", text: e.message }); }
    finally { setSocialLoading(false); }
  };

  const handleSocialPost = async (platform: string, message: string) => {
    setPostingTo(platform); setPostMsgs(m => ({ ...m, [platform]: { type: "ok", text: "" } }));
    try {
      const res = await api.post("/social/post", { platform, message });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setPostMsgs(m => ({ ...m, [platform]: { type: "ok", text: "โพสต์สำเร็จ ✓" } }));
      await fetchSocialData();
    } catch (e: any) { setPostMsgs(m => ({ ...m, [platform]: { type: "err", text: e.message } })); }
    finally { setPostingTo(null); }
  };

  const connectedPlatforms = connections.map(c => c.platform);

  const toggle = (key: string) => setExpandedSections(s => ({ ...s, [key]: !s[key] }));

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">

      {/* ── Scrollable tab bar ── */}
      <div className="flex-none border-b border-cyber-neon/20 bg-cyber-bg/50 overflow-x-auto">
        <div className="flex px-3 pt-3 gap-1 min-w-max">
          {DESKS.map(d => (
            <button key={d.id} type="button"
              onClick={() => switchDesk(d.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-t-lg text-xs font-mono whitespace-nowrap transition-all ${
                activeDesk === d.id
                  ? "bg-cyber-neon/20 border-t border-l border-r border-cyber-neon/40 text-cyber-neon font-bold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              {d.icon} {d.label}
              {d.id === "social" && connectedPlatforms.length > 0 && (
                <span className="w-3.5 h-3.5 rounded-full bg-status-success/80 text-[8px] font-bold text-white flex items-center justify-center">{connectedPlatforms.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* ── File attachment strip (shown for all non-social desks) ── */}
        {activeDesk !== "social" && (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyber-neon/30 bg-cyber-neon/5 text-cyber-neon text-xs font-mono cursor-pointer hover:bg-cyber-neon/15 transition-all">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Attach File
              <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} accept=".txt,.md,.py,.js,.ts,.json,.csv,.pdf,.sql,.yaml,.yml" />
            </label>
            {files.map(f => (
              <div key={f.file_id} className="flex items-center gap-1 bg-slate-800/50 border border-slate-700 rounded-full px-2.5 py-1 text-[10px] text-slate-300 max-w-36">
                <span className="truncate">{f.filename}</span>
                <button type="button" aria-label={`Inject ${f.filename} into input`} onClick={() => injectFileContent(f.file_id)} title="Inject into input" className="text-cyber-neon/70 hover:text-cyber-neon">
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => handleDeleteFile(f.file_id)} className="text-slate-500 hover:text-status-error">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── SOCIAL MEDIA desk ── */}
        {activeDesk === "social" && (
          <SocialPanel
            connections={connections} posts={posts}
            connectForm={connectForm} setConnectForm={setConnectForm}
            onConnect={handleConnect} onDisconnect={async (p: string) => { await api.del(`/social/${p}`); fetchSocialData(); }}
            socialLoading={socialLoading} connectMsg={connectMsg}
            postingTo={postingTo} postMsgs={postMsgs}
            onPost={handleSocialPost} onRefresh={fetchSocialData}
          />
        )}

        {/* ── Generic specialist desk ── */}
        {activeDesk !== "social" && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyber-neon/10">{desk.icon && <span className="text-cyber-neon">{desk.icon}</span>}</div>
              <div>
                <h2 className="text-base font-bold text-slate-100 tracking-wider font-mono">{desk.label.toUpperCase()}</h2>
                <p className="text-xs text-cyber-neon/80">{desk.subtitle}</p>
              </div>
            </div>

            {/* Extra fields */}
            {desk.extraFields && desk.extraFields.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {desk.extraFields.map(f => (
                  <div key={f.name} className="flex flex-col gap-0.5">
                    <label htmlFor={`extra-${f.name}`} className="text-[9px] uppercase text-slate-500 font-mono">{f.label}</label>
                    <input
                      id={`extra-${f.name}`}
                      aria-label={f.label}
                      placeholder={f.default}
                      className="bg-slate-900/50 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon w-32"
                      value={extras[f.name] ?? f.default}
                      onChange={e => setExtras(x => ({ ...x, [f.name]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Input form */}
            <form onSubmit={handleSubmit} className="relative">
              <textarea
                className="w-full h-28 bg-slate-900/50 border border-cyber-neon/30 rounded-xl py-3 px-4 pr-14 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon transition-all resize-none text-sm"
                placeholder={desk.inputLabel}
                value={input}
                onChange={e => setInput(e.target.value)}
                disabled={loading}
              />
              <button type="submit" disabled={loading || !input.trim()}
                className="absolute bottom-3 right-3 px-3 py-2 bg-cyber-neon/20 hover:bg-cyber-neon/40 text-cyber-neon rounded-lg transition-all disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-xs">
                <XCircle className="w-4 h-4 flex-none mt-0.5" /> {error}
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-400">

                {/* Main markdown output */}
                {result[desk.bodyKey!] && (
                  <div className="p-4 rounded-xl border border-cyber-neon/20 bg-slate-900/40 prose prose-invert prose-sm prose-p:text-slate-300 prose-a:text-cyber-neon max-w-none">
                    <ReactMarkdown>{result[desk.bodyKey!]}</ReactMarkdown>
                  </div>
                )}

                {/* Code Reviewer specifics */}
                {activeDesk === "code-review" && result.issues?.length > 0 && (
                  <ResultSection title={`Issues Found (${result.issues.length})`} id="issues" expanded={expandedSections} onToggle={toggle}>
                    <div className="space-y-2">
                      {result.issues.map((iss: any, i: number) => (
                        <div key={i} className={`p-2.5 rounded-lg border text-xs ${
                          iss.severity === "critical" ? "bg-red-950/40 border-red-500/40" :
                          iss.severity === "major"    ? "bg-orange-950/40 border-orange-500/40" :
                          iss.severity === "minor"    ? "bg-yellow-950/30 border-yellow-600/30" :
                                                        "bg-slate-800/30 border-slate-700"}`}>
                          <div className="flex items-center gap-2 font-mono mb-1">
                            <span className={`uppercase font-bold text-[10px] ${iss.severity === "critical" ? "text-red-400" : iss.severity === "major" ? "text-orange-400" : iss.severity === "minor" ? "text-yellow-400" : "text-slate-400"}`}>{iss.severity}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-400 text-[10px]">{iss.category}</span>
                            <span className="text-slate-600 text-[9px] truncate">{iss.file_path}:{iss.line}</span>
                          </div>
                          <div className="text-slate-300">{iss.description}</div>
                          <div className="text-cyber-neon/70 mt-1">→ {iss.suggestion}</div>
                        </div>
                      ))}
                    </div>
                  </ResultSection>
                )}

                {/* Security findings */}
                {activeDesk === "security" && result.findings?.length > 0 && (
                  <ResultSection title={`Findings (${result.findings.length}) · Risk Score: ${result.risk_score}/100`} id="findings" expanded={expandedSections} onToggle={toggle}>
                    <div className="space-y-2">
                      {result.findings.map((f: any, i: number) => (
                        <div key={i} className={`p-2.5 rounded-lg border text-xs ${
                          f.severity === "critical" ? "bg-red-950/40 border-red-500/40" :
                          f.severity === "high"     ? "bg-orange-950/30 border-orange-500/40" :
                          f.severity === "medium"   ? "bg-yellow-950/30 border-yellow-600/30" :
                                                      "bg-slate-800/30 border-slate-700"}`}>
                          <div className="flex items-center gap-2 mb-1 font-mono">
                            <span className="font-bold text-[10px] uppercase">{f.severity}</span>
                            <span className="text-slate-400 text-[10px]">{f.cwe_id} · {f.owasp}</span>
                          </div>
                          <div className="text-slate-200 font-semibold">{f.title}</div>
                          <div className="text-slate-400 mt-0.5">{f.description}</div>
                          <div className="text-cyber-neon/70 mt-1">Fix: {f.remediation}</div>
                        </div>
                      ))}
                    </div>
                  </ResultSection>
                )}

                {/* QA test cases */}
                {activeDesk === "qa" && result.test_cases?.length > 0 && (
                  <ResultSection title={`Test Cases (${result.test_cases.length}) · ~${result.coverage_estimate}`} id="tests" expanded={expandedSections} onToggle={toggle}>
                    <div className="space-y-2">
                      {result.test_cases.map((tc: any, i: number) => (
                        <div key={i} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-700 text-xs">
                          <div className="flex items-center gap-2 mb-1 font-mono">
                            <span className="bg-cyan-900/50 text-cyan-400 border border-cyan-700/40 px-1.5 rounded text-[9px]">{tc.test_type}</span>
                            <span className="text-slate-200 font-semibold">{tc.name}</span>
                          </div>
                          <div className="text-slate-400 mb-1.5">{tc.description}</div>
                          <pre className="bg-black/40 rounded p-2 text-[10px] text-slate-300 overflow-x-auto max-h-32">{tc.code}</pre>
                          <div className="text-slate-500 text-[9px] mt-1">{tc.file_path}</div>
                        </div>
                      ))}
                    </div>
                  </ResultSection>
                )}

                {/* DB tables */}
                {activeDesk === "database" && result.tables?.length > 0 && (
                  <ResultSection title={`Tables (${result.tables.length})`} id="tables" expanded={expandedSections} onToggle={toggle}>
                    <div className="space-y-2">
                      {result.tables.map((t: any, i: number) => (
                        <div key={i} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-700 text-xs">
                          <div className="text-cyan-400 font-mono font-bold mb-1">{t.name}</div>
                          <div className="space-y-0.5">{t.columns.map((c: string, j: number) => <div key={j} className="text-slate-300 text-[10px] font-mono">  {c}</div>)}</div>
                        </div>
                      ))}
                    </div>
                  </ResultSection>
                )}

                {/* Migration SQL */}
                {activeDesk === "database" && result.migration_sql && (
                  <ResultSection title="Migration SQL" id="sql" expanded={expandedSections} onToggle={toggle}>
                    <pre className="bg-black/50 rounded p-3 text-[10px] text-slate-300 overflow-x-auto max-h-60 font-mono">{result.migration_sql}</pre>
                  </ResultSection>
                )}

                {/* DevOps artifacts */}
                {activeDesk === "devops" && result.artifacts && Object.keys(result.artifacts).length > 0 && (
                  <ResultSection title="Generated Files" id="artifacts" expanded={expandedSections} onToggle={toggle}>
                    <div className="space-y-2">
                      {Object.entries(result.artifacts as Record<string,string>).map(([fname, content]) => (
                        <div key={fname} className="rounded-lg border border-slate-700 overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/60">
                            <span className="text-[10px] font-mono text-cyan-400">{fname}</span>
                            <button type="button" onClick={() => navigator.clipboard.writeText(content)} className="text-[9px] text-slate-500 hover:text-cyber-neon flex items-center gap-1">
                              <Copy className="w-2.5 h-2.5" /> Copy
                            </button>
                          </div>
                          <pre className="text-[9px] font-mono bg-black/40 p-2 text-slate-300 overflow-x-auto max-h-48">{content}</pre>
                        </div>
                      ))}
                    </div>
                  </ResultSection>
                )}

                {/* Project tasks */}
                {activeDesk === "project" && result.tasks?.length > 0 && (
                  <ResultSection title={`Tasks (${result.tasks.length}) · ${result.progress_pct}% complete`} id="tasks" expanded={expandedSections} onToggle={toggle}>
                    <div className="space-y-1.5">
                      {result.tasks.map((t: any) => (
                        <div key={t.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-800/40 border border-slate-700 text-xs">
                          <span className={`flex-none mt-0.5 w-2 h-2 rounded-full ${
                            t.status === "done" ? "bg-status-success" : t.status === "in_progress" ? "bg-cyber-neon animate-pulse" : t.status === "blocked" ? "bg-status-error" : "bg-slate-500"
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-slate-200 font-semibold truncate">{t.title}</div>
                            <div className="flex gap-2 mt-0.5">
                              <span className={`text-[9px] px-1 rounded ${t.priority === "high" ? "bg-red-900/40 text-red-400" : t.priority === "medium" ? "bg-yellow-900/40 text-yellow-400" : "bg-slate-700 text-slate-400"}`}>{t.priority}</span>
                              {t.due_date && <span className="text-[9px] text-slate-500">{t.due_date}</span>}
                              {t.assignee && <span className="text-[9px] text-slate-500">{t.assignee}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ResultSection>
                )}

                {/* Analytics charts & insights */}
                {activeDesk === "analytics" && (
                  <>
                    {result.insights?.length > 0 && (
                      <ResultSection title="Insights" id="insights" expanded={expandedSections} onToggle={toggle}>
                        <ul className="space-y-1">{result.insights.map((ins: string, i: number) => <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-cyber-neon">•</span>{ins}</li>)}</ul>
                      </ResultSection>
                    )}
                    {result.recommendations?.length > 0 && (
                      <ResultSection title="Recommendations" id="recs" expanded={expandedSections} onToggle={toggle}>
                        <ul className="space-y-1">{result.recommendations.map((r: string, i: number) => <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-status-success">→</span>{r}</li>)}</ul>
                      </ResultSection>
                    )}
                  </>
                )}

                {/* Post to social (content desk) */}
                {activeDesk === "content" && connectedPlatforms.length > 0 && result.content_md && (
                  <div className="border border-cyber-neon/20 rounded-xl bg-slate-900/30 p-3 space-y-2">
                    <div className="text-[10px] font-mono text-cyber-neon/80 uppercase flex items-center gap-1.5"><Zap className="w-3 h-3" /> Post to Social Media</div>
                    <div className="flex flex-wrap gap-2">
                      {connectedPlatforms.map(p => {
                        const meta = PLATFORM_META[p]; if (!meta) return null;
                        const msg  = postMsgs[p];
                        return (
                          <div key={p} className="flex flex-col gap-0.5">
                            <button type="button"
                              onClick={() => handleSocialPost(p, result.content_md.slice(0, 2000))}
                              disabled={postingTo === p || msg?.type === "ok"}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${msg?.type === "ok" ? "bg-status-success/10 border-status-success/40 text-status-success" : `${meta.bg} ${meta.border} ${meta.color} hover:opacity-90`}`}
                            >
                              {postingTo === p ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : msg?.type === "ok" ? <CheckCircle2 className="w-3.5 h-3.5" /> : meta.icon}
                              {postingTo === p ? "กำลังโพสต์…" : msg?.text || `Post to ${meta.label}`}
                            </button>
                            {msg?.type === "err" && <span className="text-[9px] text-status-error">{msg.text}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* DevOps code blocks */}
                {activeDesk === "devops" && result.artifacts && Object.entries(result.artifacts as Record<string,string>).map(([fname, code]) => (
                  <div key={fname}>
                    <div className="text-[9px] font-mono text-slate-500 mb-1">{fname}</div>
                    <CodeBlock code={code} language={fname.endsWith('.yml')||fname.endsWith('.yaml') ? 'yaml' : fname.endsWith('.sh') ? 'bash' : 'text'} filename={fname} />
                  </div>
                ))}

                {/* QA test code blocks */}
                {activeDesk === "qa" && result.test_cases?.map((tc: any) => (
                  <div key={tc.name}>
                    <div className="text-[9px] font-mono text-slate-500 mb-1">{tc.file_path}</div>
                    <CodeBlock code={tc.code} language="python" filename={tc.file_path} />
                  </div>
                ))}

                {/* API Integration code blocks */}
                {result.python_client && (
                  <CodeBlock code={result.python_client} language="python" filename="api_client.py" />
                )}

                {/* Copy + Export actions */}
                <div className="flex items-center gap-2 justify-end">
                  <button type="button" onClick={() => navigator.clipboard.writeText(result[desk.bodyKey!] || JSON.stringify(result, null, 2))}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded border border-slate-700 hover:border-slate-500 transition-colors">
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                  <button type="button" onClick={() => setShowExport(true)}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyber-neon px-2 py-1 rounded border border-slate-700 hover:border-cyber-neon/40 transition-colors">
                    <Download className="w-3 h-3" /> Export
                  </button>
                </div>
              </div>
            )}

            {!loading && !result && !error && (
              <div className="h-36 flex flex-col items-center justify-center text-slate-500 gap-3">
                <div className="w-12 h-12 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center animate-[spin_10s_linear_infinite] text-slate-600">{desk.icon}</div>
                <p className="text-xs font-mono text-center max-w-xs">{desk.subtitle}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Export Modal */}
      {showExport && result && (
        <ExportModal
          title={`${desk.label} — Result`}
          markdown={result[desk.bodyKey!] || JSON.stringify(result, null, 2)}
          data={Array.isArray(result.tasks) ? result.tasks : Array.isArray(result.issues) ? result.issues : null}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

// ─── Result Section Accordion ────────────────────────────────────────────────
function ResultSection({ title, id, expanded, onToggle, children }: {
  title: string; id: string; expanded: Record<string, boolean>;
  onToggle: (k: string) => void; children: React.ReactNode;
}) {
  const open = expanded[id] !== false; // default open
  return (
    <div className="rounded-xl border border-cyber-neon/20 overflow-hidden">
      <button type="button" onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-900/60 hover:bg-slate-900/80 transition-colors text-xs font-mono text-slate-300">
        <span>{title}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {open && <div className="px-4 py-3 bg-slate-900/20">{children}</div>}
    </div>
  );
}

// ─── Social Media Panel (extracted) ──────────────────────────────────────────
function SocialPanel({ connections, posts, connectForm, setConnectForm, onConnect, onDisconnect, socialLoading, connectMsg, postingTo, postMsgs, onPost, onRefresh }: any) {
  return (
    <div className="space-y-5">
      {/* Connected accounts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-cyber-neon/80 font-mono flex items-center gap-2"><Share2 className="w-3.5 h-3.5" /> Connected Accounts</h3>
          <button type="button" aria-label="Refresh" onClick={onRefresh} className="p-1 text-slate-500 hover:text-cyber-neon"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
        {connections.length === 0 ? <div className="text-xs text-slate-500 font-mono italic">ยังไม่มีบัญชีที่เชื่อมต่อ</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {connections.map((conn: any) => {
              const meta = PLATFORM_META[conn.platform] ?? PLATFORM_META.facebook;
              return (
                <div key={conn.platform} className={`flex items-center justify-between p-3 rounded-xl border ${meta.border} ${meta.bg}`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center border ${meta.border}`}><span className={meta.color}>{meta.icon}</span></div>
                    <div><div className={`text-xs font-bold ${meta.color}`}>{meta.label}</div><div className="text-[10px] text-slate-500 truncate max-w-28">{conn.account_name || conn.account_id}</div></div>
                  </div>
                  <button type="button" aria-label={`ยกเลิก ${conn.platform}`} onClick={() => onDisconnect(conn.platform)} className="p-1 text-slate-400 hover:text-status-error rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connect form */}
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-cyber-neon/80 font-mono mb-3 flex items-center gap-2"><Link2 className="w-3.5 h-3.5" /> Connect Account</h3>
        <form onSubmit={onConnect} className="space-y-3">
          <div className="flex gap-2">{(["facebook","tiktok"] as const).map(p => (
            <button key={p} type="button"
              onClick={() => setConnectForm((f: any) => ({ ...f, platform: p }))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${connectForm.platform === p ? `${PLATFORM_META[p].bg} ${PLATFORM_META[p].border} ${PLATFORM_META[p].color} ring-1 ring-current/20` : "border-slate-700 text-slate-400"}`}
            >{PLATFORM_META[p].icon} {PLATFORM_META[p].label}</button>
          ))}</div>
          {connectForm.platform === "facebook" && (
            <div className="space-y-2">
              <Field label="Page ID" placeholder="123456789" value={connectForm.page_id} onChange={(v: string) => setConnectForm((f: any) => ({ ...f, page_id: v }))} required />
              <Field label="Page Access Token" placeholder="EAAxxxxxx" value={connectForm.access_token} onChange={(v: string) => setConnectForm((f: any) => ({ ...f, access_token: v }))} required secret />
              <div className="text-[10px] text-slate-500 bg-slate-800/40 rounded p-2 leading-relaxed">รับ Token จาก <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer" className="text-cyber-neon underline">Facebook Graph Explorer ↗</a> → Permission: <code className="bg-slate-700 px-1 rounded">pages_manage_posts</code></div>
            </div>
          )}
          {connectForm.platform === "tiktok" && <Field label="TikTok Access Token" placeholder="token..." value={connectForm.access_token} onChange={(v: string) => setConnectForm((f: any) => ({ ...f, access_token: v }))} required secret />}
          {connectMsg && <div className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${connectMsg.type === "ok" ? "bg-status-success/10 border-status-success/30 text-status-success" : "bg-status-error/10 border-status-error/30 text-status-error"}`}>{connectMsg.type === "ok" ? <CheckCircle2 className="w-4 h-4 flex-none" /> : <XCircle className="w-4 h-4 flex-none" />}{connectMsg.text}</div>}
          <button type="submit" disabled={socialLoading || !connectForm.access_token} className="flex items-center gap-2 px-4 py-2 bg-cyber-neon/15 hover:bg-cyber-neon/25 border border-cyber-neon/40 text-cyber-neon rounded-lg text-xs font-mono font-bold disabled:opacity-50">
            {socialLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} เชื่อมต่อ {PLATFORM_META[connectForm.platform]?.label}
          </button>
        </form>
      </div>

      {/* Post history */}
      {posts.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-cyber-neon/80 font-mono mb-3 flex items-center gap-2"><Clock className="w-3.5 h-3.5" /> Post History</h3>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {posts.map((p: SocialPost) => {
              const meta = PLATFORM_META[p.platform] ?? PLATFORM_META.facebook;
              return (
                <div key={p.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 text-[10px]">
                  <span className={`flex-none mt-0.5 ${meta.color}`}>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-300 truncate">{p.content_snippet}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {p.status === "published" ? <span className="flex items-center gap-0.5 text-status-success"><CheckCircle2 className="w-2.5 h-2.5" /> Published</span>
                       : p.status === "failed"   ? <span className="flex items-center gap-0.5 text-status-error"><XCircle className="w-2.5 h-2.5" /> Failed</span>
                       : <span className="text-slate-500">Pending</span>}
                      {p.posted_at && <span className="text-slate-600">{new Date(p.posted_at).toLocaleString("th-TH")}</span>}
                      {p.post_url && <a href={p.post_url} target="_blank" rel="noopener noreferrer" className="text-cyber-neon flex items-center gap-0.5"><ExternalLink className="w-2.5 h-2.5" /> View</a>}
                    </div>
                    {p.error && <div className="text-status-error truncate">{p.error}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, placeholder, value, onChange, required = false, secret = false }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; required?: boolean; secret?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase text-slate-400 font-mono mb-0.5">{label}</label>
      <input type={secret ? "password" : "text"} required={required} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon transition-colors" />
    </div>
  );
}
