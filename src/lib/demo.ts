/** Seed workspace: a small but real React + Vite + TS project the agents can analyze and modify. */
export const DEMO_PROJECT_LABEL = "atlas-notes";

export function demoProjectFiles(): Record<string, string> {
  return {
    "package.json": `{
  "name": "atlas-notes",
  "private": true,
  "version": "0.4.2",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "eslint": "^8.56.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "vitest": "^1.2.0"
  }
}
`,
    "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`,
    "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
`,
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Atlas Notes</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    "README.md": `# Atlas Notes

A lightweight markdown notes app built with React, Vite and TypeScript.

## Scripts

- \`npm run dev\` — start dev server on port 5173
- \`npm run build\` — production build
- \`npm run test\` — run unit tests (Vitest)
- \`npm run lint\` — ESLint
- \`npm run typecheck\` — TypeScript check
`,
    ".env.example": `VITE_API_BASE=http://localhost:8787
VITE_SYNC_INTERVAL=30000
`,
    ".gitignore": `node_modules
dist
coverage
.env
*.local
`,
    "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    "src/App.tsx": `import { useState } from "react";
import Sidebar from "./components/Sidebar";
import NoteCard from "./components/NoteCard";
import { useNotes } from "./hooks/useNotes";

export default function App() {
  const notes = useNotes();
  const [query, setQuery] = useState("");

  const filtered = notes.filter((n) =>
    n.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="app-shell">
      <Sidebar
        count={filtered.length}
        query={query}
        onSearch={setQuery}
      />
      <main className="note-grid">
        {filtered.map((note) => (
          <NoteCard key={note.id} note={note} />
        ))}
      </main>
    </div>
  );
}
`,
    "src/components/Sidebar.tsx": `interface SidebarProps {
  count: number;
  query: string;
  onSearch: (q: string) => void;
}

export default function Sidebar({ count, query, onSearch }: SidebarProps) {
  return (
    <aside className="sidebar">
      <h1 className="brand">Atlas Notes</h1>
      <input
        className="search"
        placeholder="Search notes…"
        value={query}
        onChange={(e) => onSearch(e.target.value)}
      />
      <p className="meta">{count} notes</p>
    </aside>
  );
}
`,
    "src/components/NoteCard.tsx": `import type { Note } from "../lib/types";
import { timeAgo } from "../lib/utils";

export default function NoteCard({ note }: { note: Note }) {
  return (
    <article className="note-card">
      <h2>{note.title}</h2>
      <p>{note.body.slice(0, 140)}</p>
      <footer>{timeAgo(note.updatedAt)}</footer>
    </article>
  );
}
`,
    "src/hooks/useNotes.ts": `import { useEffect, useState } from "react";
import type { Note } from "../lib/types";
import { loadNotes } from "../lib/storage";

export function useNotes(): Note[] {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    loadNotes().then(setNotes);
  }, []);

  return notes;
}
`,
    "src/lib/types.ts": `export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
`,
    "src/lib/storage.ts": `import type { Note } from "./types";

const KEY = "atlas.notes.v1";

export async function loadNotes(): Promise<Note[]> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Note[]) : [];
  } catch {
    return [];
  }
}

export async function saveNotes(notes: Note[]): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify(notes));
}
`,
    "src/lib/utils.ts": `export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return \`\${min}m ago\`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return \`\${hours}h ago\`;
  return \`\${Math.floor(hours / 24)}d ago\`;
}

export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}
`,
    "src/lib/utils.test.ts": `import { describe, it, expect } from "vitest";
import { slugify, timeAgo } from "./utils";

describe("slugify", () => {
  it("lowercases and dashes text", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("collapses repeated separators", () => {
    expect(slugify("a---b___c")).toBe("a-b-c");
  });
});

describe("timeAgo", () => {
  it("shows minutes", () => {
    expect(timeAgo(Date.now() - 5 * 60000)).toBe("5m ago");
  });
});
`,
    "src/styles.css": `.app-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}

.sidebar {
  padding: 20px;
  border-right: 1px solid #23262e;
}

.note-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  padding: 20px;
}

.note-card {
  border: 1px solid #23262e;
  border-radius: 10px;
  padding: 16px;
}
`,
  };
}
