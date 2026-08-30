import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Eraser, FlaskConical, Info, Plus, ScrollText, Square, TerminalSquare, Wand2, X } from "lucide-react";
import { executeTerminalLine, fixWithAI } from "../agents/engine";
import type { BottomView } from "../state/store";
import { useStore } from "../state/store";
import { timeAgo } from "./ui";

const TABS: { id: BottomView; label: string }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "problems", label: "Problems" },
  { id: "output", label: "Output" },
  { id: "tests", label: "Tests" },
  { id: "logs", label: "Logs" },
];

export default function BottomPanel() {
  const view = useStore((s) => s.bottomView);
  const setView = useStore((s) => s.setBottomView);
  const problems = useStore((s) => s.problems);

  if (!view) return null;
  return (
    <div className="flex flex-col h-full bg-[var(--bg1)]">
      <div className="flex items-center h-[30px] flex-none px-2 gap-1 border-b border-[var(--line)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className="px-2.5 py-[4px] rounded-md text-[11.5px] font-medium transition-colors flex items-center gap-1.5"
            style={view === t.id ? { color: "var(--ember)", background: "var(--ember-soft)" } : { color: "var(--tx2)" }}
          >
            {t.label}
            {t.id === "problems" && problems.length > 0 && (
              <span className="chip !py-0 !px-1.5 !text-[9.5px]" style={{ color: problems.some((p) => p.severity === "error") ? "var(--danger)" : "var(--warn)", borderColor: "currentColor" }}>{problems.length}</span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)]" onClick={() => setView(null)} title="Hide panel (Ctrl+J)"><ChevronDown size={14} /></button>
      </div>
      <div className="flex-1 min-h-0">
        {view === "terminal" && <TerminalView />}
        {view === "problems" && <ProblemsView />}
        {view === "output" && <OutputView />}
        {view === "tests" && <TestsView />}
        {view === "logs" && <LogsView />}
      </div>
    </div>
  );
}

/* ─────────────── Terminal ─────────────── */

function TerminalView() {
  const terminals = useStore((s) => s.terminals);
  const activeTerminalId = useStore((s) => s.activeTerminalId);
  const setActiveTerminal = useStore((s) => s.setActiveTerminal);
  const newTerminal = useStore((s) => s.newTerminal);
  const closeTerminal = useStore((s) => s.closeTerminal);
  const clearTerminal = useStore((s) => s.clearTerminal);
  const settings = useStore((s) => s.settings);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const session = terminals.find((t) => t.id === activeTerminalId) ?? terminals[0];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.lines.length]);

  const run = () => {
    const cmd = input.trim();
    if (!cmd || !session) return;
    setHistory((h) => [cmd, ...h].slice(0, 50));
    setHistIdx(-1);
    setInput("");
    void executeTerminalLine(session.id, cmd);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--line)] flex-none">
        {terminals.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11px] cursor-pointer"
            style={t.id === activeTerminalId ? { background: "var(--bg3)", color: "var(--tx)" } : { color: "var(--tx3)" }}
            onClick={() => setActiveTerminal(t.id)}
          >
            <TerminalSquare size={11} /> {t.name}
            <button className="hover:text-[var(--danger)]" onClick={(e) => { e.stopPropagation(); closeTerminal(t.id); }}><X size={10} /></button>
          </span>
        ))}
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)]" title="New terminal" onClick={() => newTerminal()}><Plus size={12} /></button>
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)]" title="Kill foreground process"
          onClick={() => session && useStore.getState().termLine(session.id, "sys", "kill: browser runtime tracks no live PIDs — long-lived processes need the desktop runtime")}>
          <Square size={11} />
        </button>
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)]" title="Clear" onClick={() => session && clearTerminal(session.id)}><Eraser size={12} /></button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-3 py-2 font-mono text-[12px] leading-[1.6]">
        {session?.lines.map((l, i) => (
          <div key={i} style={{
            color: l.kind === "cmd" ? "var(--ember)" : l.kind === "err" ? "var(--danger)" : l.kind === "sys" ? "var(--info)" : "var(--tx)",
            fontStyle: l.kind === "sys" ? "italic" : "normal",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {l.text}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--line)] flex-none">
        <span className="font-mono text-[11.5px] flex-none" style={{ color: "var(--ok)" }}>{settings.shell} ❯</span>
        <input
          className="flex-1 bg-transparent outline-none font-mono text-[12px] text-[var(--tx)]"
          value={input}
          placeholder='type "help"'
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
            if (e.key === "ArrowUp") { e.preventDefault(); const ni = Math.min(histIdx + 1, history.length - 1); if (history[ni] !== undefined) { setHistIdx(ni); setInput(history[ni]); } }
            if (e.key === "ArrowDown") { e.preventDefault(); const ni = histIdx - 1; setHistIdx(ni); setInput(ni < 0 ? "" : history[ni]); }
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────── Problems ─────────────── */

function ProblemsView() {
  const problems = useStore((s) => s.problems);
  const openFile = useStore((s) => s.openFile);
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--line)] sticky top-0 bg-[var(--bg1)]">
        <span className="text-[11px] text-[var(--tx3)]">{problems.length} problem(s) — computed by the static analysis engine</span>
        <div className="flex-1" />
        {problems.some((p) => p.severity === "error") && (
          <button className="btn btn-primary !py-1 !text-[11px]" onClick={() => fixWithAI(problems.filter((p) => p.severity === "error"))}>
            <Wand2 size={11} /> Fix with AI
          </button>
        )}
      </div>
      {problems.length === 0 && (
        <p className="px-4 py-4 text-[12px] text-[var(--tx3)]">No problems. Run Lint or Type Check from the Test panel to validate the workspace.</p>
      )}
      {problems.map((p) => (
        <button key={p.id} className="w-full flex items-center gap-2 px-3 py-[5px] text-left hover:bg-[var(--bg2)] transition-colors" onClick={() => openFile(p.file)}>
          {p.severity === "error" ? <AlertTriangle size={12} style={{ color: "var(--danger)" }} /> : p.severity === "warning" ? <AlertTriangle size={12} style={{ color: "var(--warn)" }} /> : <Info size={12} style={{ color: "var(--info)" }} />}
          <span className="text-[12px] truncate flex-1">{p.message}</span>
          <span className="font-mono text-[10.5px] text-[var(--tx3)] flex-none">{p.file}:{p.line}</span>
          <span className="chip !py-0 !text-[9.5px] flex-none">{p.source}</span>
        </button>
      ))}
    </div>
  );
}

/* ─────────────── Output ─────────────── */

function OutputView() {
  const output = useStore((s) => s.output);
  const clearOutput = useStore((s) => s.clearOutput);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [output.length]);
  return (
    <div className="h-full flex flex-col">
      <div ref={ref} className="flex-1 overflow-y-auto scroll-thin px-3 py-2 font-mono text-[11.5px] leading-[1.6]">
        {output.length === 0 && <p className="text-[var(--tx3)] italic">Build/test output streams here.</p>}
        {output.map((l, i) => (
          <div key={i} style={{ color: l.kind === "err" ? "var(--danger)" : l.kind === "sys" ? "var(--info)" : "var(--tx)", whiteSpace: "pre-wrap" }}>{l.text}</div>
        ))}
      </div>
      <div className="flex justify-end px-2 py-1 border-t border-[var(--line)]">
        <button className="btn btn-ghost !py-0.5 !text-[10.5px]" onClick={clearOutput}><Eraser size={10} /> Clear</button>
      </div>
    </div>
  );
}

/* ─────────────── Tests ─────────────── */

function TestsView() {
  const testRuns = useStore((s) => s.testRuns);
  return (
    <div className="h-full overflow-y-auto scroll-thin px-3 py-2 space-y-1.5">
      {testRuns.length === 0 && <p className="text-[12px] text-[var(--tx3)]">No test runs yet.</p>}
      {testRuns.slice(0, 20).map((r) => (
        <div key={r.id} className="flex items-center gap-2 raised rounded-md px-3 py-1.5 text-[11.5px]">
          <FlaskConical size={11} className="text-[var(--tx3)]" />
          <span className="font-mono uppercase text-[10px] text-[var(--tx3)]">{r.kind}</span>
          <span style={{ color: "var(--ok)" }}>{r.passed} passed</span>
          <span style={{ color: r.failed ? "var(--danger)" : "var(--tx3)" }}>{r.failed} failed</span>
          <span style={{ color: "var(--tx3)" }}>{r.skipped} skipped</span>
          <span className="ml-auto text-[10px] text-[var(--tx3)]">{r.durationMs}ms · {timeAgo(r.at)}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────── Logs ─────────────── */

const CATS = ["ALL", "APP", "AI", "AGENT", "TOOL", "OLLAMA", "TERMINAL", "TEST", "ERROR"] as const;

function LogsView() {
  const logs = useStore((s) => s.logs);
  const [cat, setCat] = useState<(typeof CATS)[number]>("ALL");
  const shown = cat === "ALL" ? logs : logs.filter((l) => l.cat === cat);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--line)] flex-none flex-wrap">
        {CATS.map((c) => (
          <button key={c} className="chip !py-0.5 cursor-pointer" style={cat === c ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
        <div className="flex-1" />
        <ScrollText size={12} className="text-[var(--tx3)]" />
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-2 font-mono text-[10.5px] leading-[1.7]">
        {shown.length === 0 && <p className="text-[var(--tx3)] italic">No log entries for this category.</p>}
        {shown.map((l) => (
          <div key={l.id} className="flex gap-2">
            <span className="text-[var(--tx3)] flex-none">{new Date(l.at).toLocaleTimeString()}</span>
            <span className="flex-none w-[64px]" style={{ color: l.cat === "ERROR" ? "var(--danger)" : l.cat === "AGENT" ? "var(--ember)" : l.cat === "OLLAMA" ? "var(--ok)" : "var(--info)" }}>{l.cat}</span>
            <span className="text-[var(--tx2)] break-all">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
