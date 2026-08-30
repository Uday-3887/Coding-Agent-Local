/**
 * ProjectAdapter architecture — universal project support.
 * detectProject() inspects manifest files and returns the commands, preview
 * provider and run configuration for the project. Unknown projects fall back
 * to the generic adapter (edit + terminal + AI still fully work).
 */
import type { AdapterInfo, PreviewKind } from "../lib/types";

type Files = Record<string, string>;

interface AdapterDef {
  id: string;
  name: string;
  language: string;
  framework: string;
  /** manifest files that must exist (any match wins, first adapter wins) */
  detect: (files: Files) => boolean;
  build: (files: Files) => Omit<AdapterInfo, "id" | "name" | "language" | "framework">;
}

function pkg(files: Files): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  try { return files["package.json"] ? JSON.parse(files["package.json"]) : {}; } catch { return {}; }
}
function deps(files: Files): Record<string, string> {
  const p = pkg(files);
  return { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
}
function pm(files: Files): string {
  if (files["pnpm-lock.yaml"]) return "pnpm";
  if (files["yarn.lock"]) return "yarn";
  if (files["bun.lockb"] || files["bun.lock"]) return "bun";
  return "npm";
}
function scriptCmd(files: Files, name: string): string | null {
  const s = pkg(files).scripts?.[name];
  return s ? `${pm(files)} run ${name}` : null;
}
function has(files: Files, re: RegExp): boolean {
  return Object.keys(files).some((p) => re.test(p));
}
function pyMain(files: Files): string | null {
  for (const c of ["main.py", "app.py", "src/main.py", "src/app.py", "manage.py"]) if (files[c]) return c;
  return null;
}

const ADAPTERS: AdapterDef[] = [
  {
    id: "next", name: "Next.js", language: "TypeScript", framework: "Next.js",
    detect: (f) => Boolean(deps(f)["next"]),
    build: (f) => ({
      packageManager: pm(f), buildSystem: "Next.js", testFramework: deps(f)["jest"] ? "jest" : deps(f)["vitest"] ? "vitest" : "none",
      scripts: pkg(f).scripts ?? {}, runCommand: scriptCmd(f, "dev"), buildCommand: scriptCmd(f, "build"),
      testCommand: scriptCmd(f, "test"), lintCommand: scriptCmd(f, "lint"),
      debugConfigured: true, previewKind: "esbuild", defaultPort: 3000,
      entryFile: "app/layout.tsx" in f ? "app/layout.tsx" : "pages/index.tsx", lspServer: "typescript-language-server",
      services: [{ name: "Next.js dev server", command: scriptCmd(f, "dev") ?? "npm run dev", cwd: "." }],
    }),
  },
  {
    id: "vite", name: "Vite SPA", language: "TypeScript", framework: "Vite",
    detect: (f) => Boolean(deps(f)["vite"]),
    build: (f) => {
      const d = deps(f);
      const fw = d["react"] ? "React" : d["vue"] ? "Vue" : d["svelte"] ? "Svelte" : d["@angular/core"] ? "Angular" : "Vanilla";
      return {
        packageManager: pm(f), buildSystem: "Vite", framework: `Vite + ${fw}`,
        testFramework: d["vitest"] ? "vitest" : d["jest"] ? "jest" : d["@playwright/test"] ? "playwright" : d["cypress"] ? "cypress" : "none",
        scripts: pkg(f).scripts ?? {}, runCommand: scriptCmd(f, "dev"), buildCommand: scriptCmd(f, "build"),
        testCommand: scriptCmd(f, "test"), lintCommand: scriptCmd(f, "lint"),
        debugConfigured: true, previewKind: "esbuild" as PreviewKind, defaultPort: 5173,
        entryFile: f["index.html"] ? "index.html" : null, lspServer: "typescript-language-server",
        services: [{ name: "Vite dev server", command: scriptCmd(f, "dev") ?? "npm run dev", cwd: "." }],
      };
    },
  },
  {
    id: "react", name: "React (CRA)", language: "TypeScript", framework: "React",
    detect: (f) => Boolean(deps(f)["react-scripts"]),
    build: (f) => ({
      packageManager: pm(f), buildSystem: "react-scripts", testFramework: "jest",
      scripts: pkg(f).scripts ?? {}, runCommand: scriptCmd(f, "start"), buildCommand: scriptCmd(f, "build"),
      testCommand: scriptCmd(f, "test"), lintCommand: null, debugConfigured: true,
      previewKind: "esbuild", defaultPort: 3000, entryFile: "public/index.html", lspServer: "typescript-language-server",
      services: [{ name: "React dev server", command: scriptCmd(f, "start") ?? "npm start", cwd: "." }],
    }),
  },
  {
    id: "node", name: "Node.js", language: "JavaScript", framework: "Node.js",
    detect: (f) => Boolean(f["package.json"]) && !deps(f)["vite"] && !deps(f)["next"] && !deps(f)["react-scripts"],
    build: (f) => {
      const d = deps(f);
      const fw = d["express"] ? "Express" : d["fastify"] ? "Fastify" : d["hono"] ? "Hono" : d["koa"] ? "Koa" : "Node.js";
      const isApi = Boolean(d["express"] || d["fastify"] || d["hono"] || d["koa"]);
      return {
        packageManager: pm(f), buildSystem: d["typescript"] ? "tsc" : "node", framework: fw,
        testFramework: d["vitest"] ? "vitest" : d["jest"] ? "jest" : d["mocha"] ? "mocha" : "none",
        scripts: pkg(f).scripts ?? {}, runCommand: scriptCmd(f, "dev") ?? scriptCmd(f, "start"),
        buildCommand: scriptCmd(f, "build"), testCommand: scriptCmd(f, "test"), lintCommand: scriptCmd(f, "lint"),
        debugConfigured: true, previewKind: isApi ? "api" : "console", defaultPort: isApi ? 8080 : null,
        entryFile: f["src/index.ts"] ? "src/index.ts" : f["src/index.js"] ? "src/index.js" : "index.js",
        lspServer: "typescript-language-server",
        services: isApi ? [{ name: `${fw} API`, command: scriptCmd(f, "dev") ?? scriptCmd(f, "start") ?? "node .", cwd: "." }] : [],
      };
    },
  },
  {
    id: "fastapi", name: "FastAPI", language: "Python", framework: "FastAPI",
    detect: (f) => /fastapi/.test(f["requirements.txt"] ?? "") || /fastapi/.test(f["pyproject.toml"] ?? ""),
    build: (f) => {
      const main = pyMain(f) ?? "main.py";
      const appVar = (f[main] ?? "").match(/^app\s*=/m) ? "app" : "app";
      return {
        packageManager: f["Pipfile"] ? "pipenv" : f["pyproject.toml"] ? "pip/poetry" : "pip",
        buildSystem: "uvicorn", framework: "FastAPI", testFramework: f["tests"] || has(f, /test_.*\.py$/) ? "pytest" : "none",
        scripts: {}, runCommand: `uvicorn ${main.replace(/\.py$/, "").replace(/\//g, ".")}:${appVar} --reload`,
        buildCommand: null, testCommand: "pytest", lintCommand: f["pyproject.toml"] ? "ruff check ." : null,
        debugConfigured: true, previewKind: "api", defaultPort: 8000, entryFile: main, lspServer: "pyright",
        services: [{ name: "FastAPI server", command: `uvicorn ${main.replace(/\.py$/, "")}:${appVar} --reload`, cwd: "." },
          { name: "Swagger UI", command: "open /docs", cwd: "." }],
      };
    },
  },
  {
    id: "django", name: "Django", language: "Python", framework: "Django",
    detect: (f) => Boolean(f["manage.py"]) || /django/i.test(f["requirements.txt"] ?? ""),
    build: (f) => ({
      packageManager: "pip", buildSystem: "django", framework: "Django", testFramework: "django test",
      scripts: {}, runCommand: "python manage.py runserver", buildCommand: null,
      testCommand: "python manage.py test", lintCommand: null, debugConfigured: true,
      previewKind: "esbuild", defaultPort: 8000, entryFile: "manage.py", lspServer: "pyright",
      services: [{ name: "Django dev server", command: "python manage.py runserver", cwd: "." }],
    }),
  },
  {
    id: "flask", name: "Flask", language: "Python", framework: "Flask",
    detect: (f) => /flask/i.test(f["requirements.txt"] ?? "") || /flask/i.test(f["pyproject.toml"] ?? ""),
    build: (f) => {
      const main = pyMain(f) ?? "app.py";
      return {
        packageManager: "pip", buildSystem: "flask", framework: "Flask", testFramework: has(f, /test_.*\.py$/) ? "pytest" : "none",
        scripts: {}, runCommand: `python ${main}`, buildCommand: null, testCommand: "pytest", lintCommand: null,
        debugConfigured: true, previewKind: "esbuild", defaultPort: 5000, entryFile: main, lspServer: "pyright",
        services: [{ name: "Flask server", command: `python ${main}`, cwd: "." }],
      };
    },
  },
  {
    id: "python", name: "Python", language: "Python", framework: "Python",
    detect: (f) => Boolean(f["pyproject.toml"] || f["requirements.txt"] || f["Pipfile"]) || has(f, /\.py$/),
    build: (f) => ({
      packageManager: f["Pipfile"] ? "pipenv" : "pip", buildSystem: "python", framework: "Python",
      testFramework: has(f, /test_.*\.py$/) || f["pytest.ini"] ? "pytest" : "unittest",
      scripts: {}, runCommand: pyMain(f) ? `python ${pyMain(f)}` : null, buildCommand: null,
      testCommand: "pytest", lintCommand: null, debugConfigured: true, previewKind: "console",
      defaultPort: null, entryFile: pyMain(f), lspServer: "pyright", services: [],
    }),
  },
  {
    id: "spring", name: "Spring Boot", language: "Java", framework: "Spring Boot",
    detect: (f) => /spring-boot/.test(f["pom.xml"] ?? "") || /springframework/.test(f["build.gradle"] ?? ""),
    build: (f) => ({
      packageManager: f["pom.xml"] ? "maven" : "gradle", buildSystem: f["pom.xml"] ? "maven" : "gradle",
      framework: "Spring Boot", testFramework: "junit",
      scripts: {}, runCommand: f["pom.xml"] ? "./mvnw spring-boot:run" : "./gradlew bootRun",
      buildCommand: f["pom.xml"] ? "./mvnw package" : "./gradlew build",
      testCommand: f["pom.xml"] ? "./mvnw test" : "./gradlew test", lintCommand: null,
      debugConfigured: true, previewKind: "api", defaultPort: 8080, entryFile: null, lspServer: "jdtls",
      services: [{ name: "Spring Boot app", command: f["pom.xml"] ? "./mvnw spring-boot:run" : "./gradlew bootRun", cwd: "." }],
    }),
  },
  {
    id: "java", name: "Java", language: "Java", framework: "Java",
    detect: (f) => Boolean(f["pom.xml"] || f["build.gradle"]) || has(f, /\.java$/),
    build: (f) => ({
      packageManager: f["pom.xml"] ? "maven" : "gradle", buildSystem: f["pom.xml"] ? "maven" : "gradle",
      framework: "Java", testFramework: "junit",
      scripts: {}, runCommand: f["pom.xml"] ? "./mvnw exec:java" : "./gradlew run",
      buildCommand: f["pom.xml"] ? "./mvnw package" : "./gradlew build",
      testCommand: f["pom.xml"] ? "./mvnw test" : "./gradlew test", lintCommand: null,
      debugConfigured: false, previewKind: "console", defaultPort: null, entryFile: null, lspServer: "jdtls", services: [],
    }),
  },
  {
    id: "dotnet", name: ".NET", language: "C#", framework: ".NET",
    detect: (f) => has(f, /\.(csproj|sln)$/),
    build: () => ({
      packageManager: "nuget", buildSystem: "dotnet", framework: ".NET", testFramework: "xunit/nunit",
      scripts: {}, runCommand: "dotnet run", buildCommand: "dotnet build", testCommand: "dotnet test",
      lintCommand: null, debugConfigured: true, previewKind: "console", defaultPort: 5000,
      entryFile: null, lspServer: "omnisharp", services: [{ name: ".NET app", command: "dotnet run", cwd: "." }],
    }),
  },
  {
    id: "laravel", name: "Laravel", language: "PHP", framework: "Laravel",
    detect: (f) => Boolean(f["artisan"]) || /laravel/.test(f["composer.json"] ?? ""),
    build: (f) => ({
      packageManager: "composer", buildSystem: "artisan", framework: "Laravel", testFramework: "phpunit",
      scripts: {}, runCommand: "php artisan serve", buildCommand: null, testCommand: "php artisan test",
      lintCommand: null, debugConfigured: true, previewKind: "esbuild", defaultPort: 8000,
      entryFile: "public/index.php", lspServer: "intelephense",
      services: [{ name: "Laravel server", command: "php artisan serve", cwd: "." }],
    }),
  },
  {
    id: "php", name: "PHP", language: "PHP", framework: "PHP",
    detect: (f) => Boolean(f["composer.json"]) || has(f, /\.php$/),
    build: () => ({
      packageManager: "composer", buildSystem: "php", framework: "PHP", testFramework: "phpunit",
      scripts: {}, runCommand: "php -S localhost:8000", buildCommand: null, testCommand: "phpunit",
      lintCommand: "php -l", debugConfigured: false, previewKind: "esbuild", defaultPort: 8000,
      entryFile: "index.php", lspServer: "intelephense",
      services: [{ name: "PHP built-in server", command: "php -S localhost:8000", cwd: "." }],
    }),
  },
  {
    id: "go", name: "Go", language: "Go", framework: "Go",
    detect: (f) => Boolean(f["go.mod"]),
    build: (f) => {
      const isWeb = /net\/http|gin-gonic|echo|fiber/.test(f["go.mod"] ?? "") || has(f, /main\.go$/);
      return {
        packageManager: "go modules", buildSystem: "go", framework: "Go", testFramework: "go test",
        scripts: {}, runCommand: "go run .", buildCommand: "go build ./...", testCommand: "go test ./...",
        lintCommand: "go vet ./...", debugConfigured: true, previewKind: isWeb ? "api" : "console",
        defaultPort: isWeb ? 8080 : null, entryFile: "main.go", lspServer: "gopls",
        services: isWeb ? [{ name: "Go server", command: "go run .", cwd: "." }] : [],
      };
    },
  },
  {
    id: "rust", name: "Rust", language: "Rust", framework: "Rust",
    detect: (f) => Boolean(f["Cargo.toml"]),
    build: (f) => {
      const isWeb = /actix|axum|rocket/.test(f["Cargo.toml"] ?? "");
      return {
        packageManager: "cargo", buildSystem: "cargo", framework: isWeb ? "Rust (web)" : "Rust",
        testFramework: "cargo test", scripts: {}, runCommand: "cargo run", buildCommand: "cargo build",
        testCommand: "cargo test", lintCommand: "cargo clippy", debugConfigured: true,
        previewKind: isWeb ? "api" : "console", defaultPort: isWeb ? 3000 : null,
        entryFile: "src/main.rs", lspServer: "rust-analyzer",
        services: isWeb ? [{ name: "Rust server", command: "cargo run", cwd: "." }] : [],
      };
    },
  },
  {
    id: "cpp", name: "C / C++", language: "C++", framework: "Native",
    detect: (f) => Boolean(f["CMakeLists.txt"] || f["Makefile"]) || has(f, /\.(c|cpp|cc|h|hpp)$/),
    build: (f) => ({
      packageManager: "system", buildSystem: f["CMakeLists.txt"] ? "cmake" : "make", framework: "Native",
      testFramework: "none", scripts: {},
      runCommand: f["CMakeLists.txt"] ? "cmake -B build && cmake --build build && ./build/app" : "make && ./app",
      buildCommand: f["CMakeLists.txt"] ? "cmake --build build" : "make", testCommand: null, lintCommand: null,
      debugConfigured: false, previewKind: "console", defaultPort: null, entryFile: "main.cpp",
      lspServer: "clangd", services: [],
    }),
  },
  {
    id: "static", name: "Static site", language: "HTML", framework: "Static HTML",
    detect: (f) => Boolean(f["index.html"]) && !f["package.json"],
    build: () => ({
      packageManager: "none", buildSystem: "none", framework: "Static HTML/CSS/JS", testFramework: "none",
      scripts: {}, runCommand: null, buildCommand: null, testCommand: null, lintCommand: null,
      debugConfigured: false, previewKind: "static", defaultPort: null, entryFile: "index.html",
      lspServer: null, services: [],
    }),
  },
];

export function detectProject(files: Files): AdapterInfo {
  for (const a of ADAPTERS) {
    try {
      if (a.detect(files)) {
        const built = a.build(files);
        return { id: a.id, name: a.name, language: a.language, framework: a.framework, ...built } as AdapterInfo;
      }
    } catch { /* malformed manifest — try next adapter */ }
  }
  return {
    id: "generic", name: "Generic project", language: "Plain text", framework: "Unknown",
    packageManager: "unknown", buildSystem: "unknown", testFramework: "none", scripts: {},
    runCommand: null, buildCommand: null, testCommand: null, lintCommand: null,
    debugConfigured: false, previewKind: files["index.html"] ? "static" : "none",
    defaultPort: null, entryFile: files["index.html"] ? "index.html" : null, lspServer: null, services: [],
  };
}

export const ADAPTER_LIST = ADAPTERS.map((a) => ({ id: a.id, name: a.name, framework: a.framework }));

/* ─────────── project templates (Create Project with AI) ─────────── */

export function templateFiles(kind: "static" | "vite-react" | "fastapi"): Record<string, string> {
  if (kind === "static") {
    return {
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Site</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="hero">
    <h1>My Site</h1>
    <p>Built with LocalForge AI — edit files and watch the preview refresh.</p>
    <button id="cta">Get started</button>
  </header>
  <main id="content"></main>
  <script src="./app.js"></script>
</body>
</html>
`,
      "styles.css": `* { box-sizing: border-box; margin: 0; }
body { font-family: system-ui, sans-serif; background: #0e1116; color: #e8ecf3; }
.hero { padding: 80px 24px; text-align: center; }
.hero h1 { font-size: 44px; }
#cta { margin-top: 18px; padding: 10px 22px; border: 0; border-radius: 8px; background: #ff7a45; color: #170b05; font-weight: 600; cursor: pointer; }
#content { max-width: 720px; margin: 0 auto; padding: 24px; }
.card { border: 1px solid #232a38; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
`,
      "app.js": `const content = document.getElementById("content");

function card(title, body) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = "<h3>" + title + "</h3><p>" + body + "</p>";
  return el;
}

content.appendChild(card("Live preview", "This page is served by the in-browser preview engine."));
content.appendChild(card("Hot refresh", "Save any file and the preview rebuilds automatically."));

document.getElementById("cta").addEventListener("click", () => {
  content.appendChild(card("Clicked!", "Wired up from app.js."));
});
`,
    };
  }
  if (kind === "fastapi") {
    return {
      "main.py": `from fastapi import FastAPI

app = FastAPI(title="LocalForge API")

items = [{"id": 1, "name": "sample"}]

@app.get("/")
def root():
    return {"hello": "localforge"}

@app.get("/items")
def list_items():
    return items
`,
      "requirements.txt": `fastapi
uvicorn[standard]
`,
      "test_main.py": `from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root():
    assert client.get("/").json() == {"hello": "localforge"}
`,
    };
  }
  // vite-react scaffold
  return {
    "package.json": `{
  "name": "new-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": { "@vitejs/plugin-react": "^4.2.0", "typescript": "^5.3.0", "vite": "^5.0.0", "vitest": "^1.2.0" }
}
`,
    "index.html": `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>New App</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2020", "jsx": "react-jsx", "module": "ESNext",
    "moduleResolution": "bundler", "strict": true, "skipLibCheck": true
  },
  "include": ["src"]
}
`,
    "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    "src/App.tsx": `export default function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: 40 }}>
      <h1>New App</h1>
      <p>Scaffolded by LocalForge AI. Ask the agents to build your feature.</p>
    </div>
  );
}
`,
  };
}
