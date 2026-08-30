import { LIMITS } from "../config/app";
import { isSecretFile, maskSecretContent } from "../lib/fs";
import type { Problem, ProjectFacts } from "../lib/types";

const EXT_LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
  json: "JSON", md: "Markdown", html: "HTML", css: "CSS", py: "Python", yml: "YAML", yaml: "YAML",
};

/** Real, computed facts about the workspace — the backbone of every prompt. */
export function computeFacts(files: Record<string, string>): ProjectFacts {
  const paths = Object.keys(files);
  const pkgRaw = files["package.json"];
  let pkg: { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { if (pkgRaw) pkg = JSON.parse(pkgRaw); } catch { /* invalid package.json — reported elsewhere */ }

  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const deps = Object.keys(allDeps);

  let framework = "unknown";
  if (allDeps["next"]) framework = "Next.js";
  else if (allDeps["vite"] && allDeps["react"]) framework = "Vite + React";
  else if (allDeps["vite"]) framework = "Vite";
  else if (allDeps["react"]) framework = "React";
  else if (allDeps["vue"]) framework = "Vue";
  else if (allDeps["express"]) framework = "Express (Node.js)";
  else if (allDeps["fastify"]) framework = "Fastify (Node.js)";
  else if (files["pyproject.toml"] || files["requirements.txt"]) framework = "Python";

  let packageManager = "npm";
  if (files["pnpm-lock.yaml"]) packageManager = "pnpm";
  else if (files["yarn.lock"]) packageManager = "yarn";
  else if (files["bun.lockb"] || files["bun.lock"]) packageManager = "bun";
  else if (files["pyproject.toml"] || files["requirements.txt"]) packageManager = "pip";

  let testFramework = "none detected";
  if (allDeps["vitest"]) testFramework = "Vitest";
  else if (allDeps["jest"]) testFramework = "Jest";
  else if (allDeps["@playwright/test"]) testFramework = "Playwright";
  else if (allDeps["cypress"]) testFramework = "Cypress";
  else if (files["pytest.ini"] || /pytest/.test(files["pyproject.toml"] ?? "")) testFramework = "pytest";

  const langCount = new Map<string, number>();
  for (const p of paths) {
    const ext = p.includes(".") ? p.split(".").pop()! : "";
    const lang = EXT_LANG[ext];
    if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
  }

  const testFiles = paths.filter((p) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p) || /(^|\/)tests\//.test(p));

  return {
    name: pkg.name ?? "untitled-project",
    framework,
    languages: [...langCount.entries()].map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count),
    packageManager,
    scripts: pkg.scripts ?? {},
    dependencies: deps,
    fileCount: paths.length,
    hasTests: testFiles.length > 0,
    hasGit: paths.includes(".gitignore"),
    testFramework,
    lintConfig: deps.includes("eslint") ? "eslint" : files[".eslintrc.json"] ? "eslint (config file)" : "none detected",
    tsConfig: Boolean(files["tsconfig.json"]),
  };
}

export function factsToText(facts: ProjectFacts): string {
  const scripts = Object.entries(facts.scripts).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  (none)";
  const langs = facts.languages.map((l) => `${l.lang}×${l.count}`).join(", ") || "n/a";
  return [
    `Project: ${facts.name}`,
    `Framework: ${facts.framework} · Package manager: ${facts.packageManager}`,
    `Files indexed: ${facts.fileCount} · Languages: ${langs}`,
    `TypeScript config: ${facts.tsConfig ? "yes" : "no"} · Lint: ${facts.lintConfig} · Tests: ${facts.testFramework} (${facts.hasTests ? "test files present" : "no test files"})`,
    `Git meta ${facts.hasGit ? "yes" : "no"}`,
    `Scripts:\n${scripts}`,
    `Dependencies (${facts.dependencies.length}): ${facts.dependencies.slice(0, 30).join(", ")}${facts.dependencies.length > 30 ? ", …" : ""}`,
  ].join("\n");
}

export interface Mention { type: string; arg: string; }

/** Parse @file / @folder / @project / @selection / @errors / @terminal / @git references. */
export function parseMentions(input: string): Mention[] {
  const out: Mention[] = [];
  const re = /@(file|folder|project|selection|errors|terminal|git)(?:\s+([^\s@]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) out.push({ type: m[1], arg: m[2] ?? "" });
  return out;
}

export interface ContextRequest {
  files: Record<string, string>;
  facts: ProjectFacts;
  activeFile?: string | null;
  selection?: string;
  mentions: Mention[];
  problems?: Problem[];
  terminalTail?: string;
  gitSummary?: string;
  extraFiles?: string[];
  budget?: number;
}

/**
 * Context Manager: decides which files/snippets enter the prompt, masks secrets,
 * and enforces a hard character budget. Never dumps the whole repository.
 */
export function buildContext(req: ContextRequest): { text: string; included: string[]; masked: string[] } {
  const budget = req.budget ?? LIMITS.maxContextChars;
  const parts: string[] = [factsToText(req.facts)];
  const included: string[] = [];
  const masked: string[] = [];
  let used = parts[0].length;

  const addFile = (path: string, label: string) => {
    if (included.includes(path)) return;
    const raw = req.files[path];
    if (raw === undefined) return;
    let content = raw;
    if (isSecretFile(path)) {
      content = maskSecretContent(raw);
      masked.push(path);
    }
    const snippet = `\n<file path="${path}" note="${label}${isSecretFile(path) ? " · SECRETS MASKED" : ""}">\n${content.slice(0, 6000)}\n</file>`;
    if (used + snippet.length > budget) return;
    parts.push(snippet);
    included.push(path);
    used += snippet.length;
  };

  for (const m of req.mentions) {
    if (m.type === "file" && m.arg) addFile(m.arg, "explicitly referenced");
    if (m.type === "folder" && m.arg) {
      Object.keys(req.files).filter((p) => p.startsWith(m.arg)).slice(0, 6).forEach((p) => addFile(p, `in folder ${m.arg}`));
    }
  }
  for (const p of req.extraFiles ?? []) addFile(p, "task-relevant");
  if (req.activeFile) addFile(req.activeFile, "active in editor");

  if (req.selection && used + req.selection.length < budget) {
    parts.push(`\n<selected_code>\n${req.selection.slice(0, 3000)}\n</selected_code>`);
    used += req.selection.length;
  }
  if (req.mentions.some((m) => m.type === "errors") && req.problems?.length) {
    const p = `\n<current_problems>\n${req.problems.slice(0, 25).map((x) => `${x.severity} ${x.file}:${x.line} ${x.message}`).join("\n")}\n</current_problems>`;
    parts.push(p);
  }
  if (req.mentions.some((m) => m.type === "terminal") && req.terminalTail) {
    parts.push(`\n<terminal_tail>\n${req.terminalTail.slice(-2500)}\n</terminal_tail>`);
  }
  if (req.mentions.some((m) => m.type === "git") && req.gitSummary) {
    parts.push(`\n<source_control_state>\n${req.gitSummary}\n</source_control_state>`);
  }

  const tree = Object.keys(req.files).sort().join("\n");
  if (used + tree.length < budget) parts.unshift(`File tree:\n${tree}`);

  return { text: parts.join("\n"), included, masked };
}
