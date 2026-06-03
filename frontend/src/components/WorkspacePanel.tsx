import { useState, useEffect, useRef } from "react";
import { GitBranch, BookOpen, UserPlus, FileText, Trash2, Edit2, Plus, ArrowRight, CheckCircle, AlertCircle, RefreshCw, Zap, GitFork, History, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentRuntimeState } from "../types";
import { microStyle } from "../utils/microStyle";

interface TaskRun {
  task_id: string;
  goal: string;
  status: "queued" | "running" | "completed" | "failed";
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  traceback: string | null;
  created_at: string;
}

interface ConnectedRepo {
  repo_id: string;
  repo_url: string;
  branch: string;
  local_path: string;
  status: string;
  connected_at: string;
  last_synced: string;
  is_active: boolean;
}

interface Skill {
  skill_id: string;
  name: string;
  summary: string;
  description_md: string;
  tags: string[];
  source: string;
  maturity: string;
  usage_count: number;
  success_rate: number;
}

interface Agent {
  agent_id: string;
  role: string;
  display_name: string;
  current_micro_state: string;
  exp_points: number;
}

interface ArchivedDoc {
  filename: string;
  title: string;
  size_bytes: number;
  modified_at: string;
}

const AGENT_ORDER = ["planner", "architect", "developer", "ui_weaver", "validator", "optimizer"];

interface WorkspacePanelProps {
  agents?: Record<string, AgentRuntimeState>;
}

export function WorkspacePanel({ agents = {} }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<"git" | "skills" | "roster" | "docs" | "tasks">("git");
  const pollRef = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Authentication helper
  const getHeaders = () => {
    const key = (window as any).__NEXUS_API_KEY__ || "";
    return {
      "Content-Type": "application/json",
      "X-API-Key": key
    };
  };

  const getApiUrl = (path: string) => {
    const base = (import.meta as any).env?.VITE_NEXUS_API_URL || "";
    return `${base}${path}`;
  };

  // State storage
  const [repoInfo, setRepoInfo] = useState({ repo_url: "", branch: "main", local_path: "", status: "unknown" });
  const [connectedRepos, setConnectedRepos] = useState<ConnectedRepo[]>([]);
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [roster, setRoster] = useState<Agent[]>([]);
  const [archivedDocs, setArchivedDocs] = useState<ArchivedDoc[]>([]);

  // Selected details
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<{ filename: string; title: string; content: string } | null>(null);

  // Form states
  const [gitForm, setGitForm] = useState({ repo_url: "", branch: "main" });
  const [skillForm, setSkillForm] = useState({ skill_id: "", name: "", summary: "", description_md: "", steps: "", tags: "" });
  const [agentForm, setAgentForm] = useState({ agent_id: "", role: "developer", display_name: "" });
  const [docForm, setDocForm] = useState({ filename: "", title: "", content: "" });
  const [isEditingSkill, setIsEditingSkill] = useState(false);
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [isAddingAgent, setIsAddingAgent] = useState(false);

  // Fetch functions — accept AbortSignal so useEffect can cancel on unmount / tab change
  const fetchRepoInfo = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(getApiUrl("/repo/active"), { headers: getHeaders(), signal });
      if (res.ok) setRepoInfo(await res.json());
    } catch (e: any) { if (e?.name !== "AbortError") console.error(e); }
  };

  const fetchConnectedRepos = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(getApiUrl("/repo/list"), { headers: getHeaders(), signal });
      if (res.ok) {
        const data = await res.json();
        setConnectedRepos(data.repos || []);
      }
    } catch (e: any) { if (e?.name !== "AbortError") console.error(e); }
  };

  const fetchTasks = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(getApiUrl("/tasks"), { headers: getHeaders(), signal });
      if (res.ok) {
        const data = await res.json();
        setTaskRuns(data.tasks || []);
      }
    } catch (e: any) { if (e?.name !== "AbortError") console.error(e); }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("ลบ task นี้ออกจากประวัติ?")) return;
    try {
      const res = await fetch(getApiUrl(`/tasks/${taskId}`), {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (res.ok) await fetchTasks();
      else showMsg("ลบ task ไม่สำเร็จ", "error");
    } catch (e: any) { showMsg(e.message, "error"); }
  };

  const handleClearDuplicates = async () => {
    if (!confirm("ลบ tasks ที่ซ้ำกัน (เก็บเฉพาะล่าสุดของแต่ละ goal)?")) return;
    try {
      const res = await fetch(getApiUrl("/tasks?deduplicate=true"), {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        showMsg(`ลบ tasks ที่ซ้ำกัน ${data.deleted} รายการ`, "success");
        await fetchTasks();
      } else showMsg("ล้างข้อมูลไม่สำเร็จ", "error");
    } catch (e: any) { showMsg(e.message, "error"); }
  };

  const handleClearAllTasks = async () => {
    if (!confirm("ลบ Task History ทั้งหมด? ไม่สามารถกู้คืนได้")) return;
    try {
      const res = await fetch(getApiUrl("/tasks?clear_all=true"), {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (res.ok) {
        showMsg("ล้าง Task History ทั้งหมดแล้ว", "success");
        await fetchTasks();
      } else showMsg("ล้างข้อมูลไม่สำเร็จ", "error");
    } catch (e: any) { showMsg(e.message, "error"); }
  };

  const handleActivateRepo = async (repoId: string) => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/repo/activate/${repoId}`), {
        method: "POST",
        headers: getHeaders(),
      });
      if (res.ok) {
        await fetchRepoInfo();
        await fetchConnectedRepos();
        showMsg("Repository switched and Knowledge Graph reloaded!", "success");
      } else {
        const err = await res.json();
        showMsg(err.detail || "Failed to activate repository", "error");
      }
    } catch (e: any) {
      showMsg(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveRepo = async (repoId: string) => {
    if (!confirm("Remove this repository from the list? (Local clone will be kept)")) return;
    try {
      const res = await fetch(getApiUrl(`/repo/${repoId}`), {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (res.ok) {
        await fetchRepoInfo();
        await fetchConnectedRepos();
        showMsg("Repository removed.", "success");
      } else {
        showMsg("Failed to remove repository", "error");
      }
    } catch (e: any) {
      showMsg(e.message, "error");
    }
  };

  const fetchSkills = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(getApiUrl("/skills"), { headers: getHeaders(), signal });
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills || []);
      }
    } catch (e: any) { if (e?.name !== "AbortError") console.error(e); }
  };

  const fetchRoster = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(getApiUrl("/dashboard/roster"), { headers: getHeaders(), signal });
      if (res.ok) {
        const data = await res.json();
        setRoster(data.agents || []);
      }
    } catch (e: any) { if (e?.name !== "AbortError") console.error(e); }
  };

  const fetchDocs = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(getApiUrl("/docs/archive"), { headers: getHeaders(), signal });
      if (res.ok) {
        const data = await res.json();
        setArchivedDocs(data.documents || []);
      }
    } catch (e: any) { if (e?.name !== "AbortError") console.error(e); }
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    fetchRepoInfo(signal);
    fetchConnectedRepos(signal);
    fetchSkills(signal);
    fetchRoster(signal);
    fetchDocs(signal);
    fetchTasks(signal);
    return () => controller.abort();
  }, [activeTab]);

  // Auto-poll tasks every 2 s while any task is running
  useEffect(() => {
    const hasRunning = taskRuns.some((t) => t.status === "running" || t.status === "queued");
    if (hasRunning && activeTab === "tasks") {
      pollRef.current = window.setInterval(() => fetchTasks(), 2000);
    }
    return () => {
      if (pollRef.current !== undefined) {
        window.clearInterval(pollRef.current);
        pollRef.current = undefined;
      }
    };
  }, [taskRuns, activeTab]);

  const showMsg = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  // 1. Connect Git Repository
  const handleConnectRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(getApiUrl("/repo/connect"), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(gitForm)
      });
      if (res.ok) {
        const data = await res.json();
        setRepoInfo(data);
        fetchConnectedRepos();
        showMsg("Connected repository and compiled Knowledge Graph successfully!", "success");
      } else {
        const err = await res.json();
        showMsg(err.detail || "Failed to connect repository", "error");
      }
    } catch (e: any) {
      showMsg(e.message || "Failed to clone repository", "error");
    } finally {
      setLoading(false);
    }
  };

  // 2. Skills Operations
  const handleSaveSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        name: skillForm.name,
        summary: skillForm.summary,
        description_md: skillForm.description_md,
        tags: skillForm.tags.split(",").map(t => t.trim()).filter(Boolean),
        steps: skillForm.steps.split("\n").map(s => s.trim()).filter(Boolean),
        source: "manual"
      };

      const res = await fetch(getApiUrl("/skills/add"), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showMsg(`Skill "${skillForm.name}" saved successfully!`, "success");
        setIsEditingSkill(false);
        setSkillForm({ skill_id: "", name: "", summary: "", description_md: "", steps: "", tags: "" });
        fetchSkills();
      } else {
        const err = await res.json();
        showMsg(err.detail || "Failed to save skill", "error");
      }
    } catch (e: any) {
      showMsg(e.message || "Failed to save skill", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSkill = async (id: string) => {
    if (!confirm("Are you sure you want to delete this skill?")) return;
    try {
      const res = await fetch(getApiUrl(`/skills/${id}`), {
        method: "DELETE",
        headers: getHeaders()
      });
      if (res.ok) {
        showMsg("Skill deleted successfully!", "success");
        setSelectedSkill(null);
        fetchSkills();
      } else {
        showMsg("Failed to delete skill", "error");
      }
    } catch (e: any) {
      showMsg(e.message || "Failed to delete skill", "error");
    }
  };

  // 3. Agent Roster Operations
  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(getApiUrl("/dashboard/roster/add"), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(agentForm)
      });
      if (res.ok) {
        showMsg(`Agent "${agentForm.display_name}" registered!`, "success");
        setIsAddingAgent(false);
        setAgentForm({ agent_id: "", role: "developer", display_name: "" });
        fetchRoster();
      } else {
        const err = await res.json();
        showMsg(err.detail || "Failed to add agent", "error");
      }
    } catch (e: any) {
      showMsg(e.message || "Failed to add agent", "error");
    }
  };

  const handleDeleteAgent = async (id: string) => {
    if (!confirm(`Are you sure you want to remove agent "${id}" from the roster?`)) return;
    try {
      const res = await fetch(getApiUrl(`/dashboard/roster/${id}`), {
        method: "DELETE",
        headers: getHeaders()
      });
      if (res.ok) {
        showMsg("Agent removed from dashboard roster.", "success");
        fetchRoster();
      } else {
        showMsg("Failed to delete agent", "error");
      }
    } catch (e: any) {
      showMsg(e.message || "Failed to delete agent", "error");
    }
  };

  // 4. Markdown Document Archiving
  const handleOpenDoc = async (filename: string) => {
    try {
      const res = await fetch(getApiUrl(`/docs/archive/${filename}`), { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSelectedDoc(data);
        setIsEditingDoc(false);
      }
    } catch (e) { console.error(e); }
  };

  const handleSaveDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(getApiUrl("/docs/archive"), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(docForm)
      });
      if (res.ok) {
        showMsg(`Document "${docForm.filename}" archived successfully!`, "success");
        setIsEditingDoc(false);
        setDocForm({ filename: "", title: "", content: "" });
        fetchDocs();
        setSelectedDoc(null);
      } else {
        const err = await res.json();
        showMsg(err.detail || "Failed to archive document", "error");
      }
    } catch (e: any) {
      showMsg(e.message || "Failed to archive document", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDoc = async (filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;
    try {
      const res = await fetch(getApiUrl(`/docs/archive/${filename}`), {
        method: "DELETE",
        headers: getHeaders()
      });
      if (res.ok) {
        showMsg("Document deleted.", "success");
        setSelectedDoc(null);
        fetchDocs();
      } else {
        showMsg("Failed to delete document", "error");
      }
    } catch (e: any) {
      showMsg(e.message || "Failed to delete document", "error");
    }
  };

  return (
    <div className="relative flex flex-col w-full h-[380px] md:h-[450px] lg:h-[500px] border border-cyber-neon/15 bg-cyber-panel/30 rounded-2xl shadow-2xl backdrop-blur-sm overflow-hidden text-slate-300">
      
      {/* Top Config Navigation */}
      <div className="flex-none flex items-center justify-between border-b border-cyber-neon/15 bg-black/30 px-4 py-2">
        <div className="flex items-center gap-1.5 md:gap-3">
          <button
            onClick={() => setActiveTab("git")}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono tracking-wide transition-all ${
              activeTab === "git" ? "text-cyber-neon border-b border-cyber-neon font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Git Repository</span>
          </button>
          <button
            onClick={() => setActiveTab("skills")}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono tracking-wide transition-all ${
              activeTab === "skills" ? "text-cyber-neon border-b border-cyber-neon font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Skill Vault</span>
          </button>
          <button
            onClick={() => setActiveTab("roster")}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono tracking-wide transition-all ${
              activeTab === "roster" ? "text-cyber-neon border-b border-cyber-neon font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Agent Roster</span>
          </button>
          <button
            onClick={() => setActiveTab("docs")}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono tracking-wide transition-all ${
              activeTab === "docs" ? "text-cyber-neon border-b border-cyber-neon font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Archived Docs (.md)</span>
          </button>
          <button
            onClick={() => { setActiveTab("tasks"); fetchTasks(); }}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono tracking-wide transition-all ${
              activeTab === "tasks" ? "text-cyber-neon border-b border-cyber-neon font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Task History</span>
            {taskRuns.some(t => t.status === "running") && (
              <span className="w-1.5 h-1.5 bg-status-success rounded-full animate-pulse" />
            )}
          </button>
        </div>

        {/* Global Action indicator / loading */}
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className="w-3.5 h-3.5 text-cyber-neon animate-spin" />}
          {message && (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono ${
              message.type === "success" ? "bg-status-success/20 text-status-success" : "bg-status-error/20 text-status-error"
            }`}>
              {message.type === "success" ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              <span>{message.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Tab Body */}
      <div className="flex-1 overflow-hidden p-4">
        
        {/* 1. GIT REPOSITORY PANEL */}
        {activeTab === "git" && (
          <div className="h-full flex flex-col md:flex-row gap-5 overflow-y-auto pr-2">

            {/* Left: Connect form */}
            <div className="flex-1 space-y-4 min-w-0">
              <h3 className="text-sm font-bold uppercase tracking-wider text-cyber-neon/80 font-mono">Connect Workspace Repository</h3>
              <form onSubmit={handleConnectRepo} className="space-y-3">
                <div>
                  <label className="block text-[10px] uppercase text-slate-400 font-mono mb-1">GitHub Repo URL</label>
                  <input
                    type="url"
                    required
                    placeholder="https://github.com/username/project.git"
                    value={gitForm.repo_url}
                    onChange={(e) => setGitForm({ ...gitForm, repo_url: e.target.value })}
                    className="w-full bg-black/40 border border-cyber-neon/20 rounded px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyber-neon"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-slate-400 font-mono mb-1">Branch</label>
                  <input
                    type="text"
                    required
                    placeholder="main"
                    value={gitForm.branch}
                    onChange={(e) => setGitForm({ ...gitForm, branch: e.target.value })}
                    className="w-full bg-black/40 border border-cyber-neon/20 rounded px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-1 bg-cyber-neon/10 hover:bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/30 px-4 py-1.5 text-xs font-mono rounded transition-all shadow-[0_0_10px_rgba(95,225,255,0.15)] disabled:opacity-50"
                >
                  <span>Connect & Sync</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </form>

              {/* Connected Repositories List */}
              <div className="pt-3 border-t border-cyber-neon/10">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10px] uppercase font-mono text-slate-400 tracking-widest flex items-center gap-1.5">
                    <GitFork className="w-3 h-3" />
                    Connected Repositories ({connectedRepos.length})
                  </h4>
                  <button
                    type="button"
                    aria-label="Refresh list"
                    title="Refresh list"
                    onClick={() => fetchConnectedRepos()}
                    className="p-1 text-slate-500 hover:text-cyber-neon transition-colors"
                  >
                    <RefreshCw aria-hidden="true" className="w-3 h-3" />
                  </button>
                </div>

                {connectedRepos.length === 0 ? (
                  <div className="text-[10px] text-slate-600 font-mono italic">
                    No repositories connected yet.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {connectedRepos.map((repo) => {
                      const repoName = repo.repo_url.split("/").pop()?.replace(".git", "") ?? repo.repo_url;
                      const owner = repo.repo_url.split("/").slice(-2, -1)[0] ?? "";
                      return (
                        <div
                          key={repo.repo_id}
                          className={`flex items-start gap-3 p-2.5 rounded-lg border transition-all ${
                            repo.is_active
                              ? "bg-cyber-neon/8 border-cyber-neon/30"
                              : "bg-black/20 border-cyber-neon/10 hover:border-cyber-neon/20"
                          }`}
                        >
                          {/* Icon + name */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {repo.is_active && (
                                <span className="w-1.5 h-1.5 rounded-full bg-status-success flex-none animate-pulse" />
                              )}
                              <span className="text-xs font-bold font-mono text-white truncate">
                                {owner}/{repoName}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400">
                              <GitBranch className="w-2.5 h-2.5 flex-none" />
                              <span className="truncate">{repo.branch}</span>
                              {repo.is_active && (
                                <span className="text-status-success font-bold uppercase">active</span>
                              )}
                            </div>
                            <div className="text-[8px] text-slate-600 font-mono mt-0.5">
                              Synced {new Date(repo.last_synced).toLocaleString()}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-1 flex-none">
                            {!repo.is_active && (
                              <button
                                type="button"
                                onClick={() => handleActivateRepo(repo.repo_id)}
                                disabled={loading}
                                aria-label="Switch to this repository"
                                title="Switch to this repository"
                                className="p-1 border border-cyber-neon/30 bg-cyber-neon/5 text-cyber-neon hover:bg-cyber-neon/15 rounded disabled:opacity-40 transition-all"
                              >
                                <Zap aria-hidden="true" className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label="Remove from list"
                              title="Remove from list"
                              onClick={() => handleRemoveRepo(repo.repo_id)}
                              className="p-1 border border-status-error/30 bg-status-error/5 text-status-error hover:bg-status-error/15 rounded transition-all"
                            >
                              <Trash2 aria-hidden="true" className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Active Repo Card */}
            <div className="w-full md:w-72 flex-none bg-black/20 border border-cyber-neon/10 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-cyber-gold font-mono mb-3">Active Workspace Details</h4>
                <div className="space-y-2 text-xs font-mono">
                  <div>
                    <span className="text-slate-450 block text-[9px] uppercase">Connection Status</span>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      repoInfo.status === "connected" ? "bg-status-success/20 text-status-success" : "bg-cyan-950/40 text-cyber-neon"
                    }`}>
                      {repoInfo.status.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-450 block text-[9px] uppercase">Git URL</span>
                    <span className="text-slate-200 truncate block">{repoInfo.repo_url || "Local File System Mode"}</span>
                  </div>
                  <div>
                    <span className="text-slate-450 block text-[9px] uppercase">Active Branch</span>
                    <span className="text-slate-200">{repoInfo.branch || "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-slate-450 block text-[9px] uppercase">Local Path</span>
                    <span className="text-slate-200 text-[10px] break-all block">{repoInfo.local_path}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-cyber-neon/10 text-[9px] text-slate-500 font-mono">
                * Connecting a Git repository pulls files locally and compiles the AST analysis graph automatically.
              </div>
            </div>
          </div>
        )}

        {/* 2. SKILL VAULT PANEL */}
        {activeTab === "skills" && (
          <div className="h-full flex gap-4 overflow-hidden">
            {/* Left Column: Skill List */}
            <div className="w-56 flex-none flex flex-col border-r border-cyber-neon/10 pr-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase font-mono text-slate-400">{skills.length} Skills</span>
                <button
                  type="button"
                  aria-label="เพิ่ม Skill ใหม่"
                  title="เพิ่ม Skill ใหม่"
                  onClick={() => {
                    setIsEditingSkill(true);
                    setSelectedSkill(null);
                    setSkillForm({ skill_id: "", name: "", summary: "", description_md: "", steps: "", tags: "" });
                  }}
                  className="p-1 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 rounded text-cyber-neon"
                >
                  <Plus aria-hidden="true" className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {skills.map((s) => (
                  <div
                    key={s.skill_id}
                    onClick={() => {
                      setSelectedSkill(s);
                      setIsEditingSkill(false);
                    }}
                    className={`p-2 rounded text-left cursor-pointer border transition-all ${
                      selectedSkill?.skill_id === s.skill_id && !isEditingSkill
                        ? "bg-cyber-neon/15 border-cyber-neon/40 text-white"
                        : "bg-black/10 border-transparent hover:bg-black/20 text-slate-350"
                    }`}
                  >
                    <div className="text-xs font-bold font-mono truncate">{s.name}</div>
                    <div className="text-[9px] opacity-60 truncate mt-0.5">{s.summary}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Display / Add / Edit */}
            <div className="flex-1 overflow-y-auto pl-2 pr-1 h-full">
              {isEditingSkill ? (
                <form onSubmit={handleSaveSkill} className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyber-neon font-mono">Create/Update Skill</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">Skill Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. format-code-output"
                        value={skillForm.name}
                        onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })}
                        className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">Tags (comma separated)</label>
                      <input
                        type="text"
                        placeholder="python, linter, auto-format"
                        value={skillForm.tags}
                        onChange={(e) => setSkillForm({ ...skillForm, tags: e.target.value })}
                        className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">Brief Summary</label>
                    <input
                      type="text"
                      required
                      placeholder="Short description of what the skill accomplishes..."
                      value={skillForm.summary}
                      onChange={(e) => setSkillForm({ ...skillForm, summary: e.target.value })}
                      className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">Steps / Instructions (One instruction per line)</label>
                    <textarea
                      rows={3}
                      placeholder="Step 1: Check code syntax&#10;Step 2: Apply black formatter&#10;Step 3: Run pytest"
                      value={skillForm.steps}
                      onChange={(e) => setSkillForm({ ...skillForm, steps: e.target.value })}
                      className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyber-neon"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">Detailed Description (Markdown)</label>
                    <textarea
                      rows={5}
                      placeholder="Write markdown documentation detailing specifications and code snippet examples..."
                      value={skillForm.description_md}
                      onChange={(e) => setSkillForm({ ...skillForm, description_md: e.target.value })}
                      className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyber-neon"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="bg-cyber-neon/10 hover:bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/30 px-3 py-1 text-xs font-mono rounded"
                    >
                      Save Skill
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingSkill(false)}
                      className="bg-black/30 hover:bg-black/40 border border-slate-700 px-3 py-1 text-xs font-mono rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : selectedSkill ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-cyber-neon/10 pb-2">
                    <div>
                      <h3 className="text-sm font-bold text-white font-mono">{selectedSkill.name}</h3>
                      <div className="flex gap-1.5 mt-1">
                        {selectedSkill.tags.map(t => (
                          <span key={t} className="bg-cyber-neon/10 border border-cyber-neon/20 px-1 py-0.2 rounded text-[8px] text-cyber-neon font-mono uppercase">{t}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          setIsEditingSkill(true);
                          setSkillForm({
                            skill_id: selectedSkill.skill_id,
                            name: selectedSkill.name,
                            summary: selectedSkill.summary,
                            description_md: selectedSkill.description_md,
                            steps: "", // Steps can be loaded if necessary or re-entered
                            tags: selectedSkill.tags.join(", ")
                          });
                        }}
                        aria-label="Edit skill"
                        title="Edit skill"
                        className="p-1 border border-cyber-neon/25 bg-cyber-neon/5 text-cyber-neon hover:bg-cyber-neon/15 rounded"
                      >
                        <Edit2 aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete skill"
                        title="Delete skill"
                        onClick={() => handleDeleteSkill(selectedSkill.skill_id)}
                        className="p-1 border border-status-error/35 bg-status-error/5 text-status-error hover:bg-status-error/15 rounded"
                      >
                        <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[10px] font-mono bg-black/25 p-2 rounded">
                    <div>
                      <span className="text-slate-500 block uppercase text-[8px]">Maturity</span>
                      <span className="text-cyber-gold font-bold">{selectedSkill.maturity.toUpperCase()}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block uppercase text-[8px]">Usage Count</span>
                      <span className="text-slate-200">{selectedSkill.usage_count} times</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block uppercase text-[8px]">Success Rate</span>
                      <span className="text-status-success font-bold">{(selectedSkill.success_rate * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] uppercase font-mono text-slate-400 mb-1">Summary</h4>
                    <p className="text-xs text-slate-200 leading-relaxed font-sans">{selectedSkill.summary}</p>
                  </div>

                  <div>
                    <h4 className="text-[10px] uppercase font-mono text-slate-400 mb-1">Markdown Documentation</h4>
                    <pre className="text-[10px] font-mono bg-black/40 border border-cyber-neon/10 rounded p-3 text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-48 leading-normal">
                      {selectedSkill.description_md}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  Select a skill from the list or click '+' to create a new agent capability.
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. AGENT ROSTER PANEL */}
        {activeTab === "roster" && (
          <div className="h-full flex gap-4 overflow-hidden">
            {/* Left Column: Roster List */}
            <div className="w-60 flex-none flex flex-col border-r border-cyber-neon/10 pr-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase font-mono text-slate-400">{roster.length} Active Positions</span>
                <button
                  type="button"
                  aria-label="Add agent"
                  title="Add agent"
                  onClick={() => setIsAddingAgent(!isAddingAgent)}
                  className="p-1 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 rounded text-cyber-neon"
                >
                  <Plus aria-hidden="true" className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {roster.map((a) => (
                  <div
                    key={a.agent_id}
                    className="p-2 rounded bg-black/15 border border-cyber-neon/10 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold font-mono text-white truncate">{a.display_name.split(" / ")[0]}</div>
                      <div className="text-[8px] text-cyber-neon/80 font-mono mt-0.5 truncate uppercase">{a.role.replace(/_/g, " ")}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] font-mono bg-status-success/20 text-status-success px-1 py-0.2 rounded">EXP {a.exp_points}</span>
                      <button
                        type="button"
                        aria-label={`Remove agent ${a.display_name}`}
                        title="Remove agent"
                        onClick={() => handleDeleteAgent(a.agent_id)}
                        className="p-0.5 border border-status-error/30 text-status-error hover:bg-status-error/15 rounded"
                      >
                        <Trash2 aria-hidden="true" className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Register Agent Form */}
            <div className="flex-1 overflow-y-auto pl-2 pr-1">
              {isAddingAgent ? (
                <form onSubmit={handleAddAgent} className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyber-neon font-mono">Register New Agent / Position</h3>
                  <div>
                    <label className="block text-[9px] uppercase text-slate-400 font-mono mb-1">Unique Agent ID</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. sec_reviewer, tester_agent"
                      value={agentForm.agent_id}
                      onChange={(e) => setAgentForm({ ...agentForm, agent_id: e.target.value })}
                      className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase text-slate-400 font-mono mb-1">Display Name (Thai/Eng)</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. ผู้ตรวจความปลอดภัย / Security reviewer"
                      value={agentForm.display_name}
                      onChange={(e) => setAgentForm({ ...agentForm, display_name: e.target.value })}
                      className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="agent-role-select"
                      className="block text-[9px] uppercase text-slate-400 font-mono mb-1"
                    >
                      Job Role / Specification
                    </label>
                    <select
                      id="agent-role-select"
                      aria-label="Job Role / Specification"
                      title="Job Role / Specification"
                      value={agentForm.role}
                      onChange={(e) => setAgentForm({ ...agentForm, role: e.target.value })}
                      className="w-full bg-[#070b14] border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                    >
                      <option value="planner">Planner (ผู้วางแผน)</option>
                      <option value="technical_architect">Technical Architect (ผู้ออกแบบระบบ)</option>
                      <option value="developer">Developer (ผู้พัฒนา/เขียนโค้ด)</option>
                      <option value="ui_weaver">UI Weaver (ผู้ออกแบบ UI)</option>
                      <option value="validator">Validator (ผู้ตรวจสอบระบบ)</option>
                      <option value="autonomous_optimizer">Optimizer (ผู้ปรับปรุงความสามารถ)</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="bg-cyber-neon/10 hover:bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/30 px-3 py-1 text-xs font-mono rounded"
                    >
                      Register Agent
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingAgent(false)}
                      className="bg-black/30 hover:bg-black/40 border border-slate-700 px-3 py-1 text-xs font-mono rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="h-full flex flex-col justify-center items-center text-slate-500 font-mono text-xs text-center p-4">
                  <div>Roster shows the current active multi-agent system layout.</div>
                  <button
                    onClick={() => setIsAddingAgent(true)}
                    className="mt-3 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/35 text-cyber-neon px-3 py-1 rounded text-xs"
                  >
                    Register New Job Position
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. ARCHIVED DOCUMENTS PANEL */}
        {activeTab === "docs" && (
          <div className="h-full flex gap-4 overflow-hidden">
            {/* Left Column: Documents List */}
            <div className="w-56 flex-none flex flex-col border-r border-cyber-neon/10 pr-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase font-mono text-slate-400">{archivedDocs.length} Documents</span>
                <button
                  type="button"
                  aria-label="Add document"
                  title="Add document"
                  onClick={() => {
                    setIsEditingDoc(true);
                    setSelectedDoc(null);
                    setDocForm({ filename: "", title: "", content: "" });
                  }}
                  className="p-1 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 rounded text-cyber-neon"
                >
                  <Plus aria-hidden="true" className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {archivedDocs.map((d) => (
                  <div
                    key={d.filename}
                    onClick={() => handleOpenDoc(d.filename)}
                    className={`p-2 rounded text-left cursor-pointer border transition-all ${
                      selectedDoc?.filename === d.filename && !isEditingDoc
                        ? "bg-cyber-neon/15 border-cyber-neon/40 text-white"
                        : "bg-black/10 border-transparent hover:bg-black/20 text-slate-350"
                    }`}
                  >
                    <div className="text-xs font-bold font-mono truncate">{d.title}</div>
                    <div className="text-[9px] opacity-60 mt-0.5 flex justify-between">
                      <span>{d.filename}</span>
                      <span>{(d.size_bytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Markdown Editor / Viewer */}
            <div className="flex-1 overflow-y-auto pl-2 pr-1 h-full">
              {isEditingDoc ? (
                <form onSubmit={handleSaveDoc} className="space-y-3 h-full flex flex-col">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyber-neon font-mono">Create/Save Archived Document</h3>
                  <div className="grid grid-cols-2 gap-3 flex-none">
                    <div>
                      <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">Filename (.md)</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. system-rules.md"
                        value={docForm.filename}
                        onChange={(e) => setDocForm({ ...docForm, filename: e.target.value })}
                        className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5">Document Title</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Core System Regulations"
                        value={docForm.title}
                        onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                        className="w-full bg-black/40 border border-cyber-neon/20 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-cyber-neon"
                      />
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col">
                    <label className="block text-[9px] uppercase text-slate-400 font-mono mb-0.5 flex-none">Content (Markdown)</label>
                    <textarea
                      required
                      placeholder="# Write your documentation here..."
                      value={docForm.content}
                      onChange={(e) => setDocForm({ ...docForm, content: e.target.value })}
                      className="flex-1 w-full bg-black/45 border border-cyber-neon/25 rounded p-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyber-neon resize-none"
                    />
                  </div>
                  <div className="flex gap-2 flex-none">
                    <button
                      type="submit"
                      className="bg-cyber-neon/10 hover:bg-cyber-neon/20 text-cyber-neon border border-cyber-neon/30 px-3 py-1 text-xs font-mono rounded"
                    >
                      Archive Doc
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingDoc(false)}
                      className="bg-black/30 hover:bg-black/40 border border-slate-700 px-3 py-1 text-xs font-mono rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : selectedDoc ? (
                <div className="space-y-4 h-full flex flex-col">
                  <div className="flex items-center justify-between border-b border-cyber-neon/10 pb-2 flex-none">
                    <div>
                      <h3 className="text-sm font-bold text-white font-mono">{selectedDoc.title}</h3>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">{selectedDoc.filename}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        aria-label="Edit document"
                        title="Edit document"
                        onClick={() => {
                          setIsEditingDoc(true);
                          setDocForm({
                            filename: selectedDoc.filename,
                            title: selectedDoc.title,
                            content: selectedDoc.content
                          });
                        }}
                        className="p-1 border border-cyber-neon/25 bg-cyber-neon/5 text-cyber-neon hover:bg-cyber-neon/15 rounded"
                      >
                        <Edit2 aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete document"
                        title="Delete document"
                        onClick={() => handleDeleteDoc(selectedDoc.filename)}
                        className="p-1 border border-status-error/35 bg-status-error/5 text-status-error hover:bg-status-error/15 rounded"
                      >
                        <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Markdown Read-Only Preview Panel */}
                  <div className="flex-1 min-h-0 bg-black/45 border border-cyber-neon/15 rounded p-4 overflow-y-auto text-xs text-slate-350 leading-relaxed font-sans select-text">
                    <pre className="font-mono whitespace-pre-wrap text-[10.5px] leading-normal">{selectedDoc.content}</pre>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 font-mono text-xs">
                  Select a document from the list or click '+' to archive a new Markdown document.
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. TASK HISTORY PANEL */}
        {activeTab === "tasks" && (
          <div className="h-full flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between flex-none flex-wrap gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-cyber-neon/80 font-mono">
                Task History ({taskRuns.length})
              </h3>
              <div className="flex items-center gap-1.5">
                {/* Clear Duplicates */}
                {taskRuns.length > 1 && (
                  <button
                    type="button"
                    title="Remove duplicate tasks (keep newest per goal)"
                    onClick={handleClearDuplicates}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono border border-cyber-neon/30 text-cyber-neon/70 hover:text-cyber-neon hover:bg-cyber-neon/10 rounded transition-all"
                  >
                    <Zap aria-hidden="true" className="w-3 h-3" />
                    Clear Duplicates
                  </button>
                )}
                {/* Clear All */}
                {taskRuns.length > 0 && (
                  <button
                    type="button"
                    title="Delete all task history"
                    onClick={handleClearAllTasks}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono border border-status-error/30 text-status-error/60 hover:text-status-error hover:bg-status-error/10 rounded transition-all"
                  >
                    <Trash2 aria-hidden="true" className="w-3 h-3" />
                    Clear All
                  </button>
                )}
                {/* Refresh */}
                <button
                  type="button"
                  aria-label="Refresh task list"
                  title="Refresh task list"
                  onClick={() => fetchTasks()}
                  className="p-1 text-slate-500 hover:text-cyber-neon transition-colors"
                >
                  <RefreshCw aria-hidden="true" className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Agent Activity Monitor */}
            {AGENT_ORDER.some((id) => agents[id] && agents[id].current_micro_state !== "idle") && (
              <div className="flex-none bg-black/30 border border-cyber-neon/15 rounded-xl p-3">
                <div className="text-[9px] uppercase tracking-widest text-cyber-neon/60 font-mono mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyber-neon animate-pulse inline-block" />
                  Agent Activity
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {AGENT_ORDER.map((id) => {
                    const a = agents[id];
                    if (!a) return null;
                    const isActive = a.current_micro_state !== "idle";
                    const s = microStyle(a.current_micro_state);
                    return (
                      <div
                        key={id}
                        className={`flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg border font-mono transition-all ${
                          isActive
                            ? "border-cyber-neon/30 bg-cyber-neon/5"
                            : "border-slate-800/60 bg-black/10 opacity-40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] text-slate-200 truncate font-semibold">
                            {a.display_name.split(" / ")[0]}
                          </span>
                          <span className={`text-[8px] px-1 py-0.5 rounded font-bold flex-none ${s.badge}`}>
                            {s.label}
                          </span>
                        </div>
                        {isActive && a.status_message && (
                          <span className="text-[9px] text-cyber-neon/70 truncate leading-tight">
                            {a.status_message}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {taskRuns.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-600 font-mono text-xs italic">
                ยังไม่มี task — ลองพิมพ์คำสั่งใน command input ด้านล่าง
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {taskRuns.map((task) => {
                  const isExpanded = expandedTask === task.task_id;
                  const statusColor =
                    task.status === "completed" ? "text-status-success border-status-success/30 bg-status-success/5"
                    : task.status === "failed"  ? "text-status-error border-status-error/30 bg-status-error/5"
                    : task.status === "running" ? "text-cyber-neon border-cyber-neon/30 bg-cyber-neon/5 animate-pulse"
                    : "text-slate-400 border-slate-700 bg-black/20";
                  const statusIcon =
                    task.status === "completed" ? "✅"
                    : task.status === "failed"  ? "❌"
                    : task.status === "running" ? "⚡"
                    : "⏳";
                  return (
                    <div
                      key={task.task_id}
                      className={`rounded-lg border font-mono text-[10px] ${statusColor} overflow-hidden group`}
                    >
                      <div className="flex items-start">
                        <button
                          type="button"
                          onClick={() => setExpandedTask(isExpanded ? null : task.task_id)}
                          className="flex-1 flex items-start gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors min-w-0"
                        >
                          <span className="flex-none mt-0.5">{statusIcon}</span>
                          <span className="flex-1 min-w-0 truncate">{task.goal}</span>
                          <span className="flex-none opacity-50 text-[9px]">
                            {task.task_id.slice(0, 8)}
                          </span>
                          {isExpanded
                            ? <ChevronDown className="w-3 h-3 flex-none opacity-60" />
                            : <ChevronRight className="w-3 h-3 flex-none opacity-60" />
                          }
                        </button>
                        {/* Delete task button */}
                        <button
                          type="button"
                          aria-label="Delete task"
                          title="Delete this task"
                          onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.task_id); }}
                          className="flex-none p-2 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-status-error transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-1.5 border-t border-current/10">
                          <div className="grid grid-cols-2 gap-2 mt-2 text-[9px]">
                            <div>
                              <span className="opacity-50 uppercase">Status</span>
                              <div className="font-bold uppercase">{task.status}</div>
                            </div>
                            <div>
                              <span className="opacity-50 uppercase">Started</span>
                              <div>{task.started_at
                                ? new Date(task.started_at).toLocaleString("th-TH")
                                : "—"}
                              </div>
                            </div>
                            <div>
                              <span className="opacity-50 uppercase">Finished</span>
                              <div>{task.finished_at
                                ? new Date(task.finished_at).toLocaleString("th-TH")
                                : "—"}
                              </div>
                            </div>
                            <div>
                              <span className="opacity-50 uppercase">Task ID</span>
                              <div className="truncate">{task.task_id}</div>
                            </div>
                          </div>
                          {task.error && (
                            <div className="mt-2">
                              <div className="opacity-50 uppercase text-[9px] mb-0.5">Error</div>
                              <pre className="bg-black/40 rounded p-2 text-status-error text-[9px] whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                                {task.error}
                              </pre>
                            </div>
                          )}
                          {task.traceback && (
                            <details className="mt-1">
                              <summary className="opacity-50 text-[9px] cursor-pointer hover:opacity-80">Traceback</summary>
                              <pre className="bg-black/40 rounded p-2 text-slate-400 text-[8px] whitespace-pre-wrap break-words max-h-32 overflow-y-auto mt-1">
                                {task.traceback}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
