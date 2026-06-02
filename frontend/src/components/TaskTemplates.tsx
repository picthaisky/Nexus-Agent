import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Play, RefreshCw, Tag, Search } from "lucide-react";

interface Template {
  template_id:   string;
  name:          string;
  category:      string;
  description:   string;
  goal_template: string;
  tags:          string[];
  usage_count:   number;
  created_at:    string;
}

const CATEGORIES = ["general","development","finance","content","devops","qa","security","analytics","project"];

const BUILT_IN_TEMPLATES: Omit<Template, "template_id" | "usage_count" | "created_at">[] = [
  { name: "Code Review",          category: "development", description: "Review code quality and security",        goal_template: "@Code Reviewer ช่วย review โค้ดนี้: {{code}}",                              tags: ["code","review","quality"] },
  { name: "Debug Error",          category: "development", description: "Diagnose and fix an error",               goal_template: "@Debugger ช่วย debug error นี้: {{error}}",                                tags: ["debug","error","fix"] },
  { name: "Generate Tests",       category: "qa",          description: "Create test suite for a feature",         goal_template: "@QA Tester สร้าง test suite สำหรับ: {{feature}} ใช้ framework: {{framework}}", tags: ["qa","test","pytest"] },
  { name: "Database Schema",      category: "development", description: "Design database schema for a feature",    goal_template: "@DB Architect ออกแบบ schema สำหรับ: {{requirements}} ด้วย {{db_type}}",        tags: ["database","schema","sql"] },
  { name: "Docker Setup",         category: "devops",      description: "Generate Dockerfile and CI/CD config",    goal_template: "@DevOps สร้าง Docker config สำหรับ project {{project}} stack: {{stack}}",      tags: ["docker","cicd","devops"] },
  { name: "Security Audit",       category: "security",    description: "OWASP security scan of code",            goal_template: "@Security Auditor ตรวจสอบ security ของ: {{target}}",                         tags: ["security","owasp","audit"] },
  { name: "Project Status",       category: "project",     description: "Generate project status report",          goal_template: "@Project Manager สร้าง status report สำหรับ project: {{project}}",             tags: ["project","status","report"] },
  { name: "Content for Facebook", category: "content",     description: "Create Facebook post content",            goal_template: "@Content Strategist เขียน Facebook post สำหรับหัวข้อ: {{topic}}",              tags: ["content","facebook","social"] },
  { name: "Financial Analysis",   category: "finance",     description: "Analyse financial data",                  goal_template: "@Financial Analyst วิเคราะห์ข้อมูลทางการเงิน: {{data}}",                     tags: ["finance","analysis","report"] },
  { name: "Data Insights",        category: "analytics",   description: "Extract insights from data",              goal_template: "@Data Analyst วิเคราะห์ข้อมูลและสร้าง insights จาก: {{data}}",                tags: ["analytics","insights","data"] },
  { name: "senic-billing-next",   category: "development", description: "Full project plan for billing system",    goal_template: "@Planner ช่วยวางแผนพัฒนา project senic-billing-next: ระบบจัดการเอกสารการเงิน ใบเสร็จรับเงิน บิลเงินสด ใบส่งของ ใบกำกับภาษี สำหรับ {{company}}", tags: ["billing","invoice","project"] },
];

interface RunModalState { template: Template; variables: Record<string, string> }

function extractVars(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

export function TaskTemplates({ onRunTask }: { onRunTask: (goal: string) => Promise<{ task_id?: string }> }) {
  const headers = () => ({ "Content-Type": "application/json", "X-API-Key": (window as any).__NEXUS_API_KEY__ || "" });
  const base    = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/, "");
  const apiGet  = (p: string) => fetch(`${base()}${p}`, { headers: headers() });
  const apiPost = (p: string, body: unknown) => fetch(`${base()}${p}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const apiDel  = (p: string) => fetch(`${base()}${p}`, { method: "DELETE", headers: headers() });

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [category, setCategory]   = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [runModal, setRunModal]   = useState<RunModalState | null>(null);
  const [running, setRunning]     = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [newForm, setNewForm]     = useState({ name: "", category: "general", description: "", goal_template: "", tags: "" });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet("/templates");
      if (res.ok) setTemplates((await res.json()).templates || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Seed built-in templates on first load
  const seedBuiltIns = useCallback(async () => {
    const res = await apiGet("/templates");
    if (!res.ok) return;
    const existing: Template[] = (await res.json()).templates || [];
    const existingNames = new Set(existing.map((t: Template) => t.name));
    for (const t of BUILT_IN_TEMPLATES) {
      if (!existingNames.has(t.name)) {
        await apiPost("/templates", { ...t, tags: t.tags });
      }
    }
    await fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => { seedBuiltIns(); }, [seedBuiltIns]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiPost("/templates", { ...newForm, tags: newForm.tags.split(",").map(t => t.trim()).filter(Boolean) });
      if (res.ok) {
        setShowCreate(false);
        setNewForm({ name: "", category: "general", description: "", goal_template: "", tags: "" });
        await fetchTemplates();
      }
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("ลบ template นี้?")) return;
    await apiDel(`/templates/${id}`);
    await fetchTemplates();
  };

  const openRunModal = (t: Template) => {
    const vars = extractVars(t.goal_template);
    const init: Record<string, string> = {};
    vars.forEach(v => { init[v] = ""; });
    setRunModal({ template: t, variables: init });
    setRunResult(null);
  };

  const handleRun = async () => {
    if (!runModal) return;
    setRunning(true); setRunResult(null);
    try {
      let goal = runModal.template.goal_template;
      for (const [k, v] of Object.entries(runModal.variables)) {
        goal = goal.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v || `[${k}]`);
      }
      const result = await onRunTask(goal);
      setRunResult(`Task submitted! ID: ${result.task_id || "unknown"}`);
      // Increment usage count
      await apiPost(`/templates/${runModal.template.template_id}/use`, {});
      await fetchTemplates();
    } catch (e: any) {
      setRunResult(`Error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const filtered = templates.filter(t => {
    const matchCat = category === "all" || t.category === category;
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));
    return matchCat && matchSearch;
  });

  const catColor: Record<string,string> = {
    development: "bg-blue-900/40 text-blue-400 border-blue-700/40",
    qa:          "bg-cyan-900/40 text-cyan-400 border-cyan-700/40",
    security:    "bg-red-900/40 text-red-400 border-red-700/40",
    finance:     "bg-yellow-900/40 text-yellow-400 border-yellow-700/40",
    content:     "bg-purple-900/40 text-purple-400 border-purple-700/40",
    devops:      "bg-orange-900/40 text-orange-400 border-orange-700/40",
    analytics:   "bg-emerald-900/40 text-emerald-400 border-emerald-700/40",
    project:     "bg-indigo-900/40 text-indigo-400 border-indigo-700/40",
    general:     "bg-slate-800/40 text-slate-400 border-slate-600/40",
  };

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">

      {/* Header */}
      <div className="flex-none flex items-center justify-between px-5 py-3.5 border-b border-cyber-neon/15 bg-cyber-bg/40 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-cyber-neon" />
          <span className="text-sm font-bold font-mono text-slate-100 uppercase tracking-wider">Task Templates</span>
          <span className="text-[10px] text-slate-500 font-mono">({templates.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Refresh templates" onClick={fetchTemplates} className="p-1.5 text-slate-500 hover:text-cyber-neon rounded transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button type="button"
            onClick={() => setShowCreate(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyber-neon/15 hover:bg-cyber-neon/25 border border-cyber-neon/40 text-cyber-neon rounded-lg text-xs font-mono font-bold transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> New Template
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Create form */}
        {showCreate && (
          <form onSubmit={handleCreate} className="border-b border-cyber-neon/10 p-5 space-y-3 bg-slate-900/30">
            <h3 className="text-xs font-bold font-mono text-cyber-neon uppercase tracking-widest">Create Template</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="tmpl-name" className="block text-[9px] uppercase text-slate-400 font-mono mb-1">Name</label>
                <input id="tmpl-name" required placeholder="e.g. Code Review Flow" value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon" />
              </div>
              <div>
                <label htmlFor="tmpl-cat" className="block text-[9px] uppercase text-slate-400 font-mono mb-1">Category</label>
                <select id="tmpl-cat" value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="tmpl-desc" className="block text-[9px] uppercase text-slate-400 font-mono mb-1">Description</label>
              <input id="tmpl-desc" placeholder="Brief description..." value={newForm.description}
                onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon" />
            </div>
            <div>
              <label htmlFor="tmpl-goal" className="block text-[9px] uppercase text-slate-400 font-mono mb-1">
                Goal Template <span className="text-slate-600 normal-case">— ใช้ {"{{variable}}"} สำหรับตัวแปร</span>
              </label>
              <textarea id="tmpl-goal" required rows={3} placeholder="@Planner ช่วยวางแผน {{task}} สำหรับ {{project}}"
                value={newForm.goal_template}
                onChange={e => setNewForm(f => ({ ...f, goal_template: e.target.value }))}
                className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyber-neon resize-none" />
            </div>
            <div>
              <label htmlFor="tmpl-tags" className="block text-[9px] uppercase text-slate-400 font-mono mb-1">Tags (comma separated)</label>
              <input id="tmpl-tags" placeholder="code, review, python" value={newForm.tags}
                onChange={e => setNewForm(f => ({ ...f, tags: e.target.value }))}
                className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-1.5 bg-cyber-neon/15 border border-cyber-neon/40 text-cyber-neon rounded text-xs font-mono font-bold hover:bg-cyber-neon/25 transition-all">Save Template</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-1.5 bg-slate-800 border border-slate-700 text-slate-400 rounded text-xs font-mono hover:bg-slate-700 transition-all">Cancel</button>
            </div>
          </form>
        )}

        {/* Filters */}
        <div className="px-5 py-3 border-b border-slate-800/60 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
            <input
              aria-label="Search templates"
              placeholder="ค้นหา template..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["all", ...CATEGORIES] as const).map(c => (
              <button key={c} type="button"
                onClick={() => setCategory(c)}
                className={`px-2 py-1 rounded text-[9px] font-mono border transition-all ${category === c ? "bg-cyber-neon/20 border-cyber-neon/50 text-cyber-neon" : "border-slate-700 text-slate-500 hover:border-slate-500"}`}
              >{c}</button>
            ))}
          </div>
        </div>

        {/* Template grid */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(t => {
            const vars = extractVars(t.goal_template);
            return (
              <div key={t.template_id} className="rounded-xl border border-slate-700/60 bg-slate-900/30 hover:border-cyber-neon/30 transition-all group flex flex-col">
                <div className="p-3.5 flex-1">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-bold text-xs text-slate-200">{t.name}</div>
                    <span className={`flex-none px-1.5 py-0.5 rounded text-[8px] font-mono border ${catColor[t.category] || catColor.general}`}>{t.category}</span>
                  </div>
                  {t.description && <div className="text-[10px] text-slate-500 mb-2">{t.description}</div>}
                  <div className="text-[9px] font-mono text-slate-600 bg-black/30 rounded p-1.5 truncate">{t.goal_template.slice(0, 80)}…</div>
                  {vars.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {vars.map(v => (
                        <span key={v} className="text-[8px] font-mono bg-slate-800 text-cyber-neon/70 px-1.5 py-0.5 rounded border border-cyber-neon/20">{`{{${v}}}`}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1 flex-wrap mt-2">
                    {t.tags.map(tag => (
                      <span key={tag} className="text-[8px] text-slate-500 font-mono">#{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="px-3.5 py-2.5 border-t border-slate-800/60 flex items-center justify-between">
                  <span className="text-[9px] text-slate-600 font-mono">ใช้ {t.usage_count} ครั้ง</span>
                  <div className="flex gap-1.5">
                    <button type="button" aria-label={`Delete template ${t.name}`}
                      onClick={() => handleDelete(t.template_id)}
                      className="p-1 text-slate-600 hover:text-status-error rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" aria-label={`Run template ${t.name}`}
                      onClick={() => openRunModal(t)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 text-cyber-neon rounded text-[10px] font-mono transition-all">
                      <Play className="w-3 h-3" /> Run
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center text-slate-500 text-xs font-mono py-10">ไม่พบ template ที่ตรงกัน</div>
          )}
        </div>
      </div>

      {/* Run modal */}
      {runModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-cyber-neon/30 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-sm font-bold font-mono text-cyber-neon uppercase">{runModal.template.name}</h3>
            <div className="bg-black/30 rounded-lg p-3 text-[10px] font-mono text-slate-400 leading-relaxed break-all">
              {runModal.template.goal_template}
            </div>
            {Object.keys(runModal.variables).length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase text-slate-500 font-mono tracking-widest">Fill in variables</div>
                {Object.entries(runModal.variables).map(([k, v]) => (
                  <div key={k}>
                    <label htmlFor={`var-${k}`} className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">{k}</label>
                    <input id={`var-${k}`} aria-label={k} placeholder={`Enter ${k}...`} value={v}
                      onChange={e => setRunModal(m => m ? ({ ...m, variables: { ...m.variables, [k]: e.target.value } }) : m)}
                      className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyber-neon" />
                  </div>
                ))}
              </div>
            )}
            {runResult && (
              <div className={`p-2.5 rounded-lg border text-xs ${runResult.startsWith("Error") ? "bg-status-error/10 border-status-error/30 text-status-error" : "bg-status-success/10 border-status-success/30 text-status-success"}`}>
                {runResult}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRunModal(null)} className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-400 rounded-lg text-xs font-mono">ยกเลิก</button>
              <button type="button" onClick={handleRun} disabled={running}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyber-neon/15 hover:bg-cyber-neon/25 border border-cyber-neon/40 text-cyber-neon rounded-lg text-xs font-mono font-bold disabled:opacity-50 transition-all">
                {running ? <><span className="w-3 h-3 border-2 border-cyber-neon border-t-transparent rounded-full animate-spin" />กำลังส่ง…</> : <><Play className="w-3.5 h-3.5" /> Run Task</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
