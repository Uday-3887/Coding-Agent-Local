/* Shared domain types for LocalForge AI */

export type AgentRole =
  | "orchestrator" | "architect" | "repository" | "coder"
  | "tester" | "debugger" | "reviewer";

export type AgentStatus =
  | "idle" | "thinking" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type AiMode = "chat" | "agent" | "plan" | "test";

export interface Settings {
  theme: "dark" | "light" | "system";
  autoSave: boolean;
  defaultFolder: string;
  ollamaUrl: string;
  maxIterations: number;
  parallelAgents: boolean;
  autoTest: boolean;
  autoReview: boolean;
  shell: string;
  confirmFileChanges: boolean;
  confirmAskCommands: boolean;
  memoryEnabled: boolean;
  params: { temperature: number; topP: number; numCtx: number; numPredict: number; seed: number };
  models: { chat: string; agent: string; planner: string; tester: string; reviewer: string };
  sizes: { sidebar: number; ai: number; bottom: number };
}

export interface Workspace {
  label: string;
  source: "demo" | "local" | "upload";
  files: Record<string, string>;
  openedAt: number;
}

export interface RecentProject {
  label: string;
  source: "demo" | "local" | "upload";
  at: number;
}

export type TabKind = "file" | "diff" | "plan" | "report";
export interface EditorTab {
  id: string;
  kind: TabKind;
  title: string;
  path?: string;
  changeId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: number;
  model?: string;
}

export interface Chat {
  id: string;
  project: string;
  title: string;
  pinned: boolean;
  createdAt: number;
  messages: ChatMessage[];
}

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export interface TaskStep { id: string; label: string; status: StepStatus; }
export interface TodoItem { text: string; status: StepStatus; }

export type TaskStatus = "queued" | "running" | "paused" | "done" | "failed" | "blocked" | "cancelled";
export interface AgentTask {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  steps: TaskStep[];
  todos: TodoItem[];
  createdAt: number;
  summary?: string;
  planId?: string;
}

export interface ToolCallRecord {
  id: string;
  taskId: string;
  role: AgentRole;
  tool: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
  at: number;
}

export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  note: string;
  toolCalls: ToolCallRecord[];
  filesTouched: string[];
  errors: string[];
  output: string;
}

export interface FileChange {
  id: string;
  taskId: string;
  path: string;
  type: "create" | "modify" | "delete";
  before: string;
  after: string;
  at: number;
  status: "pending" | "accepted" | "rejected";
}

export interface Checkpoint {
  id: string;
  label: string;
  at: number;
  files: Record<string, string>;
}

export type Severity = "error" | "warning" | "info";
export interface Problem {
  id: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  source: string;
}

export type TermLineKind = "cmd" | "out" | "err" | "sys";
export interface TermLine { kind: TermLineKind; text: string; }
export interface TermSession { id: string; name: string; lines: TermLine[]; busy: boolean; }

export type TestKind = "all" | "unit" | "integration" | "build" | "lint" | "typecheck" | "runtime";
export interface TestRun {
  id: string;
  kind: TestKind;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  at: number;
  lines: TermLine[];
}

export interface Plan {
  id: string;
  task: string;
  analysis: string;
  filesToModify: string[];
  filesToCreate: string[];
  dependencies: string[];
  steps: string[];
  testing: string;
  risks: string[];
  status: "draft" | "approved" | "rejected";
  createdAt: number;
}

export type LogCategory = "APP" | "AI" | "AGENT" | "TOOL" | "OLLAMA" | "TERMINAL" | "TEST" | "ERROR";
export interface LogEntry { id: string; at: number; cat: LogCategory; msg: string; }

export interface Toast {
  id: string;
  kind: "success" | "error" | "info" | "warn";
  title: string;
  body?: string;
}

export type OllamaStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ProjectFacts {
  name: string;
  framework: string;
  languages: { lang: string; count: number }[];
  packageManager: string;
  scripts: Record<string, string>;
  dependencies: string[];
  fileCount: number;
  hasTests: boolean;
  hasGit: boolean;
  testFramework: string;
  lintConfig: string;
  tsConfig: boolean;
}

export interface AgentDecision {
  status: "continue" | "done" | "blocked";
  summary: string;
  toolCalls: { tool: string; arguments: Record<string, unknown> }[];
  todos?: { text: string; status: StepStatus }[];
}

export interface PermissionRequest {
  id: string;
  kind: "command" | "file" | "secret";
  class: "ask" | "dangerous";
  title: string;
  detail: string;
  resolve: (allow: boolean) => void;
}

export interface EcosystemInfo {
  packageManager: string;
  framework: string;
  scripts: Record<string, string>;
  testFramework: string;
  runtime: string;
}

export interface MemoryEntry { id: string; text: string; at: number; }
