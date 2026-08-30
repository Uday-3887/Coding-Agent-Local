import { useEffect, useMemo, useState } from "react";
import {
  Activity, Bot, Check, ChevronRight, Copy, Cpu, ExternalLink, Eye, EyeOff, FilePlus2, FolderPlus, FolderTree,
  GitBranch, History, ListChecks, MoreHorizontal, Pencil, Play, RefreshCw, RotateCcw, Scissors, Search,
  Server, Settings as SettingsIcon, Square, Trash2, Undo2, Wand2, X, Zap,
} from "lucide-react";
import { analyzeProject, buildProject, openPreview, runProject, runTestSuite, stopEverything, testProject } from "../agents/engine";
import { buildIndex } from "../lib/indexer";
import { timeAgo, AGENT_META, AgentStatusIcon, Chevron, ContextMenu, FileGlyph, SectionLabel, Spinner, type CtxItem } from "./ui";
import { getMergedFiles, useStore, type SidebarView } from "../state/store";

const VIEWS: { id: SidebarView; icon: typeof Search; label: string }[] = [
  { id: "explorer", icon: FolderTree, label: "Explorer" },
  { id: "search", icon: Search, label: "Search" },
  { id: "agents", icon: Bot, label: "Agents" },
  { id: "tasks", icon: ListChecks, label: "Tasks" },
  { id: "git", icon: GitBranch, label: "Source Control" },
  { id: "rundev", icon: Play, label: "Run & Debug" },
  { id: "settings", icon: SettingsIcon, label: "Settings" },
];

export default function Sidebar() {
  const view = useStore((s) => s.sidebarView);
  const setView = useStore((s) => s.setSidebarView);
  const pendingCount = useStore((s) => s.pending.length);
  const problems = useStore((s) => s.problems);
  const services = useStore((s) => s.services);
  const errCount = problems.filter((p) => p.severity === "error").length;
  const runningSvc = services.filter((s) => s.status === "running").length;

  return (
    <div className="flex h-full bg-[var(--bg1)] border-r border-[var(--line)]">
      <nav className="w-[44px] flex-none flex flex-col items-center py-2 gap-1 border-r border-[var(--line)]">
        {VIEWS.map((v) => {
          const active = view === v.id;
          const badge = v.id === "git" ? pendingCount : v.id === "rundev" ? runningSvc : 0;
          return (
            <button
              key={v.id}
              title={v.label}
              onClick={() => setView(active ? null : v.id)}
              className="relative w-[34px] h-[34px] rounded-lg flex items-center justify-center transition-all"
              style={active ? { background: "var(--ember-soft)", color: "var(--ember)", boxShadow: "inset 0 0 0 1px var(--ember)" } : { color: "var(--tx3)" }}
            >
              <v.icon size={16} />
              {badge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full text-[8.5px] font-bold flex items-center justify-center"
                  style={{ background: v.id === "git" ? "var(--warn)" : "var(--ok)", color: "#10130b" }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="w-[34px] h-[34px] rounded-lg flex items-center justify-center" title={`${errCount} errors · ${problems.length - errCount} warnings`}>
          <Activity size={15} style={{ color: errCount ? "var(--danger)" : "var(--tx3)" }} />
        </div>
      </nav>
      <div className="flex-1 min-w-0 flex flex-col">
        {view === "explorer" && <ExplorerView />}
        {view === "search" && <SearchView />}
        {view === "agents" && <AgentsView />}
        {view === "tasks" && <TasksView />}
        {view === "git" && <GitView />}
        {view === "rundev" && <RunView />}
        {view === "settings" && <SettingsView />}
        {!view && <div className="p-4 text-[12px] text-[var(--tx3)]">Select a panel.</div>}
      </div>
    </div>
  );
}

/* ─────────────── Explorer with context menu ─────────────── */

interface MenuState { x: number; y: number; path: string; isDir: boolean; }

function ExplorerView() {
  const workspace = useStore((s) => s.workspace);
  const tree = useStore((s) => s.tree);
  const dirty = useStore((s) => s.dirty);
  const pending = useStore((s) => s.pending);
  const openFile = useStore((s) => s.openFile);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newPath, setNewPath] = useState("");
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [clipboard, setClipboard] = useState<{ path: string; mode: "copy" | "cut" } | null>(null);

  const wsLabel = workspace?.label;
  useEffect(() => {
    const t = useStore.getState().tree;
    setExpanded(new Set(t.filter((n) => n.type === "dir" && n.path.split("/").length <= 2).map((n) => n.path)));
  }, [wsLabel]);

  const modified = useMemo(() => new Set(pending.map((c) => c.path)), [pending]);

  if (!workspace) {
    return <EmptyHint text="No project open." />;
  }

  const toggle = (p: string) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(p)) n.delete(p); else n.add(p);
    return n;
  });

  const submitCreate = () => {
    const p = newPath.trim().replace(/^\/+/, "");
    if (!p) { setCreating(null); return; }
    if (creating === "folder") void useStore.getState().createFolder(p);
    else void useStore.getState().createFile(p, "");
    setCreating(null); setNewPath("");
    const dir = p.includes("/") ? p.split("/").slice(0, -1).join("/") : "";
    if (dir) setExpanded((prev) => new Set([...prev, dir]));
  };

  const menuItems = (path: string, isDir: boolean): CtxItem[] => {
    const st = useStore.getState();
    const items: CtxItem[] = [
      { label: "New File…", icon: <FilePlus2 size={12} />, onClick: () => { setCreating("file"); setNewPath(isDir ? path + "/" : path.includes("/") ? path.split("/").slice(0, -1).join("/") + "/" : ""); } },
      { label: "New Folder…", icon: <FolderPlus size={12} />, onClick: () => { setCreating("folder"); setNewPath(isDir ? path + "/" : ""); } },
      { label: "Rename…", icon: <Pencil size={12} />, onClick: () => setRenaming({ path, value: path.split("/").pop() ?? path }) },
      { label: "Duplicate", icon: <Copy size={12} />, disabled: isDir, onClick: () => void st.duplicatePath(path) },
      { label: clipboard ? `Paste here` : "Copy", icon: clipboard ? <Scissors size={12} /> : <Copy size={12} />, onClick: () => {
        if (clipboard) {
          const base = clipboard.path.split("/").pop()!;
          const target = (isDir ? path : path.split("/").slice(0, -1).join("/")) + "/" + base;
          const content = getMergedFiles(useStore.getState())[clipboard.path] ?? "";
          void st.createFile(target, content).then(() => { if (clipboard.mode === "cut") void st.deletePath(clipboard.path); });
          setClipboard(null);
        } else setClipboard({ path, mode: "copy" });
      } },
      { label: "Cut", icon: <Scissors size={12} />, onClick: () => setClipboard({ path, mode: "cut" }) },
      { label: "Reveal in file explorer", icon: <ExternalLink size={12} />, onClick: () => st.toast("info", "Desktop runtime", "System reveal needs the Electron build — the folder handle lives there.") },
      { label: "Delete", icon: <Trash2 size={12} />, danger: true, onClick: () => void st.deletePath(path) },
    ];
    return items;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 h-[34px] flex-none border-b border-[var(--line)]">
        <span className="font-display font-semibold text-[12px] uppercase tracking-[0.14em] truncate">{workspace.label}</span>
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)] hover:text-[var(--tx)]" title="New file" onClick={() => { setCreating("file"); setNewPath(""); }}><FilePlus2 size={13} /></button>
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)] hover:text-[var(--tx)]" title="New folder" onClick={() => { setCreating("folder"); setNewPath(""); }}><FolderPlus size={13} /></button>
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)] hover:text-[var(--tx)]" title="Refresh" onClick={() => useStore.getState().buildTree()}><RefreshCw size={12} /></button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        {creating && (
          <div className="flex items-center gap-1 px-2 py-0.5">
            <input autoFocus className="input !py-[3px] !text-[11.5px] font-mono" placeholder={creating === "file" ? "path/file.ts" : "folder/name"} value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setCreating(null); }}
              onBlur={submitCreate}
            />
          </div>
        )}
        {tree.map((node) => {
          const isExp = expanded.has(node.path);
          const isRenaming = renaming?.path === node.path;
          return (
            <div key={node.path}>
              <div
                className="tree-row flex items-center gap-1.5 px-2 py-[3.5px] cursor-pointer select-none"
                style={{ paddingLeft: 8 + node.depth * 12 }}
                onClick={() => (node.type === "dir" ? toggle(node.path) : openFile(node.path))}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, path: node.path, isDir: node.type === "dir" }); }}
              >
                {node.type === "dir" ? <Chevron open={isExp} /> : <span className="w-3" />}
                {node.type === "dir" ? <FolderPlus size={13} style={{ color: "var(--warn)" }} className="flex-none" /> : <FileGlyph path={node.path} size={13} />}
                {isRenaming ? (
                  <input autoFocus className="input !py-0 !px-1 !text-[11.5px]" value={renaming.value}
                    onChange={(e) => setRenaming({ path: node.path, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const parent = node.path.includes("/") ? node.path.split("/").slice(0, -1).join("/") + "/" : "";
                        void useStore.getState().renamePath(node.path, parent + renaming.value);
                        setRenaming(null);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate text-[12.5px]" style={{ color: dirty[node.path] !== undefined ? "var(--ember)" : undefined }}>
                    {node.path.split("/").pop()}
                  </span>
                )}
                {modified.has(node.path) && <span className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: "var(--warn)" }} title="modified" />}
              </div>
            </div>
          );
        })}
      </div>
      {clipboard && (
        <div className="px-3 py-1.5 border-t border-[var(--line)] text-[10.5px] text-[var(--tx3)] flex items-center gap-1.5">
          <Scissors size={10} /> clipboard: {clipboard.path} ({clipboard.mode})
          <button className="ml-auto hover:text-[var(--tx)]" onClick={() => setClipboard(null)}><X size={10} /></button>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.path, menu.isDir)} onClose={() => setMenu(null)} />}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="p-4 text-[12px] text-[var(--tx3)]">{text}</div>;
}

/* ─────────────── Search ─────────────── */

function SearchView() {
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [cs, setCs] = useState(false);
  const openFile = useStore((s) => s.openFile);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const files = getMergedFiles(useStore.getState());
    const out: { file: string; line: number; text: string }[] = [];
    let re: RegExp | null = null;
    if (regex) { try { re = new RegExp(q, cs ? "g" : "gi"); } catch { return []; } }
    for (const [path, src] of Object.entries(files)) {
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const hay = cs ? lines[i] : lines[i].toLowerCase();
        const needle = cs ? q : q.toLowerCase();
        const hit = re ? re.test(lines[i]) : hay.includes(needle);
        if (re) re.lastIndex = 0;
        if (hit) { out.push({ file: path, line: i + 1, text: lines[i].trim().slice(0, 110) }); if (out.length >= 300) return out; }
      }
    }
    return out;
  }, [q, regex, cs]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2.5 space-y-1.5 border-b border-[var(--line)]">
        <input className="input font-mono !text-[12px]" placeholder="Search workspace…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="flex gap-1.5">
          <button className="chip cursor-pointer" style={regex ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined} onClick={() => setRegex(!regex)}>.*</button>
          <button className="chip cursor-pointer" style={cs ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined} onClick={() => setCs(!cs)}>Aa</button>
          <span className="text-[10.5px] text-[var(--tx3)] self-center ml-auto">{results.length} hits</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        {results.map((r, i) => (
          <button key={i} className="w-full text-left px-2.5 py-[5px] hover:bg-[var(--bg3)] transition-colors" onClick={() => openFile(r.file)}>
            <div className="flex items-center gap-1.5 text-[11px]"><FileGlyph path={r.file} size={11} /><span className="font-mono truncate">{r.file}</span><span className="text-[var(--tx3)]">:{r.line}</span></div>
            <div className="font-mono text-[10.5px] text-[var(--tx2)] truncate pl-4">{r.text}</div>
          </button>
        ))}
        {q && results.length === 0 && <p className="p-3 text-[11.5px] text-[var(--tx3)]">No matches.</p>}
      </div>
    </div>
  );
}

/* ─────────────── Agents ─────────────── */

function AgentsView() {
  const agents = useStore((s) => s.agents);
  const [sel, setSel] = useState<string | null>(null);
  const roles = Object.keys(agents) as (keyof typeof agents)[];
  const selected = sel ? agents[sel as keyof typeof agents] : null;

  if (selected) {
    const meta = AGENT_META[selected.role];
    return (
      <div className="flex flex-col h-full anim-fade">
        <div className="flex items-center gap-2 px-3 h-[34px] border-b border-[var(--line)] flex-none">
          <button className="btn btn-ghost !px-1.5" onClick={() => setSel(null)}><ChevronRight size={13} style={{ transform: "rotate(180deg)" }} /></button>
          <meta.icon size={14} style={{ color: meta.color }} />
          <span className="font-display font-semibold text-[12.5px]">{meta.label}</span>
          <AgentStatusIcon status={selected.status} />
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3 text-[12px]">
          <div>
            <SectionLabel>current note</SectionLabel>
            <p className="text-[var(--tx2)] leading-relaxed">{selected.note || "—"}</p>
          </div>
          {selected.errors.length > 0 && (
            <div>
              <SectionLabel>errors</SectionLabel>
              {selected.errors.map((e, i) => <p key={i} className="text-[11px] font-mono" style={{ color: "var(--danger)" }}>{e}</p>)}
            </div>
          )}
          <div>
            <SectionLabel>files touched ({selected.filesTouched.length})</SectionLabel>
            {selected.filesTouched.map((f) => <div key={f} className="font-mono text-[11px] text-[var(--tx2)] truncate">{f}</div>)}
            {selected.filesTouched.length === 0 && <span className="text-[var(--tx3)]">none</span>}
          </div>
          <div>
            <SectionLabel>tool calls ({selected.toolCalls.length})</SectionLabel>
            {selected.toolCalls.slice(-12).reverse().map((t) => (
              <div key={t.id} className="raised rounded-md p-2 mb-1.5">
                <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
                  {t.ok ? <Check size={10} style={{ color: "var(--ok)" }} /> : <X size={10} style={{ color: "var(--danger)" }} />}
                  <span style={{ color: "var(--ember)" }}>{t.tool}</span>
                  <span className="text-[var(--tx3)] truncate">{JSON.stringify(t.args).slice(0, 60)}</span>
                </div>
                <div className="font-mono text-[10px] text-[var(--tx3)] truncate mt-0.5">{t.result}</div>
              </div>
            ))}
            {selected.toolCalls.length === 0 && <span className="text-[var(--tx3)]">none yet</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 h-[34px] border-b border-[var(--line)] flex-none">
        <span className="font-display font-semibold text-[12px] uppercase tracking-[0.14em]">Agent crew</span>
        <span className="chip !py-0 ml-auto">{roles.length} roles</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-2 grid grid-cols-2 gap-1.5 content-start">
        {roles.map((r) => {
          const a = agents[r];
          const meta = AGENT_META[r];
          return (
            <button key={r} className="raised rounded-lg p-2 text-left hover:border-[var(--line2)] transition-all group" onClick={() => setSel(r)}>
              <div className="flex items-center gap-1.5">
                <meta.icon size={13} style={{ color: meta.color }} />
                <span className="text-[11.5px] font-semibold truncate">{meta.label}</span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-[10px] text-[var(--tx3)]">
                <AgentStatusIcon status={a.status} size={10} />
                <span className="truncate">{a.status === "idle" ? "waiting" : a.note.slice(0, 26) || a.status}</span>
              </div>
            </button>
          );
        })}
      </div>
      <p className="px-3 py-2 border-t border-[var(--line)] text-[10px] text-[var(--tx3)] leading-relaxed">
        The Orchestrator picks only the agents a task needs — never the whole crew.
      </p>
    </div>
  );
}

/* ─────────────── Tasks (queue-aware) ─────────────── */

function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const running = tasks.filter((t) => t.status === "running");
  const queued = tasks.filter((t) => t.status === "queued").sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));
  const done = tasks.filter((t) => ["done", "failed", "blocked", "cancelled"].includes(t.status)).slice(-14).reverse();
  const [sel, setSel] = useState<string | null>(null);
  const active = tasks.find((t) => t.id === sel);

  if (active) {
    return (
      <div className="flex flex-col h-full anim-fade">
        <div className="flex items-center gap-2 px-3 h-[34px] border-b border-[var(--line)] flex-none">
          <button className="btn btn-ghost !px-1.5" onClick={() => setSel(null)}><ChevronRight size={13} style={{ transform: "rotate(180deg)" }} /></button>
          <span className="font-mono text-[11px] text-[var(--tx3)]">{active.id}</span>
          <span className="chip !py-0 uppercase" style={{ color: active.status === "done" ? "var(--ok)" : active.status === "running" ? "var(--ember)" : "var(--warn)" }}>{active.status}</span>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3">
          <p className="text-[12.5px] font-medium">{active.prompt}</p>
          {active.summary && <p className="text-[11.5px] text-[var(--tx2)] raised rounded-md p-2">{active.summary}</p>}
          <div>
            <SectionLabel>steps</SectionLabel>
            {active.steps.map((s) => (
              <div key={s.id} className="flex items-center gap-2 py-[3px] text-[11.5px]">
                {s.status === "done" ? <Check size={11} style={{ color: "var(--ok)" }} /> : s.status === "running" ? <Spinner size={11} /> : s.status === "failed" ? <X size={11} style={{ color: "var(--danger)" }} /> : <span className="w-[11px] h-[11px] rounded-full border border-[var(--line2)]" />}
                <span style={{ color: s.status === "pending" ? "var(--tx3)" : undefined }}>{s.label}</span>
              </div>
            ))}
          </div>
          {active.todos.length > 0 && (
            <div>
              <SectionLabel>agent todos</SectionLabel>
              {active.todos.map((t, i) => (
                <div key={i} className="font-mono text-[10.5px] py-[2px]" style={{ color: t.status === "done" ? "var(--ok)" : t.status === "running" ? "var(--ember)" : "var(--tx3)" }}>
                  [{t.status}] {t.text}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn !py-1 !text-[11px]" onClick={() => void useStore.getState().undoTaskChanges(active.id)}><Undo2 size={11} /> Undo changes</button>
          </div>
        </div>
      </div>
    );
  }

  const Row = ({ t, queuePos }: { t: (typeof tasks)[number]; queuePos?: number }) => (
    <button className="w-full raised rounded-lg p-2 mb-1.5 text-left hover:border-[var(--line2)] transition-all" onClick={() => setSel(t.id)}>
      <div className="flex items-center gap-1.5">
        {t.status === "running" ? <Spinner size={11} /> : t.status === "queued" ? <History size={11} className="text-[var(--tx3)]" /> : t.status === "done" ? <Check size={11} style={{ color: "var(--ok)" }} /> : <X size={11} style={{ color: t.status === "cancelled" ? "var(--tx3)" : "var(--danger)" }} />}
        <span className="text-[11.5px] font-medium truncate flex-1">{t.title}</span>
        {queuePos !== undefined && <span className="chip !py-0 !text-[9px]">#{queuePos}</span>}
      </div>
      <div className="text-[10px] text-[var(--tx3)] mt-0.5">{timeAgo(t.createdAt)} · {t.steps.filter((s) => s.status === "done").length}/{t.steps.length || "—"} steps</div>
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 h-[34px] border-b border-[var(--line)] flex-none">
        <span className="font-display font-semibold text-[12px] uppercase tracking-[0.14em]">Task queue</span>
        <span className="chip !py-0 ml-auto">{running.length} running</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-2.5">
        {running.length > 0 && <SectionLabel>running</SectionLabel>}
        {running.map((t) => <Row key={t.id} t={t} />)}
        {queued.length > 0 && <SectionLabel>queued</SectionLabel>}
        {queued.map((t, i) => <Row key={t.id} t={t} queuePos={i + 1} />)}
        {done.length > 0 && <SectionLabel>history</SectionLabel>}
        {done.map((t) => <Row key={t.id} t={t} />)}
        {tasks.length === 0 && <p className="text-[11.5px] text-[var(--tx3)] p-2">No tasks yet — send work from the Agent panel.</p>}
      </div>
    </div>
  );
}

/* ─────────────── Source Control ─────────────── */

function GitView() {
  const pending = useStore((s) => s.pending);
  const checkpoints = useStore((s) => s.checkpoints);
  const openSpecialTab = useStore((s) => s.openSpecialTab);
  const acceptChange = useStore((s) => s.acceptChange);
  const rejectChange = useStore((s) => s.rejectChange);
  const acceptAll = useStore((s) => s.acceptAll);
  const rejectAll = useStore((s) => s.rejectAll);
  const restoreCheckpoint = useStore((s) => s.restoreCheckpoint);
  const deleteCheckpoint = useStore((s) => s.deleteCheckpoint);
  const [msg, setMsg] = useState("");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 h-[34px] border-b border-[var(--line)] flex-none">
        <span className="font-display font-semibold text-[12px] uppercase tracking-[0.14em]">Source control</span>
        <span className="chip !py-0 ml-auto"><GitBranch size={10} /> main</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-2.5 space-y-3">
        <div>
          <SectionLabel>changes ({pending.length})</SectionLabel>
          {pending.length === 0 && <p className="text-[11px] text-[var(--tx3)]">Working tree clean. Agent edits land here as reviewable diffs.</p>}
          {pending.map((c) => (
            <div key={c.id} className="raised rounded-md p-1.5 mb-1.5 group">
              <button className="w-full flex items-center gap-1.5 text-left" onClick={() => openSpecialTab({ id: `diff-${c.id}`, kind: "diff", title: c.path.split("/").pop()!, changeId: c.id })}>
                <FileGlyph path={c.path} size={12} />
                <span className="font-mono text-[11px] truncate flex-1">{c.path}</span>
                <span className="chip !py-0 !text-[9px] uppercase" style={{ color: c.type === "create" ? "var(--ok)" : c.type === "delete" ? "var(--danger)" : "var(--warn)" }}>{c.type}</span>
              </button>
              <div className="flex gap-1 mt-1">
                <button className="btn btn-ok !py-0 !px-1.5 !text-[10px]" onClick={() => void acceptChange(c.id)}><Check size={9} /> Accept</button>
                <button className="btn btn-danger !py-0 !px-1.5 !text-[10px]" onClick={() => rejectChange(c.id)}><X size={9} /> Reject</button>
              </div>
            </div>
          ))}
          {pending.length > 1 && (
            <div className="flex gap-1.5">
              <button className="btn btn-ok !py-0.5 !text-[10.5px] flex-1 justify-center" onClick={() => void acceptAll()}><Check size={10} /> Accept all</button>
              <button className="btn btn-danger !py-0.5 !text-[10.5px] flex-1 justify-center" onClick={() => rejectAll()}><X size={10} /> Reject all</button>
            </div>
          )}
        </div>
        <div>
          <SectionLabel>commit</SectionLabel>
          <input className="input !text-[11.5px] mb-1.5" placeholder="Commit message…" value={msg} onChange={(e) => setMsg(e.target.value)} />
          <button className="btn w-full justify-center !py-1 !text-[11.5px]" disabled={!msg.trim() || pending.length === 0}
            onClick={() => {
              useStore.getState().addCheckpoint({ id: `commit-${Date.now().toString(36)}`, label: `Commit: ${msg.slice(0, 40)}`, at: Date.now(), files: { ...getMergedFiles(useStore.getState()) } });
              void acceptAll();
              setMsg("");
              useStore.getState().toast("success", "Committed to local snapshot", "git push is never run automatically.");
            }}>
            <Check size={11} /> Commit snapshot
          </button>
          <p className="text-[9.5px] text-[var(--tx3)] mt-1">Local snapshot commit — real git plumbing runs in the desktop runtime.</p>
        </div>
        <div>
          <SectionLabel>checkpoints ({checkpoints.length})</SectionLabel>
          {checkpoints.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 py-[3px] group">
              <History size={11} className="text-[var(--tx3)] flex-none" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] truncate">{c.label}</div>
                <div className="text-[9.5px] text-[var(--tx3)]">{timeAgo(c.at)} · {Object.keys(c.files).length} files</div>
              </div>
              <button className="btn !py-0 !px-1.5 !text-[10px] opacity-0 group-hover:opacity-100" onClick={() => void restoreCheckpoint(c.id)}><RotateCcw size={9} /> Restore</button>
              <button className="p-0.5 text-[var(--tx3)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100" onClick={() => deleteCheckpoint(c.id)}><Trash2 size={10} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Run & Debug ─────────────── */

function RunView() {
  const adapter = useStore((s) => s.adapter);
  const services = useStore((s) => s.services);
  const setService = useStore((s) => s.setService);
  const workspace = useStore((s) => s.workspace);

  if (!workspace) return <EmptyHint text="Open a project to see its run configuration." />;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 h-[34px] border-b border-[var(--line)] flex-none">
        <span className="font-display font-semibold text-[12px] uppercase tracking-[0.14em]">Run & Debug</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-2.5 space-y-3">
        <div className="flex gap-1.5">
          <button className="btn btn-primary flex-1 justify-center !py-1.5" onClick={runProject}><Play size={12} /> Run</button>
          <button className="btn flex-1 justify-center !py-1.5" onClick={() => void testProject()}><Zap size={12} /> Test</button>
          <button className="btn flex-1 justify-center !py-1.5" onClick={() => void buildProject()}><Square size={11} /> Build</button>
        </div>
        <button className="btn btn-danger w-full justify-center !py-1" onClick={stopEverything}><Square size={10} fill="currentColor" /> Stop everything</button>

        {adapter && (
          <div className="raised rounded-lg p-2.5">
            <SectionLabel>detected project</SectionLabel>
            <div className="space-y-[5px] text-[11px]">
              <KV k="Adapter" v={adapter.name} />
              <KV k="Framework" v={adapter.framework} />
              <KV k="Language" v={adapter.language} />
              <KV k="Package mgr" v={adapter.packageManager} />
              <KV k="Build system" v={adapter.buildSystem} />
              <KV k="Tests" v={adapter.testFramework} />
              <KV k="Entry" v={adapter.entryFile ?? "—"} mono />
              <KV k="Run" v={adapter.runCommand ?? "—"} mono />
              <KV k="Build" v={adapter.buildCommand ?? "—"} mono />
              <KV k="Test cmd" v={adapter.testCommand ?? "—"} mono />
              <KV k="Lint" v={adapter.lintCommand ?? "—"} mono />
              <KV k="Preview" v={adapter.previewKind} />
              <KV k="Default port" v={adapter.defaultPort ? String(adapter.defaultPort) : "—"} />
              <KV k="Debug" v={adapter.debugConfigured ? "configured (desktop DAP)" : "logs + AI debugging"} />
            </div>
            <div className="flex gap-1.5 mt-2">
              <button className="btn !py-0.5 !text-[10.5px] flex-1 justify-center" onClick={() => void openPreview()}><Eye size={10} /> Preview</button>
              <button className="btn !py-0.5 !text-[10.5px] flex-1 justify-center" onClick={analyzeProject}><Activity size={10} /> Analyze</button>
              <button className="btn !py-0.5 !text-[10.5px] flex-1 justify-center" onClick={() => void runTestSuite("all")}><Zap size={10} /> Test all</button>
            </div>
          </div>
        )}

        <div>
          <SectionLabel>services ({services.length})</SectionLabel>
          {services.length === 0 && <p className="text-[11px] text-[var(--tx3)]">No services yet — Run starts them.</p>}
          {services.map((svc) => (
            <div key={svc.id} className="raised rounded-lg p-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className={`led ${svc.status === "running" ? "led-ok led-pulse" : svc.status === "crashed" ? "led-danger" : svc.status === "requires-desktop" ? "led-warn" : "led-off"}`} />
                <Server size={11} className="text-[var(--tx3)]" />
                <span className="text-[11.5px] font-medium truncate flex-1">{svc.name}</span>
                <span className="chip !py-0 !text-[9px] uppercase">{svc.status}</span>
              </div>
              <div className="font-mono text-[10px] text-[var(--tx3)] truncate mt-0.5">{svc.command}{svc.port ? ` · :${svc.port}` : ""}</div>
              <div className="flex gap-1 mt-1.5">
                {(svc.kind === "esbuild" || svc.kind === "static" || svc.kind === "console") && (
                  <button className="btn !py-0 !px-1.5 !text-[10px]" onClick={() => void openPreview()}><Eye size={9} /> Preview</button>
                )}
                <button className="btn !py-0 !px-1.5 !text-[10px]" onClick={() => setService({ ...svc, status: "stopped" })}><Square size={9} /> Stop</button>
                <button className="btn !py-0 !px-1.5 !text-[10px]" onClick={() => void runProject()}><RefreshCw size={9} /> Restart</button>
                <button className="btn !py-0 !px-1.5 !text-[10px]" onClick={() => { useStore.getState().setBottomView("output"); svc.logs.forEach((l) => useStore.getState().pushOutput(l.kind, `[${svc.name}] ${l.text}`)); }}>Logs</button>
              </div>
            </div>
          ))}
        </div>

        <RunConfigEditor />
      </div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--tx3)] w-[76px] flex-none">{k}</span>
      <span className={`truncate ${mono ? "font-mono text-[10px]" : ""}`} title={v}>{v}</span>
    </div>
  );
}

function RunConfigEditor() {
  const workspace = useStore((s) => s.workspace);
  const [text, setText] = useState<string | null>(null);
  const path = ".localforge/run.json";
  const current = text ?? (workspace ? getMergedFiles(useStore.getState())[path] ?? "" : "");
  return (
    <div>
      <SectionLabel>run configuration · {path}</SectionLabel>
      <textarea
        className="input font-mono !text-[10.5px] leading-relaxed"
        rows={6}
        placeholder={`{\n  "services": [\n    { "name": "Frontend", "cwd": "frontend", "command": "npm run dev" },\n    { "name": "Backend", "cwd": "backend", "command": "python main.py" }\n  ]\n}`}
        value={current}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn !py-0.5 !text-[10.5px] mt-1.5" disabled={text === null}
        onClick={() => { if (text !== null) { void useStore.getState().createFile(path, text); setText(null); useStore.getState().toast("success", "Run config saved", path); } }}>
        <Check size={10} /> Save config
      </button>
      <p className="text-[9.5px] text-[var(--tx3)] mt-1">Multi-service projects (frontend + backend) are honored by the desktop process manager.</p>
    </div>
  );
}

/* ─────────────── Settings ─────────────── */

function SettingsView() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const ollama = useStore((s) => s.ollama);
  const autonomy = useStore((s) => s.autonomy);
  const setAutonomy = useStore((s) => s.setAutonomy);
  const memory = useStore((s) => s.memory);
  const resources = useStore((s) => s.resources);
  const connectOllama = useStore((s) => s.connectOllama);
  const refreshModels = useStore((s) => s.refreshModels);
  const [pullName, setPullName] = useState("");

  const AUTONOMY: { id: typeof autonomy; label: string; desc: string }[] = [
    { id: "ask", label: "Ask for everything", desc: "Every file edit and command needs approval." },
    { id: "normal", label: "Normal", desc: "Safe edits allowed; installs & dangerous commands ask." },
    { id: "auto", label: "Auto", desc: "Edits, builds and tests run freely; dangerous ops still gated." },
    { id: "plan", label: "Plan only", desc: "Agents analyze and plan — no edits or terminal changes." },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 h-[34px] border-b border-[var(--line)] flex-none">
        <span className="font-display font-semibold text-[12px] uppercase tracking-[0.14em]">Settings</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-4">
        <div>
          <SectionLabel>agent autonomy</SectionLabel>
          <div className="space-y-1.5">
            {AUTONOMY.map((a) => (
              <button key={a.id} className="w-full raised rounded-lg p-2 text-left transition-all"
                style={autonomy === a.id ? { borderColor: "var(--ember)", boxShadow: "0 0 0 1px var(--ember)" } : undefined}
                onClick={() => setAutonomy(a.id)}>
                <div className="flex items-center gap-2 text-[12px] font-semibold">
                  {autonomy === a.id && <span className="led led-ok" style={{ width: 6, height: 6 }} />}
                  {a.label}
                </div>
                <div className="text-[10.5px] text-[var(--tx3)] mt-0.5">{a.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>ollama · {ollama.status}</SectionLabel>
          <input className="input font-mono !text-[11.5px] mb-1.5" value={settings.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} />
          <div className="flex gap-1.5">
            <button className="btn !py-1 !text-[11px] flex-1 justify-center" onClick={() => void connectOllama()}>Connect</button>
            <button className="btn !py-1 !text-[11px] flex-1 justify-center" onClick={() => void refreshModels()}>Refresh models</button>
          </div>
          <div className="flex gap-1.5 mt-1.5">
            <input className="input font-mono !text-[11px]" placeholder="pull e.g. qwen2.5-coder:7b" value={pullName} onChange={(e) => setPullName(e.target.value)} />
            <button className="btn !py-1 !text-[11px]" disabled={!pullName.trim()} onClick={() => { void useStore.getState().pullModel(pullName.trim()); setPullName(""); }}>Pull</button>
          </div>
          {ollama.pullState && (
            <div className="mt-1.5 text-[10.5px] text-[var(--tx2)]">
              <div className="flex justify-between"><span>{ollama.pullState.status}</span><span>{ollama.pullState.pct !== undefined ? `${ollama.pullState.pct}%` : ""}</span></div>
              <div className="h-[4px] rounded bg-[var(--bg3)] overflow-hidden mt-1">
                <div className="h-full rounded transition-all" style={{ width: `${ollama.pullState.pct ?? 4}%`, background: "var(--ember)" }} />
              </div>
            </div>
          )}
          <div className="mt-2 space-y-1">
            {ollama.models.map((m) => (
              <div key={m} className="flex items-center gap-2 text-[11px] font-mono">
                <span className="truncate flex-1">{m}</span>
                <button className="p-0.5 text-[var(--tx3)] hover:text-[var(--danger)]" title="Delete model" onClick={() => void useStore.getState().deleteModel(m)}><Trash2 size={10} /></button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>agents</SectionLabel>
          <label className="text-[11px] text-[var(--tx2)]">Max simultaneous agents: <strong style={{ color: "var(--ember)" }}>{settings.maxAgents}</strong></label>
          <input type="range" min={1} max={5} value={settings.maxAgents} className="w-full accent-[var(--ember)]" onChange={(e) => updateSettings({ maxAgents: Number(e.target.value) })} />
          <Toggle label="Parallel agents (file-locked)" value={settings.parallelAgents} onChange={(v) => updateSettings({ parallelAgents: v })} />
          <Toggle label="Single model mode (share one model)" value={settings.singleModelMode} onChange={(v) => updateSettings({ singleModelMode: v })} />
          <Toggle label="Auto review after tasks" value={settings.autoReview} onChange={(v) => updateSettings({ autoReview: v })} />
          <Toggle label="Confirm each file change" value={settings.confirmFileChanges} onChange={(v) => updateSettings({ confirmFileChanges: v })} />
          <label className="text-[11px] text-[var(--tx2)] block mt-1.5">Max iterations per agent: <strong style={{ color: "var(--ember)" }}>{settings.maxIterations}</strong></label>
          <input type="range" min={2} max={20} value={settings.maxIterations} className="w-full accent-[var(--ember)]" onChange={(e) => updateSettings({ maxIterations: Number(e.target.value) })} />
        </div>

        <div>
          <SectionLabel>ai autocomplete</SectionLabel>
          <Toggle label="Enable ghost-text completion (Tab to accept)" value={settings.autocomplete.enabled} onChange={(v) => updateSettings({ autocomplete: { ...settings.autocomplete, enabled: v } })} />
          <label className="text-[11px] text-[var(--tx2)] block mt-1">Delay: {settings.autocomplete.delayMs}ms</label>
          <input type="range" min={150} max={1200} step={50} value={settings.autocomplete.delayMs} className="w-full accent-[var(--ember)]" onChange={(e) => updateSettings({ autocomplete: { ...settings.autocomplete, delayMs: Number(e.target.value) } })} />
          <p className="text-[9.5px] text-[var(--tx3)] mt-1">Uses the autocomplete model via Ollama — off by default to save RAM/GPU on weaker laptops.</p>
        </div>

        <div>
          <SectionLabel>appearance & editor</SectionLabel>
          <div className="flex gap-1.5">
            {(["dark", "light", "system"] as const).map((t) => (
              <button key={t} className="chip cursor-pointer capitalize flex-1 justify-center !py-1" style={settings.theme === t ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined} onClick={() => updateSettings({ theme: t })}>{t}</button>
            ))}
          </div>
          <Toggle label="Auto-save on change" value={settings.autoSave} onChange={(v) => updateSettings({ autoSave: v })} />
        </div>

        <div>
          <SectionLabel>project memory ({memory.length})</SectionLabel>
          <Toggle label="Remember decisions per project" value={settings.memoryEnabled} onChange={(v) => updateSettings({ memoryEnabled: v })} />
          <div className="max-h-[90px] overflow-y-auto scroll-thin space-y-1 mt-1">
            {memory.map((m) => <div key={m.id} className="text-[10.5px] text-[var(--tx3)] raised rounded px-2 py-1 truncate" title={m.text}>{m.text}</div>)}
          </div>
          {memory.length > 0 && (
            <button className="btn btn-danger !py-0.5 !text-[10.5px] mt-1.5" onClick={() => { void import("../lib/db").then(({ dbClear }) => dbClear("project_memory")); useStore.setState({ memory: [] }); }}>
              <Trash2 size={10} /> Clear memory
            </button>
          )}
        </div>

        <div>
          <SectionLabel>system resources</SectionLabel>
          <div className="raised rounded-lg p-2 text-[11px] space-y-[4px]">
            <KV k="CPU cores" v={String(resources.cores)} />
            <KV k="JS heap" v={resources.heapMB ? `${resources.heapMB} MB / ${resources.heapLimitMB} MB limit` : "not exposed by browser"} />
            <KV k="GPU" v="not observable from web runtime" />
            <KV k="Running models" v={ollama.status === "connected" ? `${ollama.models.length} pulled locally` : "none connected"} />
          </div>
          <button className="btn !py-0.5 !text-[10.5px] mt-1.5" onClick={() => useStore.getState().refreshResources()}><Cpu size={10} /> Refresh</button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="w-full flex items-center justify-between py-[6px] text-[11.5px] text-[var(--tx2)]" onClick={() => onChange(!value)}>
      {label}
      <span className="w-[30px] h-[16px] rounded-full relative transition-colors flex-none" style={{ background: value ? "var(--ember)" : "var(--bg4)" }}>
        <span className="absolute top-[2px] w-[12px] h-[12px] rounded-full bg-white transition-all" style={{ left: value ? 16 : 2 }} />
      </span>
    </button>
  );
}
