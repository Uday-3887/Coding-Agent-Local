/**
 * Live Preview engine.
 *
 *  - esbuild provider: compiles the workspace (TS/TSX/JSX/CSS/JSON) with the
 *    real esbuild compiler (wasm), bundles a module graph, and serves it into
 *    the preview iframe. Bare imports (react, …) resolve through an import map
 *    to versioned CDN modules — clearly labeled; the desktop runtime will use
 *    local node_modules instead. Auto-rebuilds on every file change.
 *  - static provider: serves plain HTML/CSS/JS workspaces by resolving
 *    relative assets to blob URLs. Fully offline.
 *  - console provider: non-web projects show the run output instead of forcing
 *    a browser preview onto them.
 *
 * The iframe gets a bridge script that forwards console.* and inspect-mode
 * events to the host via postMessage.
 */
import * as esbuild from "esbuild-wasm";
import esbuildWasmUrl from "esbuild-wasm/esbuild.wasm?url";
import { detectProject } from "../adapters";
import type { AdapterInfo, PreviewKind, TermLine } from "../lib/types";

let initPromise: Promise<void> | null = null;

async function ensureEsbuild(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await esbuild.initialize({ wasmURL: esbuildWasmUrl });
      } catch (e) {
        initPromise = null;
        throw new Error(`esbuild init failed: ${(e as Error).message}`);
      }
    })();
  }
  return initPromise;
}

export const BRIDGE_SCRIPT = `
<script>
(function () {
  var host = window.parent;
  function send(payload) {
    try { host.postMessage(Object.assign({ __localforge: true }, payload), "*"); } catch (e) {}
  }
  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(function (a) {
        try { return typeof a === "object" ? JSON.stringify(a).slice(0, 400) : String(a).slice(0, 400); }
        catch (e) { return String(a); }
      });
      send({ type: "lf-console", level: level, text: args.join(" ") });
      return orig.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (e) {
    send({ type: "lf-console", level: "error", text: (e.message || "error") + (e.filename ? " @ " + e.filename + ":" + e.lineno : "") });
  });
  window.addEventListener("unhandledrejection", function (e) {
    send({ type: "lf-console", level: "error", text: "unhandled rejection: " + String(e.reason).slice(0, 300) });
  });
  window.__lfInspect = false;
  var outline = null;
  document.addEventListener("mousemove", function (e) {
    if (!window.__lfInspect) { if (outline) { outline.remove(); outline = null; } return; }
    var t = e.target;
    if (!t || t === document.body || t === document.documentElement) return;
    if (!outline) {
      outline = document.createElement("div");
      outline.style.cssText = "position:fixed;pointer-events:none;border:2px solid #ff7a45;background:rgba(255,122,69,.12);z-index:2147483646;transition:all .06s";
      document.body.appendChild(outline);
    }
    var r = t.getBoundingClientRect();
    outline.style.left = r.left + "px"; outline.style.top = r.top + "px";
    outline.style.width = r.width + "px"; outline.style.height = r.height + "px";
  }, true);
  document.addEventListener("click", function (e) {
    if (!window.__lfInspect) return;
    e.preventDefault(); e.stopPropagation();
    var t = e.target;
    if (!t || !t.tagName) return;
    var path = [];
    var n = t;
    for (var i = 0; i < 4 && n && n.tagName; i++) {
      path.unshift(n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\\s+/).slice(0, 2).join(".") : ""));
      n = n.parentElement;
    }
    send({
      type: "lf-inspect",
      info: {
        tag: t.tagName.toLowerCase(),
        id: t.id || null,
        classes: (typeof t.className === "string" ? t.className : "") || null,
        text: (t.textContent || "").trim().slice(0, 120),
        domPath: path.join(" > "),
        rect: (function (r) { return { w: Math.round(r.width), h: Math.round(r.height) }; })(t.getBoundingClientRect()),
      },
    });
  }, true);
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "lf-inspect-toggle") window.__lfInspect = !!e.data.on;
  });
})();
</script>`;

const HMR_NOTE = "<!-- LocalForge preview: rebuilt on save -->";

function importMapFor(bares: Set<string>, files: Record<string, string>): string {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { pkg = JSON.parse(files["package.json"] ?? "{}"); } catch { /* keep defaults */ }
  const versions = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const map: Record<string, string> = {};
  for (const b of bares) {
    const root = b.startsWith("@") ? b.split("/").slice(0, 2).join("/") : b.split("/")[0];
    const sub = b.slice(root.length);
    const v = (versions[root] ?? "latest").replace(/^[\^~]/, "");
    map[b] = v === "latest" ? `https://esm.sh/${root}${sub}` : `https://esm.sh/${root}@${v}${sub}`;
    // react-dom/client etc need the root mapped too
    if (!map[root]) map[root] = v === "latest" ? `https://esm.sh/${root}` : `https://esm.sh/${root}@${v}`;
  }
  return `<script type="importmap">${JSON.stringify({ imports: map })}</script>`;
}

export interface BuildResult {
  doc: string;
  kind: "esbuild" | "static";
  note: string;
  externals: string[];
}

const TRY_ENTRY = ["src/main.tsx", "src/main.ts", "src/index.tsx", "src/index.ts", "main.tsx", "main.ts"];

function findEntry(files: Record<string, string>, html: string | undefined): string | null {
  if (html) {
    const m = html.match(/<script[^>]+src=["']([^"']+)["']/);
    if (m) {
      const src = m[1].replace(/^\.\//, "").replace(/^\//, "");
      if (files[src]) return src;
    }
  }
  for (const e of TRY_ENTRY) if (files[e]) return e;
  return null;
}

function resolvePath(from: string, spec: string, files: Record<string, string>): string | null {
  const dir = from.split("/").slice(0, -1);
  const parts = spec.split("/");
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") dir.pop();
    else dir.push(p);
  }
  const base = dir.join("/");
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".json", ".css", "/index.ts", "/index.tsx", "/index.js"];
  for (const e of exts) if (files[base + e] !== undefined) return base + e;
  return null;
}

/** Real compilation of the workspace module graph via esbuild-wasm. */
export async function buildEsbuildPreview(files: Record<string, string>): Promise<BuildResult> {
  await ensureEsbuild();
  const adapter = detectProject(files);
  const html = files["index.html"];
  const entry = findEntry(files, html);
  if (!entry) throw new Error("No entry module found (index.html script or src/main.*)");

  const bares = new Set<string>();
  const cssChunks: string[] = [];

  const vfsPlugin: esbuild.Plugin = {
    name: "localforge-vfs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("data:")) return { path: args.path, external: true };
        if (args.path.startsWith(".") || args.path.startsWith("/")) {
          const clean = args.path.replace(/\?.*$/, "");
          const resolved = resolvePath(args.importer || entry, clean, files);
          if (resolved) return { path: resolved, namespace: "ws" };
          return { errors: [{ text: `unresolved import "${args.path}" from ${args.importer || "entry"}` }] };
        }
        bares.add(args.path.replace(/\?.*$/, ""));
        return { path: args.path, external: true };
      });
      b.onLoad({ filter: /.*/, namespace: "ws" }, (args) => {
        const contents = files[args.path];
        if (contents === undefined) return { errors: [{ text: `missing file ${args.path}` }] };
        if (args.path.endsWith(".css")) {
          cssChunks.push(contents);
          return { contents: "", loader: "js" };
        }
        if (args.path.endsWith(".json")) return { contents, loader: "json" };
        const loader = args.path.endsWith(".tsx") ? "tsx" : args.path.endsWith(".ts") ? "ts" : args.path.endsWith(".jsx") ? "jsx" : "js";
        return { contents, loader };
      });
    },
  };

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2020",
    jsx: "automatic",
    logLevel: "silent",
    plugins: [vfsPlugin],
    define: { "process.env.NODE_ENV": '"development"' },
  });

  const jsOut = result.outputFiles?.find((f) => f.path.endsWith(".js"))?.text ?? "";
  const cssOut = [
    ...cssChunks,
    ...result.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text),
  ].join("\n");

  const title = (html?.match(/<title>([^<]*)<\/title>/)?.[1]) ?? adapter.name;
  const doc = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${importMapFor(bares, files)}
<style>${cssOut}</style>
${BRIDGE_SCRIPT}
</head><body>
<div id="root"></div>
${HMR_NOTE}
<script type="module">${jsOut}</script>
</body></html>`;

  return {
    doc,
    kind: "esbuild",
    note: bares.size
      ? `Compiled ${entry} with esbuild · bare modules (${[...bares].slice(0, 4).join(", ")}${bares.size > 4 ? "…" : ""}) load from esm.sh — desktop runtime uses local node_modules.`
      : `Compiled ${entry} with esbuild. No external modules.`,
    externals: [...bares],
  };
}

/** Static provider: resolves relative assets to blob URLs. Fully offline. */
export function buildStaticPreview(files: Record<string, string>): BuildResult {
  const html = files["index.html"];
  if (!html) throw new Error("No index.html in workspace");
  const blobs = new Map<string, string>();
  const urlFor = (p: string): string | null => {
    const clean = p.replace(/^\.\//, "").replace(/^\//, "").split("?")[0];
    if (files[clean] === undefined) return null;
    if (!blobs.has(clean)) {
      const ext = clean.split(".").pop() ?? "";
      const mime = ext === "css" ? "text/css" : ext === "js" ? "text/javascript" : ext === "svg" ? "image/svg+xml" : ext === "json" ? "application/json" : "text/plain";
      blobs.set(clean, URL.createObjectURL(new Blob([files[clean]], { type: mime })));
    }
    return blobs.get(clean)!;
  };

  let doc = html;
  doc = doc.replace(/(src|href)=["'](\.\/[^"']+|[^"':\/]+(?:\.[a-z]+))["']/gi, (all, attr: string, ref: string) => {
    if (/^(https?:|data:|mailto:|#)/.test(ref)) return all;
    const u = urlFor(ref);
    return u ? `${attr}="${u}"` : all;
  });
  const inlineScripts = doc.match(/<script[^>]*src=/gi) ?? [];
  doc = doc.replace("</head>", `${BRIDGE_SCRIPT}\n</head>`);
  return {
    doc,
    kind: "static",
    note: `Static site served in-browser · ${blobs.size} asset(s) resolved · ${inlineScripts.length} script tag(s).`,
    externals: [],
  };
}

export function consolePreviewDoc(lines: TermLine[], adapter: AdapterInfo): string {
  const body = lines.length
    ? lines.map((l) => `<div class="${l.kind}">${l.text.replace(/</g, "&lt;")}</div>`).join("")
    : `<div class="sys">No output yet — press Run to execute \`${(adapter.runCommand ?? "the run command").replace(/`/g, "")}\`.</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#0b0e14;color:#d9e1ef;font-family:ui-monospace,monospace;font-size:12.5px;padding:18px;line-height:1.7}
.cmd{color:#ff7a45}.err{color:#f4586b}.sys{color:#5cb6f5;font-style:italic}
h2{font-family:sans-serif;color:#8d97ac;font-size:12px;text-transform:uppercase;letter-spacing:.14em;margin:0 0 12px}
</style></head><body><h2>Console output — ${adapter.name}</h2>${body}</body></html>`;
}

export function detectUrlsIn(text: string): string[] {
  const re = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s"'`)]*)?/g;
  return [...new Set(text.match(re) ?? [])];
}

export function previewKindLabel(k: PreviewKind): string {
  switch (k) {
    case "esbuild": return "Web preview (compiled in-browser)";
    case "static": return "Static site preview";
    case "console": return "Console output preview";
    case "api": return "API preview (Swagger/requests)";
    case "external": return "External application";
    case "none": return "No preview for this project type";
  }
}
