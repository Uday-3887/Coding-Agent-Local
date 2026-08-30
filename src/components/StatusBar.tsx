import { AlertTriangle, GitBranch, History } from "lucide-react";
import { APP_VERSION } from "../config/app";
import { detectLanguage } from "../lib/fs";
import { useStore } from "../state/store";
import { Spinner } from "./ui";

export default function StatusBar() {
  const workspace = useStore((s) => s.workspace);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const problems = useStore((s) => s.problems);
  const checkpoints = useStore((s) => s.checkpoints);
  const ollama = useStore((s) => s.ollama);
  const agentRunning = useStore((s) => s.agentRunning);
  const streaming = useStore((s) => s.streaming);
  const pending = useStore((s) => s.pending);
  const settings = useStore((s) => s.settings);
  const setBottomView = useStore((s) => s.setBottomView);

  const active = tabs.find((t) => t.id === activeTabId);
  const file = active?.kind === "file" ? active.path ?? null : null;
  const lang = file ? detectLanguage(file) : null;
  const lines = file && workspace ? (workspace.files[file]?.split("\n").length ?? 0) : 0;
  const errors = problems.filter((p) => p.severity === "error").length;

  return (
    <footer className="flex items-center gap-3 px-3 h-[24px] flex-none border-t border-[var(--line)] bg-[var(--bg1)] text-[11px] text-[var(--tx2)] select-none">
      <span className="flex items-center gap-1"><GitBranch size={11} /> main</span>
      <span className="flex items-center gap-1"><History size={11} /> {checkpoints.length} snapshot{checkpoints.length === 1 ? "" : "s"}</span>
      <button
        className="flex items-center gap-1 hover:text-[var(--tx)] transition-colors cursor-pointer"
        onClick={() => setBottomView("problems")}
        style={{ color: errors ? "var(--danger)" : undefined }}
      >
        <AlertTriangle size={11} /> {errors} error{errors === 1 ? "" : "s"} · {problems.length - errors} warn
      </button>
      {pending.length > 0 && (
        <span className="chip !py-0" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>
          {pending.length} pending change{pending.length === 1 ? "" : "s"}
        </span>
      )}
      <div className="flex-1" />
      {agentRunning || streaming ? (
        <span className="flex items-center gap-1.5" style={{ color: "var(--ember)" }}>
          <Spinner size={11} /> {agentRunning ? "agents working" : "generating"}
        </span>
      ) : (
        <span className="text-[var(--tx3)]">ready</span>
      )}
      {lang && <span className="uppercase tracking-wide">{lang}</span>}
      {file && <span>{lines} ln</span>}
      <span className="hidden sm:inline">{workspace ? `${Object.keys(workspace.files).length} files` : "no workspace"}</span>
      <span className="flex items-center gap-1">
        <span className={`led ${ollama.status === "connected" ? "led-ok" : ollama.status === "error" ? "led-danger" : "led-off"}`} />
        {ollama.status === "connected" ? "ollama" : "offline engine"}
      </span>
      <span className="text-[var(--tx3)]">v{APP_VERSION} · {settings.theme}</span>
    </footer>
  );
}
