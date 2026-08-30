import { useEffect, useMemo, useState } from "react";
import {
  Bot, Check, ChevronDown, ChevronRight, Clock, Compass, FilePlus2, FolderOpen, GitBranch,
  History, Pencil, Pin, Play, Plus, RotateCcw, Search, Settings2, Square, Trash2, Wifi, X,
} from "lucide-react";
import { stopGeneration } from "../agents/engine";
import { diffLines, diffStats } from "../lib/diff";
import type { AgentRole } from "../lib/types";
import { useStore, type SidebarView } from "../state/store";
import { FileGlyph, ROLE_META, ROLE_ORDER, SectionLabel, StatusGlyph, Spinner, timeAgo } from "./ui";

const RAIL: { id: SidebarView; icon: typeof Search; label: string }[] = [
  { id: "explorer", icon: FolderOpen, label: "Explorer" },
  { id: "search", icon: Search, label: "Search" },
  { id: "agents", icon: Bot, label: "Agents" },
  { id: "tasks", icon: Compass, label: "Tasks" },
  { id: "git", icon: GitBranch, label: "Source Control" },
  { id: "settings", icon: Settings2, label: "Settings" },
];

export default function Sidebar() {
  const view = useStore((s) => s.sidebarView);
  const setView = useStore((s) => s.setSidebarView);
  const pending = useStore((s) => s.pending);
  const problems = useStore((s) => s.problems);

  if (!view) return null;
  const meta = RAIL.find((r) => r.id === view);

  return (
    <div className="flex h-full bg-[var(--bg1)] border-r border-[var(--line)]">
      <nav className="w-[44px] flex-none flex flex-col items-center py-2 gap-1 border-r border-[var(--line)]">
        {RAIL.map((r) => {
          const active = view === r.id;
          const badge = r.id === "git" ? pending.length : r.id === "tasks" ? problems.filter((p) => p.severity === "error").length : 0;
          return (
            <button
              key={r.id}
              title={r.label}
              onClick={() => setView(active ? null : r.id)}
              className="relative w-[34px] h-[34px] rounded-lg flex items-center justify-center transition-all"
              style={active
                ? { background: "var(--ember-soft)", color: "var(--ember)", boxShadow: "inset 0 0 0 1px var(--ember)" }
                : { color: "var(--tx3)" }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--tx)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--tx3)"; }}
            >
              <r.icon size={16} />
              {badge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: "var(--ember)", color: "#170b05" }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-3 h-[34px] flex-none border-b border-[var(--line)]">
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--tx2)]">{meta?.label}</span>
          <button className="text-[var(--tx3)] hover:text-[var(--tx)]" onClick={() => setView(null)}><X size={13} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {view === "explorer" && <ExplorerView />}
          {view === "search" && <SearchView />}
          {view === "agents" && <AgentsView />}
          {view === "tasks" && <TasksView />}
          {view === "git" && <GitView />}
          {view === "settings" && <SettingsView />}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Explorer ─────────────── */

function ExplorerView() {
  const workspace = useStore((s) => s.workspace);
  const tree = useStore((s) => s.tree);
  const openFile = useStore((s) => s.openFile);
  const createFile = useStore((s) => s.createFile);
  const renameFile = useStore((s) => s.renameFile);
  const deleteFile = useStore((s) => s.deleteFile);
  const openLocal = useStore((s) => s.openLocal);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.filter((n) => n.type === "dir" && n.path.split("/").length <= 2).map((n) => n.path)));
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");

  const wsLabel = workspace?.label;
  useEffect(() => {
    setExpanded(new Set(useStore.getState().tree.filter((n) => n.type === "dir" && n.path.split("/").length <= 2).map((n) => n.path)));
  }, [wsLabel]);

  const visible = useMemo(() => tree.filter((n) => {
    const parts = n.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const anc = parts.slice(0, i).join("/");
      if (!expanded.has(anc)) return false;
    }
    return true;
  }), [tree, expanded]);

  if (!workspace) {
    return (
      <div className="p-4 text-[12px] text-[var(--tx3)] space-y-3">
        <p>No workspace open.</p>
        <button className="btn btn-primary w-full justify-center" onClick={() => void openLocal()}><FolderOpen size={13} /> Open Folder</button>
      </div>
    );
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <span className="font-mono text-[11.5px] font-semibold truncate" style={{ color: "var(--ember)" }}>{workspace.label}</span>
        <span className="chip !py-0 !text-[9px]">{workspace.source}</span>
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)] hover:text-[var(--tx)]" title="New file" onClick={() => setCreating(true)}><FilePlus2 size={13} /></button>
      </div>
      {creating && (
        <div className="px-3 pb-1.5">
          <input
            autoFocus
            className="input !py-1 !text-[11.5px] font-mono"
            placeholder="path/to/file.ts"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPath.trim()) { createFile(newPath.trim()); setCreating(false); setNewPath(""); }
              if (e.key === "Escape") setCreating(false);
            }}
            onBlur={() => { if (newPath.trim()) createFile(newPath.trim()); setCreating(false); setNewPath(""); }}
          />
        </div>
      )}
      {visible.map((n) => {
        const depth = n.path.split("/").length - 1;
        const name = n.path.split("/").pop() ?? n.path;
        const isExp = expanded.has(n.path);
        return (
          <div
            key={n.path}
            className="tree-row group flex items-center gap-1 px-2 py-[3px] cursor-pointer text-[12px]"
            style={{ paddingLeft: 8 + depth * 13 }}
            onClick={() => (n.type === "dir"
              ? setExpanded((s) => { const nx = new Set(s); if (nx.has(n.path)) nx.delete(n.path); else nx.add(n.path); return nx; })
              : openFile(n.path))}
          >
            {n.type === "dir"
              ? (isExp ? <ChevronDown size={12} className="text-[var(--tx3)] flex-none" /> : <ChevronRight size={12} className="text-[var(--tx3)] flex-none" />)
              : <span className="w-3 flex-none" />}
            {n.type === "dir"
              ? <span className="truncate text-[var(--tx2)] font-medium">{name}</span>
              : <><FileGlyph path={n.path} size={12} /><span className="truncate">{name}</span></>}
            {n.type === "file" && (
              <span className="ml-auto hidden group-hover:flex items-center gap-0.5">
                <button className="p-[2px] rounded hover:bg-[var(--bg4)] text-[var(--tx3)] hover:text-[var(--info)]" title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    const to = window.prompt("Rename to:", n.path);
                    if (to && to !== n.path) renameFile(n.path, to);
                  }}><Pencil size={10} /></button>
                <button className="p-[2px] rounded hover:bg-[var(--bg4)] text-[var(--tx3)] hover:text-[var(--danger)]" title="Delete"
                  onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete ${n.path}?`)) deleteFile(n.path); }}>
                  <Trash2 size={10} /></button>
              </span>
            )}
          </div>
        );
      })}
      <div className="px-3 py-2 text-[10.5px] text-[var(--tx3)]">{Object.keys(workspace.files).length} files indexed</div>
    </div>
  );
}

/* ─────────────── Search ─────────────── */

function SearchView() {
  const workspace = useStore((s) => s.workspace);
  const openFile = useStore((s) => s.openFile);
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const results = useMemo(() => {
    if (!workspace || q.trim().length < 2) return [];
    let re: RegExp;
    try {
      re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "" : "i");
    } catch {
      return [];
    }
    const out: { file: string; line: number; text: string }[] = [];
    for (const [p, content] of Object.entries(workspace.files)) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && out.length < 120; i++) {
        if (re.test(lines[i])) out.push({ file: p, line: i + 1, text: lines[i].trim().slice(0, 110) });
      }
    }
    return out;
  }, [workspace, q, regex, caseSensitive]);

  return (
    <div className="p-3 space-y-2">
      <input autoFocus className="input" placeholder="Search in files…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-1.5">
        <button className="chip cursor-pointer" style={regex ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined} onClick={() => setRegex(!regex)}>.* regex</button>
        <button className="chip cursor-pointer" style={caseSensitive ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined} onClick={() => setCaseSensitive(!caseSensitive)}>Aa case</button>
        <span className="ml-auto text-[10.5px] text-[var(--tx3)] self-center">{results.length} hit{results.length === 1 ? "" : "s"}</span>
      </div>
      {!workspace && <p className="text-[11.5px] text-[var(--tx3)]">Open a workspace to search.</p>}
      <div className="space-y-0.5">
        {results.map((r, i) => (
          <button key={i} className="w-full text-left px-2 py-1 rounded-md tree-row" onClick={() => openFile(r.file)}>
            <div className="flex items-center gap-1.5 text-[11px]">
              <FileGlyph path={r.file} size={11} />
              <span className="truncate font-mono">{r.file}</span>
              <span className="text-[var(--tx3)] flex-none">:{r.line}</span>
            </div>
            <div className="font-mono text-[10.5px] text-[var(--tx2)] truncate pl-4">{r.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── Agents ─────────────── */

function AgentsView() {
  const agents = useStore((s) => s.agents);
  const agentRunning = useStore((s) => s.agentRunning);
  const [selected, setSelected] = useState<AgentRole | null>(null);

  const sel = selected ? agents[selected] : null;
  return (
    <div className="p-2 space-y-1">
      <div className="px-1 pb-1 flex items-center gap-2">
        <span className="text-[10.5px] text-[var(--tx3)]">pipeline: architect → repo → coder → tester → reviewer</span>
        {agentRunning && <Spinner size={11} />}
      </div>
      {ROLE_ORDER.map((r) => {
        const a = agents[r];
        const meta = ROLE_META[r];
        const Icon = meta.icon;
        return (
          <button
            key={r}
            className="w-full flex items-center gap-2 px-2 py-[7px] rounded-lg text-left transition-colors"
            style={selected === r ? { background: "var(--bg3)" } : undefined}
            onMouseEnter={(e) => { if (selected !== r) e.currentTarget.style.background = "var(--bg2)"; }}
            onMouseLeave={(e) => { if (selected !== r) e.currentTarget.style.background = "transparent"; }}
            onClick={() => setSelected(selected === r ? null : r)}
          >
            <span className="w-[26px] h-[26px] rounded-md flex items-center justify-center flex-none" style={{ background: "var(--bg3)", color: meta.color }}>
              <Icon size={14} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12px] font-medium">{meta.label}</span>
              <span className="block text-[10.5px] truncate" style={{ color: a.status === "idle" ? "var(--tx3)" : undefined }}>{a.note || a.status}</span>
            </span>
            <StatusGlyph status={a.status} />
          </button>
        );
      })}

      {sel && (
        <div className="raised rounded-lg p-2.5 mt-2 space-y-2 anim-fade-up">
          <SectionLabel>{ROLE_META[sel.role].label} detail</SectionLabel>
          <p className="text-[11.5px] text-[var(--tx2)] leading-relaxed">{sel.output || sel.note || "No output yet."}</p>
          {sel.filesTouched.length > 0 && (
            <div>
              <SectionLabel>Files touched</SectionLabel>
              {sel.filesTouched.map((f) => <div key={f} className="font-mono text-[10.5px] text-[var(--tx2)] truncate">{f}</div>)}
            </div>
          )}
          {sel.toolCalls.length > 0 && (
            <div>
              <SectionLabel>Tool calls ({sel.toolCalls.length})</SectionLabel>
              {sel.toolCalls.slice(-6).reverse().map((t) => (
                <div key={t.id} className="font-mono text-[10px] py-[3px] border-b border-[var(--line)] last:border-0">
                  <span style={{ color: t.ok ? "var(--ok)" : "var(--danger)" }}>{t.ok ? "✓" : "✗"}</span>{" "}
                  <span style={{ color: "var(--ember)" }}>{t.tool}</span>{" "}
                  <span className="text-[var(--tx3)]">{JSON.stringify(t.args).slice(0, 60)}</span>
                </div>
              ))}
            </div>
          )}
          {sel.errors.length > 0 && (
            <div>
              <SectionLabel>Errors</SectionLabel>
              {sel.errors.map((e, i) => <div key={i} className="text-[10.5px]" style={{ color: "var(--danger)" }}>{e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Tasks ─────────────── */

function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const pending = useStore((s) => s.pending);
  const agentRunning = useStore((s) => s.agentRunning);
  const undoTask = useStore((s) => s.undoTask);
  const [open, setOpen] = useState<string | null>(tasks[0]?.id ?? null);

  if (tasks.length === 0) {
    return <p className="p-4 text-[12px] text-[var(--tx3)]">No tasks yet. Send a task from the Agent panel — every run is recorded here with its steps and TODO list.</p>;
  }

  return (
    <div className="p-2 space-y-1.5">
      {tasks.map((t, idx) => {
        const changes = pending.filter((c) => c.taskId === t.id).length;
        const isOpen = open === t.id;
        const statusColor = t.status === "done" ? "var(--ok)" : t.status === "failed" || t.status === "blocked" ? "var(--danger)" : t.status === "running" ? "var(--ember)" : "var(--tx3)";
        return (
          <div key={t.id} className="raised rounded-lg overflow-hidden">
            <button className="w-full flex items-center gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(isOpen ? null : t.id)}>
              <span className="font-mono text-[10px] text-[var(--tx3)] flex-none">#{String(tasks.length - idx).padStart(3, "0")}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] truncate">{t.title}</span>
                <span className="block text-[10px] text-[var(--tx3)]">{timeAgo(t.createdAt)} · {changes} pending change{changes === 1 ? "" : "s"}</span>
              </span>
              <span className="chip !py-0 !text-[9.5px] uppercase flex-none" style={{ color: statusColor, borderColor: statusColor }}>
                {t.status === "running" && agentRunning ? <Spinner size={9} /> : null} {t.status}
              </span>
            </button>
            {isOpen && (
              <div className="px-3 pb-2.5 space-y-2 anim-fade">
                {t.todos.length > 0 && (
                  <div>
                    <SectionLabel>TODO</SectionLabel>
                    {t.todos.map((todo, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11.5px] py-[2px]">
                        <StatusGlyph status={todo.status} />
                        <span className={todo.status === "done" ? "line-through text-[var(--tx3)]" : ""}>{todo.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <SectionLabel>Steps</SectionLabel>
                  {t.steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5 text-[11.5px] py-[2px]">
                      <StatusGlyph status={s.status} /> {s.label}
                    </div>
                  ))}
                </div>
                {t.summary && <p className="text-[11px] text-[var(--tx2)] leading-relaxed border-t border-[var(--line)] pt-2">{t.summary}</p>}
                {changes > 0 && (
                  <button className="btn !py-1 !text-[11px]" onClick={() => undoTask(t.id)}><RotateCcw size={11} /> Roll back pending changes</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── Source Control ─────────────── */

function GitView() {
  const pending = useStore((s) => s.pending);
  const checkpoints = useStore((s) => s.checkpoints);
  const acceptChange = useStore((s) => s.acceptChange);
  const rejectChange = useStore((s) => s.rejectChange);
  const acceptAll = useStore((s) => s.acceptAll);
  const rejectAll = useStore((s) => s.rejectAll);
  const openSpecialTab = useStore((s) => s.openSpecialTab);
  const restoreCheckpoint = useStore((s) => s.restoreCheckpoint);
  const deleteCheckpoint = useStore((s) => s.deleteCheckpoint);

  return (
    <div className="p-2 space-y-3">
      <div>
        <div className="flex items-center gap-2 px-1">
          <SectionLabel>Pending changes ({pending.length})</SectionLabel>
          <div className="flex-1" />
          {pending.length > 0 && (
            <>
              <button className="btn btn-ghost !py-0.5 !px-1.5 !text-[10.5px]" onClick={() => void rejectAll()}>Reject all</button>
              <button className="btn btn-ok !py-0.5 !px-1.5 !text-[10.5px]" onClick={() => void acceptAll()}>Accept all</button>
            </>
          )}
        </div>
        {pending.length === 0 && <p className="px-1 text-[11.5px] text-[var(--tx3)]">Nothing pending — agent edits appear here as diffs before anything is applied.</p>}
        {pending.map((c) => {
          const stats = diffStats(diffLines(c.before, c.after));
          return (
            <div key={c.id} className="group flex items-center gap-1.5 px-2 py-[6px] rounded-md tree-row">
              <FileGlyph path={c.path} size={12} />
              <button className="flex-1 min-w-0 text-left font-mono text-[11px] truncate hover:text-[var(--ember)] transition-colors"
                onClick={() => openSpecialTab({ id: `diff:${c.id}`, kind: "diff", title: c.path.split("/").pop() ?? c.path, changeId: c.id })}>
                {c.path}
              </button>
              <span className="chip !py-0 !text-[9px] uppercase" style={{ color: c.type === "create" ? "var(--ok)" : c.type === "delete" ? "var(--danger)" : "var(--warn)" }}>{c.type}</span>
              <span className="text-[10px] font-mono" style={{ color: "var(--ok)" }}>+{stats.added}</span>
              <span className="text-[10px] font-mono" style={{ color: "var(--danger)" }}>−{stats.removed}</span>
              <span className="hidden group-hover:flex items-center gap-0.5">
                <button className="p-[2px] rounded hover:bg-[var(--bg4)] text-[var(--tx3)] hover:text-[var(--danger)]" title="Reject" onClick={() => rejectChange(c.id)}><X size={11} /></button>
                <button className="p-[2px] rounded hover:bg-[var(--bg4)] text-[var(--tx3)] hover:text-[var(--ok)]" title="Accept" onClick={() => void acceptChange(c.id)}><Check size={11} /></button>
              </span>
            </div>
          );
        })}
      </div>

      <div>
        <SectionLabel>Checkpoints ({checkpoints.length})</SectionLabel>
        {checkpoints.length === 0 && <p className="px-1 text-[11.5px] text-[var(--tx3)]">A snapshot is taken before every agent task.</p>}
        {checkpoints.map((cp) => (
          <div key={cp.id} className="group flex items-center gap-1.5 px-2 py-[6px] rounded-md tree-row">
            <History size={12} className="text-[var(--tx3)] flex-none" />
            <span className="flex-1 min-w-0">
              <span className="block text-[11.5px] truncate">{cp.label}</span>
              <span className="block text-[9.5px] text-[var(--tx3)]">{timeAgo(cp.at)} · {Object.keys(cp.files).length} files</span>
            </span>
            <span className="hidden group-hover:flex items-center gap-0.5">
              <button className="p-[2px] rounded hover:bg-[var(--bg4)] text-[var(--tx3)] hover:text-[var(--danger)]" title="Delete" onClick={() => deleteCheckpoint(cp.id)}><Trash2 size={11} /></button>
              <button className="btn !py-0.5 !px-1.5 !text-[10px]" onClick={() => { if (window.confirm(`Restore "${cp.label}"? Current workspace files will be replaced.`)) restoreCheckpoint(cp.id); }}>
                <RotateCcw size={10} /> Restore
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── Settings ─────────────── */

function Toggle({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button className="w-full flex items-center gap-2 py-[5px] text-left" onClick={() => onChange(!value)}>
      <span className="w-[30px] h-[17px] rounded-full relative flex-none transition-colors" style={{ background: value ? "var(--ember)" : "var(--bg4)" }}>
        <span className="absolute top-[2px] w-[13px] h-[13px] rounded-full bg-white transition-all" style={{ left: value ? 15 : 2 }} />
      </span>
      <span className="flex-1">
        <span className="block text-[12px]">{label}</span>
        {hint && <span className="block text-[10px] text-[var(--tx3)]">{hint}</span>}
      </span>
    </button>
  );
}

function SettingsView() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const ollama = useStore((s) => s.ollama);
  const connectOllama = useStore((s) => s.connectOllama);
  const disconnectOllama = useStore((s) => s.disconnectOllama);
  const refreshModels = useStore((s) => s.refreshModels);
  const pullModel = useStore((s) => s.pullModel);
  const deleteModel = useStore((s) => s.deleteModel);
  const pullState = useStore((s) => s.pullState);
  const memory = useStore((s) => s.memory);
  const memoryClear = useStore((s) => s.memoryClear);
  const [url, setUrl] = useState(settings.ollamaUrl);
  const [pullName, setPullName] = useState("");

  return (
    <div className="p-3 space-y-4">
      <div>
        <SectionLabel>General</SectionLabel>
        <div className="flex items-center gap-2 py-1">
          <span className="text-[12px] flex-1">Theme</span>
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} className="chip cursor-pointer" style={settings.theme === t ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined}
              onClick={() => updateSettings({ theme: t })}>{t}</button>
          ))}
        </div>
        <Toggle value={settings.autoSave} onChange={(v) => updateSettings({ autoSave: v })} label="Auto save" hint="Write edits to the workspace ~1s after typing" />
      </div>

      <div>
        <SectionLabel>AI · Ollama</SectionLabel>
        <div className="flex gap-1.5">
          <input className="input font-mono !text-[11px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:11434" />
          <button className="btn !px-2.5" onClick={() => { updateSettings({ ollamaUrl: url }); void connectOllama(); }}><Wifi size={12} /></button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className={`led ${ollama.status === "connected" ? "led-ok" : ollama.status === "connecting" ? "led-warn led-pulse" : ollama.status === "error" ? "led-danger" : "led-off"}`} />
          <span className="text-[11.5px] capitalize">{ollama.status}{ollama.version ? ` · v${ollama.version}` : ""}</span>
          <div className="flex-1" />
          <button className="btn btn-ghost !py-0.5 !px-1.5 !text-[10.5px]" onClick={() => void refreshModels()}>Refresh</button>
          {ollama.status === "connected" && <button className="btn btn-ghost !py-0.5 !px-1.5 !text-[10.5px]" onClick={disconnectOllama}>Disconnect</button>}
        </div>

        <div className="mt-2 space-y-1">
          {ollama.models.map((m) => (
            <div key={m} className="group flex items-center gap-2 px-2 py-1 rounded-md tree-row">
              <span className="font-mono text-[11px] flex-1 truncate">{m}</span>
              <button className="opacity-0 group-hover:opacity-100 btn btn-ghost !py-0 !px-1.5 !text-[10px] !text-[var(--danger)]" onClick={() => void deleteModel(m)}>delete</button>
            </div>
          ))}
          {ollama.status === "connected" && ollama.models.length === 0 && <p className="text-[11px] text-[var(--tx3)]">No models installed — pull one below.</p>}
        </div>

        {ollama.status === "connected" && (
          <div className="mt-2">
            <div className="flex gap-1.5">
              <input className="input font-mono !text-[11px]" placeholder="qwen2.5-coder:7b" value={pullName} onChange={(e) => setPullName(e.target.value)} />
              <button className="btn !px-2.5" disabled={!pullName.trim() || !!pullState} onClick={() => void pullModel(pullName.trim())}><Plus size={12} /></button>
            </div>
            {pullState && (
              <div className="mt-1.5">
                <div className="flex justify-between text-[10.5px] text-[var(--tx2)]"><span className="truncate">{pullState.status}</span><span>{pullState.pct !== undefined ? `${pullState.pct}%` : ""}</span></div>
                <div className="h-[4px] rounded-full bg-[var(--bg4)] overflow-hidden mt-1">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pullState.pct ?? 4}%`, background: "var(--ember)" }} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 space-y-1.5">
          <SectionLabel>Models per role</SectionLabel>
          {([["chat", "Chat"], ["agent", "Agent"], ["planner", "Planner"], ["tester", "Tester"], ["reviewer", "Reviewer"]] as const).map(([role, label]) => (
            <div key={role} className="flex items-center gap-2">
              <span className="text-[11.5px] w-[64px] flex-none">{label}</span>
              <select
                className="select !py-1 !text-[11px]"
                value={settings.models[role]}
                onChange={(e) => updateSettings({ models: { ...settings.models, [role]: e.target.value } })}
              >
                <option value="">auto</option>
                <option value="localforge-heuristic-v1">heuristic (built-in)</option>
                {ollama.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1.5">
          <SectionLabel>Parameters</SectionLabel>
          {([
            ["temperature", "Temperature", 0, 2, 0.1],
            ["topP", "Top P", 0, 1, 0.05],
            ["numPredict", "Max tokens", 256, 8192, 256],
            ["numCtx", "Context window", 2048, 32768, 2048],
          ] as const).map(([key, label, min, max, step]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[11.5px] w-[92px] flex-none">{label}</span>
              <input type="range" min={min} max={max} step={step} value={settings.params[key]}
                onChange={(e) => updateSettings({ params: { ...settings.params, [key]: Number(e.target.value) } })}
                className="flex-1 accent-[var(--ember)]" />
              <span className="font-mono text-[10.5px] text-[var(--tx2)] w-[48px] text-right">{settings.params[key]}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] w-[92px] flex-none">Seed</span>
            <input className="input !py-1 font-mono !text-[11px]" type="number" value={settings.params.seed}
              onChange={(e) => updateSettings({ params: { ...settings.params, seed: Number(e.target.value) } })} />
            <span className="text-[10px] text-[var(--tx3)]">0 = unset</span>
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>Agents</SectionLabel>
        <div className="flex items-center gap-2 py-1">
          <span className="text-[12px] flex-1">Max iterations per agent</span>
          <input className="input !w-[70px] !py-1 font-mono !text-[11px]" type="number" min={1} max={20} value={settings.maxIterations}
            onChange={(e) => updateSettings({ maxIterations: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
        </div>
        <Toggle value={settings.autoTest} onChange={(v) => updateSettings({ autoTest: v })} label="Auto testing" hint="Tester agent runs validation in every pipeline" />
        <Toggle value={settings.autoReview} onChange={(v) => updateSettings({ autoReview: v })} label="Auto review" hint="Reviewer agent checks pending changes" />
        <Toggle value={settings.parallelAgents} onChange={(v) => updateSettings({ parallelAgents: v })} label="Parallel agents" hint="Reserved for the desktop runtime scheduler" />
      </div>

      <div>
        <SectionLabel>Terminal</SectionLabel>
        <div className="flex items-center gap-2 py-1">
          <span className="text-[12px] flex-1">Default shell</span>
          {(["powershell", "bash", "zsh"] as const).map((sh) => (
            <button key={sh} className="chip cursor-pointer" style={settings.shell === sh ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined}
              onClick={() => updateSettings({ shell: sh })}>{sh}</button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Security</SectionLabel>
        <Toggle value={settings.confirmFileChanges} onChange={(v) => updateSettings({ confirmFileChanges: v })} label="Confirm every AI file change" hint="Extra gate before changes are queued" />
        <Toggle value={settings.confirmAskCommands} onChange={(v) => updateSettings({ confirmAskCommands: v })} label="Confirm ASK-class commands" hint="installs, commits and friends" />
        <p className="text-[10.5px] text-[var(--tx3)] leading-relaxed pt-1">
          File ops are sandboxed to the workspace. Secrets (.env, *.pem, *.key) are masked before entering prompts. Dangerous commands always require explicit confirmation; git push never runs automatically.
        </p>
      </div>

      <div>
        <SectionLabel>Memory ({memory.length})</SectionLabel>
        <Toggle value={settings.memoryEnabled} onChange={(v) => updateSettings({ memoryEnabled: v })} label="Project memory" hint="Store task summaries locally" />
        {memory.length > 0 && (
          <>
            <div className="max-h-[120px] overflow-y-auto scroll-thin space-y-1 mt-1">
              {memory.map((m) => (
                <div key={m.id} className="flex items-start gap-1.5 text-[10.5px] text-[var(--tx2)]">
                  <Clock size={10} className="mt-[2px] flex-none text-[var(--tx3)]" />
                  <span className="flex-1">{m.text}</span>
                </div>
              ))}
            </div>
            <button className="btn !py-1 !text-[11px] mt-1.5" onClick={memoryClear}><Trash2 size={11} /> Clear memory</button>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--tx3)]">
        <Play size={10} /> demo workspace · <Square size={9} /> stop = Esc
      </div>
    </div>
  );
}
