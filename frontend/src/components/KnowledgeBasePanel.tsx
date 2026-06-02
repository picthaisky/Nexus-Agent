import { useState, useEffect, useCallback, useRef } from "react";
import { Upload, Trash2, Search, BookOpen, RefreshCw, Zap, Database, X } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface KBDoc { doc_id: string; title: string; source: string; content_type: string; chunk_count: number; created_at: string }
interface KBStats { documents: number; chunks: number }
interface SearchResult { chunk_id: string; doc_id: string; text: string; title: string; score: number }

export function KnowledgeBasePanel() {
  const [docs, setDocs]       = useState<KBDoc[]>([]);
  const [stats, setStats]     = useState<KBStats>({ documents: 0, chunks: 0 });
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer]   = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [mode, setMode]       = useState<"search" | "ask">("ask");
  const fileRef = useRef<HTMLInputElement>(null);

  const headers = () => ({ "Content-Type":"application/json", "X-API-Key": (window as any).__NEXUS_API_KEY__ || "" });
  const fHeaders = () => ({ "X-API-Key": (window as any).__NEXUS_API_KEY__ || "" });
  const base = () => ((import.meta as any).env?.VITE_NEXUS_API_URL || "").replace(/\/$/,"");

  const fetchData = useCallback(async () => {
    const [docsRes, statsRes] = await Promise.all([
      fetch(`${base()}/kb/documents`, { headers: headers() }),
      fetch(`${base()}/kb/stats`,     { headers: headers() }),
    ]);
    if (docsRes.ok)  setDocs((await docsRes.json()).documents || []);
    if (statsRes.ok) setStats(await statsRes.json());
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUploadAndIngest = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const upRes = await fetch(`${base()}/files/upload`, { method: "POST", headers: fHeaders(), body: fd });
      if (!upRes.ok) throw new Error("Upload failed");
      const upData = await upRes.json();
      setIngesting(upData.file_id);
      const inRes = await fetch(`${base()}/kb/ingest-file/${upData.file_id}?title=${encodeURIComponent(file.name)}`, {
        method: "POST", headers: headers(),
      });
      if (inRes.ok) await fetchData();
    } catch (e: any) { console.error(e); }
    finally { setUploading(false); setIngesting(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleDelete = async (doc_id: string) => {
    if (!confirm("ลบเอกสารนี้จาก Knowledge Base?")) return;
    await fetch(`${base()}/kb/documents/${doc_id}`, { method: "DELETE", headers: headers() });
    await fetchData();
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true); setResults([]); setAnswer("");
    try {
      const endpoint = mode === "ask" ? "/kb/ask" : "/kb/search";
      const res = await fetch(`${base()}${endpoint}`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ question: query, top_k: 5 }),
      });
      const data = await res.json();
      if (mode === "ask") { setAnswer(data.answer_md || ""); setResults(data.sources || []); }
      else                { setResults(data.results || []); }
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="h-full flex flex-col rounded-xl border border-cyber-neon/20 bg-cyber-panel/60 backdrop-blur-md overflow-hidden">

      {/* Header */}
      <div className="flex-none flex items-center justify-between px-5 py-3.5 border-b border-cyber-neon/15 bg-cyber-bg/40 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-cyber-neon" />
          <span className="text-sm font-bold font-mono text-slate-100 uppercase tracking-wider">Knowledge Base</span>
          <span className="text-[10px] text-slate-500 font-mono bg-slate-800 px-2 py-0.5 rounded">
            {stats.documents} docs · {stats.chunks} chunks
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Refresh knowledge base" onClick={fetchData} className="p-1.5 text-slate-500 hover:text-cyber-neon">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 text-cyber-neon rounded-lg text-xs font-mono cursor-pointer transition-all">
            {uploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload & Index
            <input ref={fileRef} type="file" className="hidden" onChange={handleUploadAndIngest}
              accept=".txt,.md,.py,.js,.ts,.json,.csv,.sql,.yaml,.yml,.pdf" />
          </label>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">

        {/* Left: Document list */}
        <div className="w-52 flex-none border-r border-cyber-neon/10 flex flex-col">
          <div className="text-[9px] uppercase font-mono text-slate-500 px-3 py-2 border-b border-slate-800/60 tracking-widest flex items-center gap-1.5">
            <BookOpen className="w-3 h-3" /> Documents
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {docs.length === 0 ? (
              <div className="text-[10px] text-slate-600 font-mono italic px-3 py-2">ยังไม่มีเอกสาร</div>
            ) : docs.map(d => (
              <div key={d.doc_id} className="flex items-start gap-2 px-3 py-2 group hover:bg-slate-800/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-slate-200 truncate">{d.title || d.source}</div>
                  <div className="text-[8px] text-slate-600">{d.chunk_count} chunks · {d.content_type}</div>
                </div>
                <button type="button" aria-label={`Delete ${d.title}`}
                  onClick={() => handleDelete(d.doc_id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 hover:text-status-error transition-all">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Search/Ask */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-none px-4 py-3 border-b border-slate-800/60">
            {/* Mode toggle */}
            <div className="flex gap-1 mb-3">
              {([["ask","AI Answer"], ["search","Search Chunks"]] as const).map(([m, l]) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`px-3 py-1 rounded text-[10px] font-mono border transition-all ${mode === m ? "bg-cyber-neon/20 border-cyber-neon/40 text-cyber-neon font-bold" : "border-slate-700 text-slate-400"}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                aria-label={mode === "ask" ? "Ask a question" : "Search documents"}
                placeholder={mode === "ask" ? "ถามคำถามจากเอกสาร..." : "ค้นหาใน documents..."}
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
                className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyber-neon"
              />
              <button type="button" onClick={handleSearch} disabled={loading || !query.trim()}
                className="px-3 py-2 bg-cyber-neon/15 hover:bg-cyber-neon/25 border border-cyber-neon/30 text-cyber-neon rounded-lg text-xs disabled:opacity-50 transition-all">
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {answer && (
              <div className="rounded-xl border border-cyber-neon/20 bg-slate-900/40 p-4">
                <div className="text-[9px] uppercase font-mono text-cyber-neon/60 mb-2 flex items-center gap-1.5">
                  <Zap className="w-3 h-3" /> AI Answer
                </div>
                <div className="prose prose-invert prose-sm max-w-none prose-p:text-slate-300 prose-a:text-cyber-neon">
                  <ReactMarkdown>{answer}</ReactMarkdown>
                </div>
              </div>
            )}
            {results.length > 0 && (
              <div className="space-y-2">
                <div className="text-[9px] uppercase font-mono text-slate-500 tracking-widest">
                  {mode === "ask" ? "Sources" : `${results.length} results`}
                </div>
                {results.map((r, i) => (
                  <div key={r.chunk_id || i} className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[8px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                        [{mode === "ask" ? i+1 : ""}] {r.title || r.doc_id.slice(0,8)}
                      </span>
                      <span className="text-[8px] text-slate-600">score: {Math.abs(r.score).toFixed(3)}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-4">{r.text}</p>
                  </div>
                ))}
              </div>
            )}
            {!loading && !answer && results.length === 0 && docs.length > 0 && (
              <div className="text-center text-slate-500 text-xs font-mono py-10">
                พิมพ์คำถามหรือ keyword เพื่อค้นหา
              </div>
            )}
            {docs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
                <Database className="w-12 h-12 opacity-20" />
                <div className="text-sm font-mono">Upload เอกสารเพื่อเริ่มใช้งาน RAG</div>
                <div className="text-[10px] text-slate-600 text-center max-w-xs">
                  รองรับ .txt .md .py .js .ts .json .csv .sql .yaml
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
