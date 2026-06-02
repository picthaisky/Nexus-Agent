/**
 * AdminPanel — unified settings hub with tabs for:
 * Scheduler · Notifications · Prompts · Workspaces/RBAC · Webhooks · Model Config
 */
import { useState, useEffect, useCallback } from "react";
import {
  Clock, Bell, Code2, Building2, Webhook, Cpu,
  Plus, Trash2, Play, Pause, RefreshCw, CheckCircle2,
  XCircle, Eye, EyeOff, Copy, Edit2, Save, X,
} from "lucide-react";

type AdminTab = "scheduler" | "notifications" | "prompts" | "workspaces" | "webhooks" | "models";

const TABS: Array<{ id: AdminTab; icon: React.ReactNode; label: string }> = [
  { id: "scheduler",     icon: <Clock className="w-4 h-4" />,    label: "Scheduler" },
  { id: "notifications", icon: <Bell className="w-4 h-4" />,     label: "Notifications" },
  { id: "prompts",       icon: <Code2 className="w-4 h-4" />,    label: "Prompt Versions" },
  { id: "workspaces",    icon: <Building2 className="w-4 h-4" />,label: "Workspaces" },
  { id: "webhooks",      icon: <Webhook className="w-4 h-4" />,  label: "Webhooks" },
  { id: "models",        icon: <Cpu className="w-4 h-4" />,      label: "Model Config" },
];

const AGENT_ROLES = [
  "planner","technical_architect","developer","code_reviewer","debugger",
  "qa_tester","database_architect","devops_agent","data_analyst",
  "project_manager","security_auditor","finance_agent","content_creator_agent",
];

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<AdminTab>("scheduler");
  const h = () => ({ "Content-Type":"application/json", "X-API-Key": (window as any).__NEXUS_API_KEY__ || "" });
  const b = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/,"");
  const get  = (p: string) => fetch(`${b()}${p}`, { headers: h() });
  const post = (p: string, body: unknown) => fetch(`${b()}${p}`, { method: "POST", headers: h(), body: JSON.stringify(body) });
  const del  = (p: string) => fetch(`${b()}${p}`, { method: "DELETE", headers: h() });

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex-none overflow-x-auto border-b border-cyber-neon/15 bg-cyber-bg/50">
        <div className="flex px-3 pt-3 gap-1 min-w-max">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-t-lg text-xs font-mono whitespace-nowrap transition-all ${
                activeTab === t.id
                  ? "bg-cyber-neon/20 border-t border-l border-r border-cyber-neon/40 text-cyber-neon font-bold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "scheduler"     && <SchedulerTab     get={get} post={post} del={del} />}
        {activeTab === "notifications" && <NotificationsTab get={get} post={post} />}
        {activeTab === "prompts"       && <PromptsTab       get={get} post={post} del={del} />}
        {activeTab === "workspaces"    && <WorkspacesTab    get={get} post={post} del={del} />}
        {activeTab === "webhooks"      && <WebhooksTab      get={get} post={post} del={del} />}
        {activeTab === "models"        && <ModelsTab        get={get} post={post} />}
      </div>
    </div>
  );
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function SchedulerTab({ get, post, del }: any) {
  const [jobs, setJobs]   = useState<any[]>([]);
  const [form, setForm]   = useState({ name: "", goal_template: "", cron_expr: "0 9 * * 1-5", timezone: "Asia/Bangkok" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg]     = useState("");

  const fetch_ = useCallback(async () => {
    const r = await get("/scheduler/jobs");
    if (r.ok) setJobs((await r.json()).jobs || []);
  }, []);
  useEffect(() => { fetch_(); }, [fetch_]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg("");
    const r = await post("/scheduler/jobs", form);
    if (r.ok) { setCreating(false); setForm({ name:"", goal_template:"", cron_expr:"0 9 * * 1-5", timezone:"Asia/Bangkok" }); await fetch_(); }
    else { const d = await r.json(); setMsg(d.detail || "Error"); }
  };

  const toggle = async (job_id: string, enabled: boolean) => {
    await post(`/scheduler/jobs/${job_id}/toggle?enabled=${!enabled}`, {});
    await fetch_();
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-mono text-cyber-neon uppercase tracking-widest">Scheduled Jobs</h3>
        <button type="button" onClick={() => setCreating(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyber-neon/10 border border-cyber-neon/30 text-cyber-neon rounded text-xs font-mono hover:bg-cyber-neon/20 transition-all">
          <Plus className="w-3.5 h-3.5" /> New Job
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="bg-slate-900/40 border border-cyber-neon/20 rounded-xl p-4 space-y-3">
          <Row label="Job Name">
            <input required value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="Daily Report" className={input} />
          </Row>
          <Row label="Goal Template">
            <textarea required rows={2} value={form.goal_template} onChange={e => setForm(f=>({...f,goal_template:e.target.value}))} placeholder="@Planner สร้าง daily status report..." className={`${input} resize-none`} />
          </Row>
          <Row label="Cron Expression">
            <input required value={form.cron_expr} onChange={e => setForm(f=>({...f,cron_expr:e.target.value}))} placeholder="0 9 * * 1-5" className={`${input} font-mono`} />
            <span className="text-[9px] text-slate-500 mt-0.5">min hour dom mon dow  (e.g. 0 9 * * 1-5 = Mon-Fri 9:00)</span>
          </Row>
          {msg && <div className="text-xs text-status-error">{msg}</div>}
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary}>Save Job</button>
            <button type="button" onClick={() => setCreating(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {jobs.length === 0 ? <div className="text-xs text-slate-500 font-mono italic">ยังไม่มี scheduled jobs</div>
          : jobs.map(j => (
            <div key={j.job_id} className={`flex items-center gap-3 p-3 rounded-xl border ${j.enabled ? "border-cyber-neon/20 bg-cyber-neon/5" : "border-slate-700 bg-slate-900/30"}`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-200">{j.name}</div>
                <div className="text-[9px] text-slate-500 font-mono">{j.cron_expr} · {j.timezone}</div>
                <div className="text-[9px] text-slate-400 truncate">{j.goal_template.slice(0,60)}…</div>
                {j.last_run_at && <div className="text-[8px] text-slate-600">Last: {new Date(j.last_run_at).toLocaleString("th-TH")} ({j.run_count} runs)</div>}
              </div>
              <button type="button" aria-label={j.enabled ? "Pause job" : "Resume job"} onClick={() => toggle(j.job_id, j.enabled)}
                className={`p-1.5 rounded transition-colors ${j.enabled ? "text-cyber-neon hover:text-amber-400" : "text-slate-500 hover:text-cyber-neon"}`}>
                {j.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button type="button" aria-label="Delete job" onClick={async () => { await del(`/scheduler/jobs/${j.job_id}`); fetch_(); }}
                className="p-1.5 text-slate-500 hover:text-status-error rounded transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────
function NotificationsTab({ get, post }: any) {
  const [config, setConfig]   = useState<any>(null);
  const [testMsg, setTestMsg] = useState<Record<string,string>>({});
  const [testing, setTesting] = useState<Record<string,boolean>>({});

  useEffect(() => {
    get("/notifications/config").then((r: Response) => r.ok && r.json().then(setConfig));
  }, []);

  const testChannel = async (channel: string, to: string = "") => {
    setTesting(t => ({...t, [channel]: true})); setTestMsg(m => ({...m, [channel]: ""}));
    const r = await post("/notifications/test", { channel, to });
    const d = await r.json();
    setTestMsg(m => ({...m, [channel]: d.message || (d.ok ? "Success" : "Failed")}));
    setTesting(t => ({...t, [channel]: false}));
  };

  if (!config) return <div className="p-5 text-slate-500 text-xs font-mono">Loading…</div>;

  return (
    <div className="p-5 space-y-5">
      {/* Email */}
      <Section title="Email (SMTP)">
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          <ConfigItem label="Status"    value={config.email.configured ? "✅ Configured" : "❌ Not configured"} />
          <ConfigItem label="SMTP Host" value={config.email.smtp_host || "—"} />
          <ConfigItem label="SMTP Port" value={String(config.email.smtp_port)} />
          <ConfigItem label="From"      value={config.email.smtp_from || "—"} />
          <ConfigItem label="Notify To" value={config.email.notification_email || "—"} />
          <ConfigItem label="TLS"       value={config.email.use_tls ? "Yes" : "No"} />
        </div>
        <div className="text-[9px] text-slate-500 mt-1">Configure via SMTP_HOST, SMTP_USER, SMTP_PASSWORD, NOTIFICATION_EMAIL in Stack.env</div>
        {config.email.configured && (
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={() => testChannel("email")} disabled={testing.email}
              className={`${btnPrimary} text-[10px]`}>
              {testing.email ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Send Test Email"}
            </button>
            {testMsg.email && <span className={`text-[10px] ${testMsg.email.includes("success")||testMsg.email.includes("sent") ? "text-status-success" : "text-status-error"}`}>{testMsg.email}</span>}
          </div>
        )}
      </Section>

      {/* LINE */}
      <Section title="LINE Notify">
        <ConfigItem label="Status" value={config.line.configured ? "✅ Token configured" : "❌ No token"} />
        <div className="text-[9px] text-slate-500 mt-1">Configure via LINE_NOTIFY_TOKEN in Stack.env. Get token at <a href="https://notify-bot.line.me" target="_blank" rel="noopener noreferrer" className="text-cyber-neon underline">notify-bot.line.me ↗</a></div>
        {config.line.configured && (
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={() => testChannel("line")} disabled={testing.line}
              className={`${btnPrimary} text-[10px]`}>
              {testing.line ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Send Test LINE"}
            </button>
            {testMsg.line && <span className={`text-[10px] ${testMsg.line.includes("sent") ? "text-status-success" : "text-status-error"}`}>{testMsg.line}</span>}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Prompts ───────────────────────────────────────────────────────────────────
function PromptsTab({ get, post, del }: any) {
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState("planner");
  const [form, setForm]   = useState({ name: "", content: "", notes: "" });
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    const r = await get(`/prompts?agent_role=${selectedRole}`);
    if (r.ok) setVersions((await r.json()).versions || []);
  }, [selectedRole]);
  useEffect(() => { fetch_(); }, [fetch_]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("/prompts", { agent_role: selectedRole, ...form });
    if (r.ok) { setCreating(false); setForm({ name:"", content:"", notes:"" }); fetch_(); }
  };
  const activate = async (id: string) => {
    await post(`/prompts/${id}/activate`, {}); fetch_();
  };
  const deleteV = async (id: string) => {
    if (!confirm("ลบ prompt version นี้?")) return;
    await del(`/prompts/${id}`); fetch_();
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select aria-label="Select agent role" value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon">
          {AGENT_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g," ")}</option>)}
        </select>
        <button type="button" onClick={() => setCreating(v => !v)} className={btnPrimary}>
          <Plus className="w-3.5 h-3.5" /> New Version
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="bg-slate-900/40 border border-cyber-neon/20 rounded-xl p-4 space-y-3">
          <Row label="Version Name"><input required value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="v2 — More concise" className={input} /></Row>
          <Row label="System Prompt"><textarea required rows={6} value={form.content} onChange={e => setForm(f=>({...f,content:e.target.value}))} placeholder="You are..." className={`${input} font-mono resize-none`} /></Row>
          <Row label="Notes"><input value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="What changed and why" className={input} /></Row>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary}>Save Version</button>
            <button type="button" onClick={() => setCreating(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {versions.length === 0 ? <div className="text-xs text-slate-500 font-mono italic">ยังไม่มี prompt versions สำหรับ role นี้</div>
          : versions.map(v => (
            <div key={v.version_id} className={`rounded-xl border p-3 ${v.is_active ? "border-status-success/40 bg-status-success/5" : "border-slate-700/60 bg-slate-900/30"}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">{v.name}</span>
                    <span className="text-[8px] text-slate-500 font-mono">v{v.version_num}</span>
                    {v.is_active && <span className="text-[8px] bg-status-success/20 text-status-success px-1.5 py-0.5 rounded font-mono">ACTIVE</span>}
                  </div>
                  {v.notes && <div className="text-[9px] text-slate-500 mt-0.5">{v.notes}</div>}
                </div>
                <button type="button" aria-label="Show prompt content" onClick={() => setExpandedId(expandedId === v.version_id ? null : v.version_id)} className="p-1 text-slate-500 hover:text-slate-300">
                  {expandedId === v.version_id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {!v.is_active && (
                  <button type="button" aria-label="Activate this version" onClick={() => activate(v.version_id)} className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono bg-cyber-neon/10 border border-cyber-neon/30 text-cyber-neon rounded hover:bg-cyber-neon/20">
                    <Play className="w-3 h-3" /> Activate
                  </button>
                )}
                <button type="button" aria-label="Delete version" onClick={() => deleteV(v.version_id)} className="p-1 text-slate-500 hover:text-status-error">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {expandedId === v.version_id && (
                <pre className="mt-2 text-[9px] font-mono text-slate-400 bg-black/30 rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">{v.content}</pre>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Workspaces ────────────────────────────────────────────────────────────────
function WorkspacesTab({ get, post, del }: any) {
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [keys, setKeys]  = useState<any[]>([]);
  const [newWs, setNewWs] = useState({ name: "", description: "" });
  const [newKey, setNewKey] = useState({ label: "", permission: "operator" });
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchWs = useCallback(async () => {
    const r = await get("/workspaces"); if (r.ok) setWorkspaces((await r.json()).workspaces || []);
  }, []);
  const fetchKeys = useCallback(async (ws_id: string) => {
    const r = await get(`/workspaces/${ws_id}/keys`); if (r.ok) setKeys((await r.json()).keys || []);
  }, []);

  useEffect(() => { fetchWs(); }, [fetchWs]);
  useEffect(() => { if (selectedWs) fetchKeys(selectedWs); }, [selectedWs, fetchKeys]);

  const createWs = async () => {
    const r = await post("/workspaces", newWs); if (r.ok) { setNewWs({name:"",description:""}); fetchWs(); }
  };
  const createKey = async () => {
    const r = await post("/workspaces/keys", { workspace_id: selectedWs, ...newKey });
    if (r.ok) { const d = await r.json(); setCreatedKey(d.api_key); fetchKeys(selectedWs!); }
  };
  const revokeKey = async (key_id: string) => {
    await post(`/workspaces/keys/${key_id}`, {}); fetchKeys(selectedWs!);
  };

  const PERMISSION_COLORS: Record<string,string> = { admin: "text-red-400", operator: "text-amber-400", viewer: "text-slate-400" };

  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: workspace list */}
        <div className="space-y-3">
          <h4 className="text-[10px] font-bold font-mono text-slate-400 uppercase tracking-widest">Workspaces</h4>
          <div className="flex gap-2">
            <input aria-label="Workspace name" placeholder="Workspace name" value={newWs.name} onChange={e => setNewWs(w=>({...w,name:e.target.value}))} className={`${input} flex-1`} />
            <button type="button" onClick={createWs} disabled={!newWs.name} className={`${btnPrimary} flex-none`}><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="space-y-1.5">
            {workspaces.map(w => (
              <button key={w.workspace_id} type="button"
                onClick={() => setSelectedWs(w.workspace_id)}
                className={`w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${selectedWs === w.workspace_id ? "border-cyber-neon/40 bg-cyber-neon/10" : "border-slate-700 hover:border-slate-600"}`}>
                <Building2 className="w-3.5 h-3.5 text-cyber-neon/70 flex-none" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-200">{w.name}</div>
                  <div className="text-[8px] text-slate-500">{w.key_count} keys</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: keys */}
        {selectedWs && (
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold font-mono text-slate-400 uppercase tracking-widest">API Keys</h4>
            {createdKey && (
              <div className="p-2.5 bg-status-success/10 border border-status-success/30 rounded-lg">
                <div className="text-[9px] text-status-success mb-1">New key created — copy now, won't show again!</div>
                <div className="flex items-center gap-2">
                  <code className="text-[9px] font-mono text-slate-200 break-all flex-1">{createdKey}</code>
                  <button type="button" aria-label="Copy API key" onClick={() => navigator.clipboard.writeText(createdKey)} className="p-1 text-slate-400 hover:text-slate-200"><Copy className="w-3 h-3" /></button>
                  <button type="button" aria-label="Close" onClick={() => setCreatedKey(null)}><X className="w-3 h-3 text-slate-500" /></button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input aria-label="Key label" placeholder="Label e.g. Production" value={newKey.label} onChange={e => setNewKey(k=>({...k,label:e.target.value}))} className={`${input} flex-1`} />
              <select aria-label="Permission level" value={newKey.permission} onChange={e => setNewKey(k=>({...k,permission:e.target.value}))} className="bg-slate-900 border border-slate-700 rounded px-2 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon">
                <option value="viewer">viewer</option>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
              </select>
              <button type="button" onClick={createKey} disabled={!newKey.label} className={`${btnPrimary} flex-none`}><Plus className="w-3.5 h-3.5" /></button>
            </div>
            <div className="space-y-1.5">
              {keys.map(k => (
                <div key={k.key_id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-700/60 bg-slate-900/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-200">{k.label}</span>
                      <span className={`text-[8px] font-mono ${PERMISSION_COLORS[k.permission] || "text-slate-400"}`}>{k.permission}</span>
                    </div>
                    <div className="text-[8px] text-slate-600 font-mono">{k.api_key_masked}</div>
                  </div>
                  <button type="button" aria-label={`Revoke key ${k.label}`} onClick={() => revokeKey(k.key_id)} className="p-1 text-slate-500 hover:text-status-error">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Webhooks ──────────────────────────────────────────────────────────────────
function WebhooksTab({ get, post, del }: any) {
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [form, setForm]         = useState({ name: "", goal_template: "" });
  const [creating, setCreating] = useState(false);
  const [showToken, setShowToken] = useState<Record<string,boolean>>({});
  const base = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/,"");

  const fetch_ = useCallback(async () => {
    const r = await get("/webhooks"); if (r.ok) setWebhooks((await r.json()).webhooks || []);
  }, []);
  useEffect(() => { fetch_(); }, [fetch_]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await post("/webhooks", form);
    if (r.ok) { setCreating(false); setForm({name:"",goal_template:""}); fetch_(); }
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold font-mono text-cyber-neon uppercase tracking-widest">Webhook Triggers</h3>
        <button type="button" onClick={() => setCreating(v=>!v)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> New Webhook</button>
      </div>
      {creating && (
        <form onSubmit={create} className="bg-slate-900/40 border border-cyber-neon/20 rounded-xl p-4 space-y-3">
          <Row label="Name"><input required value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="GitHub Push Trigger" className={input} /></Row>
          <Row label="Goal Template"><textarea required rows={2} value={form.goal_template} onChange={e => setForm(f=>({...f,goal_template:e.target.value}))} placeholder="@Code Reviewer review latest push" className={`${input} resize-none`} /></Row>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary}>Create</button>
            <button type="button" onClick={() => setCreating(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}
      <div className="space-y-2">
        {webhooks.length === 0 ? <div className="text-xs text-slate-500 font-mono italic">ยังไม่มี webhooks</div>
          : webhooks.map(w => (
            <div key={w.webhook_id} className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-200">{w.name}</div>
                  <div className="text-[9px] text-slate-500 truncate">{w.goal_template.slice(0,60)}…</div>
                  <div className="text-[8px] text-slate-600">{w.hit_count} triggers</div>
                </div>
                <button type="button" aria-label="Delete webhook" onClick={async () => { await del(`/webhooks/${w.webhook_id}`); fetch_(); }} className="p-1 text-slate-500 hover:text-status-error">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-[8px] font-mono text-slate-500 space-y-0.5">
                <div>URL: <code className="text-cyber-neon">{base()}/hooks/{w.webhook_id}</code></div>
                <div className="flex items-center gap-1">Token: {showToken[w.webhook_id]
                  ? <code className="text-slate-300">{w.secret_token}</code>
                  : <code className="text-slate-600">••••••••••••</code>}
                  <button type="button" aria-label="Toggle token visibility" onClick={() => setShowToken(t=>({...t,[w.webhook_id]:!t[w.webhook_id]}))} className="text-slate-600 hover:text-slate-400">
                    {showToken[w.webhook_id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  <button type="button" aria-label="Copy token" onClick={() => navigator.clipboard.writeText(w.secret_token)} className="text-slate-600 hover:text-slate-400"><Copy className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Models ────────────────────────────────────────────────────────────────────
function ModelsTab({ get, post }: any) {
  const [providers, setProviders] = useState<any[]>([]);
  const [env, setEnv]   = useState<Record<string,boolean>>({});
  const [testing, setTesting]     = useState<Record<string,boolean>>({});
  const [testResult, setTestResult] = useState<Record<string,any>>({});

  useEffect(() => {
    get("/models/providers").then((r: Response) => r.ok && r.json().then((d: any) => {
      setProviders(d.providers || []); setEnv(d.env_configured || {});
    }));
  }, []);

  const testProvider = async (name: string) => {
    setTesting(t=>({...t,[name]:true})); setTestResult(r=>({...r,[name]:null}));
    const r = await post(`/models/test/${name}`, {});
    const d = await r.json();
    setTestResult(res=>({...res,[name]:d}));
    setTesting(t=>({...t,[name]:false}));
  };

  return (
    <div className="p-5 space-y-4">
      <div className="text-[9px] text-slate-500 font-mono">Configure providers via environment variables in Stack.env. Changes require restart.</div>
      <div className="space-y-2">
        {Object.entries(env).map(([prov, configured]) => {
          const detail = providers.find(p => p.name === prov || p.provider.includes(prov));
          const tr     = testResult[prov];
          return (
            <div key={prov} className={`rounded-xl border p-3 ${configured ? "border-cyber-neon/20 bg-cyber-neon/5" : "border-slate-700/60 bg-slate-900/30"}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200 capitalize">{prov}</span>
                    {configured ? <CheckCircle2 className="w-3.5 h-3.5 text-status-success" /> : <XCircle className="w-3.5 h-3.5 text-slate-600" />}
                    <span className="text-[9px] text-slate-500">{configured ? "configured" : "not configured"}</span>
                  </div>
                  {detail && <div className="text-[8px] font-mono text-slate-500">{detail.model} · {detail.base_url || "cloud"}</div>}
                </div>
                {configured && (
                  <button type="button" onClick={() => testProvider(prov)} disabled={testing[prov]}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono bg-cyber-neon/10 border border-cyber-neon/30 text-cyber-neon rounded hover:bg-cyber-neon/20 disabled:opacity-50">
                    {testing[prov] ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Test
                  </button>
                )}
              </div>
              {tr && (
                <div className={`mt-2 text-[9px] font-mono px-2 py-1 rounded ${tr.ok ? "text-status-success bg-status-success/10" : "text-status-error bg-status-error/10"}`}>
                  {tr.ok ? `✅ ${tr.response} (${tr.tokens_in}↑ ${tr.tokens_out}↓)` : `❌ ${tr.error}`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900/40 border border-slate-700 rounded-xl p-3 text-[9px] font-mono text-slate-500 space-y-1">
        <div className="text-slate-400 font-bold mb-1">Required Stack.env variables:</div>
        <div>OPENAI_API_KEY, OPENAI_MODEL (default: gpt-4o-mini)</div>
        <div>ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default: claude-3-5-sonnet-20241022)</div>
        <div>GEMINI_API_KEY, GEMINI_MODEL (default: gemini-1.5-flash)</div>
        <div>VLLM_ENABLED=true, VLLM_BASE_URL, VLLM_MODEL_NAME (for local GPU)</div>
      </div>
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────
const input = "w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon transition-colors";
const btnPrimary = "flex items-center gap-1.5 px-3 py-1.5 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 text-cyber-neon rounded-lg text-xs font-mono font-bold transition-all disabled:opacity-50";
const btnSecondary = "px-3 py-1.5 bg-slate-800 border border-slate-600 text-slate-400 rounded-lg text-xs font-mono hover:bg-slate-700 transition-all";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[9px] uppercase text-slate-500 font-mono mb-0.5">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/40 border border-slate-700/60 rounded-xl p-4 space-y-2">
      <h4 className="text-xs font-bold text-slate-300 font-mono">{title}</h4>
      {children}
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8px] text-slate-600 uppercase">{label}</div>
      <div className="text-[10px] text-slate-300">{value}</div>
    </div>
  );
}
