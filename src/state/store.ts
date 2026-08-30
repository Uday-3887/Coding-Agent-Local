/**
 * Central state + local persistence (IndexedDB). The store never imports the
 * agent engine — the engine imports the store — keeping the graph acyclic.
 */
import { create } from "zustand";
import { useEffect, useState } from "react";
import { DEFAULT_OLLAMA_URL, OFFLINE_MODEL_ID } from "../config/app";
import { dbDel, dbGetAll, dbPut, kvGet, kvSet } from "../lib/db";
import { DEMO_PROJECT_LABEL, demoProjectFiles } from "../lib/demo";
import { buildTree, pickLocalFolder, saveLocalFile } from "../lib/fs";
import type { TreeNode } from "../lib/fs";
import { ollamaDelete, ollamaHealth, ollamaModels, ollamaPull } from "../ai/provider";
import type {
  AgentRole, AgentState, AgentTask, AiMode, Chat, ChatMessage, Checkpoint, EditorTab,
  FileChange, LogCategory, LogEntry, MemoryEntry, OllamaStatus, PermissionRequest,
  Plan, Problem, RecentProject, Settings, TermLine, TermLineKind, TermSession,
  TestRun, Toast, Workspace,
} from "../lib/types";

export type SidebarView = "explorer" | "search" | "agents" | "tasks" | "git" | "settings";
export type BottomView = "terminal" | "problems" | "output" | "tests" | "logs";

let idSeq = 0;
export const uid = (): string =>
  `${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function detectShell(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "powershell";
  if (/Mac/i.test(ua)) return "zsh";
  return "bash";
}

const defaultSettings: Settings = {
  theme: "dark",
  autoSave: true,
  defaultFolder: "",
  ollamaUrl: DEFAULT_OLLAMA_URL,
  maxIterations: 6,
  parallelAgents: false,
  autoTest: true,
  autoReview: true,
  shell: detectShell(),
  confirmFileChanges: false,
  confirmAskCommands: true,
  memoryEnabled: true,
  params: { temperature: 0.2, topP: 0.9, numCtx: 8192, numPredict: 2048, seed: 0 },
  models: { chat: "", agent: "", planner: "", tester: "", reviewer: "" },
  sizes: { sidebar: 264, ai: 348, bottom: 224 },
};

const ROLES: AgentRole[] = ["orchestrator", "architect", "repository", "coder", "tester", "debugger", "reviewer"];

export const emptyAgents = (): Record<AgentRole, AgentState> => {
  const out = {} as Record<AgentRole, AgentState>;
  for (const r of ROLES) {
    out[r] = { role: r, status: "idle", note: "", toolCalls: [], filesTouched: [], errors: [], output: "" };
  }
  return out;
};

export interface AppState {
  booted: boolean;
  workspace: Workspace | null;
  tree: TreeNode[];
  recents: RecentProject[];
  tabs: EditorTab[];
  activeTabId: string | null;
  dirty: Record<string, string>;
  settings: Settings;
  ollama: { status: OllamaStatus; models: string[]; version?: string };
  sidebarView: SidebarView | null;
  aiView: AiMode;
  bottomView: BottomView | null;
  chats: Chat[];
  activeChatId: string | null;
  streaming: boolean;
  streamText: string;
  agents: Record<AgentRole, AgentState>;
  tasks: AgentTask[];
  agentRunning: boolean;
  pending: FileChange[];
  checkpoints: Checkpoint[];
  permission: PermissionRequest | null;
  plan: Plan | null;
  report: string | null;
  problems: Problem[];
  testRuns: TestRun[];
  terminals: TermSession[];
  activeTerminalId: string | null;
  output: TermLine[];
  logs: LogEntry[];
  toasts: Toast[];
  memory: MemoryEntry[];
  pullState: { model: string; status: string; pct?: number } | null;
  quickOpen: boolean;
  paletteOpen: boolean;
  selection: string;

  boot: () => Promise<void>;
  toast: (kind: Toast["kind"], title: string, body?: string) => void;
  dismissToast: (id: string) => void;
  log: (cat: LogCategory, msg: string) => void;
  updateSettings: (p: Partial<Settings>) => void;
  setWorkspace: (ws: Workspace, persist?: boolean) => void;
  openLocal: () => Promise<void>;
  openDemo: () => Promise<void>;
  openRecent: (label: string) => Promise<void>;
  openFile: (path: string) => void;
  openSpecialTab: (tab: EditorTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  editorChange: (path: string, value: string) => void;
  saveFile: (path: string) => Promise<void>;
  createFile: (path: string) => void;
  renameFile: (from: string, to: string) => void;
  deleteFile: (path: string) => void;
  newChat: () => string;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  pinChat: (id: string) => void;
  setActiveChat: (id: string | null) => void;
  appendChatMessage: (chatId: string, msg: ChatMessage) => void;
  setChatMessages: (chatId: string, msgs: ChatMessage[]) => void;
  setAiView: (v: AiMode) => void;
  setSidebarView: (v: SidebarView | null) => void;
  setBottomView: (v: BottomView | null) => void;
  setQuickOpen: (b: boolean) => void;
  setPaletteOpen: (b: boolean) => void;
  connectOllama: (silent?: boolean) => Promise<void>;
  disconnectOllama: () => void;
  refreshModels: () => Promise<void>;
  pullModel: (name: string) => Promise<void>;
  deleteModel: (name: string) => Promise<void>;
  setStreaming: (b: boolean) => void;
  setStreamText: (t: string) => void;
  appendStream: (tok: string) => void;
  setAgentState: (role: AgentRole, p: Partial<AgentState>) => void;
  resetAgents: () => void;
  addTask: (t: AgentTask) => void;
  updateTask: (id: string, p: Partial<AgentTask>) => void;
  setAgentRunning: (b: boolean) => void;
  addPendingChange: (c: FileChange) => void;
  acceptChange: (id: string) => Promise<void>;
  rejectChange: (id: string) => void;
  acceptAll: () => Promise<void>;
  rejectAll: () => void;
  undoTask: (taskId: string) => void;
  addCheckpoint: (c: Checkpoint) => void;
  restoreCheckpoint: (id: string) => void;
  deleteCheckpoint: (id: string) => void;
  setPlan: (p: Plan | null) => void;
  setReport: (r: string | null) => void;
  addProblems: (list: Problem[]) => void;
  clearProblemsBySource: (source: string) => void;
  setProblems: (list: Problem[]) => void;
  termLine: (sessionId: string, kind: TermLineKind, text: string) => void;
  newTerminal: () => void;
  closeTerminal: (id: string) => void;
  clearTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  pushOutput: (kind: TermLineKind, text: string) => void;
  clearOutput: () => void;
  addTestRun: (r: TestRun) => void;
  setPermission: (p: PermissionRequest | null) => void;
  resolvePermission: (allow: boolean) => void;
  requestPermission: (cls: "ask" | "dangerous", title: string, detail: string) => Promise<boolean>;
  memoryAdd: (text: string) => void;
  memoryClear: () => void;
  setPullState: (p: AppState["pullState"]) => void;
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let pullAbort: AbortController | null = null;

export const useStore = create<AppState>()((set, get) => ({
  booted: false,
  workspace: null,
  tree: [],
  recents: [],
  tabs: [],
  activeTabId: null,
  dirty: {},
  settings: defaultSettings,
  ollama: { status: "disconnected", models: [] },
  sidebarView: "explorer",
  aiView: "chat",
  bottomView: "terminal",
  chats: [],
  activeChatId: null,
  streaming: false,
  streamText: "",
  agents: emptyAgents(),
  tasks: [],
  agentRunning: false,
  pending: [],
  checkpoints: [],
  permission: null,
  plan: null,
  report: null,
  problems: [],
  testRuns: [],
  terminals: [],
  activeTerminalId: null,
  output: [],
  logs: [],
  toasts: [],
  memory: [],
  pullState: null,
  quickOpen: false,
  paletteOpen: false,
  selection: "",

  boot: async () => {
    try {
      const [settings, recents, chats, tasks, checkpoints, testRuns, memory, ws] = await Promise.all([
        kvGet<Settings>("settings"),
        kvGet<RecentProject[]>("recents"),
        dbGetAll<Chat>("chats"),
        dbGetAll<AgentTask>("tasks"),
        dbGetAll<Checkpoint>("checkpoints"),
        dbGetAll<TestRun>("test_runs"),
        dbGetAll<MemoryEntry>("project_memory"),
        kvGet<Workspace>("workspace"),
      ]);
      const cur = get().settings;
      const merged: Settings = settings
        ? {
            ...cur, ...settings,
            params: { ...cur.params, ...(settings.params ?? {}) },
            models: { ...cur.models, ...(settings.models ?? {}) },
            sizes: { ...cur.sizes, ...(settings.sizes ?? {}) },
          }
        : cur;
      const term: TermSession = { id: uid(), name: "shell-1", lines: [{ kind: "sys", text: 'LocalForge workspace shell — type "help"' }], busy: false };
      set({
        settings: merged,
        recents: recents ?? [],
        chats: (chats ?? []).sort((a, b) => b.createdAt - a.createdAt),
        tasks: (tasks ?? []).sort((a, b) => b.createdAt - a.createdAt),
        checkpoints: (checkpoints ?? []).sort((a, b) => b.at - a.at),
        testRuns: (testRuns ?? []).sort((a, b) => b.at - a.at),
        memory: memory ?? [],
        terminals: [term],
        activeTerminalId: term.id,
      });
      if (ws && ws.files && Object.keys(ws.files).length > 0) get().setWorkspace(ws, false);
      get().log("APP", "boot complete — local database mounted");
    } catch (e) {
      get().log("ERROR", `boot: ${(e as Error).message}`);
    } finally {
      set({ booted: true });
    }
    void get().connectOllama(true);
  },

  toast: (kind, title, body) => {
    const t: Toast = { id: uid(), kind, title, body };
    set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
    setTimeout(() => get().dismissToast(t.id), 4600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  log: (cat, msg) =>
    set((s) => ({ logs: [...s.logs.slice(-399), { id: uid(), at: Date.now(), cat, msg }] })),

  updateSettings: (p) => {
    const settings = { ...get().settings, ...p };
    set({ settings });
    void kvSet("settings", settings);
  },

  setWorkspace: (ws, persist = true) => {
    set({
      workspace: ws, tree: buildTree(ws.files), tabs: [], activeTabId: null,
      dirty: {}, plan: null, report: null, problems: [], pending: [],
    });
    const recents = [
      { label: ws.label, source: ws.source, at: Date.now() },
      ...get().recents.filter((r) => r.label !== ws.label),
    ].slice(0, 8);
    set({ recents });
    void kvSet("recents", recents);
    if (persist && ws.source !== "local") void kvSet("workspace", ws);
    get().log("APP", `workspace opened: ${ws.label} · ${Object.keys(ws.files).length} files · ${ws.source}`);
  },

  openLocal: async () => {
    try {
      const picked = await pickLocalFolder();
      if (!picked) return;
      get().setWorkspace({ label: picked.label, source: "local", files: picked.files, openedAt: Date.now() });
      get().toast("success", `Opened ${picked.label}`, `${Object.keys(picked.files).length} files indexed · saves write through to disk`);
    } catch (e) {
      get().toast("error", "Could not open folder", (e as Error).message);
    }
  },

  openDemo: async () => {
    get().setWorkspace({ label: DEMO_PROJECT_LABEL, source: "demo", files: demoProjectFiles(), openedAt: Date.now() });
    get().toast("success", "Demo workspace ready", "atlas-notes · React + Vite + TypeScript");
  },

  openRecent: async (label) => {
    const r = get().recents.find((x) => x.label === label);
    if (!r) return;
    if (r.source === "demo") return get().openDemo();
    if (r.source === "local") {
      get().toast("info", "Re-grant folder access", "Browser security requires picking the folder again.");
      return get().openLocal();
    }
    const ws = await kvGet<Workspace>("workspace");
    if (ws && ws.label === label) get().setWorkspace(ws, false);
    else return get().openLocal();
  },

  openFile: (path) => {
    const s = get();
    if (!s.workspace || s.workspace.files[path] === undefined) return;
    const id = `file:${path}`;
    if (!s.tabs.some((t) => t.id === id)) {
      set({ tabs: [...s.tabs, { id, kind: "file", title: path.split("/").pop() ?? path, path }] });
    }
    set({ activeTabId: id });
  },

  openSpecialTab: (tab) => {
    const s = get();
    if (!s.tabs.some((t) => t.id === tab.id)) set({ tabs: [...s.tabs, tab] });
    set({ activeTabId: tab.id });
  },

  closeTab: (id) => {
    const s = get();
    const idx = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeTabId = s.activeTabId;
    if (activeTabId === id) activeTabId = tabs[Math.max(0, idx - 1)]?.id ?? null;
    set({ tabs, activeTabId });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  editorChange: (path, value) => {
    set((s) => ({ dirty: { ...s.dirty, [path]: value } }));
    if (get().settings.autoSave) {
      clearTimeout(saveTimers.get(path));
      saveTimers.set(path, setTimeout(() => void get().saveFile(path), 900));
    }
  },

  saveFile: async (path) => {
    const s = get();
    const content = s.dirty[path];
    if (content === undefined || !s.workspace) return;
    const ws: Workspace = { ...s.workspace, files: { ...s.workspace.files, [path]: content } };
    const dirty = { ...s.dirty };
    delete dirty[path];
    set({ workspace: ws, dirty, tree: buildTree(ws.files) });
    if (ws.source === "local") {
      const wrote = await saveLocalFile(ws.label, path, content);
      get().toast(wrote ? "success" : "warn", wrote ? "Saved to disk" : "Saved in session", wrote ? path : "disk write needs folder permission — reopen the folder");
    } else {
      void kvSet("workspace", ws);
      get().toast("success", "Saved", path);
    }
    get().log("APP", `saved ${path}`);
  },

  createFile: (path) => {
    const s = get();
    if (!s.workspace) return;
    const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!norm || s.workspace.files[norm] !== undefined) {
      get().toast("error", "Cannot create file", !norm ? "empty path" : `${norm} already exists`);
      return;
    }
    const ws = { ...s.workspace, files: { ...s.workspace.files, [norm]: "" } };
    set({ workspace: ws, tree: buildTree(ws.files) });
    if (ws.source !== "local") void kvSet("workspace", ws);
    get().openFile(norm);
    get().toast("success", "Created", norm);
  },

  renameFile: (from, to) => {
    const s = get();
    if (!s.workspace || s.workspace.files[from] === undefined) return;
    const norm = to.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!norm || s.workspace.files[norm] !== undefined) {
      get().toast("error", "Cannot rename", !norm ? "empty path" : `${norm} already exists`);
      return;
    }
    const files = { ...s.workspace.files };
    files[norm] = files[from];
    delete files[from];
    const ws = { ...s.workspace, files };
    set({ workspace: ws, tree: buildTree(files), tabs: s.tabs.filter((t) => t.path !== from), activeTabId: null });
    if (ws.source !== "local") void kvSet("workspace", ws);
    get().toast("success", "Renamed", `${from} → ${norm}`);
  },

  deleteFile: (path) => {
    const s = get();
    if (!s.workspace || s.workspace.files[path] === undefined) return;
    const files = { ...s.workspace.files };
    delete files[path];
    const ws = { ...s.workspace, files };
    set({ workspace: ws, tree: buildTree(files), tabs: s.tabs.filter((t) => t.path !== path) });
    if (ws.source !== "local") void kvSet("workspace", ws);
    get().toast("info", "Deleted", path);
  },

  newChat: () => {
    const c: Chat = {
      id: uid(), project: get().workspace?.label ?? "no-project", title: "New chat",
      pinned: false, createdAt: Date.now(), messages: [],
    };
    set((s) => ({ chats: [c, ...s.chats], activeChatId: c.id }));
    void dbPut("chats", c as unknown as { id: string } & Record<string, unknown>);
    return c.id;
  },

  renameChat: (id, title) => {
    set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)) }));
    const c = get().chats.find((x) => x.id === id);
    if (c) void dbPut("chats", c as unknown as { id: string } & Record<string, unknown>);
  },

  deleteChat: (id) => {
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== id),
      activeChatId: s.activeChatId === id ? null : s.activeChatId,
    }));
    void dbDel("chats", id);
  },

  pinChat: (id) => {
    set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)) }));
    const c = get().chats.find((x) => x.id === id);
    if (c) void dbPut("chats", c as unknown as { id: string } & Record<string, unknown>);
  },

  setActiveChat: (id) => set({ activeChatId: id }),

  appendChatMessage: (chatId, msg) => {
    set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, msg] } : c)) }));
    const c = get().chats.find((x) => x.id === chatId);
    if (c) void dbPut("chats", c as unknown as { id: string } & Record<string, unknown>);
  },

  setChatMessages: (chatId, msgs) => {
    set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: msgs } : c)) }));
    const c = get().chats.find((x) => x.id === chatId);
    if (c) void dbPut("chats", c as unknown as { id: string } & Record<string, unknown>);
  },

  setAiView: (v) => set({ aiView: v }),
  setSidebarView: (v) => set({ sidebarView: v }),
  setBottomView: (v) => set({ bottomView: v }),
  setQuickOpen: (b) => set({ quickOpen: b }),
  setPaletteOpen: (b) => set({ paletteOpen: b }),

  connectOllama: async (silent = false) => {
    const url = get().settings.ollamaUrl;
    set((s) => ({ ollama: { ...s.ollama, status: "connecting" } }));
    const h = await ollamaHealth(url);
    if (h.ok) {
      const models = await ollamaModels(url).catch(() => [] as string[]);
      set({ ollama: { status: "connected", models, version: h.version } });
      get().log("OLLAMA", `connected ${url} · v${h.version ?? "?"} · ${models.length} model(s)`);
      if (!silent) get().toast("success", "Ollama connected", `${models.length} model(s) available`);
    } else {
      set({ ollama: { status: "error", models: [] } });
      get().log("OLLAMA", `connect failed: ${h.error}`);
      if (!silent) get().toast("error", "Ollama unreachable", h.error ?? "Is `ollama serve` running?");
    }
  },

  disconnectOllama: () => {
    set({ ollama: { status: "disconnected", models: [] } });
    get().log("OLLAMA", "disconnected by user");
    get().toast("info", "Ollama disconnected", "The heuristic engine remains available.");
  },

  refreshModels: async () => {
    if (get().ollama.status !== "connected") return;
    const models = await ollamaModels(get().settings.ollamaUrl).catch(() => [] as string[]);
    set((s) => ({ ollama: { ...s.ollama, models } }));
    get().toast("info", "Models refreshed", `${models.length} installed`);
  },

  pullModel: async (name) => {
    pullAbort = new AbortController();
    set({ pullState: { model: name, status: "starting…" } });
    try {
      await ollamaPull(
        get().settings.ollamaUrl, name,
        (p) => set({ pullState: { model: name, status: p.status, pct: p.pct } }),
        pullAbort.signal
      );
      get().toast("success", "Model pulled", name);
      await get().refreshModels();
    } catch (e) {
      if ((e as Error).name !== "AbortError") get().toast("error", "Pull failed", (e as Error).message);
    } finally {
      set({ pullState: null });
    }
  },

  deleteModel: async (name) => {
    const allowed = await get().requestPermission("dangerous", `ollama delete ${name}`, "This removes the model from your local Ollama installation. This cannot be undone without re-pulling.");
    if (!allowed) return;
    try {
      await ollamaDelete(get().settings.ollamaUrl, name);
      get().toast("success", "Model deleted", name);
      await get().refreshModels();
    } catch (e) {
      get().toast("error", "Delete failed", (e as Error).message);
    }
  },

  setStreaming: (b) => set({ streaming: b }),
  setStreamText: (t) => set({ streamText: t }),
  appendStream: (tok) => set((s) => ({ streamText: s.streamText + tok })),

  setAgentState: (role, p) =>
    set((s) => ({ agents: { ...s.agents, [role]: { ...s.agents[role], ...p } } })),

  resetAgents: () => set({ agents: emptyAgents() }),

  addTask: (t) => {
    set((s) => ({ tasks: [t, ...s.tasks].slice(0, 40) }));
    void dbPut("tasks", t as unknown as { id: string } & Record<string, unknown>);
  },

  updateTask: (id, p) => {
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
    const t = get().tasks.find((x) => x.id === id);
    if (t) void dbPut("tasks", t as unknown as { id: string } & Record<string, unknown>);
  },

  setAgentRunning: (b) => set({ agentRunning: b }),

  addPendingChange: (c) => {
    set((s) => ({
      pending: [...s.pending.filter((x) => !(x.taskId === c.taskId && x.path === c.path)), c],
    }));
  },

  acceptChange: async (id) => {
    const s = get();
    const c = s.pending.find((x) => x.id === id);
    if (!c || !s.workspace) return;
    const files = { ...s.workspace.files };
    if (c.type === "delete") delete files[c.path];
    else files[c.path] = c.after;
    const dirty = { ...s.dirty };
    delete dirty[c.path];
    const ws = { ...s.workspace, files };
    set({ workspace: ws, tree: buildTree(files), dirty, pending: s.pending.filter((x) => x.id !== id) });
    if (ws.source === "local") await saveLocalFile(ws.label, c.path, c.after);
    else void kvSet("workspace", ws);
    get().toast("success", c.type === "delete" ? "Deletion applied" : "Change applied", c.path);
    get().log("APP", `accepted ${c.type} ${c.path}`);
  },

  rejectChange: (id) => {
    const c = get().pending.find((x) => x.id === id);
    set((s) => ({ pending: s.pending.filter((x) => x.id !== id) }));
    if (c) get().toast("info", "Change rejected", c.path);
  },

  acceptAll: async () => {
    const ids = get().pending.map((c) => c.id);
    for (const id of ids) await get().acceptChange(id);
    if (ids.length) get().toast("success", "All changes applied", `${ids.length} file(s)`);
  },

  rejectAll: () => {
    const n = get().pending.length;
    set({ pending: [] });
    if (n) get().toast("info", "All changes rejected", `${n} file(s) rolled back`);
  },

  undoTask: (taskId) => {
    const n = get().pending.filter((c) => c.taskId === taskId).length;
    set((s) => ({ pending: s.pending.filter((c) => c.taskId !== taskId) }));
    get().toast("info", "Task changes rolled back", `${n} pending change(s) discarded`);
    get().log("AGENT", `undo task ${taskId} — ${n} changes discarded`);
  },

  addCheckpoint: (c) => {
    set((s) => ({ checkpoints: [c, ...s.checkpoints].slice(0, 12) }));
    void dbPut("checkpoints", c as unknown as { id: string } & Record<string, unknown>);
  },

  restoreCheckpoint: (id) => {
    const cp = get().checkpoints.find((c) => c.id === id);
    const ws = get().workspace;
    if (!cp || !ws) return;
    const next: Workspace = { ...ws, files: { ...cp.files } };
    set({ workspace: next, tree: buildTree(next.files), dirty: {}, pending: [] });
    if (ws.source !== "local") void kvSet("workspace", next);
    get().toast("success", "Checkpoint restored", cp.label);
    get().log("APP", `restored checkpoint: ${cp.label}`);
  },

  deleteCheckpoint: (id) => {
    set((s) => ({ checkpoints: s.checkpoints.filter((c) => c.id !== id) }));
    void dbDel("checkpoints", id);
  },

  setPlan: (p) => set({ plan: p }),
  setReport: (r) => set({ report: r }),

  addProblems: (list) =>
    set((s) => {
      const seen = new Set(s.problems.map((p) => `${p.file}:${p.line}:${p.message}`));
      const merged = [...s.problems];
      for (const p of list) {
        const key = `${p.file}:${p.line}:${p.message}`;
        if (!seen.has(key)) { merged.push(p); seen.add(key); }
      }
      return { problems: merged.slice(-200) };
    }),

  clearProblemsBySource: (source) =>
    set((s) => ({ problems: s.problems.filter((p) => p.source !== source) })),

  setProblems: (list) => set({ problems: list.slice(-200) }),

  termLine: (sessionId, kind, text) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === sessionId
          ? { ...t, lines: text === "__CLEAR__" ? [] : [...t.lines.slice(-799), { kind, text }] }
          : t
      ),
    })),

  newTerminal: () => {
    const n = get().terminals.length + 1;
    const t: TermSession = { id: uid(), name: `shell-${n}`, lines: [{ kind: "sys", text: 'LocalForge workspace shell — type "help"' }], busy: false };
    set((s) => ({ terminals: [...s.terminals, t], activeTerminalId: t.id }));
  },

  closeTerminal: (id) => {
    const rest = get().terminals.filter((t) => t.id !== id);
    if (rest.length === 0) return get().newTerminal();
    set({ terminals: rest, activeTerminalId: rest[0].id });
  },

  clearTerminal: (id) =>
    set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, lines: [] } : t)) })),

  setActiveTerminal: (id) => set({ activeTerminalId: id }),

  pushOutput: (kind, text) =>
    set((s) => ({ output: [...s.output.slice(-399), { kind, text }] })),
  clearOutput: () => set({ output: [] }),

  addTestRun: (r) => {
    set((s) => ({ testRuns: [r, ...s.testRuns].slice(0, 30) }));
    void dbPut("test_runs", r as unknown as { id: string } & Record<string, unknown>);
  },

  setPermission: (p) => set({ permission: p }),

  resolvePermission: (allow) => {
    const p = get().permission;
    if (p) p.resolve(allow);
    set({ permission: null });
  },

  requestPermission: (cls, title, detail) =>
    new Promise<boolean>((resolve) => {
      set({
        permission: { id: uid(), kind: "command", class: cls, title, detail, resolve },
      });
    }),

  memoryAdd: (text) => {
    if (!get().settings.memoryEnabled) return;
    const e: MemoryEntry = { id: uid(), text, at: Date.now() };
    set((s) => ({ memory: [e, ...s.memory].slice(0, 60) }));
    void dbPut("project_memory", e as unknown as { id: string } & Record<string, unknown>);
  },

  memoryClear: () => {
    set({ memory: [] });
    void (async () => {
      const all = await dbGetAll<MemoryEntry>("project_memory");
      for (const e of all) await dbDel("project_memory", e.id);
    })();
    get().toast("info", "Project memory cleared");
  },

  setPullState: (p) => set({ pullState: p }),
}));

/* ─────────────── selectors & helpers ─────────────── */

export function getMergedFiles(s: Pick<AppState, "workspace" | "dirty">): Record<string, string> {
  if (!s.workspace) return {};
  return { ...s.workspace.files, ...s.dirty };
}

export type ModelRole = "chat" | "agent" | "planner" | "tester" | "reviewer";

/** Resolve the effective model for a role: explicit pick → first Ollama model → heuristic. */
export function resolveModel(
  s: Pick<AppState, "settings" | "ollama">,
  role: ModelRole
): { model: string; useOllama: boolean } {
  const chosen = s.settings.models[role];
  if (chosen === OFFLINE_MODEL_ID) return { model: OFFLINE_MODEL_ID, useOllama: false };
  if (s.ollama.status === "connected" && s.ollama.models.length > 0) {
    if (chosen && s.ollama.models.includes(chosen)) return { model: chosen, useOllama: true };
    return { model: s.ollama.models[0], useOllama: true };
  }
  return { model: OFFLINE_MODEL_ID, useOllama: false };
}

export function useResolvedTheme(): "dark" | "light" {
  const theme = useStore((s) => s.settings.theme);
  const [sys, setSys] = useState<"dark" | "light">(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const h = (e: MediaQueryListEvent) => setSys(e.matches ? "light" : "dark");
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, []);
  return theme === "system" ? sys : theme;
}
