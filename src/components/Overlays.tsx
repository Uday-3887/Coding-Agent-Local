import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Command, Info, Search, ShieldAlert, X } from "lucide-react";
import { analyzeProject, buildProject, openPreview, runProject, stopEverything, testProject } from "../agents/engine";
import { fuzzyFilter } from "../lib/fuzzy";
import { getMergedFiles, useStore } from "../state/store";
import { FileGlyph, Kbd } from "./ui";

/* ─────────────── Toasts ─────────────── */

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  return (
    <div className="fixed bottom-8 right-4 z-[90] space-y-2 w-[320px]">
      {toasts.map((t) => {
        const color = t.kind === "success" ? "var(--ok)" : t.kind === "error" ? "var(--danger)" : t.kind === "warn" ? "var(--warn)" : "var(--info)";
        const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertOctagon : t.kind === "warn" ? AlertTriangle : Info;
        return (
          <div key={t.id} className="raised rounded-lg p-3 anim-toast flex gap-2.5" style={{ borderColor: color, boxShadow: "var(--shadow)" }}>
            <Icon size={15} style={{ color }} className="flex-none mt-[1px]" />
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold">{t.title}</div>
              {t.body && <div className="text-[11.5px] text-[var(--tx2)] mt-0.5 break-words">{t.body}</div>}
            </div>
            <button className="text-[var(--tx3)] hover:text-[var(--tx)] self-start" onClick={() => dismissToast(t.id)}><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── Permission gate ─────────────── */

export function PermissionModal() {
  const permission = useStore((s) => s.permission);
  const resolvePermission = useStore((s) => s.resolvePermission);
  if (!permission) return null;
  const dangerous = permission.class === "dangerous";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 anim-fade" onClick={() => resolvePermission(false)}>
      <div
        className="raised rounded-xl w-[440px] max-w-[92vw] p-5 anim-fade-up"
        style={{ borderColor: dangerous ? "var(--danger)" : "var(--warn)", boxShadow: "var(--shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <ShieldAlert size={18} style={{ color: dangerous ? "var(--danger)" : "var(--warn)" }} />
          <div className="font-display font-semibold text-[15px]">{dangerous ? "Dangerous command" : "Permission required"}</div>
          <span className="chip !py-0 uppercase" style={{ color: dangerous ? "var(--danger)" : "var(--warn)", borderColor: "currentColor" }}>{permission.class}</span>
        </div>
        <div className="font-mono text-[12.5px] raised rounded-md px-3 py-2 mb-2 break-all" style={{ borderColor: dangerous ? "var(--danger)" : "var(--line2)" }}>
          {permission.title}
        </div>
        <p className="text-[12px] text-[var(--tx2)] leading-relaxed whitespace-pre-line mb-4">{permission.detail}</p>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={() => resolvePermission(false)}>Deny</button>
          <button className={dangerous ? "btn btn-danger" : "btn btn-ok"} onClick={() => resolvePermission(true)}>
            <CheckCircle2 size={12} /> {dangerous ? "I understand — allow" : "Allow"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Command palette ─────────────── */

interface Cmd { id: string; label: string; hint?: string; run: () => void; }

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const commands = useMemo<Cmd[]>(() => {
    const st = useStore.getState();
    return [
      { id: "open", label: "Open Folder", hint: "workspace", run: () => void st.openLocal() },
      { id: "demo", label: "Open Demo Workspace", hint: "atlas-notes", run: () => void st.openDemo() },
      { id: "chat", label: "New Chat", hint: "AI", run: () => { st.newChat(); st.setAiView("chat"); } },
      { id: "run", label: "Run Project", hint: "dev script", run: runProject },
      { id: "test", label: "Run Tests", hint: "unit suite", run: () => void testProject() },
      { id: "build", label: "Build Project", hint: "validate graph", run: () => void buildProject() },
      { id: "analyze", label: "Analyze Project", hint: "health report", run: analyzeProject },
      { id: "ollama", label: "Connect Ollama", hint: "AI backend", run: () => void st.connectOllama() },
      { id: "model", label: "Select Model / AI Settings", run: () => st.setSidebarView("settings") },
      { id: "terminal", label: "Toggle Terminal", hint: "Ctrl J", run: () => st.setBottomView("terminal") },
      { id: "sidebar", label: "Toggle Sidebar", hint: "Ctrl B", run: () => st.setSidebarView(st.sidebarView ? null : "explorer") },
      { id: "scm", label: "Open Source Control", run: () => st.setSidebarView("git") },
      { id: "settings", label: "Open Settings", run: () => st.setSidebarView("settings") },
      { id: "preview", label: "Open Preview", hint: "live website", run: () => void openPreview() },
      { id: "setup", label: "Setup Wizard (Configure)", hint: "ollama · models · prefs", run: () => window.dispatchEvent(new Event("lf-open-setup")) },
      { id: "stop", label: "Stop All", hint: "Esc", run: stopEverything },
      { id: "quick", label: "Quick Open File", hint: "Ctrl P", run: () => st.setQuickOpen(true) },
    ];
  }, [open]);

  const list = fuzzyFilter(commands, q, (c) => c.label);

  useEffect(() => { setIdx(0); }, [q, open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/45 anim-fade flex justify-center pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="raised rounded-xl w-[520px] max-w-[92vw] h-fit overflow-hidden anim-fade-up" style={{ boxShadow: "var(--shadow)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3.5 border-b border-[var(--line)]">
          <Command size={14} className="text-[var(--ember)]" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none py-3 text-[13px]"
            placeholder="Type a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && list[idx]) { list[idx].run(); setOpen(false); }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <Kbd>↵</Kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto scroll-thin p-1.5">
          {list.map((c, i) => (
            <button
              key={c.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] text-left transition-colors"
              style={i === idx ? { background: "var(--ember-soft)", color: "var(--ember)" } : undefined}
              onMouseEnter={() => setIdx(i)}
              onClick={() => { c.run(); setOpen(false); }}
            >
              <span className="flex-1">{c.label}</span>
              {c.hint && <span className="text-[10.5px] text-[var(--tx3)]">{c.hint}</span>}
            </button>
          ))}
          {list.length === 0 && <p className="px-3 py-3 text-[12px] text-[var(--tx3)]">No matching commands.</p>}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Quick open ─────────────── */

export function QuickOpen() {
  const open = useStore((s) => s.quickOpen);
  const setOpen = useStore((s) => s.setQuickOpen);
  const openFile = useStore((s) => s.openFile);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const files = useMemo(() => Object.keys(getMergedFiles(useStore.getState())).sort(), [open]);
  const list = fuzzyFilter(files, q, (f) => f).slice(0, 14);

  useEffect(() => { setIdx(0); setQ(""); }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/45 anim-fade flex justify-center pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="raised rounded-xl w-[520px] max-w-[92vw] h-fit overflow-hidden anim-fade-up" style={{ boxShadow: "var(--shadow)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3.5 border-b border-[var(--line)]">
          <Search size={14} className="text-[var(--ember)]" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none py-3 text-[13px] font-mono"
            placeholder="Search files by name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && list[idx]) { openFile(list[idx]); setOpen(false); }
              if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto scroll-thin p-1.5">
          {list.map((f, i) => (
            <button
              key={f}
              className="w-full flex items-center gap-2 px-3 py-[7px] rounded-lg text-[12.5px] font-mono text-left transition-colors"
              style={i === idx ? { background: "var(--ember-soft)", color: "var(--ember)" } : undefined}
              onMouseEnter={() => setIdx(i)}
              onClick={() => { openFile(f); setOpen(false); }}
            >
              <FileGlyph path={f} size={12} /> {f}
            </button>
          ))}
          {list.length === 0 && <p className="px-3 py-3 text-[12px] text-[var(--tx3)]">{files.length ? "No files match." : "No workspace open."}</p>}
        </div>
      </div>
    </div>
  );
}
