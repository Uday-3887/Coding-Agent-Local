/**
 * Provider abstraction. OllamaProvider talks to a local Ollama REST API
 * (endpoint always comes from Settings). OfflineProvider is a clearly-labeled
 * built-in heuristic engine so the platform works before Ollama is connected.
 */
import { z } from "zod";
import { LIMITS } from "../config/app";
import type { AgentDecision, Problem, ProjectFacts } from "../lib/types";
import { offlineChatAnswer, offlineDecide } from "./heuristics";

export interface ModelParams {
  temperature: number;
  topP: number;
  numCtx: number;
  numPredict: number;
  seed: number;
}

export interface ProviderChatMessage { role: "system" | "user" | "assistant"; content: string; }

export interface StreamChatOptions {
  model: string;
  messages: ProviderChatMessage[];
  params: ModelParams;
  signal: AbortSignal;
  onToken: (token: string) => void;
  files?: Record<string, string>;
  facts?: ProjectFacts;
  extraFile?: string | null;
}

export interface DecideRequest {
  role: string;
  task: string;
  model: string;
  system: string;
  context: string;
  history: string;
  files: Record<string, string>;
  facts: ProjectFacts;
  problems: Problem[];
  params: ModelParams;
  signal: AbortSignal;
}

export interface AIProvider {
  readonly kind: "ollama" | "offline";
  readonly label: string;
  streamChat(opts: StreamChatOptions): Promise<string>;
  decide(req: DecideRequest): Promise<AgentDecision>;
}

/* ───────────────────── Ollama REST helpers ───────────────────── */

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 5000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function ollamaHealth(url: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const j = (await fetchJson(`${url.replace(/\/$/, "")}/api/version`)) as { version?: string };
    return { ok: true, version: j.version };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "timeout — is Ollama running?" : (e as Error).message };
  }
}

export async function ollamaModels(url: string): Promise<string[]> {
  const j = (await fetchJson(`${url.replace(/\/$/, "")}/api/tags`, undefined, 8000)) as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name);
}

export async function ollamaPull(url: string, model: string, onProgress: (p: { status: string; pct?: number }) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/pull`, {
    method: "POST",
    body: JSON.stringify({ name: model, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`pull failed (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line) as { status?: string; completed?: number; total?: number };
        const pct = j.total ? Math.round(((j.completed ?? 0) / j.total) * 100) : undefined;
        onProgress({ status: j.status ?? "working", pct });
      } catch { /* partial */ }
    }
  }
}

export async function ollamaDelete(url: string, model: string): Promise<void> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/delete`, {
    method: "DELETE",
    body: JSON.stringify({ name: model }),
  });
  if (!res.ok) throw new Error(`delete failed (HTTP ${res.status})`);
}

/* ───────────────────── Decision schema (Zod-validated) ───────────────────── */

const DecisionSchema = z.object({
  status: z.enum(["continue", "done", "blocked"]).catch("continue"),
  summary: z.string().catch(""),
  toolCalls: z
    .array(z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) }))
    .catch([]),
  todos: z
    .array(z.object({ text: z.string(), status: z.enum(["pending", "running", "done"]) }))
    .optional(),
});

export function parseDecision(raw: string): AgentDecision {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model response");
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  return DecisionSchema.parse(parsed);
}

function paramsToOptions(p: ModelParams): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    temperature: p.temperature,
    top_p: p.topP,
    num_ctx: p.numCtx,
    num_predict: p.numPredict,
  };
  if (p.seed > 0) opts.seed = p.seed;
  return opts;
}

/* ───────────────────── Ollama provider ───────────────────── */

export class OllamaProvider implements AIProvider {
  readonly kind = "ollama" as const;
  readonly label = "Ollama (local)";
  constructor(private url: string) {}

  async streamChat(opts: StreamChatOptions): Promise<string> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        options: paramsToOptions(opts.params),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama chat failed (HTTP ${res.status}). Is the model pulled?`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
          if (j.error) throw new Error(j.error);
          const tok = j.message?.content ?? "";
          if (tok) { full += tok; opts.onToken(tok); }
        } catch (e) {
          if ((e as Error).message && !(e instanceof SyntaxError)) throw e;
        }
      }
    }
    return full;
  }

  async decide(req: DecideRequest): Promise<AgentDecision> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        stream: false,
        format: "json",
        options: paramsToOptions(req.params),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: `${req.context}\n\nTASK: ${req.task}\n\n<execution_so_far>\n${req.history || "(first step)"}\n</execution_so_far>\n\nRespond with strict JSON only.`.slice(0, LIMITS.maxContextChars + 8000) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama request failed (HTTP ${res.status})`);
    const j = (await res.json()) as { message?: { content?: string } };
    return parseDecision(j.message?.content ?? "");
  }
}

/* ───────────────────── Offline heuristic provider ───────────────────── */

export class OfflineProvider implements AIProvider {
  readonly kind = "offline" as const;
  readonly label = "LocalForge Heuristic (built-in)";

  async streamChat(opts: StreamChatOptions): Promise<string> {
    const lastUser = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const answer = offlineChatAnswer(lastUser, opts.files ?? {}, opts.facts ?? ({} as ProjectFacts), opts.extraFile ?? null);
    const words = answer.split(/(\s+)/);
    let full = "";
    for (const w of words) {
      if (opts.signal.aborted) break;
      full += w;
      opts.onToken(w);
      if (w.trim()) await new Promise((r) => setTimeout(r, 14));
    }
    return full;
  }

  async decide(req: DecideRequest): Promise<AgentDecision> {
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 400)); // visible thinking beat
    if (req.signal.aborted) throw new DOMException("aborted", "AbortError");
    return offlineDecide({
      role: req.role,
      task: req.task,
      files: req.files,
      facts: req.facts,
      history: req.history,
      problems: req.problems,
    });
  }
}

export function selectProvider(ollamaConnected: boolean, url: string): AIProvider {
  return ollamaConnected ? new OllamaProvider(url) : new OfflineProvider();
}
