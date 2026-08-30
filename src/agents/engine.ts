/**
 * Deterministic orchestration core. The LLM only proposes strict-JSON decisions;
 * this module owns the task lifecycle, queue scheduling, parallelism + file
 * locks, tool validation, iteration caps, permission gating and file access.
 */
import { buildContext, computeFacts, parseMentions } from "../ai/context";
import { makePatch } from "../lib/diff";
import { OfflineProvider, OllamaProvider, type AIProvider } from "../ai/provider";
import { CHAT_SYSTEM_PROMPT, buildChatUserPrompt } from "../ai/prompts/chat";
import { ARCHITECT_SYSTEM_PROMPT } from "../ai/prompts/architect";
import { CODER_SYSTEM_PROMPT } from "../ai/prompts/coder";
import { DEBUGGER_SYSTEM_PROMPT } from "../ai/prompts/debugger";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../ai/prompts/orchestrator";
import { REVIEWER_SYSTEM_PROMPT, buildReviewerPrompt } from "../ai/prompts/reviewer";
import { TESTER_SYSTEM_PROMPT } from "../ai/prompts/tester";
import { BACKEND_SYSTEM_PROMPT, DATABASE_SYSTEM_PROMPT, DOCS_SYSTEM_PROMPT, FRONTEND_SYSTEM_PROMPT, INLINE_EDIT_PROMPT, SECURITY_SYSTEM_PROMPT } from "../ai/prompts/specialists";
import { executeTool, runShellLine, type ToolCtx } from "../ai/tools";
import { detectProject, templateFiles } from "../adapters";
import { buildEsbuildPreview, buildStaticPreview, consolePreviewDoc, detectUrlsIn } from "../preview/engine";
import { projectHealth, runSuite, toTestRun } from "./testing";
import type {
  AgentRole, AgentTask, ChatMessage, FileChange, InlineAction, Problem, ServiceInfo, TaskStep, TestKind, TodoItem,
} from "../lib/types";
import { getMergedFiles, resolveModel, uid, useStore, type AppState, type ModelRole } from "../state/store";

let abort: AbortController | null = null;
const aborts = new Map<string, AbortController>();
let previewBuildToken = 0;

export function stopEverything(): void {
  abort?.abort();
  for (const [, c] of aborts) c.abort();
  aborts.clear();
  previewBuildToken++;
  const s = useStore.getState();
  if (s.streaming) s.setStreaming(false);
  const running = s.tasks.filter((t) => t.status === "running" || t.status === "queued");
  for (const t of running) s.updateTask(t.id, { status: "cancelled" });
  if (s.agentRunning) s.setAgentRunning(false);
  for (const svc of s.services) if (svc.status === "running") s.setService({ ...svc, status: "stopped" });
  s.setPreview({ building: false });
  s.toast("info", "Stopped everything", "Generation, agents, queue and services halted. No orphaned work.");
  s.log("APP", "stop-everything invoked");
}
export const stopGeneration = stopEverything;

function providerForRole(role: ModelRole): { provider: AIProvider; model: string; useOllama: boolean } {
  const s = useStore.getState();
  const { model, useOllama } = resolveModel(s, role);
  return { provider: useOllama ? new OllamaProvider(s.settings.ollamaUrl) : new OfflineProvider(), model, useOllama };
}

const roleSystemPrompt: Record<AgentRole, string> = {
  orchestrator: ORCHESTRATOR_SYSTEM_PROMPT,
  architect: ARCHITECT_SYSTEM_PROMPT,
  repository: CODER_SYSTEM_PROMPT,
  coder: CODER_SYSTEM_PROMPT,
  frontend: FRONTEND_SYSTEM_PROMPT,
  backend: BACKEND_SYSTEM_PROMPT,
  database: DATABASE_SYSTEM_PROMPT,
  tester: TESTER_SYSTEM_PROMPT,
  debugger: DEBUGGER_SYSTEM_PROMPT,
  reviewer: REVIEWER_SYSTEM_PROMPT,
  security: SECURITY_SYSTEM_PROMPT,
  docs: DOCS_SYSTEM_PROMPT,
};

const roleModelKey: Record<AgentRole, ModelRole> = {
  orchestrator: "agent", architect: "agent", repository: "agent", coder: "agent",
  frontend: "agent", backend: "agent", database: "agent",
  tester: "tester", debugger: "agent", reviewer: "reviewer", security: "reviewer", docs: "agent",
};

const STEP_LABEL: Record<AgentRole, string> = {
  orchestrator: "Decompose task", architect: "Analyze architecture", repository: "Gather context",
  coder: "Implement changes", frontend: "Build frontend", backend: "Build backend", database: "Design data layer",
  tester: "Validate (tests · lint · build)", debugger: "Fix failures", reviewer: "Review changes",
  security: "Security review", docs: "Update docs",
};

/* ─────────── file locks for parallel agents ─────────── */

const lockChains = new Map<string, Promise<void>>();
async function acquireFileLock(path: string): Promise<() => void> {
  const prefixes = [path, ...path.split("/").slice(0, -1).map((_, i, arr) => arr.slice(0, i + 1).join("/") + "/")];
  const key = prefixes[0];
  let release!: () => void;
  const wait = new Promise<void>((r) => { release = r; });
  const prev = lockChains.get(key) ?? Promise.resolve();
  lockChains.set(key, prev.then(() => wait));
  await prev;
  let released = false;
  return () => { if (!released) { released = true; release(); } };
}

function makeCtx(taskId: string, role: AgentRole, signal: AbortSignal): ToolCtx {
  const st = () => useStore.getState();
  const base: ToolCtx = {
    taskId, role, signal,
    autonomy: st().autonomy,
    acquireFileLock,
    files: () => getMergedFiles(st()),
    write: (path, after) => {
      const s = st();
      const before = getMergedFiles(s)[path] ?? "";
      const c: FileChange = {
        id: uid(), taskId, path,
        type: before === "" && !s.workspace?.files[path] ? "create" : "modify",
        before, after, at: Date.now(), status: "pending",
      };
      s.addPendingChange(c);
      s.setAgentState(role, { filesTouched: [...new Set([...s.agents[role].filesTouched, path])] });
      return c;
    },
    remove: (path) => {
      const s = st();
      const before = getMergedFiles(s)[path];
      if (before === undefined) return null;
      const c: FileChange = { id: uid(), taskId, path, type: "delete", before, after: "", at: Date.now(), status: "pending" };
      s.addPendingChange(c);
      return c;
    },
    rename: (from, to) => {
      const s = st();
      const before = getMergedFiles(s)[from] ?? "";
      const c: FileChange = { id: uid(), taskId, path: to, type: "modify", before, after: before, at: Date.now(), status: "pending" };
      s.addPendingChange(c);
      return c;
    },
    terminal: (kind, text) => {
      const s = st();
      const id = s.activeTerminalId ?? s.terminals[0]?.id;
      if (id) s.termLine(id, kind, text);
    },
    output: (kind, text) => st().pushOutput(kind, text),
    requestPermission: (cls, title, detail) => st().requestPermission(cls, title, detail),
    addProblems: (list) => st().addProblems(list),
  };
  return base;
}

/* ─────────── task queue + scheduler ─────────── */

export function submitAgentTask(prompt: string, opts: { planId?: string; roles?: AgentRole[] } = {}): void {
  const s0 = useStore.getState();
  if (!s0.workspace) { s0.toast("warn", "Open a project first", "Agents need a workspace to operate on."); return; }
  const task: AgentTask = {
    id: `task-${uid()}`, title: prompt.slice(0, 64), prompt, status: "queued",
    steps: [], todos: [], createdAt: Date.now(), queuedAt: Date.now(), planId: opts.planId,
  };
  (task as AgentTask & { roles?: AgentRole[] }).roles = opts.roles;
  s0.addTask(task);
  s0.setAiView("agent");
  s0.toast("info", "Task queued", "The scheduler runs it as capacity allows.");
  s0.log("AGENT", `queued ${task.id}: ${prompt.slice(0, 70)}`);
  void schedulerTick();
}

async function schedulerTick(): Promise<void> {
  for (;;) {
    const s = useStore.getState();
    const running = s.tasks.filter((t) => t.status === "running").length;
    const capacity = Math.max(1, Math.min(5, s.settings.maxAgents));
    const next = [...s.tasks].filter((t) => t.status === "queued").sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0))[0];
    if (!next || running >= capacity) return;
    const roles = ((next as AgentTask & { roles?: AgentRole[] }).roles) ?? undefined;
    s.updateTask(next.id, { status: "running" });
    await runAgentTaskInternal(next, { roles });
  }
}

/* ─────────── role selection (orchestrator decides the crew) ─────────── */

function pickImplementationRoles(prompt: string, files: Record<string, string>): AgentRole[] {
  const p = prompt.toLowerCase();
  const adapter = detectProject(files);
  const hasFrontend = /frontend|dashboard|ui|component|page|react|website|responsive|css/.test(p);
  const hasBackend = /backend|api|endpoint|server|fastapi|express|route/.test(p);
  const hasDb = /database|schema|model|migration|sqlite|sql\b/.test(p);
  const roles: AgentRole[] = [];
  if (hasFrontend && hasBackend) return ["frontend", "backend", ...(hasDb ? ["database" as AgentRole] : [])];
  if (adapter.language === "Python" && hasBackend) return hasDb ? ["backend", "database"] : ["backend"];
  if (hasDb && !hasFrontend) return ["database"];
  if (hasFrontend) return ["frontend"];
  return ["coder"];
}

function pickPlanRoles(): AgentRole[] {
  return ["orchestrator", "architect", "repository", "security"];
}
function pickTestRoles(): AgentRole[] {
  return ["orchestrator", "tester", "debugger", "reviewer"];
}
function pickChatRoles(): AgentRole[] {
  return ["repository"];
}

/* ─────────── the agent loop ─────────── */

const PIPELINE: AgentRole[] = ["orchestrator", "architect", "repository", "coder", "tester", "reviewer"];

interface RunOptions { roles?: AgentRole[]; planId?: string; }

async function runAgentRole(role: AgentRole, prompt: string, taskId: string, signal: AbortSignal): Promise<"done" | "blocked"> {
  const st = useStore.getState();
  const { provider, model, useOllama } = providerForRole(roleModelKey[role]);
  const merged = getMergedFiles(st);
  const facts = computeFacts(merged);
  const patches = useStore.getState().pending.filter((c) => c.taskId === taskId).map((c) => makePatch(c.path, c.before, c.after)).join("\n");
  const ctxBuild = buildContext({ files: merged, facts, mentions: [], problems: useStore.getState().problems, budget: 16000, gitSummary: role === "reviewer" || role === "security" ? patches : undefined });
  const userPrompt = role === "reviewer" ? buildReviewerPrompt(prompt, patches.slice(0, 6000)) : `${ctxBuild.text}${role === "security" ? `\n${patches.slice(0, 6000)}` : ""}\n\nTASK: ${prompt}`;

  const maxIter = Math.min(useStore.getState().settings.maxIterations, 10);
  const history: string[] = [];
  let decision: "continue" | "done" | "blocked" = "continue";
  let iterations = 0;

  while (decision === "continue" && iterations < maxIter && !signal.aborted) {
    iterations++;
    useStore.getState().setAgentState(role, { status: "running", note: useOllama ? `Iterating with ${model} (${iterations}/${maxIter})` : `Heuristic pass ${iterations}` });
    try {
      const d = await provider.decide({
        role, task: prompt, model,
        system: roleSystemPrompt[role],
        context: userPrompt,
        history: history.slice(-14).join("\n"),
        files: merged, facts,
        problems: useStore.getState().problems,
        params: useStore.getState().settings.params,
        signal,
      });
      decision = d.status;
      if (d.summary) {
        useStore.getState().setAgentState(role, { note: d.summary.slice(0, 220) });
        history.push(`[${role}] ${d.summary}`);
        useStore.getState().pushOutput("sys", `[${role}] ${d.summary}`);
      }
      if (d.todos?.length && role === "orchestrator") {
        const todos: TodoItem[] = d.todos.map((t) => ({ text: t.text, status: t.status }));
        useStore.getState().updateTask(taskId, { todos });
      }
      for (const call of d.toolCalls.slice(0, 4)) {
        if (signal.aborted) break;
        const ctx = makeCtx(taskId, role, signal);
        useStore.getState().log("TOOL", `${role} → ${call.tool}(${JSON.stringify(call.arguments).slice(0, 120)})`);
        let res;
        try { res = await executeTool(call.tool, call.arguments, ctx, "agent"); }
        catch (e) { res = { ok: false, result: `tool rejected: ${(e as Error).message}` }; }
        const rec = { id: uid(), taskId, role, tool: call.tool, args: call.arguments, result: res.result.slice(0, 500), ok: res.ok, at: Date.now() };
        const ag = useStore.getState().agents[role];
        useStore.getState().setAgentState(role, { toolCalls: [...ag.toolCalls.slice(-49), rec] });
        history.push(`[${role}:${call.tool}] ${res.result.slice(0, 200)}`);
        if (!res.ok) useStore.getState().setAgentState(role, { errors: [...useStore.getState().agents[role].errors, res.result].slice(-5) });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError" || signal.aborted) return "blocked";
      const msg = `decision failed: ${(e as Error).message}`;
      useStore.getState().setAgentState(role, { status: "failed", note: msg, errors: [...useStore.getState().agents[role].errors, msg] });
      useStore.getState().log("ERROR", `${role} ${msg}`);
      history.push(`[${role}] ${msg}`);
      return "blocked";
    }
  }
  if (iterations >= maxIter && decision === "continue") {
    useStore.getState().setAgentState(role, { status: "failed", note: `iteration limit (${maxIter}) reached` });
    return "blocked";
  }
  return decision === "blocked" ? "blocked" : "done";
}

async function runAgentTaskInternal(task: AgentTask, opts: RunOptions): Promise<void> {
  const taskId = task.id;
  const prompt = task.prompt;
  const ctrl = new AbortController();
  aborts.set(taskId, ctrl);
  const signal = ctrl.signal;

  const st = useStore.getState();
  st.setAgentRunning(true);
  st.setBottomView("output");
  st.setSidebarView("agents");

  const files = getMergedFiles(st);
  const implRoles = opts.roles ?? pickImplementationRoles(prompt, files);
  const blockedByPlan = st.autonomy === "plan";
  const roster: AgentRole[] = blockedByPlan
    ? ["orchestrator", "architect", "repository"]
    : ["orchestrator", "architect", "repository", ...implRoles, "tester", "reviewer"];
  const steps: TaskStep[] = roster.map((r) => ({ id: uid(), label: STEP_LABEL[r], status: "pending" }));
  st.updateTask(taskId, { steps, status: "running" });
  st.addCheckpoint({ id: uid(), label: `Before: ${prompt.slice(0, 48)}`, at: Date.now(), files: { ...files } });
  st.log("AGENT", `task ${taskId} running — crew: ${roster.join(" → ")}${blockedByPlan ? " (plan-only autonomy)" : ""}`);
  st.pushOutput("sys", `── task ${taskId}: ${prompt.slice(0, 90)}`);

  let status: AgentTask["status"] = "done";
  const summaryParts: string[] = [];

  try {
    for (const role of roster) {
      if (signal.aborted) { status = "cancelled"; break; }
      const idx = roster.indexOf(role);
      const patchStep = (s2: TaskStep["status"]) =>
        useStore.getState().updateTask(taskId, {
          steps: useStore.getState().tasks.find((t) => t.id === taskId)?.steps.map((s, i) => (i === idx ? { ...s, status: s2 } : s)) ?? steps,
        });
      patchStep("running");
      useStore.getState().setAgentState(role, { status: "thinking", note: "Building context…", errors: [] });

      // parallel implementation phase: independent roles run concurrently under file locks
      const isParallelStart = !blockedByPlan && useStore.getState().settings.parallelAgents && role === implRoles[0] && implRoles.length > 1;
      if (isParallelStart) {
        useStore.getState().pushOutput("sys", `── parallel phase: ${implRoles.join(" · ")} (file locks active)`);
        for (const r of implRoles) {
          useStore.getState().setAgentState(r, { status: "thinking", note: "Queued for parallel phase…" });
          const rIdx = roster.indexOf(r);
          useStore.getState().updateTask(taskId, {
            steps: useStore.getState().tasks.find((t) => t.id === taskId)?.steps.map((s, i) => (i === rIdx ? { ...s, status: "running" } : s)) ?? steps,
          });
        }
        const results = await Promise.all(implRoles.map((r) => runAgentRole(r, prompt, taskId, signal)));
        results.forEach((res, i) => {
          const r = implRoles[i];
          const final = useStore.getState().agents[r];
          useStore.getState().setAgentState(r, { status: res === "done" ? "completed" : "failed", output: final.note });
          if (final.note) summaryParts.push(`${r}: ${final.note}`);
          const rIdx = roster.indexOf(r);
          useStore.getState().updateTask(taskId, {
            steps: useStore.getState().tasks.find((t) => t.id === taskId)?.steps.map((s, ii) => (ii === rIdx ? { ...s, status: res === "done" ? "done" : "failed" } : s)) ?? steps,
          });
        });
        const parallelBlocked = results.includes("blocked");
        // skip the remaining impl roles (already ran in parallel)
        for (const r of implRoles.slice(1)) {
          const skipIdx = roster.indexOf(r);
          useStore.getState().updateTask(taskId, {
            steps: useStore.getState().tasks.find((t) => t.id === taskId)?.steps.map((s, i) => (i === skipIdx ? { ...s, status: "done" } : s)) ?? steps,
          });
        }
        // mark first impl role step done and continue past the group
        patchStep(parallelBlocked ? "failed" : "done");
        if (parallelBlocked) status = "blocked";
        continue;
      }

      const result = await runAgentRole(role, prompt, taskId, signal);
      if (signal.aborted) { status = "cancelled"; break; }
      const final = useStore.getState().agents[role];
      useStore.getState().setAgentState(role, { status: result === "done" ? "completed" : "failed", output: final.note });
      if (final.note) summaryParts.push(`${role}: ${final.note}`);
      patchStep(result === "done" ? "done" : "failed");
      if (result === "blocked" && status === "done") status = "blocked";
    }

    const pendingCount = useStore.getState().pending.filter((c) => c.taskId === taskId && c.status === "pending").length;
    if (status === "done") {
      summaryParts.push(`${pendingCount} pending change(s) await your review in Source Control.`);
      useStore.getState().toast("success", "Task complete", `${pendingCount} change(s) pending review`);
      useStore.getState().memoryAdd(`Task "${prompt.slice(0, 80)}" → ${pendingCount} change(s)`);
    } else if (status !== "cancelled") {
      useStore.getState().toast("warn", "Task needs attention", "See the agent panel for the failing step.");
    }
    useStore.getState().updateTask(taskId, {
      status,
      summary: summaryParts.join(" "),
      todos: status === "done"
        ? useStore.getState().tasks.find((t) => t.id === taskId)?.todos.map((t2) => ({ ...t2, status: "done" as const })) ?? []
        : useStore.getState().tasks.find((t) => t.id === taskId)?.todos ?? [],
    });
    useStore.getState().log("AGENT", `task ${taskId} ${status}`);
  } finally {
    aborts.delete(taskId);
    const anyRunning = useStore.getState().tasks.some((t) => t.status === "running");
    if (!anyRunning) useStore.getState().setAgentRunning(false);
    void schedulerTick();
  }
}

export async function runAgentTask(prompt: string, opts: RunOptions = {}): Promise<void> {
  submitAgentTask(prompt, opts);
}

/* ─────────── chat streaming ─────────── */

export async function sendChat(message: string): Promise<void> {
  const st = useStore.getState();
  const text = message.trim();
  if (!text || st.streaming) return;

  let chatId = st.activeChatId;
  if (!chatId || !st.chats.some((c) => c.id === chatId)) chatId = st.newChat();
  if (st.chats.find((c) => c.id === chatId)?.title === "New chat") st.renameChat(chatId, text.slice(0, 42));
  const attachments = st.attachments.map((a) => a.name);
  const userMsg: ChatMessage = { id: uid(), role: "user", content: text, at: Date.now(), attachments };
  st.appendChatMessage(chatId, userMsg);

  abort = new AbortController();
  const signal = abort.signal;
  useStore.getState().setStreaming(true);
  useStore.getState().setStreamText("");
  useStore.getState().log("AI", `chat: ${text.slice(0, 80)}`);

  const s = useStore.getState();
  const files = getMergedFiles(s);
  const facts = computeFacts(files);
  const mentions = parseMentions(text);
  const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
  const activeFile = activeTab?.kind === "file" ? activeTab.path ?? null : null;
  const terminalTail = s.terminals.find((t) => t.id === s.activeTerminalId)?.lines.slice(-25).map((l) => l.text).join("\n") ?? "";
  const pendingPatches = s.pending.filter((c) => c.status === "pending").slice(0, 10).map((c) => makePatch(c.path, c.before, c.after)).join("\n");
  const gitSummary = [
    `Pending changes (${s.pending.length}):`,
    ...s.pending.slice(0, 15).map((c) => `  ${c.type} ${c.path}`),
    `Checkpoints: ${s.checkpoints.length} local snapshot(s) — latest: ${s.checkpoints[0]?.label ?? "none"}`,
  ].join("\n");
  const diffText = mentions.some((m) => m.type === "diff") ? pendingPatches : undefined;
  const ctx = buildContext({
    files, facts, activeFile, selection: s.selection || undefined, mentions,
    problems: s.problems, terminalTail, gitSummary, diffText,
    testsSummary: mentions.some((m) => m.type === "tests") ? s.testRuns.slice(0, 6).map((r) => `${r.kind}: ${r.passed}p/${r.failed}f`).join(" · ") : undefined,
    docsSummary: mentions.some((m) => m.type === "docs") ? (files["README.md"] ?? "").slice(0, 2000) : undefined,
    codebaseSummary: mentions.some((m) => m.type === "codebase") ? s.index?.summary : undefined,
    extraFiles: mentions.filter((m) => m.type === "file").map((m) => m.arg).filter(Boolean),
  });

  const { provider, model, useOllama } = providerForRole("chat");
  const history = useStore.getState().chats.find((c) => c.id === chatId)?.messages.slice(-12) ?? [];
  const images = useStore.getState().attachments.map((a) => a.dataUrl.split(",")[1]).filter(Boolean);
  const messages = [
    { role: "system" as const, content: `${CHAT_SYSTEM_PROMPT}\n\nActive model: ${model}${useOllama ? "" : " (built-in heuristic engine — real static analysis, not an LLM)"}` },
    ...history.filter((m) => m.role !== "system").slice(0, -1).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: buildChatUserPrompt(text, ctx.text), images: images.length ? images : undefined },
  ];

  try {
    const full = await provider.streamChat({
      model, messages, params: s.settings.params, signal,
      onToken: (tok) => useStore.getState().appendStream(tok),
      files, facts,
      extraFile: mentions.find((m) => m.type === "file")?.arg ?? activeFile,
    });
    const finalText = full || useStore.getState().streamText;
    useStore.getState().appendChatMessage(chatId, { id: uid(), role: "assistant", content: finalText, at: Date.now(), model });
    useStore.getState().setAttachments([]);
    if (ctx.masked.length) useStore.getState().toast("warn", "Secrets masked", `${ctx.masked.join(", ")} was sanitized before entering the prompt.`);
  } catch (e) {
    const partial = useStore.getState().streamText;
    if ((e as Error).name === "AbortError") {
      if (partial) useStore.getState().appendChatMessage(chatId, { id: uid(), role: "assistant", content: partial + "\n\n_— stopped —_", at: Date.now(), model });
    } else {
      useStore.getState().appendChatMessage(chatId, { id: uid(), role: "assistant", content: `⚠ ${(e as Error).message}\n\nCheck Settings → AI: is Ollama running, and is the model pulled?`, at: Date.now(), model });
      useStore.getState().toast("error", "Chat failed", (e as Error).message.slice(0, 120));
      useStore.getState().log("ERROR", `chat: ${(e as Error).message}`);
    }
  } finally {
    useStore.getState().setStreaming(false);
    useStore.getState().setStreamText("");
  }
}

export function regenerateLast(): void {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === s.activeChatId);
  if (!chat || s.streaming) return;
  const msgs = [...chat.messages];
  while (msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.pop();
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  if (!lastUser) return;
  s.setChatMessages(chat.id, msgs);
  void sendChat(lastUser.content);
}

/* ─────────── inline AI (Ctrl+K) ─────────── */

export async function runInlineEdit(instruction: string, action: InlineAction): Promise<void> {
  const s = useStore.getState();
  const edit = s.inlineEdit;
  if (!edit) return;
  useStore.getState().setInlineEdit({ ...edit, instruction: instruction || edit.instruction, action, status: "working", proposed: null, explanation: null });
  const files = getMergedFiles(s);
  const facts = computeFacts(files);
  const { provider, model, useOllama } = providerForRole("agent");

  const promptForAction: Record<InlineAction, string> = {
    prompt: instruction,
    explain: "Explain this code (return a markdown explanation prefixed with @@EXPLAIN@@)",
    fix: "Fix the bugs and problems in this code",
    improve: "Improve this code: clarity, safety, idioms — keep behavior",
    refactor: "Refactor this code for readability without changing behavior",
    tests: "Generate Vitest/Jest unit tests for this code (return only the test file, prefixed with @@TESTS@@)",
  };

  try {
    let out = "";
    await provider.streamChat({
      model,
      messages: [
        { role: "system", content: useOllama ? INLINE_EDIT_PROMPT : INLINE_EDIT_PROMPT },
        { role: "user", content: `File: ${edit.path} (${facts.framework})\n\nInstruction: ${promptForAction[action]}\n\n<selection>\n${edit.original}\n</selection>` },
      ],
      params: s.settings.params,
      signal: new AbortController().signal,
      onToken: (t) => { out += t; },
      files, facts,
    });
    if (out.startsWith("@@EXPLAIN@@") || action === "explain") {
      const explanation = out.replace(/^@@EXPLAIN@@/, "").trim() || heuristicExplain(edit.original, edit.path);
      useStore.getState().setInlineEdit({ ...useStore.getState().inlineEdit!, status: "ready", proposed: edit.original, explanation });
      return;
    }
    if (out.startsWith("@@TESTS@@") || action === "tests") {
      const tests = out.replace(/^@@TESTS@@/, "").trim() || heuristicTests(edit.original, edit.path);
      useStore.getState().setInlineEdit({ ...useStore.getState().inlineEdit!, status: "ready", proposed: null, explanation: `**Proposed test file** \`${testPathFor(edit.path)}\` — Accept writes it as a pending change.\n\n\`\`\`ts\n${tests.slice(0, 900)}\n\`\`\`` });
      useStore.getState().setInlineEdit({ ...useStore.getState().inlineEdit!, proposed: tests, action: "tests" });
      return;
    }
    let proposed = out.trim().replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
    if (!proposed || proposed === edit.original) proposed = heuristicTransform(edit.original, action);
    useStore.getState().setInlineEdit({ ...useStore.getState().inlineEdit!, status: "ready", proposed });
  } catch (e) {
    useStore.getState().setInlineEdit({ ...useStore.getState().inlineEdit!, status: "ready", proposed: heuristicTransform(edit.original, action), explanation: `Model unavailable (${(e as Error).message.slice(0, 80)}) — showing the heuristic ${action} instead.` });
  }
}

function heuristicExplain(code: string, path: string): string {
  const lines = code.split("\n").length;
  const fns = (code.match(/(?:function|=>|def|fn)\s*[A-Za-z(]/g) ?? []).length;
  const imports = (code.match(/^import /gm) ?? []).length;
  return [
    `**\`${path}\` selection** — ${lines} line(s), ~${fns} function-like construct(s), ${imports} import(s).`,
    code.includes("useState") ? "Uses React state hooks — re-renders on every state change." : null,
    code.includes("async") ? "Contains asynchronous code — errors need try/catch or .catch handling." : null,
    (code.match(/any\b/g) ?? []).length ? "⚠ Uses `any` — tighten the types for safety." : null,
    `_Heuristic explanation. Connect Ollama for a full walkthrough._`,
  ].filter(Boolean).join("\n");
}

export function testPathFor(path: string): string {
  return path.replace(/\.(ts|tsx|js|jsx)$/, ".generated.test.ts");
}

function heuristicTests(code: string, path: string): string {
  const fns = [...code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const base = path.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") ?? "module";
  const cases = fns.length
    ? fns.map((f) => `  it("${f} is callable", () => {\n    expect(typeof ${f}).toBe("function");\n  });`).join("\n")
    : `  it("module loads", () => {\n    expect(true).toBe(true);\n  });`;
  return `import { describe, it, expect } from "vitest";\n${fns.length ? `import { ${fns.join(", ")} } from "./${base}";\n` : ""}\ndescribe("${base}", () => {\n${cases}\n});\n`;
}

function heuristicTransform(code: string, action: InlineAction): string {
  let out = code;
  if (action === "fix" || action === "improve") {
    out = out.split("\n").filter((l) => !/^\s*console\.log\(/.test(l) && !/^\s*debugger;?\s*$/.test(l)).join("\n");
    out = out.replace(/==(?!=)/g, "===").replace(/!=(?!=)/g, "!==");
    if (action === "improve") out = out.replace(/var\s+/g, "const ");
  }
  if (action === "refactor") {
    out = out.replace(/\t/g, "  ").replace(/[ \t]+$/gm, "");
  }
  return out === code ? code : out;
}

export function acceptInlineEdit(): void {
  const s = useStore.getState();
  const edit = s.inlineEdit;
  if (!edit || edit.proposed === null) { useStore.getState().setInlineEdit(null); return; }
  const ws = s.workspace;
  if (!ws) return;
  const full = (s.dirty[edit.path] ?? ws.files[edit.path]) ?? "";
  let after: string;
  if (edit.action === "tests") {
    const tp = testPathFor(edit.path);
    const c: FileChange = { id: uid(), taskId: "inline-ai", path: tp, type: "create", before: "", after: edit.proposed, at: Date.now(), status: "pending" };
    s.addPendingChange(c);
    useStore.getState().toast("success", "Test file staged", tp);
    useStore.getState().setInlineEdit(null);
    return;
  }
  after = full.slice(0, edit.from) + edit.proposed + full.slice(edit.to);
  const c: FileChange = { id: uid(), taskId: "inline-ai", path: edit.path, type: "modify", before: full, after, at: Date.now(), status: "pending" };
  s.addPendingChange(c);
  useStore.getState().toast("success", "Inline edit staged", `${edit.path} — review it in Source Control.`);
  useStore.getState().setInlineEdit(null);
}

/* ─────────── terminal bridge ─────────── */

export async function executeTerminalLine(sessionId: string, cmd: string): Promise<void> {
  const st = useStore.getState();
  if (cmd.trim() === "clear") { st.clearTerminal(sessionId); return; }
  st.termLine(sessionId, "cmd", `${st.settings.shell} ❯ ${cmd}`);
  st.log("TERMINAL", cmd.slice(0, 120));
  const ctrl = new AbortController();
  const ctx = makeCtx("terminal", "coder", ctrl.signal);
  const wrapped: ToolCtx = { ...ctx, terminal: (kind, text) => useStore.getState().termLine(sessionId, kind, text) };
  try {
    await runShellLine(cmd, wrapped, "terminal");
  } catch (e) {
    useStore.getState().termLine(sessionId, "err", `shell error: ${(e as Error).message}`);
  }
}

/* ─────────── run / services / preview ─────────── */

export async function rebuildPreview(showToast = false): Promise<void> {
  const s = useStore.getState();
  const ws = s.workspace;
  if (!ws) return;
  const files = getMergedFiles(s);
  const adapter = detectProject(files);
  const token = ++previewBuildToken;
  useStore.getState().setPreview({ building: true, error: null });
  const svcId = `svc-preview`;
  try {
    if (adapter.previewKind === "static" || (adapter.previewKind === "esbuild" && !files["package.json"])) {
      const built = buildStaticPreview(files);
      if (token !== previewBuildToken) return;
      useStore.getState().setPreview({ doc: built.doc, mode: "static", kind: "static", url: "localforge://preview/index.html", note: built.note, building: false });
      useStore.getState().setService({ id: svcId, name: "Static preview server", command: "in-browser blob server", cwd: ".", port: null, status: "running", startedAt: Date.now(), kind: "static", logs: [{ kind: "sys", text: built.note }] });
    } else if (adapter.previewKind === "esbuild") {
      const built = await buildEsbuildPreview(files);
      if (token !== previewBuildToken) return;
      useStore.getState().setPreview({ doc: built.doc, mode: "esbuild", kind: "esbuild", url: `localforge://preview/${adapter.entryFile ?? "index.html"}`, note: built.note, building: false });
      useStore.getState().setService({ id: svcId, name: `${adapter.framework} preview (esbuild)`, command: "esbuild-wasm bundle", cwd: ".", port: adapter.defaultPort, status: "running", startedAt: Date.now(), kind: "esbuild", logs: [{ kind: "sys", text: built.note }] });
    } else {
      if (token !== previewBuildToken) return;
      const lines = useStore.getState().output.slice(-40);
      useStore.getState().setPreview({ doc: consolePreviewDoc(lines, adapter), mode: "console", kind: adapter.previewKind, url: "", note: `${adapter.name} is not a browser project — showing console output instead of forcing a web view.`, building: false });
      useStore.getState().setService({ id: svcId, name: `${adapter.name} run`, command: adapter.runCommand ?? "n/a", cwd: ".", port: adapter.defaultPort, status: "requires-desktop", startedAt: Date.now(), kind: adapter.previewKind, logs: [{ kind: "sys", text: "process execution needs the desktop runtime" }] });
    }
    if (showToast) useStore.getState().toast("success", "Preview ready", adapter.name);
    useStore.getState().log("APP", `preview rebuilt (${adapter.previewKind})`);
  } catch (e) {
    if (token !== previewBuildToken) return;
    const msg = (e as Error).message;
    useStore.getState().setPreview({ building: false, error: msg, doc: consolePreviewDoc([{ kind: "err", text: msg }, { kind: "sys", text: "Fix the error and the preview will rebuild automatically." }], adapter) });
    useStore.getState().setService({ id: svcId, name: `${adapter.framework} preview`, command: "esbuild-wasm bundle", cwd: ".", port: null, status: "crashed", startedAt: Date.now(), kind: "esbuild", logs: [{ kind: "err", text: msg }] });
    useStore.getState().log("ERROR", `preview build: ${msg}`);
    if (showToast) useStore.getState().toast("error", "Preview build failed", msg.slice(0, 140));
  }
}

export async function openPreview(): Promise<void> {
  useStore.getState().openSpecialTab({ id: "preview-tab", kind: "preview", title: "Preview" });
  await rebuildPreview(true);
}

let rebuildTimer: number | null = null;
export function schedulePreviewRebuild(): void {
  if (!useStore.getState().preview.autoRefresh) return;
  if (useStore.getState().preview.mode === "none") return;
  if (rebuildTimer) window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => void rebuildPreview(), 450);
}

export function runProject(): void {
  const st = useStore.getState();
  if (!st.workspace) { st.toast("warn", "Open a project first"); return; }
  const files = getMergedFiles(st);
  const adapter = detectProject(files);
  st.setBottomView("output");
  st.pushOutput("sys", `── run (${adapter.name})`);

  const svcBase: ServiceInfo = {
    id: `svc-run`, name: adapter.services[0]?.name ?? `${adapter.name} process`,
    command: adapter.runCommand ?? "n/a", cwd: adapter.services[0]?.cwd ?? ".",
    port: adapter.defaultPort, status: "starting", startedAt: Date.now(), kind: adapter.previewKind, logs: [],
  };

  if (!adapter.runCommand && adapter.previewKind === "none") {
    st.pushOutput("err", "no run command detected for this project type");
    st.toast("warn", "Nothing to run", `The ${adapter.name} adapter found no run command.`);
    st.setService({ ...svcBase, status: "stopped" });
    return;
  }

  void st.requestPermission("ask", adapter.runCommand ?? "run project", `Run the project using the ${adapter.name} adapter's detected command.`).then(async (allowed) => {
    if (!allowed) { st.pushOutput("sys", "run cancelled by user"); return; }
    st.setService(svcBase);
    st.termLine(st.activeTerminalId ?? "", "cmd", `${st.settings.shell} ❯ ${adapter.runCommand}`);
    st.pushOutput("sys", `> ${adapter.runCommand}`);

    // validate config with the static engine — real checks, honest reporting
    const results = runSuite("build", files);
    for (const r of results) { for (const l of r.lines) st.pushOutput(l.kind, `  ${l.text}`); st.addProblems(r.problems); }
    const failed = results.some((r) => r.failed);

    if (adapter.previewKind === "esbuild" || adapter.previewKind === "static") {
      await openPreview();
      st.setService({ ...svcBase, status: "running", logs: [{ kind: "sys", text: "serving via the in-browser preview engine" }] });
      st.toast(failed ? "warn" : "success", failed ? "Preview up with issues" : "Project running", failed ? "Static checks found problems — see Output." : `Live preview opened (${adapter.previewKind}).`);
    } else if (adapter.previewKind === "api") {
      const url = `http://localhost:${adapter.defaultPort ?? 8000}`;
      st.setService({ ...svcBase, status: "requires-desktop", logs: [{ kind: "sys", text: `API would listen on ${url} — process spawning needs the desktop runtime` }] });
      st.setPreview({ detectedUrls: [...new Set([...useStore.getState().preview.detectedUrls, url, adapter.id === "fastapi" ? `${url}/docs` : url])] });
      st.pushOutput("sys", `detected URL: ${url}${adapter.id === "fastapi" ? " · Swagger: " + url + "/docs" : ""}`);
      st.toast("info", "API validated", "Config OK — the live process needs the desktop runtime. Use the API tab to test endpoints.");
      await openPreview();
    } else {
      const results2 = runSuite("runtime", files);
      for (const r of results2) for (const l of r.lines) st.pushOutput(l.kind, `  ${l.text}`);
      st.setService({ ...svcBase, status: "requires-desktop", logs: [{ kind: "sys", text: "console app — output appears here when run in the desktop runtime" }] });
      st.setPreview({ kind: "console", mode: "console", doc: consolePreviewDoc(useStore.getState().output.slice(-30), adapter), note: "Console application — showing run output, not a browser view.", url: "", building: false, error: null });
      st.openSpecialTab({ id: "preview-tab", kind: "preview", title: "Preview" });
      st.toast("info", "Run validated", "Console output preview opened — OS process spawning needs the desktop runtime.");
    }
    st.log("TERMINAL", `run ${adapter.runCommand}`);
  });
}

/* ─────────── tests / build / analyze / fix ─────────── */

export async function runTestSuite(kind: TestKind): Promise<void> {
  const st = useStore.getState();
  if (!st.workspace) { st.toast("warn", "Open a project first"); return; }
  st.setAiView("test");
  st.setBottomView("tests");
  const files = getMergedFiles(st);
  st.log("TEST", `suite ${kind} started`);
  st.pushOutput("sys", `── test suite: ${kind}`);
  await new Promise((r) => setTimeout(r, 60));
  const results = runSuite(kind, files);
  let p = 0, f = 0, sk = 0;
  for (const r of results) {
    p += r.passed; f += r.failed; sk += r.skipped;
    for (const l of r.lines) st.pushOutput(l.kind, `  [${r.kind}] ${l.text}`);
    st.clearProblemsBySource(r.kind);
    st.addProblems(r.problems);
    st.addTestRun(toTestRun(r));
  }
  st.log("TEST", `suite ${kind}: ${p} passed, ${f} failed, ${sk} skipped`);
  st.toast(f ? "error" : "success", f ? "Tests failed" : "Tests passed", `${p} passed · ${f} failed · ${sk} skipped`);
  if (f) st.setBottomView("problems");
}

export async function buildProject(): Promise<void> { await runTestSuite("build"); }
export async function testProject(): Promise<void> { await runTestSuite("unit"); }

export function analyzeProject(): void {
  const st = useStore.getState();
  if (!st.workspace) { st.toast("warn", "Open a project first"); return; }
  const report = projectHealth(getMergedFiles(st));
  st.setReport(report);
  st.openSpecialTab({ id: "report-tab", kind: "report", title: "Health Report" });
  st.toast("success", "Health report ready", "All figures computed from the indexed files.");
  st.log("APP", "project health analyzed");
}

export function fixWithAI(problems: Problem[]): void {
  const st = useStore.getState();
  if (!problems.length) return;
  st.setAiView("agent");
  const summary = problems.slice(0, 6).map((p) => `${p.severity} ${p.file}:${p.line} ${p.message}`).join("\n");
  submitAgentTask(`Fix these reported errors:\n${summary}`, { roles: ["debugger", "reviewer"] });
}

export function fixPreviewErrorWithAI(): void {
  const st = useStore.getState();
  const errs = [
    st.preview.error ? `preview build error: ${st.preview.error}` : null,
    ...st.preview.consoleLines.filter((l) => l.kind === "err").slice(-5).map((l) => `console: ${l.text}`),
  ].filter(Boolean).join("\n");
  if (!errs) { st.toast("info", "Nothing to fix", "No preview errors captured."); return; }
  st.setAiView("agent");
  submitAgentTask(`Fix these runtime/preview errors:\n${errs}`, { roles: ["debugger", "reviewer"] });
}

/* ─────────── create project with AI ─────────── */

export async function createProjectWithAI(description: string): Promise<void> {
  const st = useStore.getState();
  const d = description.toLowerCase();
  const kind = /fastapi|python|api backend/.test(d) ? "fastapi" : /html|static|restaurant|portfolio|landing/.test(d) && !/react/.test(d) ? "static" : "vite-react";
  st.toast("info", "Scaffolding project…", `Adapter template: ${kind}. The agents will extend it.`);
  st.log("AGENT", `create project: ${description} → ${kind}`);
  const files = templateFiles(kind);
  st.setWorkspace({ label: `generated-${kind}-${uid().slice(0, 4)}`, source: "upload", files, openedAt: Date.now() });
  await new Promise((r) => setTimeout(r, 50));
  await rebuildPreview();
  st.openSpecialTab({ id: "preview-tab", kind: "preview", title: "Preview" });
  submitAgentTask(`In this freshly scaffolded ${kind} project, realize this brief: "${description}". Extend the existing files and keep the structure working.`, {});
}

/* ─────────── helpers reused by UI ─────────── */

export function detectedUrls(): string[] {
  const s = useStore.getState();
  const all = [
    ...s.preview.detectedUrls,
    ...detectUrlsIn(s.terminals.flatMap((t) => t.lines).map((l) => l.text).join("\n")),
    ...detectUrlsIn(s.output.map((l) => l.text).join("\n")),
  ];
  return [...new Set(all)];
}

export type { AppState };
