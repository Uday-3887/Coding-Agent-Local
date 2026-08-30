import { useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import { Activity, Check, Compass, FileCode2, FolderOpen, Play, WifiOff, X, Zap } from "lucide-react";
import { APP_NAME, APP_TAGLINE, APP_VERSION, WELCOME_TITLE } from "../config/app";
import { diffLines, diffStats } from "../lib/diff";
import { detectLanguage } from "../lib/fs";
import { useResolvedTheme, useStore } from "../state/store";
import { PlanCard } from "./AIPanel";
import { FileGlyph, Kbd, LogoMark, Markdown, SectionLabel } from "./ui";

const darkTheme = createTheme({
  theme: "dark",
  settings: {
    background: "transparent", backgroundImage: "", foreground: "#d9e1ef", caret: "#ff7a45",
    selection: "#2d365088", selectionMatch: "#2d365066", lineHighlight: "#1d233155",
    gutterBackground: "transparent", gutterForeground: "#5b6478", gutterBorder: "transparent",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  },
  styles: [
    { tag: t.keyword, color: "#ff7a45" },
    { tag: [t.string, t.special(t.string)], color: "#3ecf8e" },
    { tag: t.comment, color: "#5b6478", fontStyle: "italic" },
    { tag: [t.number, t.bool, t.null], color: "#e3b341" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#5cb6f5" },
    { tag: [t.typeName, t.className, t.definition(t.variableName)], color: "#e3b341" },
    { tag: [t.tagName, t.attributeName], color: "#ff9a6e" },
    { tag: t.operator, color: "#8d97ac" },
    { tag: t.propertyName, color: "#7cc4f7" },
    { tag: t.regexp, color: "#f4586b" },
  ],
});

const lightTheme = createTheme({
  theme: "light",
  settings: {
    background: "transparent", backgroundImage: "", foreground: "#1b2233", caret: "#e05a20",
    selection: "#e05a2022", selectionMatch: "#e05a2018", lineHighlight: "#e8ebf255",
    gutterBackground: "transparent", gutterForeground: "#97a0b3", gutterBorder: "transparent",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  },
  styles: [
    { tag: t.keyword, color: "#c44a15" },
    { tag: [t.string, t.special(t.string)], color: "#178a5b" },
    { tag: t.comment, color: "#97a0b3", fontStyle: "italic" },
    { tag: [t.number, t.bool, t.null], color: "#96660a" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#0f6fc0" },
    { tag: [t.typeName, t.className], color: "#96660a" },
    { tag: [t.tagName, t.attributeName], color: "#c44a15" },
    { tag: t.operator, color: "#5a6479" },
    { tag: t.propertyName, color: "#0f6fc0" },
  ],
});

function langExtensions(path: string) {
  const lang = detectLanguage(path);
  switch (lang) {
    case "typescript": return [javascript({ typescript: true })];
    case "tsx": return [javascript({ typescript: true, jsx: true })];
    case "javascript": return [javascript()];
    case "jsx": return [javascript({ jsx: true })];
    case "json": return [json()];
    case "markdown": return [markdown()];
    case "html": return [html()];
    case "css": return [css()];
    case "python": return [python()];
    default: return [];
  }
}

export default function EditorArea() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const closeTab = useStore((s) => s.closeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const dirty = useStore((s) => s.dirty);
  const workspace = useStore((s) => s.workspace);

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="flex flex-col h-full min-w-0 bg-[var(--bg0)]">
      <div className="flex items-end h-[34px] flex-none overflow-x-auto scroll-thin bg-[var(--bg1)] border-b border-[var(--line)]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDirty = tab.kind === "file" && tab.path && dirty[tab.path] !== undefined;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 px-3 h-[30px] text-[12px] cursor-pointer border-r border-[var(--line)] flex-none max-w-[190px] bg-[var(--bg1)] text-[var(--tx2)] ${isActive ? "tab-active" : "hover:bg-[var(--bg2)]"}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.kind === "file" && tab.path && <FileGlyph path={tab.path} size={12} />}
              {tab.kind === "diff" && <FileCode2 size={12} style={{ color: "var(--warn)" }} />}
              {tab.kind === "plan" && <Compass size={12} style={{ color: "var(--info)" }} />}
              {tab.kind === "report" && <Activity size={12} style={{ color: "var(--ok)" }} />}
              <span className="truncate">{tab.title}</span>
              {isDirty && <span className="w-[6px] h-[6px] rounded-full flex-none" style={{ background: "var(--ember)" }} />}
              <button
                className="opacity-0 group-hover:opacity-100 p-[2px] rounded hover:bg-[var(--bg4)] text-[var(--tx3)] hover:text-[var(--tx)] flex-none"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {!active ? (workspace ? <NoTabsState /> : <WelcomeScreen />) : (
          active.kind === "file" && active.path ? <FileEditor path={active.path} />
            : active.kind === "diff" && active.changeId ? <DiffView changeId={active.changeId} />
            : active.kind === "plan" ? <div className="h-full overflow-y-auto scroll-thin p-5"><PlanCard /></div>
            : active.kind === "report" ? <ReportView />
            : null
        )}
      </div>
    </div>
  );
}

/* ─────────────── Welcome / empty states ─────────────── */

function NoTabsState() {
  const setQuickOpen = useStore((s) => s.setQuickOpen);
  return (
    <div className="h-full dotgrid flex flex-col items-center justify-center gap-3 text-center anim-fade">
      <LogoMark size={40} />
      <div className="font-display text-[17px] font-semibold">No open editors</div>
      <p className="text-[12.5px] text-[var(--tx3)] max-w-[340px]">Pick a file from the Explorer, or hit Quick Open and start forging.</p>
      <div className="flex items-center gap-2 text-[12px] text-[var(--tx2)]">
        <Kbd>Ctrl</Kbd><Kbd>P</Kbd> quick open · <Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>P</Kbd> commands
      </div>
      <button className="btn mt-1" onClick={() => setQuickOpen(true)}><FolderOpen size={13} /> Quick open</button>
    </div>
  );
}

function WelcomeScreen() {
  const openLocal = useStore((s) => s.openLocal);
  const openDemo = useStore((s) => s.openDemo);
  const openRecent = useStore((s) => s.openRecent);
  const recents = useStore((s) => s.recents);
  const ollama = useStore((s) => s.ollama);
  const connectOllama = useStore((s) => s.connectOllama);
  const [skip, setSkip] = useState(false);

  if (skip) return <NoProjectConsole />;

  return (
    <div className="h-full overflow-y-auto scroll-thin dotgrid">
      <div className="max-w-[860px] mx-auto px-8 py-12 grid md:grid-cols-[1.1fr_1fr] gap-10 anim-fade-up">
        <div>
          <div className="flex items-center gap-3">
            <LogoMark size={46} />
            <div>
              <h1 className="font-display font-bold text-[34px] leading-none tracking-wide">{WELCOME_TITLE.replace("Welcome to ", "")}</h1>
              <div className="ember-line w-[120px] mt-2" />
            </div>
          </div>
          <p className="font-display text-[13px] tracking-[0.2em] uppercase text-[var(--tx3)] mt-4">{APP_TAGLINE}</p>
          <p className="text-[13.5px] text-[var(--tx2)] leading-relaxed mt-4 max-w-[420px]">
            {WELCOME_TITLE}. Open any project, talk to your code, and let a crew of
            specialist agents — architect, coder, tester, debugger, reviewer — implement,
            validate and review changes <strong className="text-[var(--tx)]">with your approval</strong>.
            Everything stays on this machine; Ollama provides the models.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            <span className="chip">7 specialist agents</span>
            <span className="chip">diff-reviewed edits</span>
            <span className="chip">checkpoints & undo</span>
            <span className="chip">Ollama streaming</span>
            <span className="chip">permission-gated commands</span>
          </div>
          <div className="flex items-center gap-3 mt-8 text-[11.5px] text-[var(--tx3)] flex-wrap">
            <span><Kbd>Ctrl P</Kbd> quick open</span>
            <span><Kbd>Ctrl Shift P</Kbd> palette</span>
            <span><Kbd>Ctrl J</Kbd> terminal</span>
            <span><Kbd>Esc</Kbd> stop</span>
          </div>
        </div>

        <div className="raised rounded-xl p-5 h-fit" style={{ boxShadow: "var(--shadow)" }}>
          <SectionLabel>Start a session</SectionLabel>
          <button className="btn btn-primary w-full justify-center !py-2.5 !text-[13px] mb-2" onClick={() => void openLocal()}>
            <FolderOpen size={15} /> Open Folder
          </button>
          <button className="btn w-full justify-center !py-2 mb-2" onClick={() => void openDemo()}>
            <Play size={14} /> Explore the demo workspace
          </button>
          <button className="btn w-full justify-center !py-2" onClick={() => void connectOllama()}>
            {ollama.status === "connected"
              ? <><span className="led led-ok" /> Ollama connected — {ollama.models.length} model(s)</>
              : <><WifiOff size={14} /> Connect Ollama</>}
          </button>

          {ollama.status !== "connected" && (
            <div className="mt-4 rounded-lg border border-[var(--line2)] bg-[var(--bg0)] p-3 text-[11.5px] leading-relaxed text-[var(--tx2)]">
              <strong className="text-[var(--tx)]">Ollama is not connected.</strong><br />
              1. Install Ollama from ollama.com<br />
              2. Start it — <code>ollama serve</code><br />
              3. Pull a coding model — <code>ollama pull qwen2.5-coder:7b</code><br />
              4. Click <strong>Connect Ollama</strong> above.<br />
              <span className="text-[var(--tx3)]">Meanwhile the built-in heuristic engine keeps every feature working.</span>
            </div>
          )}

          {recents.length > 0 && (
            <div className="mt-4">
              <SectionLabel>Recent projects</SectionLabel>
              {recents.map((r) => (
                <button key={r.label} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md tree-row text-[12.5px] text-left" onClick={() => void openRecent(r.label)}>
                  <span className="led led-off" /> {r.label}
                  <span className="ml-auto text-[10px] text-[var(--tx3)]">{r.source}</span>
                </button>
              ))}
            </div>
          )}
          <button className="mt-4 text-[11px] text-[var(--tx3)] hover:text-[var(--tx2)] underline-offset-2 hover:underline" onClick={() => setSkip(true)}>
            continue without a project →
          </button>
        </div>
      </div>
    </div>
  );
}

function NoProjectConsole() {
  const openLocal = useStore((s) => s.openLocal);
  const openDemo = useStore((s) => s.openDemo);
  const setSidebarView = useStore((s) => s.setSidebarView);
  return (
    <div className="h-full dotgrid flex flex-col items-center justify-center gap-4 anim-fade text-center px-6">
      <LogoMark size={44} />
      <div>
        <div className="font-display text-[20px] font-bold">No project open</div>
        <p className="text-[12.5px] text-[var(--tx3)] mt-1 max-w-[380px]">
          {APP_NAME} v{APP_VERSION} — open a folder or the demo workspace to index files, chat with context and run agents.
        </p>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={() => void openLocal()}><FolderOpen size={13} /> Open Folder</button>
        <button className="btn" onClick={() => void openDemo()}><Play size={13} /> Demo workspace</button>
        <button className="btn" onClick={() => setSidebarView("settings")}><Zap size={13} /> Settings</button>
      </div>
    </div>
  );
}

/* ─────────────── File editor ─────────────── */

function FileEditor({ path }: { path: string }) {
  const workspace = useStore((s) => s.workspace);
  const dirty = useStore((s) => s.dirty);
  const editorChange = useStore((s) => s.editorChange);
  const resolved = useResolvedTheme();
  const value = dirty[path] ?? workspace?.files[path] ?? "";
  const extensions = useMemo(() => langExtensions(path), [path]);

  if (!workspace) return null;
  return (
    <div className="h-full overflow-auto scroll-thin">
      <CodeMirror
        value={value}
        theme={resolved === "dark" ? darkTheme : lightTheme}
        extensions={extensions}
        onChange={(v, vu) => {
          editorChange(path, v);
          if (vu) {
            const sel = vu.state.selection.main;
            const text = sel.empty ? "" : v.slice(sel.from, sel.to).slice(0, 4000);
            if (text !== useStore.getState().selection) useStore.setState({ selection: text });
          }
        }}
        basicSetup={{ foldGutter: true, highlightActiveLine: true, highlightActiveLineGutter: true, bracketMatching: true, autocompletion: true }}
        style={{ minHeight: "100%" }}
      />
    </div>
  );
}

/* ─────────────── Diff view ─────────────── */

function DiffView({ changeId }: { changeId: string }) {
  const pending = useStore((s) => s.pending);
  const acceptChange = useStore((s) => s.acceptChange);
  const rejectChange = useStore((s) => s.rejectChange);
  const change = pending.find((c) => c.id === changeId);

  if (!change) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--tx3)] anim-fade">
        <Check size={26} style={{ color: "var(--ok)" }} />
        <p className="text-[13px]">This change has been resolved (accepted or rejected).</p>
      </div>
    );
  }
  const lines = diffLines(change.before, change.after);
  const stats = diffStats(lines);
  return (
    <div className="h-full flex flex-col anim-fade">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--line)] bg-[var(--bg1)] flex-none">
        <span className="font-mono text-[12.5px]">{change.path}</span>
        <span className="chip !py-0" style={{ color: "var(--ok)" }}>+{stats.added}</span>
        <span className="chip !py-0" style={{ color: "var(--danger)" }}>−{stats.removed}</span>
        <span className="chip !py-0 uppercase">{change.type}</span>
        <span className="text-[10.5px] text-[var(--tx3)] ml-1">{change.taskId}</span>
        <div className="flex-1" />
        <button className="btn btn-danger !py-1 !text-[11px]" onClick={() => rejectChange(change.id)}><X size={11} /> Reject</button>
        <button className="btn btn-ok !py-1 !text-[11px]" onClick={() => void acceptChange(change.id)}><Check size={11} /> Accept</button>
      </div>
      <div className="flex-1 overflow-auto scroll-thin font-mono text-[12px] leading-[1.55] py-2">
        {lines.map((l, i) => (
          <div key={i} className={`flex whitespace-pre ${l.type === "add" ? "diff-add" : l.type === "del" ? "diff-del" : "diff-same"}`}>
            <span className="w-[52px] flex-none text-right pr-1 text-[var(--tx3)] select-none">{l.oldNo ?? ""}</span>
            <span className="w-[52px] flex-none text-right pr-2 text-[var(--tx3)] select-none border-r border-[var(--line)]">{l.newNo ?? ""}</span>
            <span className="w-[26px] flex-none text-center select-none" style={{ color: l.type === "add" ? "var(--ok)" : l.type === "del" ? "var(--danger)" : "var(--tx3)" }}>
              {l.type === "add" ? "+" : l.type === "del" ? "−" : ""}
            </span>
            <span className="pr-4 flex-1">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── Report view ─────────────── */

function ReportView() {
  const report = useStore((s) => s.report);
  if (!report) return null;
  return (
    <div className="h-full overflow-y-auto scroll-thin anim-fade">
      <div className="max-w-[760px] raised rounded-xl my-4 mx-4 md:mx-auto p-6" style={{ background: "var(--bg1)" }}>
        <Markdown text={report} />
      </div>
    </div>
  );
}
