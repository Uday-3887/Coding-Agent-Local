/* Shared domain types for LocalForge AI */

export type AgentRole =
  | "orchestrator" | "architect" | "repository" | "coder" | "frontend" | "backend"
  | "database" | "tester" | "debugger" | "reviewer" | "security" | "docs";

export type AgentStatus =
  | "idle" | "thinking" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type AiMode = "chat" | "agent" | "plan" | "test";

export type AutonomyMode = "ask" | "normal" | "auto" | "plan";

export interface Settings {
  theme: "dark" | "light" | "system";
  autoSave: boolean;
  defaultFolder: string;
  ollamaUrl: string;
  maxIterations: number;
  maxAgents: number;
  singleModelMode: boolean;
  parallelAgents: boolean;
  autoTest: boolean;
  autoReview: boolean;
  shell: string;
  confirmFileChanges: boolean;
  confirmAskCommands: boolean;
  memoryEnabled: boolean;
  autocomplete: { enabled: boolean; delayMs: number; contextChars: number };
  params: { temperature: number; topP: number; numCtx: number; numPredict: number; seed: number };
  models: { chat: string; agent: string; planner: string; tester: string; reviewer: string; autocomplete: string };
  sizes: { sidebar: number; ai: number; bottom: number };
}

export interface Workspace {
  label: string;
  source: "demo" | "local" | "upload";
  files: Record<string, string>;
  openedAt: number;
}

export interface RecentProject { label: string; source: "demo" | "local" | "upload"; at: number; }

export type TabKind = "file" | "diff" | "plan" | "report" | "preview";
export interface EditorTab { id: string; kind: TabKind; title: string; path?: string; changeId?: string; }

export interface ChatMessage { id: string; role: "user" | "assistant" | "system"; content: string; at: number; model?: string; attachments?: string[]; }
export interface Chat { id: string; project: string; title: string; pinned: boolean; createdAt: number; messages: ChatMessage[]; }

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export interface TaskStep { id: string; label: string; status: StepStatus; }
export interface TodoItem { text: string; status: StepStatus; }

export type TaskStatus = "queued" | "running" | "paused" | "done" | "failed" | "blocked" | "cancelled";
export interface AgentTask {
  id: string; title: string; prompt: string; status: TaskStatus;
  steps: TaskStep[]; todos: TodoItem[]; createdAt: number; queuedAt?: number;
  summary?: string; planId?: string; parallel?: boolean;
}

export interface ToolCallRecord {
  id: string; taskId: string; role: AgentRole; tool: string;
  args: Record<string, unknown>; result: string; ok: boolean; at: number;
}

export interface AgentState {
  role: AgentRole; status: AgentStatus; note: string;
  toolCalls: ToolCallRecord[]; filesTouched: string[]; errors: string[]; output: string;
}

export interface FileChange {
  id: string; taskId: string; path: string;
  type: "create" | "modify" | "delete"; before: string; after: string;
  at: number; status: "pending" | "accepted" | "rejected";
}

export interface Checkpoint { id: string; label: string; at: number; files: Record<string, string>; }

export type Severity = "error" | "warning" | "info";
export interface Problem { id: string; severity: Severity; file: string; line: number; message: string; source: string; }

export type TermLineKind = "cmd" | "out" | "err" | "sys";
export interface TermLine { kind: TermLineKind; text: string; }
export interface TermSession { id: string; name: string; lines: TermLine[]; busy: boolean; }

export type TestKind = "all" | "unit" | "integration" | "build" | "lint" | "typecheck" | "runtime";
export interface TestRun {
  id: string; kind: TestKind; passed: number; failed: number; skipped: number;
  durationMs: number; at: number; lines: TermLine[];
}

export interface Plan {
  id: string; task: string; analysis: string; filesToModify: string[]; filesToCreate: string[];
  dependencies: string[]; steps: string[]; testing: string; risks: string[];
  status: "draft" | "approved" | "rejected"; createdAt: number;
}

export type LogCategory = "APP" | "AI" | "AGENT" | "TOOL" | "OLLAMA" | "TERMINAL" | "TEST" | "ERROR";
export interface LogEntry { id: string; at: number; cat: LogCategory; msg: string; }

export interface Toast { id: string; kind: "success" | "error" | "info" | "warn"; title: string; body?: string; }

export type OllamaStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ProjectFacts {
  name: string; framework: string; languages: { lang: string; count: number }[];
  packageManager: string; scripts: Record<string, string>; dependencies: string[];
  fileCount: number; hasTests: boolean; hasGit: boolean; testFramework: string;
  lintConfig: string; tsConfig: boolean;
}

export interface AgentDecision {
  status: "continue" | "done" | "blocked";
  summary: string;
  toolCalls: { tool: string; arguments: Record<string, unknown> }[];
  todos?: { text: string; status: StepStatus }[];
  parallel?: boolean;
}

export interface PermissionRequest {
  id: string; kind: "command" | "file" | "secret";
  class: "ask" | "dangerous"; title: string; detail: string;
  resolve: (allow: boolean) => void;
}

export interface EcosystemInfo {
  packageManager: string; framework: string; scripts: Record<string, string>;
  testFramework: string; runtime: string;
}

/* ─────────── adapters / run / preview ─────────── */

export type PreviewKind = "esbuild" | "static" | "console" | "api" | "external" | "none";

export interface AdapterInfo {
  id: string;
  name: string;
  language: string;
  framework: string;
  packageManager: string;
  buildSystem: string;
  testFramework: string;
  scripts: Record<string, string>;
  runCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  debugConfigured: boolean;
  previewKind: PreviewKind;
  defaultPort: number | null;
  entryFile: string | null;
  lspServer: string | null;
  services: { name: string; command: string; cwd: string }[];
}

export type ServiceStatus = "running" | "stopped" | "crashed" | "requires-desktop" | "starting";
export interface ServiceInfo {
  id: string; name: string; command: string; cwd: string; port: number | null;
  status: ServiceStatus; startedAt: number; kind: PreviewKind; logs: TermLine[];
}

/* ─────────── preview panel ─────────── */

export interface DevicePreset { label: string; w: number; h: number; }

export interface PreviewState {
  doc: string;
  url: string;
  kind: PreviewKind;
  mode: "esbuild" | "static" | "console" | "none";
  note: string;
  device: DevicePreset;
  zoom: number;
  consoleLines: TermLine[];
  inspectOn: boolean;
  inspectInfo: string | null;
  autoRefresh: boolean;
  building: boolean;
  error: string | null;
  detectedUrls: string[];
}

/* ─────────── inline AI / autocomplete ─────────── */

export type InlineAction = "prompt" | "explain" | "fix" | "improve" | "refactor" | "tests";
export interface InlineEditState {
  path: string;
  from: number;
  to: number;
  original: string;
  proposed: string | null;
  instruction: string;
  action: InlineAction;
  status: "idle" | "working" | "ready";
  explanation: string | null;
}

/* ─────────── attachments / index / resources ─────────── */

export interface Attachment { name: string; dataUrl: string; size: number; }

export interface SymbolInfo { name: string; kind: "function" | "class" | "component" | "variable"; file: string; line: number; }
export interface ProjectIndex {
  symbols: SymbolInfo[];
  depGraph: Record<string, string[]>;
  summary: string;
  indexedAt: number;
  fileCount: number;
}

export interface ResourceInfo { cores: number; heapMB: number | null; heapLimitMB: number | null; }

export interface ModelDetail { name: string; size?: string; family?: string; context?: number; vision: boolean; }
