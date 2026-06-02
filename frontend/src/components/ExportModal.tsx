/**
 * ExportModal — export task results, markdown, and data to various formats.
 * Uses the browser's native Print API for PDF and generates CSV/Excel-like TSV.
 */
import { useState } from "react";
import { Download, FileText, Table2, Printer, Copy, X } from "lucide-react";

interface ExportModalProps {
  title:    string;
  markdown: string;
  data?:    Record<string, any>[] | null;
  onClose:  () => void;
}

export function ExportModal({ title, markdown, data, onClose }: ExportModalProps) {
  const [copied, setCopied]  = useState(false);
  const [format, setFormat]  = useState<"md" | "txt" | "json" | "csv">("md");

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleDownload = () => {
    const safe = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    if (format === "md") {
      downloadFile(markdown, `${safe}.md`, "text/markdown");
    } else if (format === "txt") {
      const plain = markdown.replace(/#{1,6}\s/g, "").replace(/[*_`]/g, "");
      downloadFile(plain, `${safe}.txt`, "text/plain");
    } else if (format === "json") {
      const obj = data ?? { title, content: markdown, exported_at: new Date().toISOString() };
      downloadFile(JSON.stringify(obj, null, 2), `${safe}.json`, "application/json");
    } else if (format === "csv") {
      if (!data || data.length === 0) {
        alert("No table data available for CSV export");
        return;
      }
      const headers = Object.keys(data[0]);
      const rows    = data.map(row => headers.map(h => `"${String(row[h] ?? "").replace(/"/g,'""')}"`).join(","));
      const csv     = [headers.join(","), ...rows].join("\n");
      downloadFile(csv, `${safe}.csv`, "text/csv");
    }
  };

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html><head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
          body { font-family: 'Helvetica Neue', sans-serif; max-width: 800px; margin: 40px auto; color: #1e293b; }
          h1,h2,h3 { color: #0f172a; }
          pre, code { background: #f1f5f9; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
          pre { padding: 12px; overflow-x: auto; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
          th { background: #f8fafc; }
          @media print { body { margin: 20px; } }
        </style>
      </head><body>
        <h1>${title}</h1>
        <p style="color:#94a3b8;font-size:12px">Exported: ${new Date().toLocaleString("th-TH")}</p>
        <hr style="border:1px solid #e2e8f0;margin:20px 0">
        <div id="content"></div>
        <script>
          // Simple markdown to HTML
          const md = ${JSON.stringify(markdown)};
          document.getElementById('content').innerHTML = md
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\`(.+?)\`/g, '<code>$1</code>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/^(?!<[h|l|p|u])(.+)$/gm, '<p>$1</p>');
        </script>
      </body></html>
    `);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const FORMATS: Array<{ id: "md"|"txt"|"json"|"csv"; label: string; icon: React.ReactNode; disabled?: boolean }> = [
    { id: "md",   label: "Markdown (.md)",    icon: <FileText className="w-3.5 h-3.5" /> },
    { id: "txt",  label: "Plain Text (.txt)", icon: <FileText className="w-3.5 h-3.5" /> },
    { id: "json", label: "JSON (.json)",      icon: <FileText className="w-3.5 h-3.5" /> },
    { id: "csv",  label: "CSV (.csv)",        icon: <Table2   className="w-3.5 h-3.5" />, disabled: !data },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-cyber-neon/30 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold font-mono text-slate-100">Export Results</h3>
            <div className="text-[10px] text-slate-500 mt-0.5">{title}</div>
          </div>
          <button type="button" aria-label="Close export modal" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format selector */}
        <div>
          <div className="text-[9px] uppercase font-mono text-slate-500 mb-2 tracking-widest">Format</div>
          <div className="space-y-1.5">
            {FORMATS.map(f => (
              <label key={f.id} className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                format === f.id ? "border-cyber-neon/40 bg-cyber-neon/10" : "border-slate-700 hover:border-slate-600"
              } ${f.disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                <input type="radio" name="format" value={f.id} checked={format === f.id}
                  disabled={f.disabled}
                  onChange={() => setFormat(f.id as any)} className="hidden" />
                <span className={format === f.id ? "text-cyber-neon" : "text-slate-500"}>{f.icon}</span>
                <span className={`text-xs font-mono ${format === f.id ? "text-cyber-neon font-bold" : "text-slate-400"}`}>{f.label}</span>
                {f.disabled && <span className="text-[8px] text-slate-600 ml-auto">No table data</span>}
              </label>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="bg-black/40 rounded-lg p-3 max-h-32 overflow-y-auto">
          <pre className="text-[9px] font-mono text-slate-400 whitespace-pre-wrap">{markdown.slice(0, 500)}{markdown.length > 500 ? "\n…" : ""}</pre>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={handleDownload}
            className="flex flex-col items-center gap-1.5 py-2.5 bg-cyber-neon/10 hover:bg-cyber-neon/20 border border-cyber-neon/30 text-cyber-neon rounded-xl text-[10px] font-mono transition-all">
            <Download className="w-4 h-4" />
            Download
          </button>
          <button type="button" onClick={handlePrint}
            className="flex flex-col items-center gap-1.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 rounded-xl text-[10px] font-mono transition-all">
            <Printer className="w-4 h-4" />
            Print / PDF
          </button>
          <button type="button" onClick={handleCopy}
            className={`flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-[10px] font-mono transition-all border ${
              copied ? "bg-status-success/10 border-status-success/30 text-status-success" : "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300"
            }`}>
            <Copy className="w-4 h-4" />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
