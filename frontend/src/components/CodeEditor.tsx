import { useState, useRef } from "react";
import { Copy, Download, Play, RotateCcw, Maximize2 } from "lucide-react";

interface CodeEditorProps {
  initialCode?: string;
  language?: string;
  filename?: string;
  readOnly?: boolean;
  onRun?: (code: string) => void;
  height?: string;
}

const LANGUAGES = ["python","typescript","javascript","sql","yaml","json","bash","markdown","text"];

export function CodeEditor({
  initialCode = "",
  language: initLang = "python",
  filename: initFilename = "untitled",
  readOnly = false,
  onRun,
  height = "h-96",
}: CodeEditorProps) {
  const [code, setCode]         = useState(initialCode);
  const [lang, setLang]         = useState(initLang);
  const [filename, setFilename] = useState(initFilename);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied]     = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta    = e.currentTarget;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const newVal = code.slice(0, start) + "  " + code.slice(end);
    setCode(newVal);
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadCode = () => {
    const ext: Record<string,string> = {
      python:"py", typescript:"ts", javascript:"js", sql:"sql",
      yaml:"yaml", json:"json", bash:"sh", markdown:"md", text:"txt",
    };
    const blob = new Blob([code], { type: "text/plain" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = filename.includes(".") ? filename : `${filename}.${ext[lang] || "txt"}`;
    a.click();
  };

  const lineCount = code.split("\n").length;

  const containerCls = fullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-slate-950 border border-cyber-neon/30"
    : `flex flex-col rounded-xl border border-cyber-neon/20 bg-slate-950 overflow-hidden ${height}`;

  return (
    <div className={containerCls}>
      {/* Toolbar */}
      <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-cyber-neon/15 bg-cyber-bg/60 flex-wrap">
        {/* Filename */}
        {readOnly ? (
          <span className="text-[10px] font-mono text-slate-400">{filename}</span>
        ) : (
          <input
            aria-label="Filename"
            value={filename}
            onChange={e => setFilename(e.target.value)}
            className="text-[10px] font-mono text-slate-300 bg-transparent border-b border-slate-700 focus:border-cyber-neon outline-none w-28"
          />
        )}

        {/* Language selector */}
        <select
          aria-label="Programming language"
          value={lang} onChange={e => setLang(e.target.value)}
          className="text-[9px] font-mono text-slate-400 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 focus:outline-none focus:border-cyber-neon"
        >
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        <span className="text-[9px] text-slate-600 font-mono">{lineCount} lines</span>
        <div className="flex-1" />

        {/* Actions */}
        {onRun && (
          <button type="button" onClick={() => onRun(code)}
            className="flex items-center gap-1 px-2 py-1 bg-status-success/15 border border-status-success/30 text-status-success rounded text-[10px] font-mono hover:bg-status-success/25 transition-all">
            <Play className="w-3 h-3" /> Run
          </button>
        )}
        {!readOnly && (
          <button type="button" aria-label="Reset code" onClick={() => setCode(initialCode)} className="p-1 text-slate-500 hover:text-slate-300">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="button" aria-label={copied ? "Copied!" : "Copy code"} onClick={copyCode}
          className={`p-1 transition-colors ${copied ? "text-status-success" : "text-slate-500 hover:text-slate-300"}`}>
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Download code" onClick={downloadCode} className="p-1 text-slate-500 hover:text-slate-300">
          <Download className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => setFullscreen(v => !v)} className="p-1 text-slate-500 hover:text-cyber-neon">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Editor body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Line numbers */}
        <div className="flex-none bg-slate-900/80 border-r border-slate-800 px-2 py-3 text-right font-mono text-[10px] text-slate-700 select-none overflow-y-hidden"
             style={{ lineHeight: "1.5rem" }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i + 1}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={taRef}
          className="flex-1 bg-slate-950 font-mono text-xs text-slate-200 p-3 resize-none focus:outline-none leading-6 overflow-auto"
          value={code}
          readOnly={readOnly}
          onChange={e => !readOnly && setCode(e.target.value)}
          onKeyDown={handleTabKey}
          spellCheck={false}
          autoComplete="off"
          aria-label="Code editor"
          style={{ tabSize: 2 }}
        />
      </div>
    </div>
  );
}

/** Floating button to open code in a full-screen editor overlay. */
export function CodeBlock({ code, language = "python", filename }: { code: string; language?: string; filename?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <>
      <div className="relative group rounded-xl border border-slate-700 overflow-hidden bg-slate-950">
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button type="button" aria-label={copied ? "Copied" : "Copy"}
            onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false),1500); }}
            className={`p-1 rounded text-[9px] ${copied ? "text-status-success" : "text-slate-500 hover:text-slate-200"}`}>
            <Copy className="w-3 h-3" />
          </button>
          <button type="button" aria-label="Edit in editor" onClick={() => setOpen(true)} className="p-1 text-slate-500 hover:text-cyber-neon rounded">
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
        <pre className="text-[10px] font-mono text-slate-300 overflow-x-auto p-3 max-h-64">
          <code>{code}</code>
        </pre>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-4xl mx-4 rounded-2xl overflow-hidden shadow-2xl" style={{ height: "80vh" }}>
            <CodeEditor initialCode={code} language={language} filename={filename} height="h-full" />
            <div className="flex justify-end p-2 bg-slate-950 border-t border-slate-800">
              <button type="button" onClick={() => setOpen(false)}
                className="px-4 py-1.5 bg-slate-800 border border-slate-600 text-slate-300 rounded text-xs font-mono">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
