/**
 * Agent tool system. Every tool is validated (Zod), sandboxed to the open
 * workspace, and recorded. Mutations never land directly — they become pending
 * FileChanges that the user accepts or rejects from the diff view.
 */
import { z } from "zod";
import { LIMITS } from "../config/app";
import { isSecretFile, maskSecretContent, safePath } from "../lib/fs";
import { fuzzyFilter } from "../lib/fuzzy";
import type { AgentRole, FileChange, Problem, TermLineKind } from "../lib/types";
import { detectEcosystem, runSuite } from "../agents/testing";

export interface ToolCtx {
  taskId: string;
  role: AgentRole;
  signal: AbortSignal;
  files(): Record<string, string>;
  write(path: string, after: string): FileChange | null;
  remove(path: string): FileChange | null;
  rename(from: string, to: string): FileChange | null;
  terminal(kind: TermLineKind, text: string): void;
  output(kind: TermLineKind, text: string): void;
  requestPermission(cls: "ask" | "dangerous", title: string, detail: string): Promise<boolean>;
  addProblems(problems: Problem[]): void;
}

export interface ToolResult { ok: boolean; result: string; }

const ok = (result: string): ToolResult => ({ ok: true, result });
const fail = (result: string): ToolResult => ({ ok: false, result });

export const TOOL_NAMES = [
  "read_file", "write_file", "create_file", "delete_file", "move_file",
  "list_directory", "search_files", "search_text", "find_symbol",
  "get_file_tree", "get_project_info", "inspect_package_json",
  "run_terminal_command", "run_tests", "run_lint", "run_build", "report_problem",
] as const;

/* ─────────────── command classification ─────────────── */

const DANGEROUS_RE = /(rm\s+(-[a-z]*r[a-z]*\s+)?\/|rm\s+-[a-z]*r[a-z]*\s+\*|mkfs|format\s+[a-z]:|del\s+\/[sfq]|rd\s+\/s|force[\s-]?push|--force\s+push|git\s+push\s+.*--force|shutdown|reboot|:\(\)\s*\{|>\s*\/dev\/|chmod\s+-R\s+777\s+\/|curl[^\n|]*\|\s*(sh|bash)|wget[^\n|]*\|\s*(sh|bash))/i;
const ASK_RE = /^(npm|pnpm|yarn|bun|pip|pip3)\s+(install|i|add|remove|uninstall)|git\s+(commit|merge|rebase|checkout|reset|clean)|docker\s+(rm|rmi|system\s+prune)|npx\s+/i;

export function classifyCommand(cmd: string): "safe" | "ask" | "dangerous" {
  const c = cmd.trim();
  if (DANGEROUS_RE.test(c)) return "dangerous";
  if (ASK_RE.test(c)) return "ask";
  return "safe";
}

/* ─────────────── tool execution ─────────────── */

export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolCtx,
  origin: "agent" | "terminal"
): Promise<ToolResult> {
  const files = ctx.files();

  switch (name) {
    case "read_file": {
      const { path } = z.object({ path: z.string() }).parse(rawArgs);
      const p = safePath(path);
      if (!p) return fail(`invalid path: ${path}`);
      const content = files[p];
      if (content === undefined) return fail(`no such file: ${p}`);
      if (isSecretFile(p)) {
        return ok(`[SECRET FILE — values masked]\n${maskSecretContent(content).slice(0, 8000)}`);
      }
      return ok(content.slice(0, LIMITS.maxFileChars));
    }

    case "write_file": {
      const { path, content } = z.object({ path: z.string(), content: z.string() }).parse(rawArgs);
      const p = safePath(path);
      if (!p) return fail(`invalid path: ${path}`);
      if (files[p] === undefined) return fail(`no such file: ${p} — use create_file for new files`);
      if (isSecretFile(p)) return fail(`refusing to modify secret file: ${p}`);
      ctx.write(p, content);
      return ok(`queued modification of ${p} (${content.split("\n").length} lines) — pending user review`);
    }

    case "create_file": {
      const { path, content } = z.object({ path: z.string(), content: z.string() }).parse(rawArgs);
      const p = safePath(path);
      if (!p) return fail(`invalid path: ${path}`);
      if (files[p] !== undefined) return fail(`file already exists: ${p} — use write_file to modify`);
      if (isSecretFile(p)) return fail(`refusing to create file matching secret patterns: ${p}`);
      ctx.write(p, content);
      return ok(`queued creation of ${p} (${content.split("\n").length} lines) — pending user review`);
    }

    case "delete_file": {
      const { path } = z.object({ path: z.string() }).parse(rawArgs);
      const p = safePath(path);
      if (!p) return fail(`invalid path: ${path}`);
      if (files[p] === undefined) return fail(`no such file: ${p}`);
      ctx.remove(p);
      return ok(`queued deletion of ${p} — pending user review`);
    }

    case "move_file": {
      const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(rawArgs);
      const f = safePath(from);
      const t = safePath(to);
      if (!f || !t) return fail("invalid path");
      if (files[f] === undefined) return fail(`no such file: ${f}`);
      ctx.rename(f, t);
      return ok(`queued move ${f} → ${t} — pending user review`);
    }

    case "list_directory": {
      const { path } = z.object({ path: z.string().optional() }).parse(rawArgs);
      const prefix = path ? safePath(path) : null;
      if (path && !prefix) return fail(`invalid path: ${path}`);
      const entries = new Set<string>();
      for (const p of Object.keys(files)) {
        if (prefix && !p.startsWith(prefix + "/")) continue;
        const rest = prefix ? p.slice(prefix.length + 1) : p;
        entries.add(rest.split("/")[0]);
      }
      return ok([...entries].sort().join("\n") || "(empty)");
    }

    case "get_file_tree": {
      return ok(Object.keys(files).sort().join("\n"));
    }

    case "search_files": {
      const { query } = z.object({ query: z.string() }).parse(rawArgs);
      const hits = fuzzyFilter(Object.keys(files).sort(), query, (f) => f).slice(0, 30);
      return ok(hits.length ? hits.join("\n") : "no files match");
    }

    case "search_text": {
      const { query, regex } = z.object({ query: z.string(), regex: z.boolean().optional() }).parse(rawArgs);
      let re: RegExp;
      try {
        re = regex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      } catch {
        return fail("invalid regex");
      }
      const out: string[] = [];
      for (const [p, content] of Object.entries(files)) {
        if (isSecretFile(p)) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && out.length < LIMITS.maxSearchResults; i++) {
          if (re.test(lines[i])) out.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
        }
      }
      return ok(out.length ? out.join("\n") : "no matches");
    }

    case "find_symbol": {
      const { name: sym } = z.object({ name: z.string() }).parse(rawArgs);
      const re = new RegExp(`(export\\s+(default\\s+)?(function|class|const|interface|type)\\s+${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b)|(def\\s+${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\()`, "i");
      const out: string[] = [];
      for (const [p, content] of Object.entries(files)) {
        const lines = content.split("\n");
        lines.forEach((l, i) => { if (re.test(l)) out.push(`${p}:${i + 1}: ${l.trim().slice(0, 140)}`); });
      }
      return ok(out.length ? out.join("\n") : `symbol "${sym}" not found`);
    }

    case "get_project_info": {
      const eco = detectEcosystem(files);
      return ok(JSON.stringify({ ...eco, fileCount: Object.keys(files).length }, null, 2));
    }

    case "inspect_package_json": {
      const raw = files["package.json"];
      if (!raw) return fail("no package.json in workspace");
      try {
        const j = JSON.parse(raw) as Record<string, unknown>;
        return ok(JSON.stringify({ name: j.name, scripts: j.scripts, dependencies: j.dependencies, devDependencies: j.devDependencies }, null, 2));
      } catch (e) {
        return fail(`package.json is invalid JSON: ${(e as Error).message}`);
      }
    }

    case "run_terminal_command": {
      const { command } = z.object({ command: z.string() }).parse(rawArgs);
      const transcript = await runShellLine(command, ctx, origin);
      return ok(transcript || "(no output)");
    }

    case "run_tests":
      return runSuiteTool("unit", ctx);
    case "run_lint":
      return runSuiteTool("lint", ctx);
    case "run_build":
      return runSuiteTool("build", ctx);

    case "report_problem": {
      const parsed = z.object({
        file: z.string(), line: z.number().optional(), message: z.string(),
        severity: z.enum(["error", "warning", "info"]).optional(),
      }).parse(rawArgs);
      ctx.addProblems([{
        id: `pr${Date.now().toString(36)}`, severity: parsed.severity ?? "warning",
        file: parsed.file, line: parsed.line ?? 1, message: parsed.message, source: ctx.role,
      }]);
      return ok("problem recorded");
    }

    default:
      return fail(`unknown tool: ${name} (available: ${TOOL_NAMES.join(", ")})`);
  }
}

function runSuiteTool(kind: "unit" | "lint" | "build", ctx: ToolCtx): ToolResult {
  const results = runSuite(kind, ctx.files());
  for (const r of results) {
    for (const l of r.lines) ctx.output(l.kind, l.text);
    ctx.addProblems(r.problems);
  }
  const r = results[0];
  const summary = `${kind}: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped in ${r.durationMs}ms`;
  ctx.terminal(r.failed ? "err" : "out", summary);
  return ok(summary);
}

/* ─────────────── terminal emulator ─────────────── */

export async function runShellLine(line: string, ctx: ToolCtx, origin: "agent" | "terminal"): Promise<string> {
  const cmd = line.trim();
  const out: string[] = [];
  const say = (kind: TermLineKind, text: string) => { ctx.terminal(kind, text); out.push(text); };
  if (!cmd) return "";

  const [bin, ...rest] = cmd.split(/\s+/);
  const files = ctx.files();

  // Permission gate (interactive terminal asks for rm/install; agents were gated upstream).
  if (bin === "rm" || bin === "del") {
    const recursive = rest.some((a) => /^-[a-z]*r/i.test(a));
    const target = safePath(rest.filter((a) => !a.startsWith("-"))[0] ?? "");
    if (!target) { say("err", "rm: missing operand"); return out.join("\n"); }
    const affected = Object.keys(files).filter((p) => p === target || p.startsWith(target + "/"));
    if (affected.length === 0) { say("err", `rm: ${target}: No such file or directory`); return out.join("\n"); }
    const allowed = origin === "agent"
      ? true
      : await ctx.requestPermission(
          recursive ? "dangerous" : "ask",
          `rm ${recursive ? "-r " : ""}${target}`,
          `This permanently deletes ${affected.length} file(s) from the workspace:\n${affected.slice(0, 10).join("\n")}${affected.length > 10 ? "\n…" : ""}`
        );
    if (!allowed) { say("err", "permission denied by user"); return out.join("\n"); }
    for (const p of affected) ctx.remove(p);
    say("sys", `queued deletion of ${affected.length} file(s) — review in Source Control`);
    return out.join("\n");
  }

  const cls = classifyCommand(cmd);
  if (cls === "dangerous") {
    const allowed = origin === "agent"
      ? true
      : await ctx.requestPermission("dangerous", cmd, "This command is classified DANGEROUS (recursive delete / force push / system modification class). It is never executed silently.");
    if (!allowed) { say("err", "blocked: dangerous command denied by user"); return out.join("\n"); }
  } else if (cls === "ask" && origin === "terminal" && /^(npm|pnpm|yarn|bun)\s+(install|i|add)/i.test(cmd)) {
    const allowed = await ctx.requestPermission("ask", cmd, "Package installation modifies the dependency tree. In the browser runtime this is recorded but not executed.");
    if (!allowed) { say("err", "permission denied by user"); return out.join("\n"); }
    say("sys", "recorded: install requested (dependency changes require the desktop runtime)");
    return out.join("\n");
  }

  switch (bin) {
    case "help":
      say("sys", "LocalForge workspace shell — emulated against the open project.");
      say("out", "  ls [dir] · cat <file> · tree · grep [-i] <text> [dir] · find <name>");
      say("out", "  mkdir <dir> · touch <file> · rm [-r] <path> · echo <text> · pwd · clear");
      say("out", "  npm/pnpm/yarn run <script> · test|build|lint|typecheck · git status|diff|branch|log");
      say("sys", "OS-process commands (node, vite, installs) report honestly: they need the desktop runtime.");
      break;
    case "pwd":
      say("out", `/${"workspace"}`);
      break;
    case "clear":
      ctx.terminal("sys", "__CLEAR__");
      break;
    case "ls": case "dir": {
      const target = rest[0] ? safePath(rest[0]) : null;
      const entries = new Set<string>();
      for (const p of Object.keys(files)) {
        if (target && !p.startsWith(target + "/")) continue;
        const r = target ? p.slice(target.length + 1) : p;
        const seg = r.split("/");
        entries.add(seg.length > 1 ? seg[0] + "/" : seg[0]);
      }
      if (entries.size === 0) say("err", `ls: ${rest[0] ?? ""}: No such file or directory`);
      else say("out", [...entries].sort().join("  "));
      break;
    }
    case "cat": case "type": {
      const p = safePath(rest[0] ?? "");
      if (!p || files[p] === undefined) { say("err", `cat: ${rest[0] ?? ""}: No such file or directory`); break; }
      if (isSecretFile(p)) { say("sys", `[secret file — values masked]\n${maskSecretContent(files[p]).slice(0, 4000)}`); break; }
      say("out", files[p].slice(0, 8000));
      break;
    }
    case "tree": {
      say("out", Object.keys(files).sort().join("\n").slice(0, 6000));
      break;
    }
    case "grep": {
      const args = [...rest];
      const insensitive = args[0] === "-i" ? args.shift() !== undefined : false;
      const pattern = args.shift() ?? "";
      const dir = args.shift();
      if (!pattern) { say("err", "usage: grep [-i] <text> [dir]"); break; }
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), insensitive ? "i" : "");
      const hits: string[] = [];
      for (const [p, content] of Object.entries(files)) {
        if (dir && !p.startsWith(dir)) continue;
        if (isSecretFile(p)) continue;
        content.split("\n").forEach((l, i) => {
          if (re.test(l) && hits.length < 60) hits.push(`${p}:${i + 1}:${l.trim().slice(0, 140)}`);
        });
      }
      say(hits.length ? "out" : "sys", hits.length ? hits.join("\n") : "(no matches)");
      break;
    }
    case "find": {
      const name = rest[0] ?? "";
      const hits = Object.keys(files).filter((p) => p.toLowerCase().includes(name.toLowerCase())).slice(0, 60);
      say(hits.length ? "out" : "sys", hits.length ? hits.join("\n") : "(no matches)");
      break;
    }
    case "echo":
      say("out", rest.join(" "));
      break;
    case "mkdir": {
      const p = safePath(rest[0] ?? "");
      if (!p) { say("err", "mkdir: missing operand"); break; }
      say("sys", `directory noted: ${p}/ (materialized when a file is created inside)`);
      break;
    }
    case "touch": {
      const p = safePath(rest[0] ?? "");
      if (!p) { say("err", "touch: missing operand"); break; }
      if (files[p] === undefined) ctx.write(p, "");
      say("sys", files[p] === undefined ? `queued creation of empty file ${p} — review in Source Control` : `${p} already exists`);
      break;
    }
    case "whoami":
      say("out", "localforge (local session)");
      break;
    case "date":
      say("out", new Date().toString());
      break;
    case "env":
      say("sys", "(environment variables are never exposed — secret protection)");
      break;
    case "curl": case "wget": case "ssh": case "scp":
      say("err", `${bin}: network access is blocked by the LocalForge security policy`);
      break;
    case "git": {
      const sub = rest[0];
      if (sub === "status" || sub === "branch" || sub === "diff" || sub === "log") {
        say("out", gitLikeSummary(sub, ctx));
      } else if (sub === "push") {
        say("err", "git push is never executed automatically by LocalForge (security policy)");
      } else if (sub === "commit") {
        say("sys", "commits run in the desktop git runtime — recorded as intent only");
      } else {
        say("sys", `git ${sub ?? ""}: available in the desktop runtime (status/diff/branch/log emulated here)`);
      }
      break;
    }
    case "npm": case "pnpm": case "yarn": case "bun": {
      const script = rest[0] === "run" ? rest[1] : rest[0];
      const eco = detectEcosystem(files);
      const suiteMap: Record<string, "unit" | "lint" | "build" | "typecheck" | "runtime"> = {
        test: "unit", "test:unit": "unit", lint: "lint", build: "build",
        typecheck: "typecheck", "type-check": "typecheck", dev: "runtime", start: "runtime",
      };
      if (script === "install" || script === "i" || script === "add") {
        say("sys", "install: dependency changes require the desktop runtime — recorded, not executed");
        break;
      }
      const mapped = suiteMap[script ?? ""];
      if (!mapped) {
        const available = Object.keys(eco.scripts).join(", ") || "none";
        say("err", `script not mapped. Available in package.json: ${available}`);
        break;
      }
      if (!(script! in eco.scripts) && script !== "dev") {
        say("err", `no "${script}" script in package.json (available: ${Object.keys(eco.scripts).join(", ") || "none"})`);
        break;
      }
      say("sys", `> ${bin} run ${script}  (resolved from package.json → static engine)`);
      const results = runSuite(mapped, files);
      for (const r of results) {
        for (const l of r.lines) say(l.kind, `  ${l.text}`);
        ctx.addProblems(r.problems);
      }
      break;
    }
    case "node": case "python": case "python3": case "deno": case "vite": case "vitest": case "tsc": case "eslint":
      say("sys", `${bin}: spawning OS processes requires the desktop runtime. For test/build/lint/typecheck use the mapped npm scripts or the Test panel — those run for real here.`);
      break;
    default:
      say("err", `${bin}: command not found — type "help" for the emulated command set`);
  }
  return out.join("\n");
}

function gitLikeSummary(sub: string, ctx: ToolCtx): string {
  const files = ctx.files();
  const pending = Object.keys(files).length;
  if (sub === "branch") return "* main   (local snapshot branch — git commands run in the desktop runtime)";
  if (sub === "log") return "commit history is read from the desktop git runtime\n(local snapshots are listed under Source Control → Checkpoints)";
  if (sub === "diff") return pending >= 0 ? "(workspace diff — open pending changes in Source Control for line-level diffs)" : "";
  return [
    "On branch main (local snapshot)",
    "Untracked/modified state is tracked as pending changes:",
    "  use the Source Control panel to review, accept or reject each change.",
    `  indexed files: ${Object.keys(files).length}`,
  ].join("\n");
}
