/**
 * Deterministic orchestration core. The LLM only proposes strict-JSON decisions;
 * this module owns the task lifecycle, tool validation, iteration caps,
 * permission gating and file access.
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
import { executeTool, runShellLine, type ToolCtx } from "../ai/tools";
import { projectHealth, runSuite, toTestRun } from "./testing";
import type {
  AgentRole, AgentTask, ChatMessage, FileChange, Problem, TaskStep, TestKind, TodoItem,
} from "../lib/types";
import { getMergedFiles, resolveModel, uid, useStore, type ModelRole } from "../state/store";

let abort: AbortController | null = null;

export function stopGeneration(): void {
  abort?.abort();
  const s = useStore.getState();
  if (s.streaming) {
    s.setStreaming(false);
    s.toast("info", "Generation stopped");
  }
  if (s.agentRunning) {
    s.setAgentRunning(false);
    s.toast("info", "Agents stopped", "Partial changes remain in Source Control for review.");
  }
}

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
  tester: TESTER_SYSTEM_PROMPT,
  debugger: DEBUGGER_SYSTEM_PROMPT,
  reviewer: REVIEWER_SYSTEM_PROMPT,
};

const roleModelKey: Record<AgentRole, ModelRole> = {
  orchestrator: "agent", architect: "agent", repository: "agent", coder: "agent",
  tester: "tester", debugger: "agent", reviewer: "reviewer",
};

function makeCtx(taskId: string, role: AgentRole, signal: AbortSignal): ToolCtx {
  const st = () => useStore.getState();
  return {
    taskId,
    role,
    signal,
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
      s.setAgentState(role, { filesTouched: [...new Set([...s.agents[role].filesTouched, path])] });
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
}

/* ─────────────── agent task pipeline ─────────────── */

const PIPELINE: AgentRole[] = ["orchestrator", "architect", "repository", "coder", "tester", "reviewer"];

const STEP_LABEL: Record<AgentRole, string> = {
  orchestrator: "Decompose task",
  architect: "Analyze architecture",
  repository: "Gather context",
  coder: "Implement changes",
  tester: "Validate (tests · lint · build)",
  debugger: "Fix failures",
  reviewer: "Review changes",
};

export interface TaskOptions { planId?: string; roles?: AgentRole[]; }

export async function runAgentTask(prompt: string, opts: TaskOptions = {}): Promise<void> {
  const s0 = useStore.getState();
  if (!s0.workspace) { s0.toast("warn", "Open a project first", "Agents need a workspace to operate on."); return; }

  abort = new AbortController();
  const signal = abort.signal;
  const st = useStore.getState();
  st.resetAgents();
  st.setAgentRunning(true);
  st.setAiView("agent");
  st.setBottomView("output");
  st.setSidebarView("agents");

  const taskId = `task-${uid()}`;
  const files = getMergedFiles(st);
  const facts = computeFacts(files);
  const roles = opts.roles ?? [...PIPELINE];

  // Checkpoint before any agent mutation.
  st.addCheckpoint({ id: uid(), label: `Before: ${prompt.slice(0, 48)}`, at: Date.now(), files: { ...files } });

  const steps: TaskStep[] = roles.map((r) => ({ id: uid(), label: STEP_LABEL[r], status: "pending" }));
  const task: AgentTask = {
    id: taskId, title: prompt.slice(0, 64), prompt, status: "running",
    steps, todos: [], createdAt: Date.now(), planId: opts.planId,
  };
  st.addTask(task);
  st.log("AGENT", `task ${taskId} started — pipeline: ${roles.join(" → ")}`);
  st.pushOutput("sys", `── task ${taskId}: ${prompt.slice(0, 90)}`);

  const history: string[] = [];
  let status: AgentTask["status"] = "done";
  const summaryParts: string[] = [];

  try {
    for (const role of roles) {
      if (signal.aborted) { status = "cancelled"; break; }
      const stepIdx = roles.indexOf(role);
      useStore.getState().updateTask(taskId, {
        steps: useStore.getState().tasks.find((t) => t.id === taskId)?.steps.map((s, i) => (i === stepIdx ? { ...s, status: "running" } : s)) ?? steps,
      });
      useStore.getState().setAgentState(role, { status: "thinking", note: "Building context…", errors: [] });

      const { provider, model, useOllama } = providerForRole(roleModelKey[role]);
      const cur = useStore.getState();
      const merged = getMergedFiles(cur);
      const patches = cur.pending
        .filter((c) => c.taskId === taskId)
        .map((c) => makePatch(c.path, c.before, c.after))
        .join("\n");
      const ctxBuild = buildContext({
        files: merged, facts, mentions: [], problems: cur.problems, budget: 16000,
        gitSummary: role === "reviewer" ? patches : undefined,
      });
      const extra = role === "reviewer" && patches ? `\n${patches.slice(0, 6000)}` : "";
      const userPrompt = role === "reviewer" ? buildReviewerPrompt(prompt, patches.slice(0, 6000)) : `${ctxBuild.text}${extra}\n\nTASK: ${prompt}`;

      const maxIter = Math.min(cur.settings.maxIterations, 10);
      let decision = "continue";
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
            params: cur.settings.params,
            signal,
          });
          decision = d.status;
          if (d.summary) {
            useStore.getState().setAgentState(role, { note: d.summary.slice(0, 220) });
            history.push(`[${role}] ${d.summary}`);
            useStore.getState().pushOutput(role === "coder" || role === "debugger" ? "out" : "sys", `[${role}] ${d.summary}`);
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
            try {
              res = await executeTool(call.tool, call.arguments, ctx, "agent");
            } catch (e) {
              res = { ok: false, result: `tool rejected: ${(e as Error).message}` };
            }
            const rec = {
              id: uid(), taskId, role, tool: call.tool,
              args: call.arguments, result: res.result.slice(0, 500), ok: res.ok, at: Date.now(),
            };
            const ag = useStore.getState().agents[role];
            useStore.getState().setAgentState(role, { toolCalls: [...ag.toolCalls.slice(-49), rec] });
            history.push(`[${role}:${call.tool}] ${res.result.slice(0, 200)}`);
            if (!res.ok) {
              const errs = [...useStore.getState().agents[role].errors, res.result].slice(-5);
              useStore.getState().setAgentState(role, { errors: errs });
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError" || signal.aborted) { status = "cancelled"; break; }
          const msg = `decision failed: ${(e as Error).message}`;
          useStore.getState().setAgentState(role, { status: "failed", note: msg, errors: [...useStore.getState().agents[role].errors, msg] });
          useStore.getState().log("ERROR", `${role} ${msg}`);
          history.push(`[${role}] ${msg}`);
          decision = "blocked";
          status = "failed";
        }
      }

      if (status === "cancelled") break;
      if (decision === "blocked") { status = "blocked"; }
      if (iterations >= maxIter && decision === "continue") {
        useStore.getState().setAgentState(role, { status: "failed", note: `iteration limit (${maxIter}) reached` });
        status = status === "done" ? "blocked" : status;
      }

      const finalState = useStore.getState().agents[role];
      const completed = status === "done" && decision !== "blocked";
      const cancelledNow = signal.aborted;
      useStore.getState().setAgentState(role, {
        status: completed ? "completed" : cancelledNow ? "cancelled" : decision === "blocked" ? "waiting" : "completed",
        output: finalState.note,
      });
      if (finalState.note) summaryParts.push(`${role}: ${finalState.note}`);
      useStore.getState().updateTask(taskId, {
        steps: useStore.getState().tasks.find((t) => t.id === taskId)?.steps.map((s, i) => (i === stepIdx ? { ...s, status: decision === "blocked" ? "failed" : "done" } : s)) ?? steps,
      });

      // Insert the debugger when validation surfaced errors.
      if (role === "tester" && useStore.getState().problems.some((p) => p.severity === "error") && !roles.includes("debugger")) {
        roles.splice(roles.indexOf("tester") + 1, 0, "debugger");
        const ts = useStore.getState().tasks.find((t) => t.id === taskId)?.steps ?? [];
        useStore.getState().updateTask(taskId, {
          steps: [...ts.slice(0, roles.indexOf("debugger")), { id: uid(), label: STEP_LABEL.debugger, status: "pending" as const }, ...ts.slice(roles.indexOf("debugger"))],
        });
      }
    }

    const pendingCount = useStore.getState().pending.filter((c) => c.taskId === taskId).length;
    if (status === "done") {
      summaryParts.push(`${pendingCount} pending change(s) await your review in Source Control.`);
      useStore.getState().toast("success", "Task complete", `${pendingCount} change(s) pending review`);
      useStore.getState().memoryAdd(`Task "${prompt.slice(0, 80)}" → ${pendingCount} change(s), pipeline ${roles.join("→")}`);
    } else if (status === "blocked" || status === "failed") {
      useStore.getState().toast("warn", "Task needs attention", "See agent panel for the failing step.");
    }

    useStore.getState().updateTask(taskId, {
      status,
      summary: summaryParts.join(" "),
      todos: status === "done"
        ? useStore.getState().tasks.find((t) => t.id === taskId)?.todos.map((t) => ({ ...t, status: "done" as const })) ?? []
        : useStore.getState().tasks.find((t) => t.id === taskId)?.todos ?? [],
    });
    useStore.getState().log("AGENT", `task ${taskId} ${status}`);
  } finally {
    useStore.getState().setAgentRunning(false);
  }
}

/* ─────────────── chat streaming ─────────────── */

export async function sendChat(message: string): Promise<void> {
  const st = useStore.getState();
  const text = message.trim();
  if (!text || st.streaming) return;

  let chatId = st.activeChatId;
  if (!chatId || !st.chats.some((c) => c.id === chatId)) chatId = st.newChat();
  const project = st.workspace?.label ?? "no-project";
  if (st.chats.find((c) => c.id === chatId)?.title === "New chat") {
    st.renameChat(chatId, text.slice(0, 42));
  }
  const userMsg: ChatMessage = { id: uid(), role: "user", content: text, at: Date.now() };
  st.appendChatMessage(chatId, userMsg);
  void project;

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
  const gitSummary = [
    `Pending changes (${s.pending.length}):`,
    ...s.pending.slice(0, 15).map((c) => `  ${c.type} ${c.path}`),
    `Checkpoints: ${s.checkpoints.length} local snapshot(s) — latest: ${s.checkpoints[0]?.label ?? "none"}`,
  ].join("\n");
  const ctx = buildContext({
    files, facts, activeFile, selection: s.selection || undefined, mentions,
    problems: s.problems, terminalTail, gitSummary,
    extraFiles: mentions.filter((m) => m.type === "file").map((m) => m.arg).filter(Boolean),
  });

  const { provider, model, useOllama } = providerForRole("chat");
  const history = useStore.getState().chats.find((c) => c.id === chatId)?.messages.slice(-12) ?? [];
  const messages = [
    { role: "system" as const, content: `${CHAT_SYSTEM_PROMPT}\n\nActive model: ${model}${useOllama ? "" : " (built-in heuristic engine — real static analysis, not an LLM)"}` },
    ...history.filter((m) => m.role !== "system").slice(0, -1).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: buildChatUserPrompt(text, ctx.text) },
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
    if (ctx.masked.length) {
      useStore.getState().toast("warn", "Secrets masked", `${ctx.masked.join(", ")} was sanitized before entering the prompt.`);
    }
  } catch (e) {
    const partial = useStore.getState().streamText;
    if ((e as Error).name === "AbortError") {
      if (partial) useStore.getState().appendChatMessage(chatId, { id: uid(), role: "assistant", content: partial + "\n\n_— stopped —_", at: Date.now(), model });
    } else {
      useStore.getState().appendChatMessage(chatId, { id: uid(), role: "assistant", content: `⚠ ${ (e as Error).message}\n\nCheck Settings → AI: is Ollama running, and is the model pulled?`, at: Date.now(), model });
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

/* ─────────────── terminal bridge ─────────────── */

export async function executeTerminalLine(sessionId: string, cmd: string): Promise<void> {
  const st = useStore.getState();
  st.termLine(sessionId, "cmd", `${st.settings.shell} ❯ ${cmd}`);
  st.log("TERMINAL", cmd.slice(0, 120));
  const ctrl = new AbortController();
  const ctx = makeCtx("terminal", "coder", ctrl.signal);
  const wrapped: ToolCtx = {
    ...ctx,
    terminal: (kind, text) => useStore.getState().termLine(sessionId, kind, text),
  };
  try {
    await runShellLine(cmd, wrapped, "terminal");
  } catch (e) {
    useStore.getState().termLine(sessionId, "err", `shell error: ${(e as Error).message}`);
  }
}

/* ─────────────── test / build / run / analyze ─────────────── */

export async function runTestSuite(kind: TestKind): Promise<void> {
  const st = useStore.getState();
  if (!st.workspace) { st.toast("warn", "Open a project first"); return; }
  st.setAiView("test");
  st.setBottomView("tests");
  const files = getMergedFiles(st);
  st.log("TEST", `suite ${kind} started`);
  st.pushOutput("sys", `── test suite: ${kind}`);
  await new Promise((r) => setTimeout(r, 60)); // let the UI settle
  const results = runSuite(kind, files);
  let p = 0, f = 0, sk = 0;
  for (const r of results) {
    p += r.passed; f += r.failed; sk += r.skipped;
    for (const l of r.lines) st.pushOutput(l.kind, `  [${r.kind}] ${l.text}`);
    st.clearProblemsBySource(r.kind === "all" ? "lint" : r.kind);
    st.addProblems(r.problems);
    st.addTestRun(toTestRun(r));
  }
  for (const r of results) for (const src of ["lint", "typecheck", "unit", "build"]) void src;
  st.log("TEST", `suite ${kind}: ${p} passed, ${f} failed, ${sk} skipped`);
  st.toast(f ? "error" : "success", f ? "Tests failed" : "Tests passed", `${p} passed · ${f} failed · ${sk} skipped`);
  if (f) {
    st.setBottomView("problems");
  }
}

export async function buildProject(): Promise<void> {
  await runTestSuite("build");
}

export async function testProject(): Promise<void> {
  await runTestSuite("unit");
}

export function runProject(): void {
  const st = useStore.getState();
  if (!st.workspace) { st.toast("warn", "Open a project first"); return; }
  const files = getMergedFiles(st);
  const facts = computeFacts(files);
  const dev = facts.scripts["dev"] ?? facts.scripts["start"];
  st.setBottomView("output");
  if (!dev) {
    st.pushOutput("err", "no dev/start script in package.json — nothing to run");
    st.toast("warn", "No run script", "package.json defines no dev/start script.");
    return;
  }
  const cmd = `${facts.packageManager} run ${facts.scripts["dev"] ? "dev" : "start"}`;
  void st.requestPermission("ask", cmd, `Run the project's dev script (\`${dev}\`). Spawning long-lived processes requires the desktop runtime — LocalForge validates the configuration and reports honestly.`).then(async (allowed) => {
    if (!allowed) { st.pushOutput("sys", "run cancelled by user"); return; }
    st.termLine(st.activeTerminalId ?? "", "cmd", `${st.settings.shell} ❯ ${cmd}`);
    st.pushOutput("sys", `> ${cmd}`);
    const results = runSuite("runtime", files);
    for (const r of results) for (const l of r.lines) st.pushOutput(l.kind, `  ${l.text}`);
    const build = runSuite("build", files);
    for (const r of build) for (const l of r.lines) st.pushOutput(l.kind, `  ${l.text}`);
    st.toast(build.some((r) => r.failed) ? "warn" : "success", "Run validated", build.some((r) => r.failed) ? "config issues found — see Output" : "dev config OK — process spawning needs the desktop runtime");
    st.log("TERMINAL", `run ${cmd}`);
  });
}

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
  void runAgentTask(`Fix these reported errors:\n${summary}`, { roles: ["debugger", "reviewer"] });
}
