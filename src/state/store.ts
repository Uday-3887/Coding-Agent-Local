import { create } from "zustand";
import { DEFAULT_OLLAMA_URL, LIMITS, OFFLINE_MODEL_ID, SECRET_PATTERNS, WELCOME_TITLE } from "../config/app";
import { DEMO_PROJECT_LABEL, demoProjectFiles } from "../lib/demo";
import { dbClear, dbDel, dbGetAll, dbPut, kvGet, kvSet } from "../lib/db";
import { pickLocalFolder, saveLocalFile } from "../lib/fs";
import type {
  AdapterInfo, AgentRole, AgentState, AgentTask, Attachment, AutonomyMode, Chat, Checkpoint,
  EditorTab, FileChange, LogCategory, LogEntry, ModelDetail, OllamaStatus, PermissionRequest,
  Plan, PreviewState, Problem, ProjectIndex, RecentProject, ResourceInfo, ServiceInfo, Settings,
  TaskStatus, TermLine, TermLineKind, TermSession, TestRun, Toast, Workspace, InlineEditState,
} from "../lib/types";
import { ollamaHealth, ollamaModels, ollamaPull, ollamaDelete } from "../ai/provider";
import { buildIndex } from "../lib/indexer";
import { detectProject } from "../adapters";

export const ROLES: AgentRole[] = [
  "orchestrator", "architect", "repository", "coder", "frontend", "backend",
  "database", "tester", "debugger", "reviewer", "security", "docs",
];

export type ModelRole = "chat" | "agent" | "planner" | "tester" | "reviewer" | "autocomplete";

const uid = () => Math.random().toString(36).slice(2, 10);
export { uid };

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  autoSave: true,
  defaultFolder: "",
  ollamaUrl: DEFAULT_OLLAMA_URL,
  maxIterations: 12,
  maxAgents: 2,
  singleModelMode: false,
  parallelAgents: true,
  autoTest: true,
  autoReview: true,
  shell: "bash",
  confirmFileChanges: false,
  confirmAskCommands: true,
  memoryEnabled: true,
  autocomplete: { enabled: false, delayMs: 350, contextChars: 800 },
  params: { temperature: 0.2, topP: 0.9, numCtx: 8192, numPredict: 2048, seed: 0 },
  models: { chat: "", agent: "", planner: "", tester: "", reviewer: "", autocomplete: "" },
  sizes: { sidebar: 264, ai: 360, bottom: 240 },
};

const DEFAULT_PREVIEW: PreviewState = {
  doc: "", url: "", kind: "none", mode: "none", note: "",
  device: { label: "Laptop", w: 1366, h: 768 }, zoom: 1,
  consoleLines: [], inspectOn: false, inspectInfo: null,
  autoRefresh: true, building: false, error: null, detectedUrls: [],
};

export const emptyAgents = (): Record<AgentRole, AgentState> => {
  const out = {} as Record<AgentRole, AgentState>;
  for (const r of ROLES) out[r] = { role: r, status: "idle", note: "", toolCalls: [], filesTouched: [], errors: [], output: "" };
  return out;
};

/** Resolve the effective model for a role: explicit > single-model mode > chat model > first Ollama model > heuristic. */
export function resolveModel(state: Pick<AppState, "settings" | "ollama">, role: ModelRole): { model: string; useOllama: boolean } {
  const { settings, ollama } = state;
  const connected = ollama.status === "connected" && ollama.models.length > 0;
  let m = settings.models[role];
  if (settings.singleModelMode && connected) m = m || settings.models.chat || ollama.models[0];
  if (!m && connected && (role === "chat" || !settings.models[role])) m = settings.models.chat || ollama.models[0];
  if (!m) m = connected ? ollama.models[0] : OFFLINE_MODEL_ID;
  return { model: m, useOllama: connected && m !== OFFLINE_MODEL_ID };
}

export type SidebarView = "explorer" | "search" | "agents" | "tasks" | "git" | "settings" | "rundev" | null;
export type BottomView = "terminal" | "problems" | "output" | "tests" | "logs" | "services" | "api" | "database" | null;

interface MemoryEntry { id: string; project: string; text: string; at: number; }

export interface AppState {
  booted: boolean;
  workspace: Workspace | null;
  adapter: AdapterInfo | null;
  tree: { path: string; type: "file" | "dir"; depth: number }[];
  recents: RecentProject[];
  tabs: EditorTab[];
  activeTabId: string | null;
  dirty: Record<string, string>;
  settings: Settings;
  ollama: { status: OllamaStatus; models: string[]; version?: string; modelDetails: ModelDetail[]; pullState: { model: string; status: string; pct?: number } | null };
  sidebarView: SidebarView;
  bottomView: BottomView;
  aiView: "chat" | "agent" | "plan" | "test";
  chats: Chat[];
  activeChatId: string | null;
  streaming: boolean;
  streamText: string;
  tasks: AgentTask[];
  agents: Record<AgentRole, AgentState>;
  agentRunning: boolean;
  autonomy: AutonomyMode;
  pending: FileChange[];
  checkpoints: Checkpoint[];
  problems: Problem[];
  terminals: TermSession[];
  activeTerminalId: string | null;
  testRuns: TestRun[];
  plan: Plan | null;
  logs: LogEntry[];
  toasts: Toast[];
  permission: PermissionRequest | null;
  output: TermLine[];
  memory: MemoryEntry[];
  report: string | null;
  pullState: { model: string; status: string; pct?: number } | null;
  quickOpen: boolean;
  paletteOpen: boolean;
  selection: string;
  cursorPos: { line: number; col: number };
  services: ServiceInfo[];
  preview: PreviewState;
  inlineEdit: InlineEditState | null;
  attachments: Attachment[];
  index: ProjectIndex | null;
  resources: ResourceInfo;
  pullAbort: AbortController | null;

  boot: () => Promise<void>;
  toast: (kind: Toast["kind"], title: string, body?: string) => void;
  dismissToast: (id: string) => void;
  log: (cat: LogCategory, msg: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  openDemo: () => Promise<void>;
  openLocal: () => Promise<void>;
  openRecent: (label: string) => Promise<void>;
  setWorkspace: (ws: Workspace | null) => void;

  buildTree: () => void;
  createFile: (path: string, content?: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  renamePath: (from: string, to: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  duplicatePath: (path: string) => Promise<void>;
  openFile: (path: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  openSpecialTab: (tab: EditorTab) => void;
  editorChange: (path: string, value: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveAll: () => Promise<void>;
  setCursorPos: (line: number, col: number) => void;

  setSidebarView: (v: SidebarView) => void;
  setBottomView: (v: BottomView) => void;
  setAiView: (v: AppState["aiView"]) => void;
  setAutonomy: (v: AutonomyMode) => void;

  newChat: () => string;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  pinChat: (id: string) => void;
  setActiveChat: (id: string | null) => void;
  appendChatMessage: (chatId: string, msg: Chat["messages"][number]) => void;
  setChatMessages: (chatId: string, msgs: Chat["messages"]) => void;
  setStreaming: (v: boolean) => void;
  setStreamText: (v: string) => void;
  appendStream: (tok: string) => void;
  addAttachment: (a: Attachment) => void;
  removeAttachment: (name: string) => void;
  setAttachments: (a: Attachment[]) => void;

  addTask: (t: AgentTask) => void;
  updateTask: (id: string, patch: Partial<AgentTask>) => void;
  removeTask: (id: string) => void;
  setTaskStatus: (id: string, status: TaskStatus) => void;
  setAgents: (a: Record<AgentRole, AgentState>) => void;
  setAgentState: (role: AgentRole, patch: Partial<AgentState>) => void;
  resetAgents: () => void;
  setAgentRunning: (v: boolean) => void;

  addPendingChange: (c: FileChange) => void;
  acceptChange: (id: string) => Promise<void>;
  rejectChange: (id: string) => void;
  acceptAll: (taskId?: string) => Promise<void>;
  rejectAll: (taskId?: string) => void;
  undoTaskChanges: (taskId: string) => Promise<void>;

  addCheckpoint: (c: Checkpoint) => void;
  restoreCheckpoint: (id: string) => Promise<void>;
  deleteCheckpoint: (id: string) => void;

  addProblems: (p: Problem[]) => void;
  clearProblemsBySource: (source: string) => void;
  clearProblems: () => void;

  newTerminal: () => string;
  closeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  termLine: (id: string, kind: TermLineKind, text: string) => void;
  clearTerminal: (id: string) => void;

  addTestRun: (r: TestRun) => void;
  setPlan: (p: Plan | null) => void;
  pushOutput: (kind: TermLineKind, text: string) => void;
  clearOutput: () => void;
  setReport: (r: string | null) => void;
  memoryAdd: (text: string) => void;
  clearMemory: () => Promise<void>;
  requestPermission: (cls: "ask" | "dangerous", title: string, detail: string) => Promise<boolean>;
  resolvePermission: (allow: boolean) => void;
  setQuickOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;

  connectOllama: (silent?: boolean) => Promise<void>;
  disconnectOllama: () => void;
  refreshModels: () => Promise<void>;
  refreshModelDetails: () => Promise<void>;
  pullModel: (model: string) => Promise<void>;
  deleteModel: (model: string) => Promise<void>;
  cancelPull: () => void;

  setService: (s: ServiceInfo) => void;
  removeService: (id: string) => void;
  setPreview: (patch: Partial<PreviewState>) => void;
  resetPreview: () => void;
  setInlineEdit: (v: InlineEditState | null) => void;
  setIndex: (i: ProjectIndex | null) => void;
  refreshResources: () => void;
}

export const useStore = create<AppState>()((set, get) => ({
  booted: false,
  workspace: null,
  adapter: null,
  tree: [],
  recents: [],
  tabs: [],
  activeTabId: null,
  dirty: {},
  settings: DEFAULT_SETTINGS,
  ollama: { status: "disconnected", models: [], modelDetails: [], pullState: null },
  sidebarView: "explorer",
  bottomView: null,
  aiView: "chat",
  chats: [],
  activeChatId: null,
  streaming: false,
  streamText: "",
  tasks: [],
  agents: emptyAgents(),
  agentRunning: false,
  autonomy: "normal",
  pending: [],
  checkpoints: [],
  problems: [],
  terminals: [{ id: "term-1", name: "bash", lines: [{ kind: "sys", text: "LocalForge terminal — workspace shell emulator. Type \"help\"." }], busy: false }],
  activeTerminalId: "term-1",
  testRuns: [],
  plan: null,
  logs: [],
  toasts: [],
  permission: null,
  output: [],
  memory: [],
  report: null,
  pullState: null,
  quickOpen: false,
  paletteOpen: false,
  selection: "",
  cursorPos: { line: 1, col: 1 },
  services: [],
  preview: DEFAULT_PREVIEW,
  inlineEdit: null,
  attachments: [],
  index: null,
  resources: { cores: navigator.hardwareConcurrency ?? 4, heapMB: null, heapLimitMB: null },
  pullAbort: null,

  boot: async () => {
    const settings = (await kvGet<Settings>("settings")) ?? DEFAULT_SETTINGS;
    const merged = { ...DEFAULT_SETTINGS, ...settings, params: { ...DEFAULT_SETTINGS.params, ...settings.params }, models: { ...DEFAULT_SETTINGS.models, ...settings.models }, sizes: { ...DEFAULT_SETTINGS.sizes, ...settings.sizes }, autocomplete: { ...DEFAULT_SETTINGS.autocomplete, ...settings.autocomplete } };
    const chats = (await dbGetAll<Chat>("chats")).sort((a, b) => b.createdAt - a.createdAt);
    const tasks = (await dbGetAll<AgentTask>("tasks")).sort((a, b) => b.createdAt - a.createdAt).map((t) => (t.status === "running" || t.status === "queued" ? { ...t, status: "cancelled" as const } : t));
    const checkpoints = (await dbGetAll<Checkpoint>("checkpoints")).sort((a, b) => b.at - a.at);
    const memory = await dbGetAll<MemoryEntry>("project_memory");
    const testRuns = (await dbGetAll<TestRun>("test_runs")).sort((a, b) => b.at - a.at).slice(0, 30);
    const recents = (await kvGet<RecentProject[]>("recents")) ?? [];
    const dirty = (await kvGet<Record<string, string>>("dirty-buffers")) ?? {};
    const lastWorkspace = await kvGet<Workspace>("last-workspace");
    document.documentElement.dataset.theme = merged.theme === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : merged.theme;

    set({
      booted: true, settings: merged, chats, tasks, checkpoints, memory, testRuns, recents, dirty,
      logs: [{ id: uid(), at: Date.now(), cat: "APP", msg: "LocalForge booted — local database mounted" }],
    });
    get().refreshResources();

    if (lastWorkspace && lastWorkspace.source !== "local") {
      // demo/upload workspaces restore fully; local folders re-request permission on Open Folder
      set({ workspace: lastWorkspace, adapter: detectProject(lastWorkspace.files) });
      get().buildTree();
      get().log("APP", `restored workspace "${lastWorkspace.label}" (${Object.keys(lastWorkspace.files).length} files)`);
    }
    // restore unsaved buffers as tabs
    const dirtyPaths = Object.keys(dirty);
    if (dirtyPaths.length && get().workspace) {
      for (const p of dirtyPaths.slice(0, 6)) get().openFile(p);
      get().toast("info", "Recovered unsaved edits", `${dirtyPaths.length} buffer(s) restored from the crash-recovery store.`);
    }
    void get().connectOllama(true);
  },

  toast: (kind, title, body) => {
    const t: Toast = { id: uid(), kind, title, body };
    set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
    setTimeout(() => get().dismissToast(t.id), kind === "error" ? 7000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  log: (cat, msg) => {
    const safe = SECRET_PATTERNS.some((p) => p.test(msg)) ? "[masked]" : msg;
    set((s) => ({ logs: [...s.logs.slice(-(LIMITS.maxSearchResults * 2)), { id: uid(), at: Date.now(), cat, msg: safe }] }));
  },
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void kvSet("settings", settings);
    if (patch.theme) {
      document.documentElement.dataset.theme = settings.theme === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : settings.theme;
    }
  },

  /* ───── workspaces ───── */

  setWorkspace: (ws) => {
    set({ workspace: ws, tabs: [], activeTabId: null, dirty: {}, problems: [], plan: null, report: null, index: null, services: [], pending: [] });
    get().resetPreview();
    if (ws) {
      set({ adapter: detectProject(ws.files) });
      get().buildTree();
      set({ index: buildIndex(ws.files) });
      void kvSet("last-workspace", ws);
      const recents = [{ label: ws.label, source: ws.source, at: Date.now() }, ...get().recents.filter((r) => r.label !== ws.label)].slice(0, 8);
      set({ recents });
      void kvSet("recents", recents);
      void dbPut("projects", { id: ws.label, label: ws.label, source: ws.source, openedAt: ws.openedAt, fileCount: Object.keys(ws.files).length });
      get().log("APP", `workspace "${ws.label}" opened — ${Object.keys(ws.files).length} files indexed`);
    } else {
      set({ adapter: null });
      void kvSet("last-workspace", null);
    }
  },

  openDemo: async () => {
    const files = demoProjectFiles();
    get().setWorkspace({ label: DEMO_PROJECT_LABEL, source: "demo", files, openedAt: Date.now() });
    get().toast("success", "Demo workspace ready", `${Object.keys(files).length} files · React + Vite + Vitest · press Run for the live preview.`);
    get().openFile("src/App.tsx");
  },

  openLocal: async () => {
    try {
      const picked = await pickLocalFolder();
      if (!picked) return;
      const { label, files } = picked;
      if (!label) return;
      get().setWorkspace({ label, source: "local", files, openedAt: Date.now() });
      get().toast("success", "Folder opened", `${Object.keys(files).length} files indexed · saves write through to disk`);
      const first = Object.keys(files).find((f) => /\.(tsx?|jsx?|py|md|json)$/.test(f));
      if (first) get().openFile(first);
    } catch (e) {
      get().toast("error", "Could not open folder", (e as Error).message);
      get().log("ERROR", `open folder: ${(e as Error).message}`);
    }
  },

  openRecent: async (label) => {
    const r = get().recents.find((x) => x.label === label);
    if (!r) return;
    if (r.source === "demo") return get().openDemo();
    if (r.source === "local") {
      get().toast("info", "Re-select the folder", "Browser security requires re-granting folder access.");
      return get().openLocal();
    }
    const ws = (await kvGet<Workspace>(`ws-${label}`));
    if (ws) { get().setWorkspace(ws); get().toast("success", "Project restored", label); }
  },

  /* ───── tree / files ───── */

  buildTree: () => {
    const ws = get().workspace;
    if (!ws) { set({ tree: [] }); return; }
    const dirs = new Set<string>();
    const paths = Object.keys(ws.files).sort();
    for (const p of paths) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    const nodes: AppState["tree"] = [];
    const all = new Map<string, "file" | "dir">();
    for (const d of dirs) all.set(d, "dir");
    for (const p of paths) all.set(p, "file");
    const sorted = [...all.entries()].sort(([a, ta], [b, tb]) => {
      const da = a.split("/").length, db = b.split("/").length;
      if (da !== db) return da - db;
      if (ta !== tb) return ta === "dir" ? -1 : 1;
      return a.localeCompare(b);
    });
    for (const [path, type] of sorted) nodes.push({ path, type, depth: path.split("/").length - 1 });
    set({ tree: nodes });
  },

  createFile: async (path, content = "") => {
    const ws = get().workspace;
    if (!ws || !path.trim()) return;
    if (ws.files[path] !== undefined) { get().toast("warn", "File exists", path); return; }
    const files = { ...ws.files, [path]: content };
    set({ workspace: { ...ws, files } });
    get().buildTree();
    get().openFile(path);
    get().log("TOOL", `create_file ${path}`);
    if (ws.source === "local") await saveLocalFile(ws.label, path, content).catch(() => undefined);
  },

  createFolder: async (path) => {
    const ws = get().workspace;
    if (!ws || !path.trim()) return;
    const marker = `${path.replace(/\/$/, "")}/.keep`;
    if (!ws.files[marker]) {
      set({ workspace: { ...ws, files: { ...ws.files, [marker]: "" } } });
      get().buildTree();
    }
  },

  renamePath: async (from, to) => {
    const ws = get().workspace;
    if (!ws || !to.trim() || from === to) return;
    const files = { ...ws.files };
    const moving = Object.keys(files).filter((p) => p === from || p.startsWith(from + "/"));
    if (moving.length === 0) return;
    for (const p of moving) {
      files[to + p.slice(from.length)] = files[p];
      delete files[p];
    }
    set({ workspace: { ...ws, files } });
    get().buildTree();
    set((s) => ({ tabs: s.tabs.map((t) => (t.path && (t.path === from || t.path.startsWith(from + "/")) ? { ...t, path: to + t.path.slice(from.length), title: (to + t.path.slice(from.length)).split("/").pop() ?? t.title } : t)) }));
    get().toast("success", "Renamed", `${from} → ${to}`);
  },

  deletePath: async (path) => {
    const ws = get().workspace;
    if (!ws) return;
    const files = { ...ws.files };
    const removing = Object.keys(files).filter((p) => p === path || p.startsWith(path + "/"));
    for (const p of removing) delete files[p];
    set({ workspace: { ...ws, files } });
    get().buildTree();
    set((s) => ({ tabs: s.tabs.filter((t) => !t.path || !(t.path === path || t.path.startsWith(path + "/"))) }));
    get().toast("info", "Deleted", `${removing.length} item(s)`);
    get().log("TOOL", `delete ${path}`);
  },

  duplicatePath: async (path) => {
    const ws = get().workspace;
    if (!ws || ws.files[path] === undefined) return;
    const dot = path.lastIndexOf(".");
    const copy = dot > 0 ? `${path.slice(0, dot)}.copy${path.slice(dot)}` : `${path}.copy`;
    await get().createFile(copy, ws.files[path]);
  },

  /* ───── tabs / editor ───── */

  openFile: (path) => {
    const s = get();
    const existing = s.tabs.find((t) => t.kind === "file" && t.path === path);
    if (existing) { set({ activeTabId: existing.id }); return; }
    const tab: EditorTab = { id: uid(), kind: "file", title: path.split("/").pop() ?? path, path };
    set((st) => ({ tabs: [...st.tabs, tab], activeTabId: tab.id }));
  },

  openSpecialTab: (tab) => {
    const existing = get().tabs.find((t) => t.id === tab.id);
    if (existing) { set({ activeTabId: existing.id }); return; }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  closeTab: (id) => {
    const s = get();
    const idx = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeTabId = s.activeTabId;
    if (activeTabId === id) activeTabId = tabs[Math.max(0, idx - 1)]?.id ?? null;
    set({ tabs, activeTabId });
  },

  closeAllTabs: () => set({ tabs: [], activeTabId: null }),
  setActiveTab: (id) => set({ activeTabId: id }),

  editorChange: (path, value) => {
    set((s) => ({ dirty: { ...s.dirty, [path]: value } }));
    if (get().settings.autoSave) void get().saveFile(path);
  },

  saveFile: async (path) => {
    const s = get();
    const ws = s.workspace;
    const value = s.dirty[path];
    if (!ws || value === undefined) return;
    const files = { ...ws.files, [path]: value };
    const dirty = { ...s.dirty };
    delete dirty[path];
    set({ workspace: { ...ws, files }, dirty });
    void kvSet("dirty-buffers", get().dirty);
    if (ws.source === "local") {
      try { await saveLocalFile(ws.label, path, value); } catch { get().toast("warn", "Disk write failed", "Saved in-session; re-grant folder access to persist."); }
    } else {
      void kvSet(`ws-${ws.label}`, get().workspace);
    }
    get().log("APP", `saved ${path}`);
    // live preview auto-refresh hook
    if (get().preview.autoRefresh && get().preview.mode !== "none" && get().preview.mode !== "console") {
      window.dispatchEvent(new CustomEvent("localforge-files-changed"));
    }
    // keep the index warm (debounced via microtask scheduling in caller)
  },

  saveAll: async () => {
    const paths = Object.keys(get().dirty);
    for (const p of paths) await get().saveFile(p);
    if (paths.length) get().toast("success", "Saved", `${paths.length} file(s)`);
  },

  setCursorPos: (line, col) => set({ cursorPos: { line, col } }),

  setSidebarView: (v) => set({ sidebarView: v }),
  setBottomView: (v) => set({ bottomView: v }),
  setAiView: (v) => set({ aiView: v }),
  setAutonomy: (v) => {
    set({ autonomy: v });
    get().toast("info", `Autonomy: ${v}`, v === "plan" ? "Agents cannot modify files or run mutating commands." : v === "auto" ? "Safe edits and builds run without asking; dangerous commands still require approval." : undefined);
  },

  /* ───── chats ───── */

  newChat: () => {
    const id = uid();
    const chat: Chat = { id, project: get().workspace?.label ?? "no-project", title: "New chat", pinned: false, createdAt: Date.now(), messages: [] };
    set((s) => ({ chats: [chat, ...s.chats], activeChatId: id }));
    void dbPut("chats", chat as unknown as { id: string } & Record<string, unknown>);
    return id;
  },
  renameChat: (id, title) => {
    set((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)) }));
    const c = get().chats.find((x) => x.id === id);
    if (c) void dbPut("chats", c as unknown as { id: string } & Record<string, unknown>);
  },
  deleteChat: (id) => {
    set((s) => ({ chats: s.chats.filter((c) => c.id !== id), activeChatId: s.activeChatId === id ? null : s.activeChatId }));
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
  setStreaming: (v) => set({ streaming: v }),
  setStreamText: (v) => set({ streamText: v }),
  appendStream: (tok) => set((s) => ({ streamText: s.streamText + tok })),
  addAttachment: (a) => set((s) => ({ attachments: [...s.attachments.filter((x) => x.name !== a.name), a] })),
  removeAttachment: (name) => set((s) => ({ attachments: s.attachments.filter((a) => a.name !== name) })),
  setAttachments: (a) => set({ attachments: a }),

  /* ───── tasks / agents ───── */

  addTask: (t) => {
    set((s) => ({ tasks: [t, ...s.tasks] }));
    void dbPut("tasks", t as unknown as { id: string } & Record<string, unknown>);
  },
  updateTask: (id, patch) => {
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    const t = get().tasks.find((x) => x.id === id);
    if (t) void dbPut("tasks", t as unknown as { id: string } & Record<string, unknown>);
  },
  removeTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    void dbDel("tasks", id);
  },
  setTaskStatus: (id, status) => get().updateTask(id, { status }),
  setAgents: (a) => set({ agents: a }),
  setAgentState: (role, patch) => set((s) => ({ agents: { ...s.agents, [role]: { ...s.agents[role], ...patch } } })),
  resetAgents: () => set({ agents: emptyAgents() }),
  setAgentRunning: (v) => set({ agentRunning: v }),

  /* ───── changes / checkpoints ───── */

  addPendingChange: (c) => {
    set((s) => {
      const replaced = s.pending.filter((p) => !(p.path === c.path && p.status === "pending" && p.taskId === c.taskId));
      return { pending: [...replaced, c] };
    });
    void dbPut("file_changes", c as unknown as { id: string } & Record<string, unknown>);
  },

  acceptChange: async (id) => {
    const s = get();
    const c = s.pending.find((x) => x.id === id);
    const ws = s.workspace;
    if (!c || !ws) return;
    if (s.settings.confirmFileChanges) {
      const ok = await s.requestPermission("ask", `Apply change to ${c.path}`, `${c.type} · ${c.before.length} → ${c.after.length} chars`);
      if (!ok) return;
    }
    const files = { ...ws.files };
    if (c.type === "delete") delete files[c.path];
    else files[c.path] = c.after;
    set((st) => ({ workspace: { ...ws, files }, pending: st.pending.map((x) => (x.id === id ? { ...x, status: "accepted" as const } : x)) }));
    get().buildTree();
    if (ws.source === "local" && c.type !== "delete") await saveLocalFile(ws.label, c.path, c.after).catch(() => undefined);
    get().log("TOOL", `accepted ${c.type} ${c.path}`);
    get().toast("success", "Change applied", c.path);
    window.dispatchEvent(new CustomEvent("localforge-files-changed"));
  },

  rejectChange: (id) => {
    set((s) => ({ pending: s.pending.map((x) => (x.id === id ? { ...x, status: "rejected" as const } : x)).filter((x) => x.status === "pending") }));
    get().log("TOOL", `rejected change ${id}`);
  },

  acceptAll: async (taskId) => {
    const ids = get().pending.filter((c) => c.status === "pending" && (!taskId || c.taskId === taskId)).map((c) => c.id);
    for (const id of ids) await get().acceptChange(id);
  },

  rejectAll: (taskId) => {
    set((s) => ({ pending: s.pending.filter((c) => c.status !== "pending" || (taskId ? c.taskId !== taskId : false)) }));
    get().toast("info", "Changes rejected", taskId ?? undefined);
  },

  undoTaskChanges: async (taskId) => {
    const s = get();
    const ws = s.workspace;
    if (!ws) return;
    const applied = s.pending.filter((c) => c.taskId === taskId && c.status === "accepted");
    const files = { ...ws.files };
    for (const c of applied) {
      if (c.type === "delete" || c.type === "modify") files[c.path] = c.before;
      else delete files[c.path];
    }
    set({ workspace: { ...ws, files }, pending: s.pending.filter((c) => c.taskId !== taskId) });
    get().buildTree();
    get().toast("success", "Rolled back", `${applied.length} change(s) from ${taskId} reverted`);
    get().log("TOOL", `undo task ${taskId} (${applied.length} changes)`);
    window.dispatchEvent(new CustomEvent("localforge-files-changed"));
  },

  addCheckpoint: (c) => {
    set((s) => ({ checkpoints: [c, ...s.checkpoints].slice(0, 12) }));
    void dbPut("checkpoints", c as unknown as { id: string } & Record<string, unknown>);
    get().log("APP", `checkpoint: ${c.label}`);
  },

  restoreCheckpoint: async (id) => {
    const c = get().checkpoints.find((x) => x.id === id);
    const ws = get().workspace;
    if (!c || !ws) return;
    set({ workspace: { ...ws, files: { ...c.files } } });
    get().buildTree();
    set({ index: buildIndex(c.files) });
    get().toast("success", "Checkpoint restored", c.label);
    get().log("APP", `restored checkpoint ${c.label}`);
    window.dispatchEvent(new CustomEvent("localforge-files-changed"));
  },

  deleteCheckpoint: (id) => {
    set((s) => ({ checkpoints: s.checkpoints.filter((c) => c.id !== id) }));
    void dbDel("checkpoints", id);
  },

  /* ───── problems / terminal / tests ───── */

  addProblems: (p) => set((s) => ({ problems: [...s.problems, ...p].slice(-200) })),
  clearProblemsBySource: (source) => set((s) => ({ problems: s.problems.filter((p) => p.source !== source) })),
  clearProblems: () => set({ problems: [] }),

  newTerminal: () => {
    const id = `term-${uid()}`;
    const n = get().terminals.length + 1;
    const session: TermSession = { id, name: `${get().settings.shell} ${n}`, lines: [{ kind: "sys", text: "LocalForge terminal — type \"help\"." }], busy: false };
    set((s) => ({ terminals: [...s.terminals, session], activeTerminalId: id }));
    return id;
  },
  closeTerminal: (id) => {
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      if (terminals.length === 0) {
        const fresh: TermSession = { id: `term-${uid()}`, name: get().settings.shell, lines: [], busy: false };
        return { terminals: [fresh], activeTerminalId: fresh.id };
      }
      return { terminals, activeTerminalId: s.activeTerminalId === id ? terminals[0].id : s.activeTerminalId };
    });
  },
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  termLine: (id, kind, text) => {
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, lines: [...t.lines.slice(-LIMITS.maxTerminalLines), { kind, text }] } : t)),
    }));
  },
  clearTerminal: (id) => set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, lines: [] } : t)) })),

  addTestRun: (r) => {
    set((s) => ({ testRuns: [r, ...s.testRuns].slice(0, 30) }));
    void dbPut("test_runs", r as unknown as { id: string } & Record<string, unknown>);
  },
  setPlan: (p) => set({ plan: p }),
  pushOutput: (kind, text) => set((s) => ({ output: [...s.output.slice(-400), { kind, text }] })),
  clearOutput: () => set({ output: [] }),
  setReport: (r) => set({ report: r }),

  memoryAdd: (text) => {
    if (!get().settings.memoryEnabled) return;
    const m: MemoryEntry = { id: uid(), project: get().workspace?.label ?? "", text, at: Date.now() };
    set((s) => ({ memory: [m, ...s.memory].slice(0, 80) }));
    void dbPut("project_memory", m as unknown as { id: string } & Record<string, unknown>);
  },
  clearMemory: async () => {
    set({ memory: [] });
    await dbClear("project_memory");
    get().toast("info", "Memory cleared");
  },

  requestPermission: (cls, title, detail) =>
    new Promise<boolean>((resolve) => {
      set({ permission: { id: uid(), kind: "command", class: cls, title, detail, resolve } });
    }),
  resolvePermission: (allow) => {
    const p = get().permission;
    if (!p) return;
    set({ permission: null });
    p.resolve(allow);
    get().log("APP", `permission ${allow ? "granted" : "denied"}: ${p.title}`);
  },

  setQuickOpen: (v) => set({ quickOpen: v }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),

  /* ───── ollama ───── */

  connectOllama: async (silent = false) => {
    const url = get().settings.ollamaUrl;
    set((s) => ({ ollama: { ...s.ollama, status: "connecting" } }));
    const h = await ollamaHealth(url);
    if (h.ok) {
      const models = await ollamaModels(url);
      set((s) => ({ ollama: { ...s.ollama, status: "connected", version: h.version, models } }));
      get().log("OLLAMA", `connected ${url} · ${models.length} models · v${h.version}`);
      if (!silent) get().toast("success", "Ollama connected", `${models.length} model(s) available`);
      void get().refreshModelDetails();
    } else {
      set((s) => ({ ollama: { ...s.ollama, status: "error", models: [] } }));
      get().log("OLLAMA", `connection failed: ${h.error}`);
      if (!silent) get().toast("warn", "Ollama unreachable", `${h.error} — the heuristic engine stays active. Install/start Ollama, then retry.`);
    }
  },
  disconnectOllama: () => {
    set((s) => ({ ollama: { ...s.ollama, status: "disconnected", models: [], modelDetails: [] } }));
    get().toast("info", "Ollama disconnected", "Falling back to the heuristic engine.");
  },
  refreshModels: async () => {
    const url = get().settings.ollamaUrl;
    try {
      const models = await ollamaModels(url);
      set((s) => ({ ollama: { ...s.ollama, models, status: "connected" } }));
      get().toast("success", "Models refreshed", `${models.length} found`);
      void get().refreshModelDetails();
    } catch (e) {
      get().toast("error", "Refresh failed", (e as Error).message);
    }
  },
  refreshModelDetails: async () => {
    const s = get();
    const details: ModelDetail[] = [];
    for (const m of s.ollama.models.slice(0, 12)) {
      try {
        const res = await fetch(`${s.settings.ollamaUrl.replace(/\/$/, "")}/api/show`, { method: "POST", body: JSON.stringify({ name: m }) });
        if (res.ok) {
          const j = (await res.json()) as { details?: { family?: string; parameter_size?: string }; model_info?: Record<string, unknown> };
          const ctx = Object.entries(j.model_info ?? {}).find(([k]) => k.includes("context_length"))?.[1];
          details.push({ name: m, family: j.details?.family, size: j.details?.parameter_size, context: typeof ctx === "number" ? ctx : undefined, vision: /vision|llava|gemma3|bakllava|minicpm-v/i.test(m) || JSON.stringify(j.model_info ?? {}).includes("projector") });
        }
      } catch { /* detail optional */ }
    }
    set((st) => ({ ollama: { ...st.ollama, modelDetails: details } }));
  },
  pullModel: async (model) => {
    const ctrl = new AbortController();
    set({ pullAbort: ctrl, pullState: { model, status: "starting…" } });
    get().log("OLLAMA", `pull ${model}`);
    try {
      await ollamaPull(get().settings.ollamaUrl, model, (p) => set({ pullState: { model, status: p.status, pct: p.pct } }), ctrl.signal);
      set({ pullState: null, pullAbort: null });
      get().toast("success", "Model pulled", model);
      void get().refreshModels();
    } catch (e) {
      set({ pullState: null, pullAbort: null });
      if ((e as Error).name !== "AbortError") get().toast("error", "Pull failed", (e as Error).message);
    }
  },
  cancelPull: () => {
    get().pullAbort?.abort();
    set({ pullState: null, pullAbort: null });
  },
  deleteModel: async (model) => {
    try {
      await ollamaDelete(get().settings.ollamaUrl, model);
      get().toast("success", "Model deleted", model);
      void get().refreshModels();
    } catch (e) {
      get().toast("error", "Delete failed", (e as Error).message);
    }
  },

  /* ───── services / preview / inline / index ───── */

  setService: (svc) => {
    set((s) => {
      const exists = s.services.some((x) => x.id === svc.id);
      return { services: exists ? s.services.map((x) => (x.id === svc.id ? svc : x)) : [...s.services, svc] };
    });
  },
  removeService: (id) => set((s) => ({ services: s.services.filter((x) => x.id !== id) })),
  setPreview: (patch) => set((s) => ({ preview: { ...s.preview, ...patch } })),
  resetPreview: () => set({ preview: DEFAULT_PREVIEW }),
  setInlineEdit: (v) => set({ inlineEdit: v }),
  setIndex: (i) => set({ index: i }),
  refreshResources: () => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    set({
      resources: {
        cores: navigator.hardwareConcurrency ?? 4,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        heapLimitMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
      },
    });
  },
}));

/* merged workspace view (accepted = workspace; pending = before snapshot) */
export function getMergedFiles(s: Pick<AppState, "workspace" | "dirty">): Record<string, string> {
  return { ...(s.workspace?.files ?? {}), ...s.dirty };
}

export function useResolvedTheme(): "dark" | "light" {
  const theme = useStore((s) => s.settings.theme);
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export { WELCOME_TITLE };
export type { MemoryEntry };
