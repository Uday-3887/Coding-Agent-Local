/**
 * AI ghost-text autocomplete for CodeMirror.
 * Renders a suggestion after the cursor; Tab accepts, Esc rejects.
 * The suggestion source is pluggable (offline heuristic or Ollama /api/generate).
 */
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

export interface Ghost { from: number; text: string; }

export const setGhost = StateEffect.define<Ghost | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.textContent = this.text;
    return span;
  }
  eq(other: GhostWidget) { return other.text === this.text; }
}

export const ghostField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhost)) {
        if (!e.value || !e.value.text) return Decoration.none;
        const w = Decoration.widget({ widget: new GhostWidget(e.value.text), side: 1 });
        return Decoration.set([w.range(e.value.from)]);
      }
    }
    // any doc/selection change invalidates the ghost
    if (tr.docChanged || tr.selection) return Decoration.none;
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function getGhost(view: EditorView): Ghost | null {
  let ghost: Ghost | null = null;
  view.state.field(ghostField, false)?.between(0, view.state.doc.length, (from, _to, deco) => {
    const widget = (deco.spec as { widget?: GhostWidget }).widget;
    if (widget) ghost = { from, text: widget.text };
  });
  return ghost;
}

export const ghostKeymap = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      const g = getGhost(view);
      if (!g) return false;
      view.dispatch({
        changes: { from: g.from, insert: g.text },
        effects: setGhost.of(null),
        scrollIntoView: true,
      });
      return true;
    },
  },
  {
    key: "Escape",
    run: (view) => {
      if (!getGhost(view)) return false;
      view.dispatch({ effects: setGhost.of(null) });
      return true;
    },
  },
]);

export function ghostTheme() {
  return EditorView.baseTheme({
    ".cm-ghost-text": { opacity: 0.42, fontStyle: "italic", color: "var(--tx3)" },
  });
}

/* ─────────── offline continuation heuristics ─────────── */

export function heuristicContinuation(doc: string, cursor: number): string {
  const before = doc.slice(Math.max(0, cursor - 1200), cursor);
  const lines = before.split("\n");
  const last = lines[lines.length - 1] ?? "";
  const trimmed = last.trimEnd();
  if (!trimmed) return "";

  // closing brace continuation
  const opens = (before.match(/{/g) ?? []).length;
  const closes = (before.match(/}/g) ?? []).length;
  if (opens > closes && /[)]\s*{?$/.test(trimmed) === false && /=>\s*{$|{\s*$|\(\s*$/.test(trimmed)) return "";

  // import completion: suggest next likely import based on react project patterns
  if (/^import\s/.test(trimmed) && /from ["']react["']/.test(trimmed) === false && lines.filter((l) => l.startsWith("import")).length <= 3) {
    if (before.includes("useState") && !before.includes('from "react"')) return "";
  }

  // JSX: after an opening tag line suggest the closing tag
  const tag = trimmed.match(/<([A-Za-z][A-Za-z0-9]*)[^/>]*>$/);
  if (tag && !trimmed.endsWith("/>")) return `</${tag[1]}>`;

  // after "const x = useState(" suggest default
  const useState = trimmed.match(/const\s*\[\s*(\w+)/);
  if (useState && trimmed.endsWith("(")) return `] = useState();`;

  // function body start
  if (/\)\s*{$/.test(trimmed) || /=>\s*{$/.test(trimmed)) {
    const indent = (last.match(/^\s*/) ?? [""])[0];
    return `\n${indent}  \n${indent}}`;
  }
  if (opens > closes && /^}$/.test(trimmed) === false && /:\s*$/.test(trimmed) === false) {
    // inside a block that just opened with content — no guess
  }
  return "";
}
