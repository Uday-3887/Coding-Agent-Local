/**
 * Workspace filesystem utilities.
 * - Real local folder access through the File System Access API (Chromium),
 *   with a <input webkitdirectory> fallback for other browsers.
 * - Write-through saves for local folders via stored directory handles.
 * - Secret detection + masking (contents never enter prompts unmasked).
 */
import { DEFAULT_IGNORED, LIMITS, SECRET_PATTERNS } from "../config/app";

export type Lang =
  | "typescript" | "tsx" | "javascript" | "jsx" | "json"
  | "markdown" | "html" | "css" | "python" | "plaintext";

export function detectLanguage(path: string): Lang {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "ts": return "typescript";
    case "tsx": return "tsx";
    case "js": case "mjs": case "cjs": return "javascript";
    case "jsx": return "jsx";
    case "json": return "json";
    case "md": case "mdx": return "markdown";
    case "html": case "htm": return "html";
    case "css": case "scss": case "less": return "css";
    case "py": return "python";
    default: return "plaintext";
  }
}

export function isBinaryName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp[34]|wav|zip|tar|gz|exe|dll|so|dylib|pdf|lockb)$/i.test(name);
}

export function isIgnored(path: string): boolean {
  const parts = path.split("/");
  return parts.some((p) => DEFAULT_IGNORED.includes(p)) || isBinaryName(path);
}

export function isSecretFile(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return SECRET_PATTERNS.some((re) => re.test(name) || re.test(path));
}

/** Mask values in KEY=VALUE style files; keep structure visible, hide secrets. */
export function maskSecretContent(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*(?:export\s+)?[A-Za-z_][\w]*\s*=\s*)(.+)$/);
      if (m && m[2].trim()) return `${m[1]}••••••••  (masked by LocalForge)`;
      return line;
    })
    .join("\n");
}

/* ---------- flat tree for the explorer ---------- */

export interface TreeNode { path: string; type: "dir" | "file"; }

export function buildTree(files: Record<string, string>): TreeNode[] {
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const nodes: TreeNode[] = [
    ...[...dirs].map((d) => ({ path: d, type: "dir" as const })),
    ...Object.keys(files).map((f) => ({ path: f, type: "file" as const })),
  ];
  return nodes.sort((a, b) =>
    a.type !== b.type && a.path.split("/").length === b.path.split("/").length
      ? (a.type === "dir" ? -1 : 1)
      : a.path.localeCompare(b.path)
  );
}

/* ---------- real folder access ---------- */

const dirHandles = new Map<string, LFDirHandle>();

interface LFDirHandle {
  name: string;
  values(): AsyncIterable<LFHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<LFDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<LFFileHandle>;
}
interface LFFileHandle {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
interface LFHandle { kind: "file" | "directory"; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<LFHandle>; }

async function readDirRecursive(
  handle: LFDirHandle,
  prefix: string,
  out: Record<string, string>,
  count: { n: number }
): Promise<void> {
  for await (const entry of handle.values()) {
    if (count.n >= LIMITS.maxIndexedFiles) return;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isIgnored(path)) continue;
    if (entry.kind === "directory" && entry.values) {
      await readDirRecursive(entry as unknown as LFDirHandle, path, out, count);
    } else if (entry.kind === "file" && entry.getFile) {
      const file = await entry.getFile();
      if (file.size > LIMITS.maxFileChars * 2) continue; // skip very large files
      out[path] = (await file.text()).slice(0, LIMITS.maxFileChars);
      count.n++;
    }
  }
}

/** Open a real local folder. Returns null when the user cancels. */
export async function pickLocalFolder(): Promise<{ label: string; files: Record<string, string> } | null> {
  const w = window as unknown as { showDirectoryPicker?: (opts?: unknown) => Promise<LFDirHandle> };
  if (typeof w.showDirectoryPicker === "function") {
    try {
      const handle = await w.showDirectoryPicker({ mode: "readwrite" });
      dirHandles.set(handle.name, handle);
      const files: Record<string, string> = {};
      await readDirRecursive(handle, "", files, { n: 0 });
      return { label: handle.name, files };
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  // Fallback: directory picker input (read-only copy)
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.multiple = true;
    input.onchange = async () => {
      const list = Array.from(input.files ?? []);
      if (list.length === 0) return resolve(null);
      const files: Record<string, string> = {};
      let label = "project";
      for (const f of list) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
        const parts = rel.split("/");
        label = parts[0];
        if (isIgnored(rel)) continue;
        if (files && Object.keys(files).length >= LIMITS.maxIndexedFiles) break;
        files[parts.slice(1).join("/") || f.name] = (await f.text()).slice(0, LIMITS.maxFileChars);
      }
      resolve({ label, files });
    };
    input.click();
  });
}

/** Write-through save for locally-opened folders (no-op for demo/upload workspaces). */
export async function saveLocalFile(label: string, path: string, content: string): Promise<boolean> {
  const handle = dirHandles.get(label);
  if (!handle) return false;
  try {
    const parts = path.split("/");
    let dir: LFDirHandle = handle;
    for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fh.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/* ---------- path safety ---------- */

/** Resolve a user/agent supplied path inside the workspace. Returns null if it escapes. */
export function safePath(raw: string): string | null {
  const norm = String(raw).replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!norm) return null;
  const parts = norm.split("/").filter((p) => p !== "." && p !== "");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      if (stack.length === 0) return null; // traversal attempt
      stack.pop();
    } else stack.push(p);
  }
  return stack.length ? stack.join("/") : null;
}
