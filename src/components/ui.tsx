import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BrainCircuit, Bug, Check, Circle, CircleDot, Code2, Compass, FileCode2, FileJson2,
  FileText, FlaskConical, Loader2, Minus, Search, ShieldCheck, XCircle, type LucideIcon,
} from "lucide-react";
import type { AgentRole, AgentStatus, StepStatus } from "../lib/types";

/* ─────────────── primitives ─────────────── */

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin-slow" />;
}

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--bg3)" />
      <rect x="1" y="1" width="30" height="30" rx="6" fill="none" stroke="var(--line2)" />
      <path d="M8 21h16v3H8zM10 15h12v3H10zM13 8h6v4h-6z" fill="var(--ember)" />
    </svg>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--tx3)] mb-1.5">
      {children}
    </div>
  );
}

export function Dropdown({
  trigger, children, width = 250, align = "left",
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className="absolute z-50 mt-1 raised rounded-lg p-1 anim-fade-up scroll-thin"
          style={{
            width, top: "100%",
            ...(align === "right" ? { right: 0 } : { left: 0 }),
            boxShadow: "var(--shadow)", maxHeight: 360, overflowY: "auto",
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children, onClick, danger,
}: { children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      className="w-full flex items-center gap-2 px-2.5 py-[7px] rounded-md text-[12px] text-left transition-colors"
      style={{ color: danger ? "var(--danger)" : "var(--tx)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "var(--danger-soft)" : "var(--bg3)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ─────────────── agent metadata ─────────────── */

export const ROLE_META: Record<AgentRole, { label: string; icon: LucideIcon; color: string }> = {
  orchestrator: { label: "Orchestrator", icon: Compass, color: "var(--ember)" },
  architect: { label: "Architect", icon: BrainCircuit, color: "var(--info)" },
  repository: { label: "Repository", icon: Search, color: "var(--tx2)" },
  coder: { label: "Coder", icon: Code2, color: "var(--ok)" },
  tester: { label: "Tester", icon: FlaskConical, color: "var(--warn)" },
  debugger: { label: "Debugger", icon: Bug, color: "var(--danger)" },
  reviewer: { label: "Reviewer", icon: ShieldCheck, color: "#c792ea" },
};

export const ROLE_ORDER: AgentRole[] = ["orchestrator", "architect", "repository", "coder", "tester", "debugger", "reviewer"];

export function statusColor(s: AgentStatus): string {
  switch (s) {
    case "completed": return "var(--ok)";
    case "running": case "thinking": return "var(--ember)";
    case "failed": return "var(--danger)";
    case "waiting": return "var(--warn)";
    case "cancelled": return "var(--tx3)";
    default: return "var(--tx3)";
  }
}

export function StatusGlyph({ status }: { status: AgentStatus | StepStatus }) {
  if (status === "running" || status === "thinking") return <CircleDot size={13} style={{ color: "var(--ember)" }} className="led-pulse" />;
  if (status === "done" || status === "completed") return <Check size={13} style={{ color: "var(--ok)" }} />;
  if (status === "failed") return <XCircle size={13} style={{ color: "var(--danger)" }} />;
  if (status === "waiting") return <CircleDot size={13} style={{ color: "var(--warn)" }} />;
  if (status === "skipped") return <Minus size={13} style={{ color: "var(--tx3)" }} />;
  return <Circle size={13} style={{ color: "var(--tx3)" }} />;
}

/* ─────────────── file glyphs ─────────────── */

export function FileGlyph({ path, size = 13 }: { path: string; size?: number }) {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  if (ext === "json") return <FileJson2 size={size} style={{ color: "var(--warn)" }} />;
  if (ext === "md" || ext === "txt") return <FileText size={size} style={{ color: "var(--tx2)" }} />;
  const code = ["ts", "tsx", "js", "jsx", "py", "html", "css", "yml", "yaml", "toml"];
  const color = ["ts", "tsx"].includes(ext) ? "var(--info)" : ["js", "jsx"].includes(ext) ? "var(--warn)" : ["py"].includes(ext) ? "var(--ok)" : "var(--ember)";
  if (code.includes(ext)) return <FileCode2 size={size} style={{ color }} />;
  return <FileText size={size} style={{ color: "var(--tx3)" }} />;
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ─────────────── tiny markdown renderer ─────────────── */

function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else {
      const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (mm) parts.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function renderTextBlock(block: string, keyBase: string): ReactNode[] {
  const lines = block.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(
        <table key={`${keyBase}-t${k++}`}>
          <thead><tr>{rows[0]?.map((c, ci) => <th key={ci}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      );
      continue;
    }
    if (/^###\s/.test(line)) { out.push(<h3 key={`${keyBase}-h${k++}`}>{inline(line.replace(/^###\s/, ""))}</h3>); i++; continue; }
    if (/^##\s/.test(line)) { out.push(<h2 key={`${keyBase}-h${k++}`}>{inline(line.replace(/^##\s/, ""))}</h2>); i++; continue; }
    if (/^#\s/.test(line)) { out.push(<h1 key={`${keyBase}-h${k++}`}>{inline(line.replace(/^#\s/, ""))}</h1>); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      out.push(<ul key={`${keyBase}-u${k++}`}>{items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push(<ol key={`${keyBase}-o${k++}`}>{items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}</ol>);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(<p key={`${keyBase}-p${k++}`}>{inline(para.join(" "))}</p>);
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const chunks = text.split("```");
  return (
    <div className="markdown-body text-[12.5px] leading-relaxed break-words">
      {chunks.map((chunk, i) => {
        if (i % 2 === 1) {
          const nl = chunk.indexOf("\n");
          const code = nl >= 0 ? chunk.slice(nl + 1) : chunk;
          return <pre key={i}><code>{code.replace(/\n$/, "")}</code></pre>;
        }
        return <span key={i}>{renderTextBlock(chunk, `b${i}`)}</span>;
      })}
    </div>
  );
}
