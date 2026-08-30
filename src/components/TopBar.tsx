import { Activity, ChevronDown, FlaskConical, FolderOpen, GitBranch, Hammer, Monitor, Play, RefreshCw, Search, Square, Wifi, WifiOff } from "lucide-react";
import { analyzeProject, buildProject, openPreview, runProject, stopGeneration, testProject } from "../agents/engine";
import { APP_NAME, APP_VERSION, OFFLINE_MODEL_ID, OFFLINE_MODEL_LABEL } from "../config/app";
import type { AiMode } from "../lib/types";
import { useStore } from "../state/store";
import { Dropdown, Kbd, LogoMark, MenuItem, Spinner } from "./ui";

const MODES: { id: AiMode; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "agent", label: "Agent" },
  { id: "plan", label: "Plan" },
  { id: "test", label: "Test" },
];

export default function TopBar() {
  const workspace = useStore((s) => s.workspace);
  const recents = useStore((s) => s.recents);
  const aiView = useStore((s) => s.aiView);
  const ollama = useStore((s) => s.ollama);
  const settings = useStore((s) => s.settings);
  const streaming = useStore((s) => s.streaming);
  const agentRunning = useStore((s) => s.agentRunning);
  const services = useStore((s) => s.services);
  const openLocal = useStore((s) => s.openLocal);
  const openDemo = useStore((s) => s.openDemo);
  const openRecent = useStore((s) => s.openRecent);
  const setAiView = useStore((s) => s.setAiView);
  const updateSettings = useStore((s) => s.updateSettings);
  const connectOllama = useStore((s) => s.connectOllama);
  const disconnectOllama = useStore((s) => s.disconnectOllama);
  const refreshModels = useStore((s) => s.refreshModels);
  const setSidebarView = useStore((s) => s.setSidebarView);
  const setQuickOpen = useStore((s) => s.setQuickOpen);

  const busy = Boolean(streaming) || agentRunning;
  const runningSvc = services.filter((s) => s.status === "running").length;

  return (
    <header className="flex items-center gap-2 px-3 h-[46px] flex-none border-b border-[var(--line)] bg-[var(--bg1)] relative z-30">
      <div className="flex items-center gap-2 mr-1">
        <LogoMark />
        <div className="leading-none">
          <div className="font-display font-bold text-[14px] tracking-wide">{APP_NAME}</div>
          <div className="text-[9px] text-[var(--tx3)] tracking-[0.18em] uppercase mt-[3px]">v{APP_VERSION} · local-first</div>
        </div>
      </div>

      <Dropdown
        width={270}
        trigger={
          <button className="btn btn-ghost !text-[12.5px]">
            <FolderOpen size={13} style={{ color: "var(--ember)" }} />
            <span className="max-w-[140px] truncate">{workspace ? workspace.label : "Open project"}</span>
            <ChevronDown size={12} className="text-[var(--tx3)]" />
          </button>
        }
      >
        {(close) => (
          <>
            <MenuItem onClick={() => { void openLocal(); close(); }}><FolderOpen size={13} /> Open Folder…</MenuItem>
            <MenuItem onClick={() => { void openDemo(); close(); }}><Play size={13} /> Demo workspace (atlas-notes)</MenuItem>
            {recents.length > 0 && <div className="my-1 border-t border-[var(--line)]" />}
            {recents.map((r) => (
              <MenuItem key={r.label} onClick={() => { void openRecent(r.label); close(); }}>
                <GitBranch size={13} className="text-[var(--tx3)]" />
                <span className="truncate">{r.label}</span>
                <span className="ml-auto text-[10px] text-[var(--tx3)]">{r.source}</span>
              </MenuItem>
            ))}
          </>
        )}
      </Dropdown>

      <span className="chip" title="Local snapshot branch — real git plumbing runs in the desktop runtime">
        <GitBranch size={11} /> main
      </span>

      <button className="btn btn-ghost hidden lg:inline-flex" onClick={() => setQuickOpen(true)} title="Quick open (Ctrl+P)">
        <Search size={13} /> <Kbd>Ctrl P</Kbd>
      </button>

      <div className="flex-1" />

      <div className="flex items-center rounded-lg border border-[var(--line2)] bg-[var(--bg0)] p-[3px] gap-[2px]">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setAiView(m.id)}
            className="px-3 py-[3px] rounded-md text-[12px] font-medium transition-all font-display tracking-wide"
            style={aiView === m.id
              ? { background: "var(--ember-soft)", color: "var(--ember)", boxShadow: "inset 0 0 0 1px var(--ember)" }
              : { color: "var(--tx2)" }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <select
        className="select !w-[170px] !text-[11.5px]"
        value={settings.models.chat}
        onChange={(e) => updateSettings({ models: { ...settings.models, chat: e.target.value } })}
        title="Active chat model (auto = first Ollama model when connected)"
      >
        <option value="">{ollama.status === "connected" && ollama.models.length ? "Auto — first Ollama model" : "Auto — heuristic engine"}</option>
        <option value={OFFLINE_MODEL_ID}>{OFFLINE_MODEL_LABEL}</option>
        {ollama.models.map((m) => <option key={m} value={m}>{m}</option>)}
        {ollama.status !== "connected" && <option disabled value="__none">connect Ollama for installed models…</option>}
      </select>

      {ollama.status === "connected" ? (
        <Dropdown
          align="right"
          width={220}
          trigger={
            <button className="btn btn-ghost !px-2" title="Ollama connected — click for options">
              <span className={`led led-ok ${agentRunning ? "led-pulse" : ""}`} />
              <Wifi size={13} style={{ color: "var(--ok)" }} />
            </button>
          }
        >
          {(close) => (
            <>
              <div className="px-2.5 py-1.5 text-[11px] text-[var(--tx2)]">
                Ollama {ollama.version ?? ""} · {ollama.models.length} model(s)
              </div>
              <MenuItem onClick={() => { void refreshModels(); close(); }}><RefreshCw size={13} /> Refresh models</MenuItem>
              <MenuItem onClick={() => { setSidebarView("settings"); close(); }}><Search size={13} /> Ollama settings</MenuItem>
              <MenuItem danger onClick={() => { disconnectOllama(); close(); }}><WifiOff size={13} /> Disconnect</MenuItem>
            </>
          )}
        </Dropdown>
      ) : (
        <button
          className="btn !px-2.5"
          onClick={() => void connectOllama()}
          title={`Connect to ${settings.ollamaUrl}`}
        >
          {ollama.status === "connecting" ? <Spinner size={13} /> : <WifiOff size={13} style={{ color: "var(--tx3)" }} />}
          <span className="text-[11.5px]">{ollama.status === "connecting" ? "Connecting" : ollama.status === "error" ? "Ollama error" : "Ollama off"}</span>
        </button>
      )}

      <span className="w-px h-5 bg-[var(--line2)] mx-0.5" />

      <button className="btn btn-primary !px-3" onClick={runProject} title="Run project using the detected adapter">
        <Play size={13} /> Run
      </button>
      <button className="btn !px-2.5" onClick={() => void openPreview()} title="Open live preview">
        <Monitor size={13} style={{ color: "var(--ember)" }} />
      </button>
      <button className="btn !px-2.5" onClick={buildProject} title="Validate build graph"><Hammer size={13} /></button>
      <button className="btn !px-2.5" onClick={testProject} title="Run unit suite"><FlaskConical size={13} /></button>
      <button className="btn !px-2.5 hidden md:inline-flex" onClick={analyzeProject} title="Project health report"><Activity size={13} /></button>
      {busy ? (
        <button className="btn btn-danger !px-2.5" onClick={stopGeneration} title="Stop generation, agents, queue and services (Esc)">
          <Square size={12} fill="currentColor" /> Stop all
        </button>
      ) : runningSvc > 0 ? (
        <button className="btn btn-danger !px-2.5" onClick={stopGeneration} title="Stop running services">
          <Square size={12} fill="currentColor" /> Stop
        </button>
      ) : null}
    </header>
  );
}
