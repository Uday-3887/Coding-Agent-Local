import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Braces, Bug, Check, ChevronRight, Circle, CircleDot, Code2, Compass, Database, File, FileCode2, FileJson,
  FileText, FlaskConical, Folder, FolderOpen, Hammer, Library, Loader2, Monitor, Network, ScrollText,
  Search, Server, ShieldCheck, Wrench, X, XCircle, BrainCircuit,
} from "lucide-react";
import type { AgentRole } from "../lib/types";

/* ─────────── brand ─────────── */

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="LocalForge">
      <rect width="32" height="32" rx="7" fill="var(--bg3)" />
      <path d="M8 21h16v3H8z" fill="var(--ember)" opacity="0.55" />
      <path d="M10 15h12v3H10z" fill="var(--ember)" opacity="0.8" />
      <path d="M13 8h6v4h-6z" fill="var(--ember)" />
      <path d="M15.2 3.5l.8-2 .8 2z" fill="var(--warn)" />
    </svg>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin-slow" style={{ color: "var(--ember)" }} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--tx3)] font-semibold mb-1.5 mt-3 first:mt-0">{children}</div>;
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/* ─────────── file glyphs ─────────── */

export function FileGlyph({ path, size = 14 }: { path: string; size?: number }) {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  const name = path.split("/").pop()!.toLowerCase();
  let color = "var(--tx3)";
  let Icon: typeof File = File;
  if (["ts", "tsx"].includes(ext)) { color = "#5cb6f5"; Icon = FileCode2; }
  else if (["js", "jsx", "mjs"].includes(ext)) { color = "#e3b341"; Icon = FileCode2; }
  else if (ext === "json") { color = "#e3b341"; Icon = FileJson; }
  else if (ext === "md") { color = "#8d97ac"; Icon = FileText; }
  else if (ext === "css") { color = "#c792ea"; Icon = Braces; }
  else if (ext === "html") { color = "#ff7a45"; Icon = Code2; }
  else if (ext === "py") { color = "#3ecf8e"; Icon = FileCode2; }
  else if (["java", "kt"].includes(ext)) { color = "#f4586b"; Icon = FileCode2; }
  else if (["go", "rs", "c", "cpp", "cs"].includes(ext)) { color = "#5cb6f5"; Icon = Wrench; }
  else if (name.startsWith(".git")) { color = "#f4586b"; Icon = FileText; }
  else if (ext === "sql") { color = "#5cb6f5"; Icon = Database; }
  return <Icon size={size} style={{ color }} className="flex-none" />;
}

/* ─────────── agent metadata ─────────── */

export const AGENT_META: Record<AgentRole, { label: string; icon: typeof Bug; color: string }> = {
  orchestrator: { label: "Orchestrator", icon: Network, color: "var(--ember)" },
  architect: { label: "Architect", icon: Compass, color: "var(--info)" },
  repository: { label: "Repository", icon: Library, color: "var(--tx2)" },
  coder: { label: "Coder", icon: Code2, color: "var(--ok)" },
  frontend: { label: "Frontend", icon: Monitor, color: "#c792ea" },
  backend: { label: "Backend", icon: Server, color: "#5cb6f5" },
  database: { label: "Database", icon: Database, color: "#e3b341" },
  tester: { label: "Tester", icon: FlaskConical, color: "var(--warn)" },
  debugger: { label: "Debugger", icon: Bug, color: "var(--danger)" },
  reviewer: { label: "Reviewer", icon: ShieldCheck, color: "var(--ok)" },
  security: { label: "Security", icon: ShieldCheck, color: "var(--danger)" },
  docs: { label: "Docs", icon: ScrollText, color: "var(--tx2)" },
};

export function AgentStatusIcon({ status, size = 12 }: { status: string; size?: number }) {
  switch (status) {
    case "completed": return <Check size={size} style={{ color: "var(--ok)" }} />;
    case "running": return <CircleDot size={size} style={{ color: "var(--ember)" }} />;
    case "thinking": return <Loader2 size={size} className="spin-slow" style={{ color: "var(--ember)" }} />;
    case "waiting": return <Circle size={size} style={{ color: "var(--tx3)" }} />;
    case "failed": return <XCircle size={size} style={{ color: "var(--danger)" }} />;
    case "cancelled": return <X size={size} style={{ color: "var(--tx3)" }} />;
    default: return <Circle size={size} style={{ color: "var(--tx3)" }} />;
  }
}

/* ─────────── dropdown ─────────── */

export function Dropdown({ trigger, children, align = "left", width = 210 }: {
  trigger: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className="absolute top-full mt-1 z-50 raised rounded-lg py-1 anim-fade-up"
          style={{ width, [align]: 0, boxShadow: "var(--shadow)" } as React.CSSProperties}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger }: { children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      className="w-full flex items-center gap-2 px-2.5 py-[6px] text-[12px] text-left transition-colors hover:bg-[var(--bg3)]"
      style={{ color: danger ? "var(--danger)" : "var(--tx)" }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ─────────── context menu (right-click) ─────────── */

export interface CtxItem { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onClick: () => void; }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = Math.min(x, vw - 200), top = Math.min(y, vh - items.length * 30 - 16);
  return (
    <div ref={ref} className="fixed z-[75] raised rounded-lg py-1 anim-fade" style={{ left, top, width: 196, boxShadow: "var(--shadow)" }}>
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          className="w-full flex items-center gap-2 px-2.5 py-[6px] text-[12px] text-left hover:bg-[var(--bg3)] disabled:opacity-40 transition-colors"
          style={{ color: it.danger ? "var(--danger)" : "var(--tx)" }}
          onClick={() => { it.onClick(); onClose(); }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────── markdown-lite renderer ─────────── */

export function Markdown({ text }: { text: string }) {
  const html = renderMarkdown(text);
  return <div className="markdown-body text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(src: string): string {
  const blocks = src.split(/```/);
  let out = "";
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      const nl = block.indexOf("\n");
      const code = nl > -1 ? block.slice(nl + 1) : block;
      out += `<pre><code>${escapeHtml(code)}</code></pre>`;
    } else {
      out += inlineMarkdown(block);
    }
  });
  return out;
}

function inlineMarkdown(block: string): string {
  const lines = block.split("\n");
  let html = "";
  let inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { html += "</ul>"; inUl = false; } if (inOl) { html += "</ol>"; inOl = false; } };
  for (const raw of lines) {
    const line = raw;
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeLists(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inUl) { closeLists(); html += "<ul>"; inUl = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inOl) { closeLists(); html += "<ol>"; inOl = true; }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`; continue;
    }
    closeLists();
    if (line.trim() === "") continue;
    if (/^\|.*\|$/.test(line.trim())) continue; // tables: render simply below
    html += `<p>${inline(line)}</p>`;
  }
  closeLists();
  // very small table pass
  if (block.includes("|---")) {
    const rows = block.split("\n").filter((l) => /^\|/.test(l.trim()) && !/^\|[\s-|]+\|$/.test(l.trim()));
    if (rows.length) {
      let t = "<table>";
      rows.forEach((r, ri) => {
        const cells = r.split("|").filter((c) => c.trim() !== "");
        t += "<tr>" + cells.map((c) => (ri === 0 ? `<th>${inline(c.trim())}</th>` : `<td>${inline(c.trim())}</td>`)).join("") + "</tr>";
      });
      t += "</table>";
      return t;
    }
  }
  return html;
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/* ─────────── misc ─────────── */

export function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`led ${ok ? "led-ok" : "led-off"}`} />;
}

export function Chevron({ open }: { open: boolean }) {
  return <ChevronRight size={12} className="flex-none text-[var(--tx3)] transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />;
}

export { Folder, FolderOpen, Search, Hammer, BrainCircuit };
