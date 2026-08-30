import { useEffect, useRef, useState } from "react";
import {
  AtSign, Check, FlaskConical, ImagePlus, Paperclip, Pencil, Pin, Play, RefreshCw, Send, Square, Trash2, Wand2, X, Zap,
} from "lucide-react";
import { OFFLINE_MODEL_ID } from "../config/app";
import { approvePlan, generatePlan, rejectPlan, sendPlanToAgent } from "../agents/planner";
import { regenerateLast, runTestSuite, sendChat, submitAgentTask, fixWithAI } from "../agents/engine";
import type { TestKind } from "../lib/types";
import { getMergedFiles, resolveModel, useStore } from "../state/store";
import { AGENT_META, AgentStatusIcon, Markdown, SectionLabel, Spinner, timeAgo } from "./ui";

const MENTIONS = ["file", "folder", "project", "codebase", "selection", "errors", "terminal", "git", "diff", "tests", "docs"];

export default function AIPanel() {
  const aiView = useStore((s) => s.aiView);
  return (
    <div className="flex flex-col h-full bg-[var(--bg1)] border-l border-[var(--line)]">
      <div className="flex items-center px-2.5 h-[34px] flex-none border-b border-[var(--line)] gap-1">
        <ModelTag />
        {(["chat", "agent", "plan", "test"] as const).map((v) => (
          <button key={v} className="px-2 py-[4px] rounded-md text-[11.5px] font-medium font-display tracking-wide capitalize transition-all"
            style={aiView === v ? { color: "var(--ember)", background: "var(--ember-soft)" } : { color: "var(--tx3)" }}
            onClick={() => useStore.getState().setAiView(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {aiView === "chat" && <ChatView />}
        {aiView === "agent" && <AgentView />}
        {aiView === "plan" && <PlanView />}
        {aiView === "test" && <TestView />}
      </div>
    </div>
  );
}

function ModelTag() {
  const aiView = useStore((s) => s.aiView);
  const role = aiView === "plan" ? "planner" : aiView === "test" ? "tester" : aiView === "agent" ? "agent" : "chat";
  const resolved = useStore((s) => resolveModel(s, role));
  const label = resolved.model === OFFLINE_MODEL_ID ? "heuristic" : resolved.model;
  return (
    <span className="chip !text-[9.5px] mr-auto" title={`Model used by ${role} mode`} style={{ color: resolved.useOllama ? "var(--ok)" : "var(--warn)", borderColor: "currentColor" }}>
      <span className={`led ${resolved.useOllama ? "led-ok" : "led-warn"}`} style={{ width: 6, height: 6 }} />
      {label.length > 18 ? label.slice(0, 17) + "…" : label}
    </span>
  );
}

/* ─────────────── Chat ─────────────── */

function ChatView() {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const streaming = useStore((s) => s.streaming);
  const streamText = useStore((s) => s.streamText);
  const attachments = useStore((s) => s.attachments);
  const [input, setInput] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = chats.find((c) => c.id === activeChatId);
  const project = useStore.getState().workspace?.label ?? "no-project";
  const projectChats = chats.filter((c) => c.project === project);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [chat?.messages.length, streamText]);

  const send = () => {
    const t = input.trim();
    if (!t || streaming) return;
    setInput("");
    void sendChat(t);
  };

  const attach = (f: File) => {
    if (f.size > 1_500_000) { useStore.getState().toast("warn", "Image too large", "Keep screenshots under 1.5 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => useStore.getState().addAttachment({ name: f.name, dataUrl: String(reader.result), size: f.size });
    reader.readAsDataURL(f);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2.5 h-[28px] border-b border-[var(--line)] flex-none">
        <button className="chip !py-0 cursor-pointer" onClick={() => setListOpen(!listOpen)}><AtSign size={9} /> chats · {projectChats.length}</button>
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-[var(--bg3)] text-[var(--tx3)] hover:text-[var(--tx)]" title="New chat" onClick={() => useStore.getState().newChat()}><Pencil size={11} /></button>
      </div>
      {listOpen && (
        <div className="border-b border-[var(--line)] max-h-[140px] overflow-y-auto scroll-thin anim-fade">
          {projectChats.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt).map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-[5px] hover:bg-[var(--bg3)] cursor-pointer" onClick={() => { useStore.setState({ activeChatId: c.id }); setListOpen(false); }}>
              {c.pinned && <Pin size={9} style={{ color: "var(--ember)" }} />}
              <span className={`text-[11px] truncate flex-1 ${c.id === activeChatId ? "text-[var(--ember)]" : ""}`}>{c.title}</span>
              <button className="p-0.5 text-[var(--tx3)] hover:text-[var(--tx)]" onClick={(e) => { e.stopPropagation(); useStore.getState().pinChat(c.id); }}><Pin size={9} /></button>
              <button className="p-0.5 text-[var(--tx3)] hover:text-[var(--danger)]" onClick={(e) => { e.stopPropagation(); useStore.getState().deleteChat(c.id); }}><Trash2 size={9} /></button>
            </div>
          ))}
          {projectChats.length === 0 && <p className="px-3 py-2 text-[10.5px] text-[var(--tx3)]">No chats for this project yet.</p>}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-3">
        {!chat || chat.messages.length === 0 ? (
          <div className="text-center pt-8 space-y-2 anim-fade">
            <p className="font-display text-[13px] font-semibold">Ask about this project</p>
            <p className="text-[11px] text-[var(--tx3)] max-w-[260px] mx-auto leading-relaxed">Answers are grounded in the real workspace — files, problems, terminal and git state.</p>
            <div className="flex flex-wrap gap-1 justify-center pt-2">
              {["explain the architecture", "find bugs in this project", "@codebase where is auth handled?", "how do I run this?"].map((q) => (
                <button key={q} className="chip cursor-pointer hover:border-[var(--ember)] hover:text-[var(--ember)] transition-colors" onClick={() => { setInput(q); }}>{q}</button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map((m) => (
            <div key={m.id} className={`anim-fade-up ${m.role === "user" ? "flex justify-end" : ""}`}>
              <div className={`max-w-[92%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${m.role === "user" ? "rounded-br-sm" : "raised rounded-bl-sm"}`}
                style={m.role === "user" ? { background: "var(--ember-soft)", border: "1px solid var(--ember)", color: "var(--tx)" } : undefined}>
                {m.attachments && m.attachments.length > 0 && (
                  <div className="flex gap-1 mb-1">{m.attachments.map((a) => <span key={a} className="chip !py-0 !text-[9px]"><ImagePlus size={8} /> {a}</span>)}</div>
                )}
                <Markdown text={m.content} />
                {m.model && m.role === "assistant" && <div className="text-[9px] text-[var(--tx3)] mt-1 font-mono">{m.model}</div>}
              </div>
            </div>
          ))
        )}
        {streaming && (
          <div className="raised rounded-xl rounded-bl-sm px-3 py-2 text-[12.5px] leading-relaxed anim-fade">
            <Markdown text={streamText || "…"} />
            <span className="caret-blink inline-block w-[7px] h-[13px] align-middle ml-0.5" style={{ background: "var(--ember)" }} />
          </div>
        )}
      </div>

      <div className="flex-none border-t border-[var(--line)] p-2.5 space-y-1.5">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {attachments.map((a) => (
              <span key={a.name} className="chip !text-[9.5px]">
                <ImagePlus size={9} /> {a.name}
                <button onClick={() => useStore.getState().removeAttachment(a.name)}><X size={8} /></button>
              </span>
            ))}
            <span className="text-[9px] text-[var(--tx3)] self-center">sent to vision-capable models only</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {MENTIONS.map((m) => (
            <button key={m} className="chip !py-0 !text-[9.5px] cursor-pointer hover:text-[var(--ember)] hover:border-[var(--ember)] transition-colors"
              onClick={() => setInput((v) => v + (v.endsWith(" ") || !v ? "" : " ") + "@" + m + (m === "file" ? " " : ""))}>
              @{m}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ""; }} />
          <button className="btn !px-2 flex-none" title="Attach screenshot" onClick={() => fileRef.current?.click()}><Paperclip size={12} /></button>
          <textarea
            className="input resize-none !text-[12px]"
            rows={2}
            placeholder="Message… (Ctrl+Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
          />
          {streaming ? (
            <button className="btn btn-danger !px-2 flex-none" onClick={regenerateLastStop} title="Stop (Esc)"><Square size={11} fill="currentColor" /></button>
          ) : (
            <button className="btn btn-primary !px-2 flex-none" onClick={send} disabled={!input.trim()} title="Send"><Send size={12} /></button>
          )}
        </div>
        {chat && chat.messages.some((m) => m.role === "assistant") && !streaming && (
          <button className="text-[10px] text-[var(--tx3)] hover:text-[var(--ember)] flex items-center gap-1" onClick={regenerateLast}><RefreshCw size={9} /> Regenerate last answer</button>
        )}
      </div>
    </div>
  );
}

function regenerateLastStop() {
  // Esc-like stop: abort current stream via engine stop
  void import("../agents/engine").then((m) => m.stopGeneration());
}

/* ─────────────── Agent ─────────────── */

function AgentView() {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const autonomy = useStore((s) => s.autonomy);
  const agentRunning = useStore((s) => s.agentRunning);
  const [input, setInput] = useState("");

  const active = tasks.find((t) => t.status === "running");
  const queued = tasks.filter((t) => t.status === "queued");

  const send = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    submitAgentTask(t);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scroll-thin p-2.5 space-y-2.5">
        <div className="raised rounded-lg p-2.5 anim-fade">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap size={11} style={{ color: "var(--ember)" }} />
            <span className="text-[11px] font-semibold font-display tracking-wide uppercase">delegate a task</span>
            <span className="chip !py-0 !text-[9px] ml-auto uppercase" style={{ color: autonomy === "auto" ? "var(--ok)" : autonomy === "plan" ? "var(--info)" : "var(--warn)" }}>{autonomy}</span>
          </div>
          {active ? (
            <div>
              <div className="flex items-center gap-1.5 text-[11.5px]"><Spinner size={11} /><span className="truncate font-medium">{active.title}</span></div>
              <div className="mt-1.5 space-y-[3px]">
                {active.steps.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5 text-[10.5px]">
                    {s.status === "done" ? <Check size={9} style={{ color: "var(--ok)" }} /> : s.status === "running" ? <Spinner size={9} /> : s.status === "failed" ? <X size={9} style={{ color: "var(--danger)" }} /> : <span className="w-[9px] h-[9px] rounded-full border border-[var(--line2)] flex-none" />}
                    <span style={{ color: s.status === "pending" ? "var(--tx3)" : undefined }}>{s.label}</span>
                  </div>
                ))}
              </div>
              {active.todos.length > 0 && (
                <div className="mt-1.5 border-t border-[var(--line)] pt-1.5">
                  {active.todos.map((t, i) => (
                    <div key={i} className="font-mono text-[9.5px]" style={{ color: t.status === "done" ? "var(--ok)" : t.status === "running" ? "var(--ember)" : "var(--tx3)" }}>[{t.status}] {t.text}</div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.values(agents).filter((a) => a.status !== "idle").map((a) => {
                  const meta = AGENT_META[a.role];
                  return (
                    <span key={a.role} className="chip !py-0 !text-[9px]" title={a.note}>
                      <AgentStatusIcon status={a.status} size={8} /> {meta.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[10.5px] text-[var(--tx3)]">The orchestrator decomposes work and picks the crew — architect, frontend/backend, database, tester, debugger, reviewer. Dangerous commands always ask first.</p>
          )}
        </div>

        {queued.length > 0 && (
          <div>
            <SectionLabel>queued ({queued.length})</SectionLabel>
            {queued.map((t, i) => (
              <div key={t.id} className="raised rounded-md px-2 py-1.5 mb-1 flex items-center gap-2 text-[11px]">
                <span className="chip !py-0 !text-[9px]">#{i + 1}</span>
                <span className="truncate flex-1">{t.title}</span>
              </div>
            ))}
          </div>
        )}

        {tasks.filter((t) => ["done", "failed", "blocked", "cancelled"].includes(t.status)).slice(-6).reverse().map((t) => (
          <div key={t.id} className="raised rounded-md px-2 py-1.5 text-[10.5px]">
            <div className="flex items-center gap-1.5">
              {t.status === "done" ? <Check size={10} style={{ color: "var(--ok)" }} /> : <X size={10} style={{ color: t.status === "cancelled" ? "var(--tx3)" : "var(--danger)" }} />}
              <span className="truncate flex-1 font-medium">{t.title}</span>
              <span className="text-[9px] text-[var(--tx3)]">{timeAgo(t.createdAt)}</span>
            </div>
            {t.summary && <p className="text-[var(--tx3)] mt-0.5 truncate">{t.summary}</p>}
          </div>
        ))}
      </div>

      <div className="flex-none border-t border-[var(--line)] p-2.5">
        <div className="flex items-end gap-1.5">
          <textarea className="input resize-none !text-[12px]" rows={3} placeholder='e.g. "Create login and registration" — the crew does the rest'
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
          <button className="btn btn-primary !px-2 flex-none" onClick={send} disabled={!input.trim() || agentRunning && false} title="Queue task">
            {agentRunning ? <Spinner size={12} /> : <Play size={12} />}
          </button>
        </div>
        <p className="text-[9px] text-[var(--tx3)] mt-1">Tasks queue behind running ones; parallel agents are file-locked. Ctrl+Enter to send.</p>
      </div>
    </div>
  );
}

/* ─────────────── Plan ─────────────── */

function PlanView() {
  const plan = useStore((s) => s.plan);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const gen = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setBusy(true);
    try { await generatePlan(t); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scroll-thin p-2.5">
        {plan ? <PlanCard /> : (
          <div className="text-center pt-10 space-y-2">
            <p className="font-display text-[13px] font-semibold">Think before coding</p>
            <p className="text-[11px] text-[var(--tx3)] max-w-[250px] mx-auto">Plan mode inspects the project and drafts an implementation plan. It never touches files until you approve.</p>
          </div>
        )}
      </div>
      <div className="flex-none border-t border-[var(--line)] p-2.5">
        <div className="flex items-end gap-1.5">
          <textarea className="input resize-none !text-[12px]" rows={2} placeholder='e.g. "Add JWT authentication"' value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void gen(); } }} />
          <button className="btn btn-primary !px-2 flex-none" onClick={() => void gen()} disabled={!input.trim() || busy}>
            {busy ? <Spinner size={12} /> : <Wand2 size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlanCard() {
  const plan = useStore((s) => s.plan);
  const setPlan = useStore((s) => s.setPlan);
  const openFile = useStore((s) => s.openFile);
  if (!plan) return null;
  return (
    <div className="raised rounded-xl p-4 anim-fade-up space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-display font-bold text-[14px]">Implementation plan</span>
        <span className="chip !py-0 uppercase" style={{ color: plan.status === "approved" ? "var(--ok)" : plan.status === "rejected" ? "var(--danger)" : "var(--warn)" }}>{plan.status}</span>
      </div>
      <p className="text-[12px] text-[var(--tx2)]">{plan.task}</p>
      <div><SectionLabel>architecture analysis</SectionLabel><p className="text-[11.5px] text-[var(--tx2)] leading-relaxed">{plan.analysis}</p></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <SectionLabel>modify ({plan.filesToModify.length})</SectionLabel>
          {plan.filesToModify.map((f) => <button key={f} className="block font-mono text-[10.5px] hover:text-[var(--ember)] truncate max-w-full" onClick={() => openFile(f)}>{f}</button>)}
          {plan.filesToModify.length === 0 && <span className="text-[10px] text-[var(--tx3)]">none</span>}
        </div>
        <div>
          <SectionLabel>create ({plan.filesToCreate.length})</SectionLabel>
          {plan.filesToCreate.map((f) => <div key={f} className="font-mono text-[10.5px] truncate" style={{ color: "var(--ok)" }}>{f}</div>)}
          {plan.filesToCreate.length === 0 && <span className="text-[10px] text-[var(--tx3)]">none</span>}
        </div>
      </div>
      {plan.dependencies.length > 0 && (
        <div><SectionLabel>dependencies</SectionLabel><div className="flex flex-wrap gap-1">{plan.dependencies.map((d) => <span key={d} className="chip !py-0 font-mono !text-[10px]">{d}</span>)}</div></div>
      )}
      <div><SectionLabel>steps</SectionLabel>{plan.steps.map((s, i) => <div key={i} className="text-[11.5px] text-[var(--tx2)] py-[2px]">{s}</div>)}</div>
      <div><SectionLabel>testing plan</SectionLabel><p className="text-[11.5px] text-[var(--tx2)]">{plan.testing}</p></div>
      <div><SectionLabel>risks</SectionLabel>{plan.risks.map((r, i) => <div key={i} className="text-[11px] py-[2px]" style={{ color: "var(--warn)" }}>⚠ {r}</div>)}</div>
      {plan.status !== "rejected" && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button className="btn btn-ok !py-1 !text-[11px]" onClick={approvePlan} disabled={plan.status === "approved"}><Check size={11} /> Approve</button>
          <button className="btn btn-primary !py-1 !text-[11px]" onClick={sendPlanToAgent}><Play size={11} /> Send to agents</button>
          <button className="btn btn-danger !py-1 !text-[11px]" onClick={rejectPlan}><X size={11} /> Reject</button>
          <button className="btn btn-ghost !py-1 !text-[11px]" onClick={() => setPlan(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

/* ─────────────── Test ─────────────── */

const SUITES: { id: TestKind; label: string }[] = [
  { id: "all", label: "Test All" }, { id: "unit", label: "Unit" }, { id: "integration", label: "Integration" },
  { id: "build", label: "Build" }, { id: "lint", label: "Lint" }, { id: "typecheck", label: "Type Check" }, { id: "runtime", label: "Runtime" },
];

function TestView() {
  const testRuns = useStore((s) => s.testRuns);
  const problems = useStore((s) => s.problems);
  const [busy, setBusy] = useState<TestKind | null>(null);

  const run = async (k: TestKind) => { setBusy(k); try { await runTestSuite(k); } finally { setBusy(null); } };
  const last = testRuns[0];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scroll-thin p-2.5 space-y-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          {SUITES.map((s) => (
            <button key={s.id} className="raised rounded-lg py-2 text-[11.5px] font-medium flex items-center justify-center gap-1.5 hover:border-[var(--ember)] transition-all"
              onClick={() => void run(s.id)} disabled={busy !== null}>
              {busy === s.id ? <Spinner size={11} /> : <FlaskConical size={11} className="text-[var(--tx3)]" />}
              {s.label}
            </button>
          ))}
        </div>
        {last && (
          <div className="raised rounded-lg p-2.5 anim-fade-up">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-mono uppercase text-[9.5px] text-[var(--tx3)]">{last.kind}</span>
              <span style={{ color: "var(--ok)" }}>{last.passed} passed</span>
              <span style={{ color: last.failed ? "var(--danger)" : "var(--tx3)" }}>{last.failed} failed</span>
              <span className="text-[var(--tx3)]">{last.skipped} skipped · {last.durationMs}ms</span>
            </div>
            <div className="mt-1.5 max-h-[130px] overflow-y-auto scroll-thin font-mono text-[10px] leading-[1.6]">
              {last.lines.map((l, i) => (
                <div key={i} style={{ color: l.kind === "err" ? "var(--danger)" : l.kind === "sys" ? "var(--info)" : "var(--tx2)", whiteSpace: "pre-wrap" }}>{l.text}</div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button className="btn !py-1 !text-[11px]" disabled={!problems.some((p) => p.severity === "error")} onClick={() => fixWithAI(problems.filter((p) => p.severity === "error"))}>
            <Wand2 size={11} /> Fix failures with AI
          </button>
          <button className="btn !py-1 !text-[11px]" disabled={!last || last.failed === 0}
            onClick={() => { if (last) void sendChat(`Explain this test failure and suggest a fix:\n${last.lines.filter((l) => l.kind === "err").slice(-6).map((l) => l.text).join("\n")}`); }}>
            <Zap size={11} /> Explain failure
          </button>
        </div>
        {testRuns.length > 1 && (
          <div>
            <SectionLabel>history</SectionLabel>
            {testRuns.slice(1, 10).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[10.5px] py-[3px]">
                <span className="font-mono uppercase text-[9px] text-[var(--tx3)] w-[72px]">{r.kind}</span>
                <span style={{ color: "var(--ok)" }}>{r.passed}✓</span>
                <span style={{ color: r.failed ? "var(--danger)" : "var(--tx3)" }}>{r.failed}✗</span>
                <span className="ml-auto text-[9px] text-[var(--tx3)]">{timeAgo(r.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex-none border-t border-[var(--line)] px-3 py-2 text-[9.5px] text-[var(--tx3)] leading-relaxed">
        Suites run as real static validation in this runtime (import graph, syntax, JSON, test-file verification). OS-bound runners (vitest CLI, pytest) execute in the desktop build.
      </div>
    </div>
  );
}
