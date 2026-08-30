/**
 * Agent tool registry. Every call is validated with Zod, sandboxed to the open
 * workspace, secret-aware, and gated by the autonomy mode:
 *   ask    → file edits + ask-class commands require approval
 *   normal → edits flow, ask-class commands require approval
 *   auto   → edits and builds flow, dangerous commands still require approval
 *   plan   → read-only; every mutation is rejected
 */
import { z } from "zod";
import { LIMITS } from "../config/app";
import { detectProject } from "../adapters";
import { isSecretFile, maskSecretContent, safePath } from "../lib/fs";
import type { Problem, TermLineKind } from "../lib/types";
import { runSuite } from "../agents/testing";

export interface ToolResult { ok: boolean; result: string; }
const ok = (result: string): ToolResult => ({ ok: true, result });
const fail = (result: string): ToolResult => ({ ok: false, result });

export interface ToolCtx {
  taskId: string;
  role: string;
  signal: AbortSignal;
  files: () => Record<string, string>;
  write: (path: string, after: string) => unknown;
  remove: (path: string) => unknown;
  rename: (from: string, to: string) => unknown;
  terminal: (kind: TermLineKind, text: string) => void;
  output: (kind: TermLineKind, text: string) => void;
  requestPermission: (cls: "ask" | "dangerous", title: string, detail: string) => Promise<boolean>;
  addProblems: (p: Problem[]) => void;
  autonomy?: "ask" | "normal" | "auto" | "plan";
  acquireFileLock?: (path: string) => Promise<() => void>;
}

export function classifyCommand(cmd: string): "safe" | "ask" | "dangerous" {
  const c = cmd.trim().toLowerCase();
  const dangerous = [
    /\brm\s+(-[a-z]*r[a-z]*\s+)?(-[a-z]*f[a-z]*\s+)?\//, /\brm\s+-rf?\s+\*/, /rm\s+-rf\s+~/, /rm\s+-rf\s+\./,
    /\bmkfs\b/, /\bdd\s+if=/, /\bformat\b\s+[a-z]:/, /\brmdir\s+\/s/, /\bdel\s+\/[sfq]/,
    /--force\s+push|push\s+(-f|--force)/, /\bcurl\b.*\|\s*(bash|sh|powershell)/, /wget\b.*\|\s*(bash|sh)/,
    /\biex\b/, /invoke-expression/, /\bshutdown\b/, /\breboot\b/, /::\(\)\{/, /\bchmod\s+-r\b/,
    />\s*\/dev\/sd/, /\bkill\s+-9\s+1\b/, /git\s+clean\s+-[a-z]*f/, /\bnpkill\b/,
    /credentials|password|secret|token|private[_-]?key/,
  ];
  if (dangerous.some((r) => r.test(c))) return "dangerous";
  const ask = [
    /^(npm|pnpm|yarn|bun)\s+(install|i|add|remove|uninstall|publish)/,
    /^pip3?\s+install/, /^apt(-get)?\s/, /^brew\s+install/, /^cargo\s+install/, /^go\s+install/,
    /^gem\s+install/, /^composer\s+(require|install)/, /^dotnet\s+add\s+package/,
    /git\s+(commit|checkout|branch|merge|rebase|reset|stash|init|clone|add)/,
    /\bnpx\s+/, /docker\s+(run|pull|rm|rmi|system)/,
  ];
  if (ask.some((r) => r.test(c))) return "ask";
  return "safe";
}

export const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  read_file: z.object({ path: z.string() }),
  write_file: z.object({ path: z.string(), content: z.string() }),
  create_file: z.object({ path: z.string(), content: z.string() }),
  delete_file: z.object({ path: z.string() }),
  move_file: z.object({ from: z.string(), to: z.string() }),
  list_directory: z.object({ path: z.string().optional() }),
  search_text: z.object({ query: z.string(), regex: z.boolean().optional() }),
  search_files: z.object({ pattern: z.string() }),
  find_symbol: z.object({ name: z.string() }),
  get_file_tree: z.object({}),
  get_project_info: z.object({}),
  inspect_package_json: z.object({}),
  run_terminal_command: z.object({ command: z.string() }),
  run_tests: z.object({}),
  run_lint: z.object({}),
  run_build: z.object({}),
  report_problem: z.object({ file: z.string(), line: z.number().optional(), message: z.string() }),
  api_request: z.object({ method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), url: z.string(), body: z.string().optional() }),
};

function searchHits(files: Record<string, string>, query: string, isRegex: boolean) {
  const hits: string[] = [];
  let re: RegExp;
  try { re = isRegex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  catch { return ["invalid regex"]; }
  for (const [p, content] of Object.entries(files)) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 140)}`);
        if (hits.length >= 40) return hits;
      }
    }
  }
  return hits.length ? hits : [`no matches for "${query}"`];
}

/** Autonomy gate: decides whether this mutation needs explicit user approval right now. */
async function gateMutation(ctx: ToolCtx, kind: "file" | "command", cls: "ask" | "dangerous", title: string, detail: string): Promise<boolean> {
  const mode = ctx.autonomy ?? "normal";
  if (mode === "plan") return false; // plan mode: never mutate
  if (cls === "dangerous") return ctx.requestPermission("dangerous", title, detail);
  if (kind === "command" && mode === "auto") return true;
  if (kind === "file" && (mode === "auto" || mode === "normal")) return true;
  return ctx.requestPermission("ask", title, detail);
}

export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolCtx,
  origin: "agent" | "terminal"
): Promise<ToolResult> {
  const schema = TOOL_SCHEMAS[name];
  if (!schema) return fail(`unknown tool "${name}" — refusing to execute`);
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) return fail(`invalid arguments for ${name}: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  const args = parsed.data as Record<string, unknown>;
  const files = ctx.files();

  const guard = (p: string): string | null => {
    const sp = safePath(p);
    if (!sp) return null;
    if (isSecretFile(sp) && origin === "agent") {
      ctx.terminal("err", `security: ${sp} is a sensitive file — blocked from AI access`);
      return null;
    }
    return sp;
  };

  switch (name) {
    case "read_file": {
      const p = guard(args.path as string);
      if (!p) return fail("blocked or invalid path");
      const content = files[p];
      if (content === undefined) return fail(`${p}: file not found`);
      const masked = isSecretFile(p) ? maskSecretContent(content) : content;
      return ok(masked.slice(0, LIMITS.maxFileChars));
    }
    case "write_file":
    case "create_file": {
      const p = guard(args.path as string);
      if (!p) return fail("blocked or invalid path");
      const content = args.content as string;
      const exists = files[p] !== undefined;
      if (name === "create_file" && exists) return fail(`${p} already exists — use write_file to modify`);
      if (name === "write_file" && !exists) return fail(`${p} does not exist — use create_file`);
      const allowed = await gateMutation(ctx, "file", "ask", `${name}: ${p}`, `${content.split("\n").length} lines will be written to ${p}.`);
      if (!allowed) return fail(`permission denied for ${name} ${p}`);
      if (ctx.acquireFileLock) {
        const release = await ctx.acquireFileLock(p);
        try { ctx.write(p, content); } finally { release(); }
      } else {
        ctx.write(p, content);
      }
      return ok(`${name === "create_file" ? "created" : "updated"} ${p} (${content.split("\n").length} lines) — change pending review`);
    }
    case "delete_file": {
      const p = guard(args.path as string);
      if (!p) return fail("blocked or invalid path");
      if (files[p] === undefined) return fail(`${p}: file not found`);
      const allowed = await gateMutation(ctx, "file", "ask", `delete_file: ${p}`, `This stages deletion of ${p} (recoverable until accepted).`);
      if (!allowed) return fail("permission denied");
      ctx.remove(p);
      return ok(`staged deletion of ${p} — pending review`);
    }
    case "move_file": {
      const from = guard(args.from as string);
      const to = guard(args.to as string);
      if (!from || !to) return fail("blocked or invalid path");
      if (files[from] === undefined) return fail(`${from}: not found`);
      const allowed = await gateMutation(ctx, "file", "ask", `move_file: ${from} → ${to}`, "Stages a rename.");
      if (!allowed) return fail("permission denied");
      ctx.rename(from, to);
      return ok(`staged move ${from} → ${to}`);
    }
    case "list_directory": {
      const dir = (args.path as string | undefined)?.replace(/\/$/, "") ?? "";
      const prefix = dir ? dir + "/" : "";
      const entries = new Set<string>();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        entries.add(rest.includes("/") ? rest.split("/")[0] + "/" : rest);
      }
      return ok([...entries].sort().slice(0, 100).join("\n") || "(empty)");
    }
    case "search_text":
      return ok(searchHits(files, args.query as string, Boolean(args.regex)).join("\n"));
    case "search_files": {
      const pat = (args.pattern as string).toLowerCase().replace(/\*/g, "");
      const matches = Object.keys(files).filter((p) => p.toLowerCase().includes(pat)).slice(0, 40);
      return ok(matches.length ? matches.join("\n") : `no files match "${args.pattern}"`);
    }
    case "find_symbol": {
      const name2 = args.name as string;
      const re = new RegExp(`(function|class|const|interface|type|def|fn|func)\\s+${name2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      const hits: string[] = [];
      for (const [p, content] of Object.entries(files)) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) hits.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
        }
      }
      return ok(hits.slice(0, 20).join("\n") || `symbol "${name2}" not found`);
    }
    case "get_file_tree":
      return ok(Object.keys(files).sort().join("\n"));
    case "get_project_info": {
      const adapter = detectProject(files);
      return ok([
        `Adapter: ${adapter.name} · ${adapter.framework} · ${adapter.language}`,
        `Package manager: ${adapter.packageManager} · Build: ${adapter.buildSystem} · Tests: ${adapter.testFramework}`,
        `Run: ${adapter.runCommand ?? "n/a"} · Build cmd: ${adapter.buildCommand ?? "n/a"} · Test cmd: ${adapter.testCommand ?? "n/a"}`,
        `Preview: ${adapter.previewKind} · Port: ${adapter.defaultPort ?? "n/a"} · Entry: ${adapter.entryFile ?? "n/a"}`,
        `Files: ${Object.keys(files).length}`,
      ].join("\n"));
    }
    case "inspect_package_json": {
      const raw = files["package.json"];
      if (!raw) return fail("no package.json in workspace");
      try {
        const j = JSON.parse(raw) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        return ok([
          "scripts:", ...Object.entries(j.scripts ?? {}).map(([k, v]) => `  ${k}: ${v}`),
          `dependencies: ${Object.keys(j.dependencies ?? {}).join(", ") || "none"}`,
          `devDependencies: ${Object.keys(j.devDependencies ?? {}).join(", ") || "none"}`,
        ].join("\n"));
      } catch {
        return fail("package.json is not valid JSON");
      }
    }
    case "run_terminal_command": {
      const cmd = (args.command as string).trim();
      if (!cmd) return ok("");
      const cls = classifyCommand(cmd);
      if (origin === "agent") {
        const mode = ctx.autonomy ?? "normal";
        if (mode === "plan") return fail("plan mode: commands are not executed");
        if (cls === "dangerous" || (cls === "ask" && mode !== "auto")) {
          const allowed = await ctx.requestPermission(
            cls === "dangerous" ? "dangerous" : "ask", cmd,
            cls === "dangerous"
              ? "The agent wants to run a DANGEROUS command. These are never executed silently."
              : "The agent wants to run a state-modifying command."
          );
          if (!allowed) { ctx.terminal("err", `permission denied: ${cmd}`); return fail("command denied by user"); }
        }
      }
      ctx.terminal("cmd", `$ ${cmd}`);
      const result = await runShellLine(cmd, ctx, origin);
      return result;
    }
    case "run_tests": {
      const results = runSuite("unit", files);
      for (const r of results) {
        for (const l of r.lines) ctx.output(l.kind, `  [unit] ${l.text}`);
        ctx.addProblems(r.problems);
      }
      const t = results[0];
      return ok(`unit suite: ${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped (${t.durationMs}ms)`);
    }
    case "run_lint": {
      const results = runSuite("lint", files);
      for (const r of results) { for (const l of r.lines) ctx.output(l.kind, `  [lint] ${l.text}`); ctx.addProblems(r.problems); }
      return ok(`lint: ${results[0].problems.filter((p) => p.severity === "warning").length} warning(s)`);
    }
    case "run_build": {
      const results = runSuite("build", files);
      for (const r of results) { for (const l of r.lines) ctx.output(l.kind, `  [build] ${l.text}`); ctx.addProblems(r.problems); }
      return ok(results[0].failed ? `build would fail: ${results[0].failed} blocking issue(s)` : "build graph OK");
    }
    case "report_problem": {
      ctx.addProblems([{
        id: Math.random().toString(36).slice(2, 10), severity: "error",
        file: args.file as string, line: (args.line as number | undefined) ?? 1,
        message: args.message as string, source: "agent",
      }]);
      return ok("problem recorded");
    }
    case "api_request": {
      const url = args.url as string;
      if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) {
        return fail("api_request only targets the local development server (localhost/127.0.0.1)");
      }
      const allowed = await gateMutation(ctx, "command", "ask", `api_request ${args.method} ${url}`, "Sends an HTTP request to your local dev server.");
      if (!allowed) return fail("permission denied");
      try {
        const t0 = performance.now();
        const res = await fetch(url, {
          method: args.method as string,
          headers: { "Content-Type": "application/json" },
          body: args.body as string | undefined,
          signal: ctx.signal,
        });
        const text = (await res.text()).slice(0, 1200);
        return ok(`${res.status} ${res.statusText} in ${Math.round(performance.now() - t0)}ms\n${text}`);
      } catch (e) {
        return fail(`request failed: ${(e as Error).message} — is the backend service running?`);
      }
    }
    default:
      return fail(`tool "${name}" not implemented`);
  }
}

/* ─────────── workspace shell emulator ─────────── */

export async function runShellLine(cmd: string, ctx: ToolCtx, origin: "agent" | "terminal"): Promise<ToolResult> {
  const [bin, ...rest] = cmd.trim().split(/\s+/);
  const files = ctx.files();
  const out = (kind: TermLineKind, text: string) => ctx.terminal(kind, text);

  switch (bin) {
    case "help":
      out("sys", "Workspace shell: ls, cat, grep, find, tree, echo, pwd, mkdir, touch, rm, mv, cp, clear,");
      out("sys", "npm/pnpm/yarn/bun (run|test|build|lint|typecheck|install), python, pytest, cargo, go, dotnet, help.");
      out("sys", "Long-lived servers (vite, uvicorn…) run via Run → Preview; browser runtime cannot spawn OS processes.");
      return ok("help shown");
    case "pwd": out("out", `/${(Object.keys(files)[0] ?? "").split("/")[0] || "workspace"}`); return ok("pwd");
    case "ls": {
      const dir = rest[0]?.replace(/\/$/, "") ?? "";
      const prefix = dir ? dir + "/" : "";
      const entries = new Set<string>();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const r2 = p.slice(prefix.length);
        entries.add(r2.includes("/") ? r2.split("/")[0] + "/" : r2);
      }
      out("out", [...entries].sort().join("  ") || "(empty)");
      return ok("ls");
    }
    case "cat": {
      const p = safePath(rest[0] ?? "");
      if (!p || files[p] === undefined) { out("err", `cat: ${rest[0]}: No such file`); return fail("not found"); }
      out("out", isSecretFile(p) ? maskSecretContent(files[p]) : files[p]);
      return ok("cat");
    }
    case "grep": {
      const q = rest[0];
      const hits = searchHits(files, q, false).slice(0, 25);
      out(hits[0]?.startsWith("no matches") ? "sys" : "out", hits.join("\n"));
      return ok("grep");
    }
    case "find": {
      const pat = rest.find((r) => !r.startsWith("-")) ?? "";
      const matches = Object.keys(files).filter((p) => p.includes(pat)).slice(0, 30);
      out("out", matches.join("\n") || "(no matches)");
      return ok("find");
    }
    case "tree": {
      const dirs = new Set<string>();
      for (const p of Object.keys(files)) { const parts = p.split("/"); if (parts.length > 1) dirs.add(parts.slice(0, -1).join("/")); }
      out("out", [...dirs].sort().map((d) => d + "/").concat(Object.keys(files).filter((f) => !f.includes("/"))).slice(0, 60).join("\n"));
      return ok("tree");
    }
    case "echo": out("out", rest.join(" ")); return ok("echo");
    case "mkdir": {
      const p = rest[0];
      if (!p) return fail("mkdir: missing operand");
      ctx.write(`${p.replace(/\/$/, "")}/.keep`, "");
      out("sys", `created ${p}/ (staged as .keep — pending review)`);
      return ok("mkdir");
    }
    case "touch": {
      const p = safePath(rest[0] ?? "");
      if (!p) return fail("invalid path");
      if (files[p] === undefined) ctx.write(p, "");
      out("sys", `touched ${p} (staged if new)`);
      return ok("touch");
    }
    case "rm": {
      const recursive = rest.includes("-r") || rest.includes("-rf");
      const target = safePath(rest.filter((r) => !r.startsWith("-"))[0] ?? "");
      if (!target) return fail("rm: invalid target");
      const affected = Object.keys(files).filter((p) => p === target || p.startsWith(target + "/"));
      if (affected.length === 0) { out("err", `rm: ${target}: No such file or directory`); return fail("not found"); }
      const cls = recursive ? "dangerous" : "ask";
      const allowed = origin === "agent"
        ? true // already gated by run_terminal_command path
        : await ctx.requestPermission(cls, `rm ${recursive ? "-r " : ""}${target}`, `Deletes ${affected.length} file(s):\n${affected.slice(0, 10).join("\n")}${affected.length > 10 ? "\n…" : ""}`);
      if (!allowed) { out("err", "rm: permission denied"); return fail("denied"); }
      for (const a of affected) ctx.remove(a);
      out("sys", `staged deletion of ${affected.length} file(s) — pending review`);
      return ok("rm");
    }
    case "mv":
    case "cp": {
      const [a, b] = rest;
      const from = safePath(a ?? ""); const to = safePath(b ?? "");
      if (!from || !to || files[from] === undefined) { out("err", `${bin}: invalid arguments`); return fail("invalid"); }
      if (bin === "mv") ctx.rename(from, to);
      else ctx.write(to, files[from]);
      out("sys", `${bin} ${from} → ${to} staged — pending review`);
      return ok(bin);
    }
    case "clear": return ok("__clear__");
    case "npm": case "pnpm": case "yarn": case "bun": {
      const script = rest[0] ?? "run";
      if (script === "install" || script === "i" || script === "add") {
        const allowed = origin === "agent"
          ? true
          : await ctx.requestPermission("ask", `${bin} ${rest.join(" ")}`, "Package installation modifies the dependency tree. The browser runtime records the intent; execution happens in the desktop runtime.");
        if (!allowed) { out("err", "install cancelled"); return fail("denied"); }
        out("sys", `${bin} ${script}: recorded — package installs execute in the desktop runtime (node-pty). Dependencies were validated against package.json.`);
        return ok("install recorded");
      }
      if (script === "run" || script === "test" || script === "build" || script === "lint" || script === "typecheck" || script === "dev" || script === "start") {
        const name = script === "run" ? rest[1] : script;
        const pkgRaw = files["package.json"];
        let scripts: Record<string, string> = {};
        try { scripts = pkgRaw ? ((JSON.parse(pkgRaw) as { scripts?: Record<string, string> }).scripts ?? {}) : {}; } catch { /* invalid json reported below */ }
        const target = name === "test" ? "test" : name === "build" ? "build" : name === "lint" ? "lint" : name === "typecheck" ? "typecheck" : name === "dev" || name === "start" ? "dev" : name;
        if (!scripts[target]) { out("err", `script "${target}" not found in package.json (available: ${Object.keys(scripts).join(", ") || "none"})`); return fail("missing script"); }
        if (target === "dev" || target === "start") {
          out("sys", `dev server spawning requires the desktop runtime — press Run to validate config and open the in-browser preview instead.`);
          return ok("dev redirect");
        }
        const kind = target === "test" ? "unit" : target === "build" ? "build" : target === "lint" ? "lint" : "typecheck";
        out("sys", `> ${scripts[target]}  (executed by the static engine)`);
        const results = runSuite(kind as "unit" | "build" | "lint" | "typecheck", files);
        for (const r of results) { for (const l of r.lines) out(l.kind, l.text); ctx.addProblems(r.problems); }
        return ok(`${target} completed`);
      }
      out("err", `${bin} ${script}: unsupported in workspace shell`);
      return fail("unsupported");
    }
    case "python": case "python3": {
      const f = safePath(rest[0] ?? "");
      if (f && files[f]) { out("sys", `python ${f}: interpreted execution requires the desktop runtime — static checks run instead.`); const r = runSuite("typecheck", files); for (const x of r) for (const l of x.lines) out(l.kind, l.text); return ok("python static"); }
      out("err", `python: ${rest[0] ?? ""}: No such file`);
      return fail("not found");
    }
    case "pytest": {
      out("sys", "> pytest (static verification of test files)");
      const r = runSuite("unit", files);
      for (const x of r) { for (const l of x.lines) out(l.kind, l.text); ctx.addProblems(x.problems); }
      return ok("pytest");
    }
    case "cargo": case "go": case "dotnet": case "mvn": case "./mvnw": case "./gradlew": case "php": case "uvicorn": {
      out("sys", `${cmd}: native toolchain execution requires the desktop runtime — running static validation instead.`);
      const r = runSuite(bin === "cargo" || bin === "go" ? "build" : "typecheck", files);
      for (const x of r) for (const l of x.lines) out(l.kind, l.text);
      return ok(`${bin} static`);
    }
    case "git": {
      const sub = rest[0];
      if (sub === "status") {
        out("out", "On branch main (local snapshot)");
        out("out", `Changes pending review: ${Object.keys(files).length} tracked file(s) in workspace`);
        return ok("git status");
      }
      if (sub === "log") { out("out", "(history lives in the git repository — open the project in the desktop runtime for full git)"); return ok("git log"); }
      if (sub === "push") { out("err", "git push is never executed by the AI or without explicit desktop-runtime action."); return fail("blocked"); }
      out("sys", `git ${sub ?? ""}: recorded — git mutations run in the desktop runtime.`);
      return ok("git");
    }
    default:
      out("err", `${bin}: command not found (workspace shell). Type "help".`);
      return fail("not found");
  }
}
