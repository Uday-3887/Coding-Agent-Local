import React, { useCallback, useEffect, useRef } from "react";
import { stopGeneration } from "./agents/engine";
import AIPanel from "./components/AIPanel";
import BottomPanel from "./components/BottomPanel";
import EditorArea from "./components/EditorArea";
import { CommandPalette, PermissionModal, QuickOpen, ToastHost } from "./components/Overlays";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import TopBar from "./components/TopBar";
import { LogoMark, Spinner } from "./components/ui";
import { useResolvedTheme, useStore } from "./state/store";

/* ─────────────── error boundary ─────────────── */

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen w-screen flex items-center justify-center" style={{ background: "var(--bg0)" }}>
          <div className="raised rounded-xl p-6 max-w-[440px] text-center space-y-3" style={{ borderColor: "var(--danger)" }}>
            <div className="font-display font-bold text-[16px]" style={{ color: "var(--danger)" }}>LocalForge hit a snag</div>
            <p className="text-[12.5px] text-[var(--tx2)] break-words">{this.state.error.message}</p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload application</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─────────────── hotkeys ─────────────── */

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const st = useStore.getState();
      if (mod && e.key.toLowerCase() === "p" && !e.shiftKey) {
        e.preventDefault();
        st.setQuickOpen(true);
      } else if (mod && e.key.toLowerCase() === "p" && e.shiftKey) {
        e.preventDefault();
        st.setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        st.setSidebarView(st.sidebarView ? null : "explorer");
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        st.setBottomView(st.bottomView ? null : "terminal");
      } else if (e.key === "Escape") {
        if (st.permission) return; // let the modal handle its own dismissal
        if (st.quickOpen) st.setQuickOpen(false);
        else if (st.paletteOpen) st.setPaletteOpen(false);
        else stopGeneration();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/* ─────────────── theme applier ─────────────── */

function useThemeApplier() {
  const resolved = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
}

/* ─────────────── resizable panels ─────────────── */

function useResize(kind: "sidebar" | "ai" | "bottom") {
  const updateSettings = useStore((s) => s.updateSettings);
  const dragRef = useRef<{ start: number; size: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const s = useStore.getState().settings.sizes;
    dragRef.current = { start: kind === "bottom" ? e.clientY : e.clientX, size: s[kind] };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = (kind === "bottom" ? ev.clientY : ev.clientX) - d.start;
      let next = kind === "sidebar" ? d.size + delta : kind === "ai" ? d.size - delta : d.size - delta;
      next = Math.max(kind === "bottom" ? 120 : 180, Math.min(kind === "bottom" ? 480 : 520, next));
      updateSettings({ sizes: { ...useStore.getState().settings.sizes, [kind]: next } });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [kind, updateSettings]);

  return { onPointerDown };
}

/* ─────────────── app shell ─────────────── */

function Shell() {
  const booted = useStore((s) => s.booted);
  const sidebarView = useStore((s) => s.sidebarView);
  const bottomView = useStore((s) => s.bottomView);
  const sizes = useStore((s) => s.settings.sizes);
  useHotkeys();
  useThemeApplier();

  useEffect(() => {
    void useStore.getState().boot();
  }, []);

  const sidebar = useResize("sidebar");
  const ai = useResize("ai");
  const bottom = useResize("bottom");

  if (!booted) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--bg0)" }}>
        <LogoMark size={44} />
        <div className="font-display font-bold text-[17px] tracking-wide">LocalForge AI</div>
        <div className="ember-line w-[160px]" />
        <div className="flex items-center gap-2 text-[12px] text-[var(--tx3)]"><Spinner size={12} /> mounting local database…</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: "var(--bg0)" }}>
      <TopBar />
      <div className="flex flex-1 min-h-0">
        {sidebarView && (
          <>
            <div style={{ width: sizes.sidebar }} className="flex-none min-w-0 h-full">
              <Sidebar />
            </div>
            <div className="resize-handle resize-h" onPointerDown={sidebar.onPointerDown} />
          </>
        )}
        <div className="flex-1 min-w-0 flex flex-col h-full">
          <div className="flex-1 min-h-0">
            <EditorArea />
          </div>
          {bottomView && (
            <>
              <div className="resize-handle resize-v" onPointerDown={bottom.onPointerDown} />
              <div style={{ height: sizes.bottom }} className="flex-none min-h-0">
                <BottomPanel />
              </div>
            </>
          )}
        </div>
        <div className="resize-handle resize-h" onPointerDown={ai.onPointerDown} />
        <div style={{ width: sizes.ai }} className="flex-none min-w-0 h-full">
          <AIPanel />
        </div>
      </div>
      <StatusBar />
      <ToastHost />
      <PermissionModal />
      <CommandPalette />
      <QuickOpen />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}
