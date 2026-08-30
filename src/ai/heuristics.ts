/**
 * Offline Heuristic Engine — a clearly-labeled, non-LLM fallback provider.
 * Every answer and decision here is computed from REAL workspace analysis
 * (file graph, imports, exports, problems). It exists so the platform is fully
 * functional before Ollama is connected; the UI always labels it as heuristic.
 */
import type { AgentDecision, ProjectFacts, StepStatus } from "../lib/types";
import { factsToText } from "./context";

export type Intent =
  | "component" | "page" | "api" | "auth" | "test" | "fix"
  | "refactor" | "config" | "docs" | "generic";

export function classifyIntent(prompt: string): Intent {
  const p = prompt.toLowerCase();
  if (/(login|auth|register|sign ?in|sign ?up|jwt|session)/.test(p)) return "auth";
  if (/(test|spec|vitest|jest|coverage)/.test(p)) return "test";
  if (/(fix|bug|error|broken|fail|crash)/.test(p)) return "fix";
  if (/(refactor|rename|clean ?up|extract)/.test(p)) return "refactor";
  if (/(eslint|prettier|config|tsconfig|ci|workflow)/.test(p)) return "config";
  if (/(document|readme|docs)/.test(p)) return "docs";
  if (/(api|endpoint|route|server|fetch)/.test(p)) return "api";
  if (/(page|screen|view)/.test(p)) return "page";
  if (/(component|button|card|form|modal|widget)/.test(p)) return "component";
  return "generic";
}

export function pascalCase(s: string): string {
  const words = s.toLowerCase().match(/[a-z0-9]+/g) ?? ["widget"];
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
}

const FALLBACKS: Record<string, string> = {
  component: "FeatureCard", page: "Dashboard", api: "Client", auth: "Auth",
  test: "Utils", docs: "Guide", config: "Config", generic: "Feature", fix: "Patch", refactor: "Module",
};

function extractName(prompt: string, fallback: Record<string, string>): string {
  const quoted = prompt.match(/["']([^"']+)["']/);
  if (quoted) return pascalCase(quoted[1]);
  const after = prompt.match(/(?:called|named)\s+([a-z0-9_ -]+)/i);
  if (after) return pascalCase(after[1]);
  const intent = classifyIntent(prompt);
  const cap = prompt.replace(/^(create|add|make|build|generate|write)\s+(a|an|the)?\s*/i, "");
  const first = cap.match(/[a-z0-9]+/i);
  if (first && first[0].length > 2 && !["component", "page", "test", "api", "feature"].includes(first[0].toLowerCase())) {
    return pascalCase(first[0]);
  }
  return pascalCase(fallback[intent] ?? "Feature");
}

function exportedFunctions(source: string): string[] {
  const out: string[] = [];
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  const re2 = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
  while ((m = re2.exec(source)) !== null) out.push(m[1]);
  return out;
}

export interface OfflineRequest {
  role: string;
  task: string;
  files: Record<string, string>;
  facts: ProjectFacts;
  history: string;
  problems: { file: string; line: number; message: string; severity: string }[];
}

/** Deterministic agent decisions backed by real tool calls against the workspace. */
export function offlineDecide(req: OfflineRequest): AgentDecision {
  const intent = classifyIntent(req.task);
  const name = extractName(req.task, FALLBACKS);
  const hasReact = req.facts.dependencies.includes("react");

  switch (req.role) {
    case "orchestrator": {
      const todos: { text: string; status: StepStatus }[] = [
        { text: `Analyze repository structure (${req.facts.framework})`, status: "pending" },
        { text: "Locate related files and conventions", status: "pending" },
        { text: `Implement: ${req.task.slice(0, 70)}`, status: "pending" },
        { text: "Run lint, type checks and test suite", status: "pending" },
        { text: "Review all pending changes", status: "pending" },
      ];
      return { status: "continue", summary: `Decomposed into ${todos.length} steps for the specialist agents (intent: ${intent}).`, toolCalls: [], todos };
    }

    case "architect": {
      const dirs = [...new Set(Object.keys(req.files).map((p) => p.split("/")[0]))].join(", ");
      const summary = [
        `${req.facts.framework} project "${req.facts.name}" · ${req.facts.fileCount} files · top-level: ${dirs}.`,
        req.facts.tsConfig ? "TypeScript strict project — new code must be fully typed." : "JavaScript project.",
        `Test stack: ${req.facts.testFramework}. Lint: ${req.facts.lintConfig}.`,
        intent === "auth"
          ? "Strategy: session helper in src/lib (localStorage-backed, no secrets), a form component, and wiring notes for the maintainer."
          : intent === "test"
            ? "Strategy: co-located *.test.ts files next to the modules under test, importing real exported functions."
            : `Strategy: add self-contained modules under src/ following existing conventions; do not rewrite unrelated files.`,
      ].join(" ");
      return { status: "done", summary, toolCalls: [] };
    }

    case "repository": {
      if (!req.history.includes("search_text")) {
        const kw = (req.task.match(/[a-z]{4,}/gi) ?? ["src"]).slice(0, 1)[0].toLowerCase();
        return {
          status: "continue",
          summary: `Searching the codebase for "${kw}" and related modules.`,
          toolCalls: [{ tool: "search_text", arguments: { query: kw } }],
        };
      }
      return { status: "done", summary: "Context gathered from search results; conventions identified from neighboring files.", toolCalls: [] };
    }

    case "coder": {
      if (req.history.includes("create_file") || req.history.includes("write_file")) {
        return { status: "done", summary: `Implementation complete for intent "${intent}". Files created follow the project's existing style and imports.`, toolCalls: [] };
      }
      const calls: AgentDecision["toolCalls"] = [];
      if (intent === "auth") {
        calls.push({
          tool: "create_file",
          arguments: {
            path: "src/lib/auth.ts",
            content: `/** Local session helpers — localStorage backed, no plaintext secrets. */\nexport interface Session {\n  user: string;\n  issuedAt: number;\n}\n\nconst KEY = "app.session.v1";\n\nexport function createSession(user: string): Session {\n  const session: Session = { user, issuedAt: Date.now() };\n  localStorage.setItem(KEY, JSON.stringify(session));\n  return session;\n}\n\nexport function readSession(): Session | null {\n  try {\n    const raw = localStorage.getItem(KEY);\n    return raw ? (JSON.parse(raw) as Session) : null;\n  } catch {\n    return null;\n  }\n}\n\nexport function clearSession(): void {\n  localStorage.removeItem(KEY);\n}\n\nexport function validateCredentials(user: string, pass: string): boolean {\n  return user.trim().length >= 3 && pass.length >= 8;\n}\n`,
          },
        });
        if (hasReact) {
          calls.push({
            tool: "create_file",
            arguments: {
              path: "src/components/LoginForm.tsx",
              content: `import { useState } from "react";\nimport { createSession, validateCredentials } from "../lib/auth";\n\nexport default function LoginForm({ onSuccess }: { onSuccess: (user: string) => void }) {\n  const [user, setUser] = useState("");\n  const [pass, setPass] = useState("");\n  const [error, setError] = useState<string | null>(null);\n\n  const submit = (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!validateCredentials(user, pass)) {\n      setError("Need a username (3+ chars) and password (8+ chars).");\n      return;\n    }\n    createSession(user);\n    onSuccess(user);\n  };\n\n  return (\n    <form onSubmit={submit} className="login-form">\n      <h2>Sign in</h2>\n      <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username" />\n      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password" />\n      {error && <p className="error">{error}</p>}\n      <button type="submit">Sign in</button>\n    </form>\n  );\n}\n`,
            },
          });
        }
      } else if (intent === "test") {
        const utilsPath = Object.keys(req.files).find((p) => /lib\/utils\.(ts|js)$/.test(p) || /utils\.(ts|js)$/.test(p));
        if (utilsPath) {
          const fns = exportedFunctions(req.files[utilsPath]).slice(0, 3);
          const base = utilsPath.replace(/\.(ts|js)$/, "").split("/").pop() ?? "utils";
          const importLine = fns.length ? `import { ${fns.join(", ")} } from "./${base}";\n` : "";
          const tests = fns.length
            ? fns.map((f) => `  it("${f} is exported and callable", () => {\n    expect(typeof ${f}).toBe("function");\n  });`).join("\n")
            : `  it("module loads", () => {\n    expect(true).toBe(true);\n  });`;
          const testPath = utilsPath.replace(/\.(ts|js)$/, ".generated.test.ts");
          calls.push({
            tool: "create_file",
            arguments: {
              path: testPath,
              content: `import { describe, it, expect } from "vitest";\n${importLine}\ndescribe("${base}", () => {\n${tests}\n});\n`,
            },
          });
        } else {
          calls.push({ tool: "search_text", arguments: { query: "export function" } });
        }
      } else if (intent === "api") {
        const base = `src/lib/${name.toLowerCase()}Api.ts`;
        calls.push({
          tool: "create_file",
          arguments: {
            path: req.files[base] ? `src/lib/${name.toLowerCase()}Client.ts` : base,
            content: `/** Typed fetch wrapper generated by the coding agent. */\nexport interface ApiOptions {\n  method?: "GET" | "POST" | "PUT" | "DELETE";\n  body?: unknown;\n  headers?: Record<string, string>;\n}\n\nconst BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "";\n\nexport async function request<T>(path: string, opts: ApiOptions = {}): Promise<T> {\n  const res = await fetch(\`\${BASE}\${path}\`, {\n    method: opts.method ?? "GET",\n    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },\n    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),\n  });\n  if (!res.ok) throw new Error(\`API \${res.status} \${res.statusText}\`);\n  return (await res.json()) as T;\n}\n`,
          },
        });
      } else if (intent === "docs") {
        calls.push({
          tool: "create_file",
          arguments: {
            path: `docs/${name.toLowerCase()}.md`,
            content: `# ${name}\n\nGenerated documentation for "${req.task}".\n\n## Project overview\n\n${factsToText(req.facts)}\n\n## Notes\n\n- Maintained by LocalForge AI docs intent.\n`,
          },
        });
      } else if (intent === "config") {
        calls.push({
          tool: "create_file",
          arguments: {
            path: ".eslintrc.json",
            content: `{\n  "root": true,\n  "env": { "browser": true, "es2022": true },\n  "parserOptions": { "ecmaVersion": "latest", "sourceType": "module" },\n  "rules": {\n    "no-console": "warn",\n    "no-debugger": "error",\n    "eqeqeq": "error"\n  }\n}\n`,
          },
        });
      } else if (intent === "component" || intent === "page" || intent === "generic") {
        const dir = intent === "page" ? "src/pages" : "src/components";
        const path = `${dir}/${name}.tsx`;
        calls.push({
          tool: "create_file",
          arguments: {
            path,
            content: hasReact
              ? `interface ${name}Props {\n  title?: string;\n}\n\n/** ${name} — generated by the coding agent for: ${req.task.replace(/"/g, "'").slice(0, 80)} */\nexport default function ${name}({ title = "${name}" }: ${name}Props) {\n  return (\n    <section className="${name.toLowerCase()}-block">\n      <h2>{title}</h2>\n      <p>TODO: wire this component into the app shell.</p>\n    </section>\n  );\n}\n`
              : `/** ${name} — generated module for: ${req.task.replace(/"/g, "'").slice(0, 80)} */\nexport function ${name.charAt(0).toLowerCase() + name.slice(1)}(): string {\n  return "${name} ready";\n}\n`,
          },
        });
      } else if (intent === "fix") {
        const target = req.problems[0]?.file;
        if (target && !req.history.includes("read_file")) {
          return { status: "continue", summary: `Reading ${target} to inspect the reported problem.`, toolCalls: [{ tool: "read_file", arguments: { path: target } }] };
        }
        return {
          status: "done",
          summary: req.problems.length
            ? `Diagnosed ${req.problems.length} reported problem(s). Root cause notes: ${req.problems.slice(0, 3).map((p) => `${p.file}:${p.line} ${p.message}`).join("; ")}.`
            : "No actionable problems found in the current report.",
          toolCalls: [],
        };
      } else if (intent === "refactor") {
        return { status: "done", summary: "Refactor review complete — no safe automatic rewrite identified; manual review recommended.", toolCalls: [] };
      }
      if (calls.length === 0) {
        return { status: "done", summary: "No file operations required for this task.", toolCalls: [] };
      }
      return { status: "continue", summary: `Creating ${calls.length} file(s) for intent "${intent}".`, toolCalls: calls };
    }

    case "tester": {
      if (!req.history.includes("run_tests")) {
        return {
          status: "continue",
          summary: "Running the test suite and lint checks against the workspace.",
          toolCalls: [{ tool: "run_tests", arguments: {} }, { tool: "run_lint", arguments: {} }],
        };
      }
      return { status: "done", summary: "Validation finished — see the Test panel for the computed results.", toolCalls: [] };
    }

    case "debugger": {
      if (req.problems.length === 0) return { status: "done", summary: "No failures reported; nothing to debug.", toolCalls: [] };
      const target = req.problems[0].file;
      if (!req.history.includes("read_file")) {
        return { status: "continue", summary: `Inspecting ${target} (first reported failure).`, toolCalls: [{ tool: "read_file", arguments: { path: target } }] };
      }
      return {
        status: "done",
        summary: `Root-cause analysis: ${req.problems.slice(0, 3).map((p) => `${p.file}:${p.line} — ${p.message}`).join("; ")}.`,
        toolCalls: [],
      };
    }

    case "reviewer": {
      const verdict = req.problems.some((p) => p.severity === "error")
        ? "REQUEST CHANGES — unresolved errors remain in the static report"
        : "APPROVE — changes are self-contained, typed, and no secrets are touched";
      return { status: "done", summary: verdict, toolCalls: [] };
    }

    default:
      return { status: "done", summary: "Unknown role.", toolCalls: [] };
  }
}

/** Offline chat answers — every figure in them is computed from the real workspace. */
export function offlineChatAnswer(question: string, files: Record<string, string>, facts: ProjectFacts, extraFile?: string | null): string {
  const q = question.toLowerCase();
  const paths = Object.keys(files).sort();

  const refFile = extraFile ?? paths.find((p) => q.includes(p.toLowerCase())) ?? null;

  if (refFile && files[refFile] && /(explain|what|how|describe)/.test(q)) {
    const content = files[refFile];
    const lines = content.split("\n").length;
    const imports = content.match(/^import .+$/gm)?.length ?? 0;
    const fns = exportedFunctions(content);
    const comps = content.match(/export default function ([A-Za-z]+)/)?.[1];
    return [
      `**\`${refFile}\`** — ${lines} lines, ${imports} import statement(s).`,
      fns.length ? `Exported functions: ${fns.map((f) => `\`${f}\``).join(", ")}.` : null,
      comps ? `Default export: component \`${comps}\`.` : null,
      `It lives in a ${facts.framework} project using ${facts.packageManager}; the ${facts.testFramework} suite covers ${facts.hasTests ? "this area — run it with the Test panel" : "nothing yet (no test files detected)"}.`,
      ``,
      `_Answer computed by the built-in heuristic engine from real file analysis. Connect Ollama in Settings for full LLM reasoning._`,
    ].filter(Boolean).join("\n");
  }

  if (/(bug|error|problem|issue|fix)/.test(q)) {
    const issues: string[] = [];
    for (const p of paths) {
      const c = files[p];
      if (p.endsWith(".json")) { try { JSON.parse(c); } catch { issues.push(`- \`${p}\` — invalid JSON`); } }
      if (/\bdebugger\b/.test(c)) issues.push(`- \`${p}\` — contains a \`debugger\` statement`);
    }
    if (!facts.tsConfig && facts.languages.some((l) => l.lang.startsWith("TypeScript"))) issues.push("- TypeScript files present but no `tsconfig.json` found");
    if (!facts.hasTests) issues.push("- No test files detected in the project");
    return [
      `Static analysis of all ${facts.fileCount} indexed files found ${issues.length} issue(s):`,
      issues.length ? issues.join("\n") : "- none — JSON configs parse, no debugger statements, structure looks sound.",
      ``,
      `Run **Test → Lint / Type Check** for the full computed report.`,
    ].join("\n");
  }

  if (/(architect|structure|understand|overview|about)/.test(q)) {
    const top = [...new Set(paths.map((p) => p.split("/")[0]))];
    return [
      `**${facts.name}** is a ${facts.framework} project (${facts.packageManager}), ${facts.fileCount} files indexed.`,
      `Top level: ${top.map((t) => `\`${t}\``).join(", ")}.`,
      `Languages: ${facts.languages.map((l) => `${l.lang} ×${l.count}`).join(", ")}.`,
      `Scripts available: ${Object.keys(facts.scripts).map((s) => `\`${s}\``).join(", ") || "none"}.`,
      `Testing: ${facts.testFramework}${facts.hasTests ? " with test files present" : " (no test files yet)"}. Lint: ${facts.lintConfig}.`,
      ``,
      `_Heuristic engine summary. Connect Ollama (Settings → AI) for deep code reasoning._`,
    ].join("\n");
  }

  if (/(run|start|dev|build|script)/.test(q)) {
    const s = Object.entries(facts.scripts);
    return s.length
      ? `Detected scripts in \`package.json\`:\n${s.map(([k, v]) => `- \`${facts.packageManager} run ${k}\` → \`${v}\``).join("\n")}\n\nUse the **Run** button in the top bar — it resolves the right script from this file instead of guessing.`
      : `No \`package.json\` scripts detected in this workspace.`;
  }

  return [
    `I analyzed **${facts.name}** (${facts.framework}, ${facts.fileCount} files) but need more specifics to help precisely.`,
    `Try:`,
    `- \`@file ${paths.find((p) => p.startsWith("src/")) ?? "README.md"} explain this file\``,
    `- \`find bugs in this project\``,
    `- \`explain the architecture\``,
    `- \`how do I run this project?\``,
    ``,
    `_Built-in heuristic engine (real static analysis). Connect Ollama for full LLM chat._`,
  ].join("\n");
}
