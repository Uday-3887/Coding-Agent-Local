# LocalForge AI

**A local-first, multi-agent AI coding platform.** Open a project, chat with your code,
and let a crew of specialist agents implement, test, debug and review changes — with every
file edit landing as a diff **you** accept or reject. All data stays on your machine;
[Ollama](https://ollama.com) is the default (and only required) AI backend.

> Change the product name, default Ollama URL, ignore-lists and limits in **one place**:
> `src/config/app.ts`.

## What you can do

| Capability | Where |
|---|---|
| Open a real local folder (read + write-through on save) | Top bar → project menu / Welcome screen |
| Browse, create, rename, delete files | Explorer sidebar |
| Edit code with syntax highlighting, tabs, autosave, dirty state | Center editor (CodeMirror) |
| Chat with streaming answers grounded in real project context (`@file`, `@errors`, `@terminal`, `@selection`, `@git`) | AI panel → Chat |
| Delegate tasks to a 7-agent crew with a visible pipeline, TODO list, iteration limits and permission gates | AI panel → Agent |
| Generate implementation plans, edit/approve/reject them, send them to the agents — plans never touch files | AI panel → Plan |
| Run real static validation suites: lint, type/import-graph checks, unit verification, build graph, integration & runtime detection | AI panel → Test / top bar |
| Review every AI change as a line diff; Accept / Reject / Accept all / Reject all / Undo per task | Source Control sidebar + diff tabs |
| Checkpoints before every agent task — restore, compare, delete | Source Control sidebar |
| Permission-classified commands (SAFE / ASK / DANGEROUS) with explicit confirmation modals | Terminal + agent tools |
| Ollama: connect, health check, list/pull/delete models, per-role model assignment, token streaming, Stop/Regenerate | Settings → AI |
| Fuzzy Quick Open, Command Palette, resizable & collapsible panels, dark/light/system themes | `Ctrl+P`, `Ctrl+Shift+P`, `Ctrl+B`, `Ctrl+J`, `Esc` |

## The agent crew

`Orchestrator → Architect → Repository → Coder → Tester → Debugger → Reviewer`

The **orchestration is deterministic TypeScript** (`src/agents/engine.ts`): the LLM only
proposes strict-JSON decisions (validated with Zod), while the application owns the task
lifecycle, tool validation, iteration caps, timeouts and file access. Agents communicate
through structured records (`agentId, role, taskId, status, toolCalls, filesTouched,
errors`) stored in the local database.

## Tools

`read_file · write_file · create_file · delete_file · move_file · list_directory ·
search_text · search_files · find_symbol · get_file_tree · get_project_info ·
inspect_package_json · run_terminal_command · run_tests · run_lint · run_build ·
report_problem`

All file tools are hard-restricted to the open workspace (path traversal is resolved and
rejected), and every mutation becomes a *pending change* with snapshot → diff → accept/reject.

## Requirements

- Node.js ≥ 18 (to run this repo)
- [Ollama](https://ollama.com) for real LLM inference — optional but recommended.
  Without it, the built-in **heuristic engine** keeps every workflow functional using
  genuine static analysis (clearly labeled as such everywhere).

## Run it

```bash
pnpm install        # or npm install
pnpm dev            # start the dev server
pnpm build          # production build (dist/)
```

## Ollama setup

1. Install Ollama and start it (`ollama serve` → `http://localhost:11434`).
2. Pull a coding model: `ollama pull qwen2.5-coder:7b` (or any model you like).
3. In the app: **Settings → AI → Connect** (URL is configurable, never hardcoded).
4. Assign models per role (Chat / Agent / Planner / Tester / Reviewer) and tune
   temperature, top-p, context window, max tokens and seed.

> **Running this build from a browser origin other than localhost?** Start Ollama with
> `OLLAMA_ORIGINS=* ollama serve` so the browser may call the REST API. In the desktop
> (Electron) target this is unnecessary — requests come from the main process.

## Architecture

```
src/
  config/app.ts          ← single identity/config file (name, defaults, limits)
  lib/                   ← fs (workspace + real folder access + secrets), db (IndexedDB),
                            diff (LCS line diff), fuzzy, demo workspace
  ai/
    provider.ts          ← AIProvider interface · OllamaProvider · OfflineProvider (heuristic)
    context.ts           ← Context Manager: facts, mentions, budget, secret masking
    tools.ts             ← tool registry, Zod validation, command classification, terminal
    heuristics.ts        ← offline decision engine (real static analysis)
    prompts/             ← chat · planner · architect · coder · debugger · tester ·
                            reviewer · orchestrator (one file per role)
  agents/
    engine.ts            ← deterministic orchestration loop, chat streaming, permissions
    planner.ts           ← Plan Mode (never modifies files) → approval → Agent Mode
    testing.ts           ← ecosystem detection + real static validation suites
  state/store.ts         ← Zustand store + IndexedDB persistence
  components/            ← TopBar · Sidebar (6 views) · EditorArea · AIPanel (4 modes) ·
                            BottomPanel (5 tabs) · StatusBar · Overlays
```

### Persistence (local database)

IndexedDB stores mirror the desktop SQLite schema: `projects · chats · messages · tasks ·
agent_runs · tool_calls · file_changes · checkpoints · settings · project_memory ·
test_runs`.

### Browser runtime vs. desktop target

This repository builds the **full product as a local-first web app** so it runs anywhere:

- Real folder access via the **File System Access API** (Chromium) with a
  `<input webkitdirectory>` fallback; saves write straight through to disk.
- The terminal runs a **real workspace emulator** (`ls, cat, grep, tree, rm, mkdir, …`)
  and routes `npm test/build/lint/typecheck` into the static engine; commands that must
  spawn OS processes (`node`, `vite`, installs) are *honestly reported* as requiring the
  desktop runtime rather than faked.
- The desktop (Electron + node-pty + SQLite/Drizzle) target swaps the `lib/fs`,
  terminal and `lib/db` adapters — the AI core, agents, prompts and UI carry over
  unchanged because everything talks through provider/tool/store interfaces.

## Security design

1. File operations resolve against the workspace root; traversal (`../`) is rejected.
2. `.env*`, `*.pem`, `*.key`, credential files are masked before entering any prompt/log.
3. Commands are classified SAFE / ASK / DANGEROUS — dangerous ones always require an
   explicit modal confirmation; `git push` never runs automatically.
4. AI file edits are snapshots + pending diffs; nothing is applied without review
   (optional per-change confirmation gate in Settings → Security).
5. Iteration hard-caps prevent runaway agent loops; malformed JSON decisions are refused.
6. All logs are local and scrubbed of secret content.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Ollama unreachable" | Ensure `ollama serve` is running; check the URL in Settings; for non-localhost origins set `OLLAMA_ORIGINS=*`. |
| Model missing from dropdown | `ollama pull <model>` or use Settings → Pull with progress. |
| Folder open does nothing | Use Chrome/Edge (File System Access API); other browsers fall back to a folder picker. |
| Shell commands "need desktop runtime" | Expected in the web build — static suites (`test/build/lint/typecheck`) run for real. |
