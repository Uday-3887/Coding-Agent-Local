import { LIMITS } from "../config/app";
import { isSecretFile } from "../lib/fs";
import type { Problem, ProjectFacts } from "../lib/types";

const EXT_LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
  json: "JSON", md: "Markdown", html: "HTML", css: "CSS", py: "Python", yml: "YAML", yaml: "YAML",
  java: "Java", cs: "C#", go: "Go", rs: "Rust", php: "PHP", rb: "Ruby", sql: "SQL",
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
  else if (files["Cargo.toml"]) framework = "Rust";
  else if (files["go.mod"]) framework = "Go";
  else if (files["pom.xml"] || files["build.gradle"]) framework = "Java";

  let packageManager = "npm";
  if (files["pnpm-lock.yaml"]) packageManager = "pnpm";
  else if (files["yarn.lock"]) packageManager = "yarn";
  else if (files["bun.lockb"] || files["bun.lock"]) packageManager = "bun";
  else if (files["pyproject.toml"] || files["requirements.txt"]) packageManager = "pip";
  else if (files["Cargo.toml"]) packageManager = "cargo";
  else if (files["go.mod"]) packageManager = "go modules";

  let testFramework = "none detected";
  if (allDeps["vitest"]) testFramework = "Vitest";
  else if (allDeps["jest"]) testFramework = "Jest";
  else if (allDeps["@playwright/test"]) testFramework = "Playwright";
  else if (allDeps["cypress"]) testFramework = "Cypress";
  else if (files["pytest.ini"] || /pytest/.test(files["pyproject.toml"] ?? "") || /pytest/.test(files["requirements.txt"] ?? "")) testFramework = "pytest";
  else if (files["Cargo.toml"]) testFramework = "cargo test";
  else if (files["go.mod"]) testFramework = "go test";

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

/** Parse @file / @folder / @project / @codebase / @selection / @errors / @terminal / @git / @diff / @tests / @docs references. */
export function parseMentions(input: string): Mention[] {
  const out: Mention[] = [];
  const re = /@(file|folder|project|codebase|selection|errors|terminal|git|diff|tests|docs)(?:\s+([^\s@]+))?/g;
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
  diffText?: string;
  testsSummary?: string;
  docsSummary?: string;
  codebaseSummary?: string;
  extraFiles?: string[];
  budget?: number;
}

/**
 * Context Manager with priority budgeting:
 *   1. selection  2. referenced files  3. current file  4. related symbols (via extraFiles)
 *   5. search results  6. recent changes (diff)  7. terminal errors  8. architecture summary
 * Secrets are masked; the whole repo is never dumped.
 */
export function buildContext(req: ContextRequest): { text: string; included: string[]; masked: string[] } {
  const budget = req.budget ?? LIMITS.maxContextChars;
  const parts: string[] = [];
  const included: string[] = [];
  const masked: string[] = [];
  let used = 0;

  const add = (chunk: string) => {
    if (used + chunk.length > budget) return false;
    parts.push(chunk);
    used += chunk.length;
    return true;
  };

  const addFile = (path: string, label: string) => {
    if (included.includes(path)) return;
    const content = req.files[path];
    if (content === undefined) return;
    if (isSecretFile(path)) { masked.push(path); return; }
    const snippet = `\n<file path="${path}" note="${label}">\n${content.slice(0, 6000)}\n</file>`;
    if (add(snippet)) included.push(path);
  };

  // 1. user selection
  if (req.selection) add(`<selected_code>\n${req.selection.slice(0, 3000)}\n</selected_code>`);
  // 2. explicitly referenced files
  for (const m of req.mentions) {
    if (m.type === "file" && m.arg) addFile(m.arg, "explicitly referenced");
    if (m.type === "folder" && m.arg) {
      Object.keys(req.files).filter((p) => p.startsWith(m.arg)).slice(0, 6).forEach((p) => addFile(p, `in folder ${m.arg}`));
    }
  }
  for (const p of req.extraFiles ?? []) addFile(p, "task-relevant");
  // 3. current file
  if (req.activeFile) addFile(req.activeFile, "active in editor");
  // 6. recent changes
  if (req.diffText) add(`<recent_changes>\n${req.diffText.slice(0, 4000)}\n</recent_changes>`);
  // 7. terminal + errors
  if (req.mentions.some((m) => m.type === "terminal") && req.terminalTail) add(`<terminal_tail>\n${req.terminalTail.slice(-2500)}\n</terminal_tail>`);
  if (req.mentions.some((m) => m.type === "errors") && req.problems?.length) {
    add(`<current_problems>\n${req.problems.slice(0, 25).map((x) => `${x.severity} ${x.file}:${x.line} ${x.message}`).join("\n")}\n</current_problems>`);
  }
  if (req.mentions.some((m) => m.type === "git") && req.gitSummary) add(`<source_control_state>\n${req.gitSummary}\n</source_control_state>`);
  if (req.testsSummary) add(`<test_results>\n${req.testsSummary}\n</test_results>`);
  if (req.docsSummary) add(`<project_docs>\n${req.docsSummary}\n</project_docs>`);
  // 8. architecture summary + facts (always fit — they are small)
  if (req.codebaseSummary) add(`<architecture_summary>\n${req.codebaseSummary}\n</architecture_summary>`);
  add(factsToText(req.facts));
  const tree = Object.keys(req.files).sort().join("\n");
  if (used + tree.length < budget) parts.unshift(`File tree:\n${tree}`);

  return { text: parts.join("\n"), included, masked };
}
