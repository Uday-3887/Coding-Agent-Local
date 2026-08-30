/**
 * Project Indexer — file map, symbol map, dependency graph and an architecture
 * summary. Powers semantic search ("where is authentication handled?") by
 * combining symbol hits, text hits and metadata.
 */
import { detectProject } from "../adapters";
import type { ProjectIndex, SymbolInfo } from "./types";

const CODE = /\.(ts|tsx|js|jsx|mjs|py|java|cs|go|rs|php|rb)$/;

function extractSymbols(path: string, src: string): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  const push = (name: string, kind: SymbolInfo["kind"], line: number) => out.push({ name, kind, file: path, line });
  const lines = src.split("\n");
  lines.forEach((ln, i) => {
    let m = ln.match(/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) return push(m[1], "function", i + 1);
    m = ln.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) return push(m[1], "function", i + 1);
    m = ln.match(/^\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (m) return push(m[1], "class", i + 1);
    m = ln.match(/^\s*class\s+([A-Za-z_$][\w$]*)/);
    if (m) return push(m[1], "class", i + 1);
    m = ln.match(/^\s*export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/);
    if (m) return push(m[1], ln.includes("=>") || /\bfunction\b/.test(ln) ? "function" : "variable", i + 1);
    m = ln.match(/^\s*def\s+([A-Za-z_][\w$]*)/);
    if (m) return push(m[1], "function", i + 1);
    m = ln.match(/^\s*(?:public|private|static)?\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*{?\s*$/);
    if (m && /\.(java|cs)$/.test(path) && !["if", "for", "while", "switch"].includes(m[1])) return push(m[1], "function", i + 1);
    m = ln.match(/^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_$][\w$]*)/);
    if (m) return push(m[1], "function", i + 1);
    m = ln.match(/^\s*(?:pub\s+)?fn\s+([A-Za-z_$][\w$]*)/);
    if (m) return push(m[1], "function", i + 1);
    m = ln.match(/^export default function ([A-Z][A-Za-z0-9_]*)/);
    if (m) return push(m[1], "component", i + 1);
    if (/^[A-Z][A-Za-z0-9_]*\s*=\s*\(/.test(ln.trim()) && /\.(tsx|jsx)$/.test(path)) {
      push(ln.trim().split(/\s*=/)[0], "component", i + 1);
    }
  });
  return out;
}

function extractDeps(path: string, src: string): string[] {
  const out: string[] = [];
  const re = /(?:import\s+(?:[\s\S]*?)\s+from\s+|require\s*\(\s*|export\s+(?:[\s\S]*?)\s+from\s+)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

export function buildIndex(files: Record<string, string>): ProjectIndex {
  const symbols: SymbolInfo[] = [];
  const depGraph: Record<string, string[]> = {};
  for (const [path, src] of Object.entries(files)) {
    if (!CODE.test(path)) continue;
    if (src.length > 200_000) continue;
    symbols.push(...extractSymbols(path, src));
    depGraph[path] = extractDeps(path, src);
  }
  const adapter = detectProject(files);
  const dirs = [...new Set(Object.keys(files).map((p) => p.split("/")[0]))];
  const routes = Object.keys(files).filter((p) => /route|api\/|pages\/|app\//i.test(p)).slice(0, 12);
  const summary = [
    `Adapter: ${adapter.name} (${adapter.framework}) · ${Object.keys(files).length} files · ${symbols.length} symbols indexed.`,
    `Top level: ${dirs.join(", ")}.`,
    routes.length ? `Likely routes/API surface: ${routes.join(", ")}.` : null,
    adapter.entryFile ? `Entry: ${adapter.entryFile}.` : null,
    adapter.runCommand ? `Run: \`${adapter.runCommand}\`` : "No run command detected.",
  ].filter(Boolean).join("\n");
  return { symbols, depGraph, summary, indexedAt: Date.now(), fileCount: Object.keys(files).length };
}

export interface SemanticResult { kind: "symbol" | "file" | "text"; label: string; file: string; line: number; score: number; snippet?: string; }

/** Local semantic search: concept keywords → symbols + filenames + content. No embeddings required. */
export function semanticSearch(query: string, files: Record<string, string>, index: ProjectIndex | null): SemanticResult[] {
  const q = query.toLowerCase().replace(/[?.!,]/g, "");
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !["where", "how", "what", "the", "is", "are", "does", "find", "handled", "defined"].includes(w));
  const terms = words.length ? words : [q];
  const results: SemanticResult[] = [];

  if (index) {
    for (const s of index.symbols) {
      const name = s.name.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (name.includes(t)) score += 40;
        else if (t.split("").filter((c) => name.includes(c)).length > t.length * 0.6) score += 6;
      }
      if (score > 0) results.push({ kind: "symbol", label: `${s.kind} ${s.name}`, file: s.file, line: s.line, score });
    }
  }
  for (const p of Object.keys(files)) {
    let score = 0;
    const pl = p.toLowerCase();
    for (const t of terms) if (pl.includes(t)) score += 30;
    if (score) results.push({ kind: "file", label: p, file: p, line: 1, score });
  }
  let scanned = 0;
  for (const [p, src] of Object.entries(files)) {
    if (!CODE.test(p) || ++scanned > 400) continue;
    const ls = src.toLowerCase();
    let hits = 0, firstLine = 0;
    for (const t of terms) {
      const idx = ls.indexOf(t);
      if (idx >= 0) {
        hits++;
        if (!firstLine) firstLine = src.slice(0, idx).split("\n").length;
      }
    }
    if (hits === terms.length) {
      results.push({ kind: "text", label: `${terms.join(" + ")} in ${p}`, file: p, line: firstLine, score: 12 * hits, snippet: src.split("\n")[firstLine - 1]?.trim().slice(0, 90) });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 40);
}
