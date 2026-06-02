import { useState, useEffect, useCallback } from "react";
import {
  Loader2, ArrowRight, FileText, Briefcase, FileSignature,
  Share2, Link2, CheckCircle2, XCircle, RefreshCw,
  Copy, ExternalLink, Trash2, Clock, Zap,
} from "lucide-react";

// Facebook icon (not in lucide-react)
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}
import ReactMarkdown from "react-markdown";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpecialistResult { markdown: string }

interface SocialConnection {
  platform:       string;
  account_name:   string;
  account_id:     string;
  page_id:        string | null;
  connected_at:   string;
  token_expires_at: string | null;
}

interface SocialPost {
  id:              number;
  platform:        string;
  content_snippet: string;
  api_post_id:     string | null;
  post_url:        string | null;
  status:          "pending" | "published" | "failed";
  posted_at:       string | null;
  error:           string | null;
  created_at:      string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useApi() {
  const key  = () => (window as any).__NEXUS_API_KEY__ || "";
  const base = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/, "");
  const headers = () => ({ "Content-Type": "application/json", "X-API-Key": key() });

  const get  = (path: string) => fetch(`${base()}${path}`, { headers: headers() });
  const post = (path: string, body: unknown) =>
    fetch(`${base()}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const del  = (path: string) => fetch(`${base()}${path}`, { method: "DELETE", headers: headers() });

  return { get, post, del };
}

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  facebook: {
    label: "Facebook",
    color: "text-blue-600",
    bg:    "bg-blue-50",
    border:"border-blue-200",
    icon:  <FacebookIcon className="w-4 h-4" />,
  },
  tiktok: {
    label: "TikTok",
    color: "text-slate-800",
    bg:    "bg-slate-50",
    border:"border-slate-200",
    icon:  <span className="w-4 h-4 flex items-center justify-center font-bold text-[10px] text-black">TT</span>,
  },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function SpecialistOfficePanel() {
  const api = useApi();
  const [activeDesk, setActiveDesk] = useState<"finance" | "content" | "social">("finance");

  // ── Content Creator state ──
  const [topic, setTopic]       = useState("");
  const [platform, setPlatform] = useState("general");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<SpecialistResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // ── Finance state ──
  const [finInput, setFinInput]   = useState("");
  const [finLoading, setFinLoading] = useState(false);
  const [finResult, setFinResult]   = useState<SpecialistResult | null>(null);
  const [finError, setFinError]     = useState<string | null>(null);

  // ── Social Media state ──
  const [connections, setConnections]   = useState<SocialConnection[]>([]);
  const [posts, setPosts]               = useState<SocialPost[]>([]);
  const [socialLoading, setSocialLoading] = useState(false);
  const [connectForm, setConnectForm]   = useState({ platform: "facebook", access_token: "", page_id: "", account_name: "" });
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [postingTo, setPostingTo]       = useState<string | null>(null);
  const [postError, setPostError]       = useState<Record<string, string>>({});
  const [postSuccess, setPostSuccess]   = useState<Record<string, string>>({});

  const fetchSocialData = useCallback(async () => {
    try {
      const [connRes, postsRes] = await Promise.all([
        api.get("/social/connections"),
        api.get("/social/posts?limit=20"),
      ]);
      if (connRes.ok)  setConnections((await connRes.json()).connections || []);
      if (postsRes.ok) setPosts((await postsRes.json()).posts || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeDesk === "social") fetchSocialData();
  }, [activeDesk, fetchSocialData]);

  // ── Finance submit ──
  const handleFinance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finInput.trim()) return;
    setFinLoading(true); setFinError(null); setFinResult(null);
    try {
      const res = await api.post("/agents/finance/analyze", { task: finInput });
      if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
      const data = await res.json();
      setFinResult({ markdown: data.analysis_md || data.content_md });
    } catch (e: any) { setFinError(e.message); }
    finally { setFinLoading(false); }
  };

  // ── Content submit ──
  const handleContent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true); setGenError(null); setResult(null);
    try {
      const res = await api.post("/agents/content/generate", { topic, platform });
      if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
      const data = await res.json();
      setResult({ markdown: data.content_md });
    } catch (e: any) { setGenError(e.message); }
    finally { setLoading(false); }
  };

  // ── Social: connect platform ──
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSocialLoading(true); setConnectError(null); setConnectSuccess(null);
    try {
      const body: Record<string, string> = {
        platform:     connectForm.platform,
        access_token: connectForm.access_token,
        account_name: connectForm.account_name,
      };
      if (connectForm.platform === "facebook") body.page_id = connectForm.page_id;
      const res = await api.post("/social/connect", body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setConnectSuccess(
        connectForm.platform === "facebook"
          ? `เชื่อมต่อสำเร็จ: ${data.page_name} (${data.fan_count?.toLocaleString() || 0} followers)`
          : `เชื่อมต่อสำเร็จ: @${data.display_name} (${data.follower_count?.toLocaleString() || 0} followers)`,
      );
      setConnectForm({ platform: "facebook", access_token: "", page_id: "", account_name: "" });
      await fetchSocialData();
    } catch (e: any) { setConnectError(e.message); }
    finally { setSocialLoading(false); }
  };

  // ── Social: disconnect ──
  const handleDisconnect = async (platform: string) => {
    if (!confirm(`ยืนยันการยกเลิกการเชื่อมต่อ ${PLATFORM_META[platform]?.label || platform}?`)) return;
    try {
      await api.del(`/social/${platform}`);
      await fetchSocialData();
    } catch { /* ignore */ }
  };

  // ── Social: post content ──
  const handleSocialPost = async (targetPlatform: string, message: string) => {
    setPostingTo(targetPlatform);
    setPostError(prev => ({ ...prev, [targetPlatform]: "" }));
    setPostSuccess(prev => ({ ...prev, [targetPlatform]: "" }));
    try {
      const res = await api.post("/social/post", { platform: targetPlatform, message });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setPostSuccess(prev => ({
        ...prev,
        [targetPlatform]: data.url ? `โพสต์สำเร็จ ✓` : "โพสต์สำเร็จ ✓",
      }));
      await fetchSocialData();
    } catch (e: any) {
      setPostError(prev => ({ ...prev, [targetPlatform]: e.message }));
    } finally {
      setPostingTo(null);
    }
  };

  const connectedPlatforms = connections.map(c => c.platform);

  // ── Derived: extract social media paragraph from generated markdown ──
  const extractSocialText = (md: string): string => {
    const lines = md.split("\n");
    const socialIdx = lines.findIndex(l =>
      /social|โซเชียล|facebook|tiktok|tweet|caption/i.test(l)
    );
    if (socialIdx !== -1) {
      const snippetLines: string[] = [];
      for (let i = socialIdx + 1; i < Math.min(socialIdx + 8, lines.length); i++) {
        const line = lines[i].replace(/^[#>*\-`]+\s*/, "").trim();
        if (line) snippetLines.push(line);
        if (snippetLines.length >= 3) break;
      }
      if (snippetLines.length) return snippetLines.join(" ").slice(0, 2000);
    }
    // fallback: first 280 chars
    return md.replace(/#+\s*/g, "").replace(/\*+/g, "").trim().slice(0, 280);
  };

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">

      {/* ── Header Tabs ── */}
      <div className="flex border-b border-cyber-neon/20 bg-cyber-bg/50 px-4 pt-4 gap-1 flex-wrap">
        {([
          { id: "finance",  icon: <Briefcase className="h-4 w-4" />,     label: "Finance Desk" },
          { id: "content",  icon: <FileSignature className="h-4 w-4" />, label: "Content Creator" },
          { id: "social",   icon: <Share2 className="h-4 w-4" />,        label: "Social Media" },
        ] as const).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setActiveDesk(tab.id); }}
            className={`flex items-center gap-2 px-4 py-3 rounded-t-lg transition-all font-mono text-sm whitespace-nowrap ${
              activeDesk === tab.id
                ? "bg-cyber-neon/20 border-t border-l border-r border-cyber-neon/40 text-cyber-neon font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "social" && connectedPlatforms.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-status-success/80 text-[9px] font-bold text-white flex items-center justify-center">
                {connectedPlatforms.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab bodies ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── FINANCE DESK ── */}
        {activeDesk === "finance" && (
          <div className="p-6 space-y-6">
            <DeskHeader icon={<Briefcase className="h-5 w-5 text-cyber-neon" />}
              title="FINANCIAL ANALYST"
              subtitle="Analyze numbers, corporate accounting files, and month-end closings." />
            <InputForm
              value={finInput} onChange={setFinInput} loading={finLoading}
              placeholder="Describe the financial task or data..."
              onSubmit={handleFinance}
            />
            {finError && <ErrorBox message={finError} />}
            {finResult && <ResultCard markdown={finResult.markdown} />}
            {!finLoading && !finResult && !finError && (
              <EmptyState icon={<Briefcase className="h-6 w-6 text-slate-600" />}
                text="Awaiting financial data or instructions to process." />
            )}
          </div>
        )}

        {/* ── CONTENT CREATOR ── */}
        {activeDesk === "content" && (
          <div className="p-6 space-y-5">
            <DeskHeader icon={<FileSignature className="h-5 w-5 text-cyber-neon" />}
              title="CONTENT STRATEGIST"
              subtitle="Draft articles and social media posts tailored to each platform." />

            {/* Platform selector */}
            <div className="flex gap-2 flex-wrap">
              {["general","facebook","tiktok","article","email"].map(p => (
                <button key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  className={`px-3 py-1 rounded-full text-xs font-mono border transition-all ${
                    platform === p
                      ? "bg-cyber-neon/20 border-cyber-neon/50 text-cyber-neon font-bold"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {p === "general" ? "General" : p === "facebook" ? "Facebook" : p === "tiktok" ? "TikTok" : p === "article" ? "Article" : "Email"}
                </button>
              ))}
            </div>

            <InputForm
              value={topic} onChange={setTopic} loading={loading}
              placeholder="Enter topic or keywords for content generation..."
              onSubmit={handleContent}
            />
            {genError && <ErrorBox message={genError} />}

            {result && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ResultCard markdown={result.markdown} />

                {/* Social post actions — only show if platforms are connected */}
                {connectedPlatforms.length > 0 && (
                  <div className="border border-cyber-neon/20 rounded-xl bg-slate-900/30 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-[11px] font-mono text-cyber-neon/80 uppercase tracking-widest">
                      <Zap className="w-3.5 h-3.5" />
                      Post to Social Media
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {connectedPlatforms.map(p => {
                        const meta = PLATFORM_META[p];
                        if (!meta) return null;
                        const isPosting = postingTo === p;
                        const success   = postSuccess[p];
                        const err       = postError[p];
                        return (
                          <div key={p} className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => handleSocialPost(p, extractSocialText(result.markdown))}
                              disabled={!!isPosting || !!success}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all disabled:opacity-60 ${
                                success
                                  ? "bg-status-success/10 border-status-success/40 text-status-success"
                                  : `${meta.bg} ${meta.border} ${meta.color} hover:opacity-90`
                              }`}
                            >
                              {isPosting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : success ? <CheckCircle2 className="w-3.5 h-3.5" /> : meta.icon}
                              {isPosting ? "กำลังโพสต์…" : success ? success : `Post to ${meta.label}`}
                            </button>
                            {err && <span className="text-[9px] text-status-error px-1">{err}</span>}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(extractSocialText(result.markdown)); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-slate-200 text-xs"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy Text
                      </button>
                    </div>
                  </div>
                )}

                {connectedPlatforms.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveDesk("social")}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-slate-600 text-slate-500 hover:border-cyber-neon/40 hover:text-cyber-neon text-xs font-mono transition-all"
                  >
                    <Share2 className="w-3.5 h-3.5" /> เชื่อมต่อ Social Media เพื่อ Auto-Post
                  </button>
                )}
              </div>
            )}

            {!loading && !result && !genError && (
              <EmptyState icon={<FileSignature className="h-6 w-6 text-slate-600" />}
                text="Awaiting topic or context to begin writing." />
            )}
          </div>
        )}

        {/* ── SOCIAL MEDIA ── */}
        {activeDesk === "social" && (
          <div className="p-6 space-y-6">

            {/* Connected accounts */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-cyber-neon/80 font-mono flex items-center gap-2">
                  <Share2 className="w-3.5 h-3.5" /> Connected Accounts
                </h3>
                <button
                  type="button"
                  aria-label="Refresh connections"
                  onClick={fetchSocialData}
                  className="p-1 text-slate-500 hover:text-cyber-neon transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {connections.length === 0 ? (
                <div className="text-xs text-slate-500 font-mono italic py-2">ยังไม่มีบัญชีที่เชื่อมต่อ</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {connections.map(conn => {
                    const meta = PLATFORM_META[conn.platform] ?? PLATFORM_META.facebook;
                    return (
                      <div key={conn.platform} className={`flex items-center justify-between p-3 rounded-xl border ${meta.border} ${meta.bg}`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${meta.bg} border ${meta.border}`}>
                            <span className={meta.color}>{meta.icon}</span>
                          </div>
                          <div>
                            <div className={`text-xs font-bold ${meta.color}`}>{meta.label}</div>
                            <div className="text-[10px] text-slate-500 truncate max-w-32">{conn.account_name || conn.account_id}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDisconnect(conn.platform)}
                          className="p-1.5 text-slate-400 hover:text-status-error hover:bg-status-error/10 rounded transition-colors"
                          aria-label={`ยกเลิกการเชื่อมต่อ ${conn.platform}`}
                          title="ยกเลิกการเชื่อมต่อ"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Connect new account */}
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-cyber-neon/80 font-mono mb-3 flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5" /> Connect New Account
              </h3>
              <form onSubmit={handleConnect} className="space-y-3">
                {/* Platform selector */}
                <div className="flex gap-2">
                  {(["facebook","tiktok"] as const).map(p => (
                    <button key={p} type="button"
                      onClick={() => setConnectForm(f => ({ ...f, platform: p }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        connectForm.platform === p
                          ? `${PLATFORM_META[p].bg} ${PLATFORM_META[p].border} ${PLATFORM_META[p].color} ring-1 ring-current/30`
                          : "border-slate-700 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      {PLATFORM_META[p].icon} {PLATFORM_META[p].label}
                    </button>
                  ))}
                </div>

                {/* Platform-specific fields */}
                {connectForm.platform === "facebook" ? (
                  <>
                    <FormField
                      label="Facebook Page ID"
                      placeholder="เช่น 123456789012345"
                      value={connectForm.page_id}
                      onChange={v => setConnectForm(f => ({ ...f, page_id: v }))}
                      required
                    />
                    <FormField
                      label="Page Access Token"
                      placeholder="EAAxxxxxxxxxxxxxxx..."
                      value={connectForm.access_token}
                      onChange={v => setConnectForm(f => ({ ...f, access_token: v }))}
                      required secret
                    />
                    <div className="text-[10px] text-slate-500 bg-slate-800/40 rounded-lg p-2.5 leading-relaxed">
                      <strong className="text-slate-400">วิธีรับ Page Access Token:</strong>
                      <br/>1. ไปที่{" "}
                      <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer"
                        className="text-cyber-neon underline">
                        Facebook Graph API Explorer ↗
                      </a>
                      <br/>2. เลือก App → คลิก "Generate Access Token"
                      <br/>3. เลือก Permission: <code className="bg-slate-700 px-1 rounded">pages_manage_posts</code> + <code className="bg-slate-700 px-1 rounded">pages_read_engagement</code>
                      <br/>4. เลือก Page แล้ว copy token
                    </div>
                  </>
                ) : (
                  <>
                    <FormField
                      label="TikTok Access Token"
                      placeholder="Access token จาก TikTok OAuth2..."
                      value={connectForm.access_token}
                      onChange={v => setConnectForm(f => ({ ...f, access_token: v }))}
                      required secret
                    />
                    <div className="text-[10px] text-slate-500 bg-slate-800/40 rounded-lg p-2.5 leading-relaxed">
                      <strong className="text-slate-400">วิธีรับ TikTok Access Token:</strong>
                      <br/>1. สมัคร{" "}
                      <a href="https://developers.tiktok.com" target="_blank" rel="noopener noreferrer"
                        className="text-cyber-neon underline">
                        TikTok for Developers ↗
                      </a>{" "}และสร้าง App
                      <br/>2. ตั้งค่า <code className="bg-slate-700 px-1 rounded">TIKTOK_CLIENT_KEY</code> และ <code className="bg-slate-700 px-1 rounded">TIKTOK_CLIENT_SECRET</code> ใน Stack.env
                      <br/>3. ใช้ OAuth2 flow เพื่อรับ access token (Scope: <code className="bg-slate-700 px-1 rounded">video.publish</code>)
                    </div>
                  </>
                )}

                {connectError  && <ErrorBox message={connectError} />}
                {connectSuccess && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-status-success/10 border border-status-success/30 text-status-success text-xs">
                    <CheckCircle2 className="w-4 h-4 flex-none" />
                    {connectSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={socialLoading || !connectForm.access_token}
                  className="flex items-center gap-2 px-4 py-2 bg-cyber-neon/15 hover:bg-cyber-neon/25 border border-cyber-neon/40 text-cyber-neon rounded-lg text-xs font-mono font-bold transition-all disabled:opacity-50"
                >
                  {socialLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  เชื่อมต่อ {PLATFORM_META[connectForm.platform]?.label}
                </button>
              </form>
            </section>

            {/* Post history */}
            {posts.length > 0 && (
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-cyber-neon/80 font-mono mb-3 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" /> Post History
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {posts.map(p => {
                    const meta = PLATFORM_META[p.platform] ?? PLATFORM_META.facebook;
                    return (
                      <div key={p.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-900/40 border border-slate-800">
                        <span className={`flex-none mt-0.5 ${meta.color}`}>{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-slate-300 truncate">{p.content_snippet}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {p.status === "published" ? (
                              <span className="flex items-center gap-0.5 text-[9px] text-status-success">
                                <CheckCircle2 className="w-2.5 h-2.5" /> Published
                              </span>
                            ) : p.status === "failed" ? (
                              <span className="flex items-center gap-0.5 text-[9px] text-status-error">
                                <XCircle className="w-2.5 h-2.5" /> Failed
                              </span>
                            ) : (
                              <span className="text-[9px] text-slate-500">Pending</span>
                            )}
                            {p.posted_at && (
                              <span className="text-[9px] text-slate-600">
                                {new Date(p.posted_at).toLocaleString("th-TH")}
                              </span>
                            )}
                            {p.post_url && (
                              <a href={p.post_url} target="_blank" rel="noopener noreferrer"
                                className="text-[9px] text-cyber-neon flex items-center gap-0.5">
                                <ExternalLink className="w-2.5 h-2.5" /> View
                              </a>
                            )}
                          </div>
                          {p.error && <div className="text-[9px] text-status-error mt-0.5 truncate">{p.error}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DeskHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg bg-cyber-neon/10">{icon}</div>
      <div>
        <h2 className="text-lg font-bold text-slate-100 tracking-wider font-mono">{title}</h2>
        <p className="text-xs text-cyber-neon/80">{subtitle}</p>
      </div>
    </div>
  );
}

function InputForm({
  value, onChange, loading, placeholder, onSubmit,
}: {
  value: string; onChange: (v: string) => void;
  loading: boolean; placeholder: string; onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="relative">
      <div className="absolute inset-y-0 left-0 pl-4 pt-4 pointer-events-none">
        <FileText className="h-5 w-5 text-slate-500" />
      </div>
      <textarea
        className="w-full h-28 bg-slate-900/50 border border-cyber-neon/30 rounded-xl py-4 pl-12 pr-14 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon focus:ring-1 focus:ring-cyber-neon transition-all resize-none text-sm"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="absolute bottom-4 right-4 px-3 py-2 bg-cyber-neon/20 hover:bg-cyber-neon/40 text-cyber-neon rounded-lg flex items-center justify-center transition-all disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
      </button>
    </form>
  );
}

function ResultCard({ markdown }: { markdown: string }) {
  return (
    <div className="p-5 rounded-xl border border-cyber-neon/20 bg-slate-900/40 prose prose-invert prose-p:text-slate-300 prose-a:text-cyber-neon max-w-none prose-sm">
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-xs">
      <XCircle className="w-4 h-4 flex-none mt-0.5" />
      {message}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="h-40 flex flex-col items-center justify-center text-slate-500 space-y-3">
      <div className="w-14 h-14 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center animate-[spin_10s_linear_infinite]">
        {icon}
      </div>
      <p className="text-xs font-mono text-center max-w-sm">{text}</p>
    </div>
  );
}

function FormField({
  label, placeholder, value, onChange, required = false, secret = false,
}: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; required?: boolean; secret?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase text-slate-400 font-mono mb-1">{label}</label>
      <input
        type={secret ? "password" : "text"}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon transition-colors"
      />
    </div>
  );
}
