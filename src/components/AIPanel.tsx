import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, AtSign, Check, ChevronDown, Compass, FlaskConical, History, Pin, Plus,
  RotateCcw, Send, Square, Trash2, Wand2, X, Zap,
} from "lucide-react";
import { fixWithAI, regenerateLast, runAgentTask, runTestSuite, sendChat, stopGeneration } from "../agents/engine";
import { approvePlan, generatePlan, rejectPlan, sendPlanToAgent } from "../agents/planner";
import { OFFLINE_MODEL_ID } from "../config/app";
import type { TestKind } from "../lib/types";
import { getMergedFiles, resolveModel, useStore } from "../state/store";
import { Dropdown, Markdown, MenuItem, ROLE_META, SectionLabel, Spinner, StatusGlyph, timeAgo } from "./ui";

function ModelTag() {
  const aiView = useStore((s) => s.aiView);
  const role = aiView === "plan" ? "planner" : aiView === "test" ? "tester" : aiView === "agent" ? "agent" : "chat";
  const settings = useStore((s) => s.settings);
  const ollama = useStore((s) => s.ollama);
  const resolved = resolveModel({ settings, ollama }, role);
  const label = resolved.model === OFFLINE_MODEL_ID ? "heuristic" : resolved.model;
  return (
    <span className="chip !text-[10px] mr-1" title={`Model used by ${role} mode`} style={{ color: resolved.useOllama ? "var(--ok)" : "var(--warn)", borderColor: "currentColor" }}>
      <span className={`led ${resolved.useOllama ? "led-ok" : "led-warn"}`} style={{ width: 6, height: 6 }} />
      {label.length > 22 ? label.slice(0, 20) + "…" : label}
    </span>
  );
}

export default function AIPanel() {
  const aiView = useStore((s) => s.aiView);
  return (
    <div className="flex flex-col h-full bg-[var(--bg1)] border-l border-[var(--line)] min-w-0">
      <div className="flex items-center h-[34px] flex-none px-3 border-b border-[var(--line)]">
        <ModelTag />
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--tx2)]">
          {aiView === "chat" ? "AI Chat" : aiView === "agent" ? "Agent Crew" : aiView === "plan" ? "Plan Mode" : "Testing"}
        </span>
        <div className="flex-1" />
        {aiView === "chat" && <ChatMenu />}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {aiView === "chat" && <ChatView />}
        {aiView === "agent" && <AgentView />}
        {aiView === "plan" && <PlanView />}
        {aiView === "test" && <TestView />}
      </div>
    </div>
  );
}

/* ─────────────── Chat ─────────────── */

function ChatMenu() {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const setActiveChat = useStore((s) => s.setActiveChat);
  const newChat = useStore((s) => s.newChat);
  const deleteChat = useStore((s) => s.deleteChat);
  const pinChat = useStore((s) => s.pinChat);
  const renameChat = useStore((s) => s.renameChat);
  const workspace = useStore((s) => s.workspace);

  const projectChats = useMemo(
    () => chats.filter((c) => c.project === (workspace?.label ?? "no-project"))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt),
    [chats, workspace]
  );

  return (
    <Dropdown
      align="right"
      width={250}
      trigger={<button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)] hover:text-[var(--tx)]" title="Chat history"><History size={14} /></button>}
    >
      {(close) => (
        <>
          <MenuItem onClick={() => { newChat(); close(); }}><Plus size={13} /> New chat</MenuItem>
          <div className="my-1 border-t border-[var(--line)]" />
          {projectChats.length === 0 && <div className="px-2.5 py-2 text-[11px] text-[var(--tx3)]">No chats for this project yet.</div>}
          {projectChats.map((c) => (
            <div key={c.id} className="group flex items-center gap-1 rounded-md hover:bg-[var(--bg3)] transition-colors" style={c.id === activeChatId ? { background: "var(--ember-soft)" } : undefined}>
              <button className="flex-1 min-w-0 text-left px-2.5 py-[6px]" onClick={() => { setActiveChat(c.id); close(); }}>
                <span className="block text-[11.5px] truncate" style={c.id === activeChatId ? { color: "var(--ember)" } : undefined}>
                  {c.pinned && <Pin size={9} className="inline mr-1" />}{c.title}
                </span>
                <span className="block text-[9.5px] text-[var(--tx3)]">{c.messages.length} msg · {timeAgo(c.createdAt)}</span>
              </button>
              <span className="hidden group-hover:flex items-center pr-1">
                <button className="p-1 text-[var(--tx3)] hover:text-[var(--ember)]" title="Pin" onClick={() => pinChat(c.id)}><Pin size={10} /></button>
                <button className="p-1 text-[var(--tx3)] hover:text-[var(--info)]" title="Rename"
                  onClick={() => { const t = window.prompt("Rename chat:", c.title); if (t) renameChat(c.id, t); }}><Wand2 size={10} /></button>
                <button className="p-1 text-[var(--tx3)] hover:text-[var(--danger)]" title="Delete" onClick={() => deleteChat(c.id)}><Trash2 size={10} /></button>
              </span>
            </div>
          ))}
        </>
      )}
    </Dropdown>
  );
}

const MENTIONS = ["@file", "@project", "@errors", "@terminal", "@selection", "@git"];

function ChatView() {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const streaming = useStore((s) => s.streaming);
  const streamText = useStore((s) => s.streamText);
  const workspace = useStore((s) => s.workspace);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const msgs = chat?.messages ?? [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs.length, streamText]);

  const submit = () => {
    if (!input.trim() || streaming) return;
    const text = input;
    setInput("");
    void sendChat(text);
  };

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-3">
        {msgs.length === 0 && !streaming && (
          <div className="pt-6 anim-fade-up">
            <div className="flex items-center gap-2 mb-2">
              <Compass size={16} style={{ color: "var(--ember)" }} />
              <span className="font-display font-semibold text-[14px]">Ask about your code</span>
            </div>
            <p className="text-[11.5px] text-[var(--tx3)] leading-relaxed mb-3">
              {workspace ? `Context is drawn from ${workspace.label} — reference anything with @mentions.` : "Open a project to ground answers in real code."}
            </p>
            <div className="space-y-1.5">
              {["explain the architecture", "find bugs in this project", "how do I run this project?", `@file ${Object.keys(getMergedFiles(useStore.getState())).find((p) => p.startsWith("src/") && p.endsWith(".tsx")) ?? "README.md"} explain this component`].map((sugg) => (
                <button key={sugg} className="block w-full text-left px-2.5 py-1.5 rounded-lg raised text-[11.5px] text-[var(--tx2)] hover:text-[var(--tx)] hover:border-[var(--ember)] transition-all"
                  onClick={() => { setInput(sugg); taRef.current?.focus(); }}>
                  {sugg}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`anim-fade-up ${m.role === "user" ? "flex justify-end" : ""}`}>
            {m.role === "user" ? (
              <div className="max-w-[88%] rounded-xl rounded-br-sm px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
                style={{ background: "var(--ember-soft)", border: "1px solid var(--ember)" }}>
                {m.content}
              </div>
            ) : (
              <div className="max-w-[96%]">
                {m.model && <div className="text-[9.5px] font-mono text-[var(--tx3)] mb-1">{m.model}</div>}
                <Markdown text={m.content} />
              </div>
            )}
          </div>
        ))}
        {streaming && (
          <div className="anim-fade">
            <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--ember)] mb-1">
              <Spinner size={10} /> generating…
            </div>
            <Markdown text={streamText} />
            <span className="caret-blink inline-block w-[7px] h-[13px] align-middle" style={{ background: "var(--ember)" }} />
          </div>
        )}
      </div>

      <div className="flex-none p-2.5 border-t border-[var(--line)] space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {MENTIONS.map((m) => (
            <button key={m} className="chip cursor-pointer !text-[10px] hover:!text-[var(--ember)] hover:!border-[var(--ember)] transition-colors"
              onClick={() => { setInput((v) => (v ? v + " " : "") + m + " "); taRef.current?.focus(); }}>
              <AtSign size={9} /> {m.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5">
          <textarea
            ref={taRef}
            className="input !py-2 resize-none"
            rows={2}
            placeholder={workspace ? "Ask… (Ctrl+Enter to send)" : "Open a project, then ask…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
            }}
          />
          {streaming ? (
            <button className="btn btn-danger !px-2.5 h-[34px]" onClick={stopGeneration} title="Stop (Esc)"><Square size={12} fill="currentColor" /></button>
          ) : (
            <button className="btn btn-primary !px-2.5 h-[34px]" onClick={submit} disabled={!input.trim()} title="Send (Ctrl+Enter)"><Send size={13} /></button>
          )}
          {msgs.length > 0 && !streaming && (
            <button className="btn !px-2 h-[34px]" onClick={regenerateLast} title="Regenerate last answer"><RotateCcw size={12} /></button>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────── Agent ─────────────── */

function AgentView() {
  const tasks = useStore((s) => s.tasks);
  const agentRunning = useStore((s) => s.agentRunning);
  const agents = useStore((s) => s.agents);
  const pending = useStore((s) => s.pending);
  const workspace = useStore((s) => s.workspace);
  const [prompt, setPrompt] = useState("");

  const active = tasks.find((t) => t.status === "running" || t.status === "blocked") ?? tasks[0];

  const run = () => {
    if (!prompt.trim() || agentRunning) return;
    const p = prompt;
    setPrompt("");
    void runAgentTask(p);
  };

  return (
    <>
      <div className="flex-none p-2.5 border-b border-[var(--line)] space-y-1.5">
        <textarea
          className="input resize-none"
          rows={3}
          placeholder={workspace ? 'e.g. "Create login and registration"' : "Open a project, then delegate a task…"}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); } }}
        />
        <div className="flex items-center gap-2">
          <button className="btn btn-primary flex-1 justify-center" onClick={run} disabled={!prompt.trim() || agentRunning}>
            {agentRunning ? <><Spinner size={12} /> Crew working…</> : <><Zap size={13} /> Run agent crew</>}
          </button>
          {agentRunning && <button className="btn btn-danger" onClick={stopGeneration}><Square size={11} fill="currentColor" /></button>}
        </div>
        <p className="text-[10px] text-[var(--tx3)] leading-relaxed">
          Orchestrator → Architect → Repository → Coder → Tester → Debugger → Reviewer. Edits land as pending diffs.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-2.5 space-y-2.5">
        {agentRunning && (
          <div className="raised rounded-lg p-2.5 space-y-1.5 anim-fade">
            <SectionLabel>Live pipeline</SectionLabel>
            {(["orchestrator", "architect", "repository", "coder", "tester", "debugger", "reviewer"] as const).map((r) => {
              const a = agents[r];
              const meta = ROLE_META[r];
              const Icon = meta.icon;
              if (a.status === "idle" && !agentRunning) return null;
              return (
                <div key={r} className="flex items-center gap-2 text-[11.5px]">
                  <Icon size={12} style={{ color: meta.color }} />
                  <span className="w-[76px] flex-none">{meta.label}</span>
                  <span className="flex-1 truncate text-[var(--tx2)]">{a.note || a.status}</span>
                  <StatusGlyph status={a.status} />
                </div>
              );
            })}
          </div>
        )}

        {active && (
          <div className="raised rounded-lg p-2.5 space-y-2 anim-fade-up">
            <div className="flex items-center gap-2">
              <span className="font-display text-[12px] font-semibold truncate flex-1">{active.title}</span>
              <span className="chip !py-0 !text-[9.5px] uppercase" style={{
                color: active.status === "done" ? "var(--ok)" : active.status === "running" ? "var(--ember)" : active.status === "blocked" || active.status === "failed" ? "var(--danger)" : "var(--tx3)",
                borderColor: "currentColor",
              }}>{active.status}</span>
            </div>
            {active.todos.length > 0 && (
              <div className="space-y-[3px]">
                {active.todos.map((t, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                    <StatusGlyph status={t.status} />
                    <span className={t.status === "done" ? "line-through text-[var(--tx3)]" : "text-[var(--tx2)]"}>{t.text}</span>
                  </div>
                ))}
              </div>
            )}
            {active.summary && <p className="text-[11px] text-[var(--tx2)] leading-relaxed border-t border-[var(--line)] pt-2">{active.summary}</p>}
            {pending.filter((c) => c.taskId === active.id).length > 0 && (
              <p className="text-[10.5px]" style={{ color: "var(--warn)" }}>
                {pending.filter((c) => c.taskId === active.id).length} change(s) waiting in Source Control →
              </p>
            )}
          </div>
        )}

        {!active && !agentRunning && (
          <p className="text-[11.5px] text-[var(--tx3)] leading-relaxed px-1">
            No tasks yet. The crew decomposes your request, inspects the repository, writes code,
            validates it with the testing engine and reviews every change — all recorded in the Tasks panel.
          </p>
        )}

        {tasks.length > 1 && (
          <div>
            <SectionLabel>History</SectionLabel>
            {tasks.slice(1, 8).map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-[3px] text-[11px]">
                <span className={`led ${t.status === "done" ? "led-ok" : t.status === "failed" || t.status === "blocked" ? "led-danger" : "led-off"}`} style={{ width: 6, height: 6 }} />
                <span className="truncate flex-1 text-[var(--tx2)]">{t.title}</span>
                <span className="text-[9.5px] text-[var(--tx3)]">{timeAgo(t.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ─────────────── Plan ─────────────── */

function PlanView() {
  const plan = useStore((s) => s.plan);
  const workspace = useStore((s) => s.workspace);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const gen = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await generatePlan(prompt);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex-none p-2.5 border-b border-[var(--line)] space-y-1.5">
        <textarea
          className="input resize-none"
          rows={3}
          placeholder={workspace ? 'e.g. "Create admin authentication" — plan first, code never' : "Open a project to plan against it…"}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void gen(); } }}
        />
        <button className="btn w-full justify-center" onClick={() => void gen()} disabled={!prompt.trim() || busy}>
          {busy ? <><Spinner size={12} /> Analyzing repository…</> : <><Compass size={13} /> Generate implementation plan</>}
        </button>
        <p className="text-[10px] text-[var(--tx3)]">Plan Mode is read-only: it inspects the project and proposes — nothing is written until you send it to the agents.</p>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-2.5">
        {plan ? <PlanCard /> : (
          <p className="text-[11.5px] text-[var(--tx3)] leading-relaxed px-1">
            No plan yet. A plan lists the architecture analysis, files to modify and create,
            dependencies, ordered steps, testing strategy and risks — with approve / reject / send-to-agent controls.
          </p>
        )}
      </div>
    </>
  );
}

export function PlanCard() {
  const plan = useStore((s) => s.plan);
  const agentRunning = useStore((s) => s.agentRunning);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  if (!plan) return null;

  const statusColor = plan.status === "approved" ? "var(--ok)" : plan.status === "rejected" ? "var(--danger)" : "var(--warn)";

  if (editing) {
    return (
      <div className="space-y-2 anim-fade">
        <SectionLabel>Edit plan task</SectionLabel>
        <textarea className="input resize-none" rows={4} value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1 justify-center" onClick={() => { setEditing(false); void generatePlan(editText); }}>Re-plan</button>
          <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 anim-fade-up">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-display font-semibold text-[14px] leading-snug">{plan.task}</div>
          <div className="text-[9.5px] text-[var(--tx3)] mt-0.5">{timeAgo(plan.createdAt)}</div>
        </div>
        <span className="chip uppercase !text-[9.5px]" style={{ color: statusColor, borderColor: statusColor }}>{plan.status}</span>
      </div>

      <div>
        <SectionLabel>Architecture analysis</SectionLabel>
        <p className="text-[11.5px] text-[var(--tx2)] leading-relaxed">{plan.analysis}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="raised rounded-lg p-2">
          <SectionLabel>Modify ({plan.filesToModify.length})</SectionLabel>
          {plan.filesToModify.length === 0 && <span className="text-[10.5px] text-[var(--tx3)]">none</span>}
          {plan.filesToModify.map((f) => <div key={f} className="font-mono text-[10.5px] truncate" style={{ color: "var(--warn)" }}>{f}</div>)}
        </div>
        <div className="raised rounded-lg p-2">
          <SectionLabel>Create ({plan.filesToCreate.length})</SectionLabel>
          {plan.filesToCreate.length === 0 && <span className="text-[10.5px] text-[var(--tx3)]">none</span>}
          {plan.filesToCreate.map((f) => <div key={f} className="font-mono text-[10.5px] truncate" style={{ color: "var(--ok)" }}>{f}</div>)}
        </div>
      </div>

      {plan.dependencies.length > 0 && (
        <div>
          <SectionLabel>Dependencies</SectionLabel>
          <div className="flex flex-wrap gap-1">{plan.dependencies.map((d) => <span key={d} className="chip font-mono !text-[10px]">{d}</span>)}</div>
        </div>
      )}

      <div>
        <SectionLabel>Implementation steps</SectionLabel>
        <div className="space-y-1">
          {plan.steps.map((s, i) => (
            <div key={i} className="flex gap-2 text-[11.5px] text-[var(--tx2)] leading-relaxed">
              <span className="font-mono text-[10px] flex-none mt-[2px]" style={{ color: "var(--ember)" }}>{String(i + 1).padStart(2, "0")}</span>
              <Markdown text={s.replace(/^\d+\.\s*/, "")} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Testing plan</SectionLabel>
        <p className="text-[11.5px] text-[var(--tx2)] leading-relaxed">{plan.testing}</p>
      </div>

      <div>
        <SectionLabel>Risks</SectionLabel>
        {plan.risks.map((r, i) => (
          <div key={i} className="flex gap-1.5 text-[11px] text-[var(--tx2)] py-[2px]">
            <span style={{ color: "var(--warn)" }}>▲</span> {r}
          </div>
        ))}
      </div>

      {plan.status !== "rejected" && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--line)]">
          {plan.status === "draft" && (
            <>
              <button className="btn btn-ok" onClick={approvePlan}><Check size={12} /> Approve</button>
              <button className="btn btn-danger" onClick={rejectPlan}><X size={12} /> Reject</button>
              <button className="btn" onClick={() => { setEditText(plan.task); setEditing(true); }}><Wand2 size={12} /> Edit</button>
            </>
          )}
          <button className="btn btn-primary flex-1 justify-center" disabled={agentRunning} onClick={sendPlanToAgent}>
            <Zap size={12} /> Send to Agent
          </button>
        </div>
      )}
      {plan.status === "rejected" && (
        <p className="text-[11px] text-[var(--tx3)]">Plan rejected. Generate a new one above.</p>
      )}
    </div>
  );
}

/* ─────────────── Test ─────────────── */

const TEST_BUTTONS: { kind: TestKind; label: string; primary?: boolean }[] = [
  { kind: "all", label: "Test All", primary: true },
  { kind: "unit", label: "Unit Tests" },
  { kind: "integration", label: "Integration" },
  { kind: "build", label: "Build Test" },
  { kind: "lint", label: "Lint" },
  { kind: "typecheck", label: "Type Check" },
  { kind: "runtime", label: "Runtime Test" },
];

function TestView() {
  const testRuns = useStore((s) => s.testRuns);
  const problems = useStore((s) => s.problems);
  const workspace = useStore((s) => s.workspace);
  const [running, setRunning] = useState<TestKind | null>(null);
  const latest = testRuns[0];

  const run = async (kind: TestKind) => {
    if (running) return;
    setRunning(kind);
    try {
      await runTestSuite(kind);
    } finally {
      setRunning(null);
    }
  };

  const errors = problems.filter((p) => p.severity === "error");

  return (
    <>
      <div className="flex-none p-2.5 border-b border-[var(--line)]">
        <div className="grid grid-cols-2 gap-1.5">
          {TEST_BUTTONS.map((b) => (
            <button
              key={b.kind}
              className={`btn justify-center !py-1.5 !text-[11.5px] ${b.primary ? "btn-primary" : ""}`}
              disabled={!!running || !workspace}
              onClick={() => void run(b.kind)}
            >
              {running === b.kind ? <Spinner size={11} /> : <FlaskConical size={11} />} {b.label}
            </button>
          ))}
          <button className="btn btn-danger justify-center !py-1.5 !text-[11.5px]" disabled={errors.length === 0}
            onClick={() => fixWithAI(errors)} title="Send current errors to the Debug agent">
            <Wand2 size={11} /> Fix with AI
          </button>
        </div>
        <p className="text-[10px] text-[var(--tx3)] mt-1.5 leading-relaxed">
          Static engine: lint scan, import-graph + syntax type check, test-file verification, build graph. Real results, computed live.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin p-2.5 space-y-2.5">
        {latest && (
          <div className="raised rounded-lg p-3 anim-fade-up">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-display text-[12px] font-semibold uppercase tracking-wide">Latest: {latest.kind}</span>
              <span className="ml-auto text-[9.5px] text-[var(--tx3)]">{timeAgo(latest.at)}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-center mb-2">
              {[
                ["Passed", latest.passed, "var(--ok)"],
                ["Failed", latest.failed, latest.failed ? "var(--danger)" : "var(--tx3)"],
                ["Skipped", latest.skipped, "var(--tx3)"],
                ["Time", `${latest.durationMs}ms`, "var(--tx2)"],
              ].map(([label, val, color]) => (
                <div key={label as string} className="rounded-lg py-1.5" style={{ background: "var(--bg3)" }}>
                  <div className="font-display font-bold text-[16px]" style={{ color: color as string }}>{val}</div>
                  <div className="text-[9px] uppercase tracking-wide text-[var(--tx3)]">{label}</div>
                </div>
              ))}
            </div>
            <div className="font-mono text-[10px] leading-[1.6] max-h-[140px] overflow-y-auto scroll-thin rounded-md p-2" style={{ background: "var(--bg0)" }}>
              {latest.lines.map((l, i) => (
                <div key={i} style={{ color: l.kind === "err" ? "var(--danger)" : l.kind === "sys" ? "var(--info)" : "var(--tx2)", whiteSpace: "pre-wrap" }}>{l.text}</div>
              ))}
            </div>
          </div>
        )}

        {testRuns.length > 1 && (
          <div>
            <SectionLabel>Recent runs</SectionLabel>
            {testRuns.slice(1, 10).map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-[3px] text-[11px]">
                <span className={`led ${r.failed ? "led-danger" : "led-ok"}`} style={{ width: 6, height: 6 }} />
                <span className="font-mono uppercase text-[9.5px] text-[var(--tx3)] w-[74px]">{r.kind}</span>
                <span style={{ color: "var(--ok)" }}>{r.passed}✓</span>
                <span style={{ color: r.failed ? "var(--danger)" : "var(--tx3)" }}>{r.failed}✗</span>
                <span className="ml-auto text-[9.5px] text-[var(--tx3)]">{r.durationMs}ms · {timeAgo(r.at)}</span>
              </div>
            ))}
          </div>
        )}

        {!latest && (
          <p className="text-[11.5px] text-[var(--tx3)] leading-relaxed px-1">
            {workspace
              ? `Ready — ${Object.keys(workspace.files).length} files indexed. Run Test All for the full computed report.`
              : "Open a project to run validation suites."}
          </p>
        )}
      </div>
    </>
  );
}
