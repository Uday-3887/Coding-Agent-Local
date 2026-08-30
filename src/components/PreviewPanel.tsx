import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Copy, Eraser, ExternalLink, Monitor, MousePointer2, RefreshCw,
  Smartphone, Square, Tablet, Wand2, X, Zap,
} from "lucide-react";
import { detectedUrls, fixPreviewErrorWithAI, rebuildPreview } from "../agents/engine";
import type { DevicePreset, TermLine } from "../lib/types";
import { useStore } from "../state/store";
import { Dropdown, MenuItem, Spinner } from "./ui";

const DEVICES: DevicePreset[] = [
  { label: "Responsive", w: 0, h: 0 },
  { label: "Desktop · 1920×1080", w: 1920, h: 1080 },
  { label: "Laptop · 1366×768", w: 1366, h: 768 },
  { label: "Tablet · 768×1024", w: 768, h: 1024 },
  { label: "Mobile · 390×844", w: 390, h: 844 },
];

export default function PreviewPanel() {
  const preview = useStore((s) => s.preview);
  const setPreview = useStore((s) => s.setPreview);
  const [showConsole, setShowConsole] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  /* bridge: console + inspect events from the preview iframe */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __localforge?: boolean; type?: string; level?: string; text?: string; info?: unknown };
      if (!d || !d.__localforge) return;
      if (d.type === "lf-console") {
        const line: TermLine = { kind: d.level === "error" ? "err" : d.level === "warn" ? "sys" : "out", text: `[${d.level}] ${d.text}` };
        useStore.getState().pushPreviewConsole(line);
      }
      if (d.type === "lf-inspect") {
        const info = d.info as { tag: string; domPath: string; text: string; classes: string | null; rect: { w: number; h: number } };
        useStore.getState().setPreview({ inspectInfo: `<${info.tag}${info.classes ? ` class="${info.classes}"` : ""}> ${info.rect.w}×${info.rect.h}px — "${info.text.slice(0, 60)}" — path: ${info.domPath}` });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  /* toggle inspect mode inside the frame */
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "lf-inspect-toggle", on: preview.inspectOn }, "*");
  }, [preview.inspectOn, frameKey]);

  const refresh = () => { void rebuildPreview(true); setFrameKey((k) => k + 1); };
  const urls = detectedUrls();
  const hasErrors = Boolean(preview.error) || preview.consoleLines.some((l) => l.kind === "err");
  const dev = preview.device;
  const frameStyle = dev.w
    ? { width: dev.w * preview.zoom, height: dev.h * preview.zoom }
    : { width: "100%", height: "100%" };

  const copyUrl = () => {
    void navigator.clipboard?.writeText(preview.url || urls[0] || "localforge://preview");
    useStore.getState().toast("info", "URL copied");
  };
  const openExternal = () => {
    if (!preview.doc) return;
    const u = URL.createObjectURL(new Blob([preview.doc], { type: "text/html" }));
    window.open(u, "_blank");
  };

  return (
    <div className="h-full flex flex-col anim-fade bg-[var(--bg0)]">
      {/* toolbar */}
      <div className="flex items-center gap-1.5 px-2.5 h-[38px] flex-none border-b border-[var(--line)] bg-[var(--bg1)]">
        <button className="btn btn-ghost !px-1.5" title="Back (history lives in-frame)" onClick={() => iframeRef.current?.contentWindow?.history.back()}><ArrowLeft size={13} /></button>
        <button className="btn btn-ghost !px-1.5" title="Forward" onClick={() => iframeRef.current?.contentWindow?.history.forward()}><ArrowRight size={13} /></button>
        <button className="btn btn-ghost !px-1.5" title="Rebuild & refresh" onClick={refresh}>
          {preview.building ? <Spinner size={13} /> : <RefreshCw size={13} />}
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-1 raised rounded-md px-2.5 h-[26px]">
          <span className="led led-ok" style={{ width: 6, height: 6 }} />
          <span className="font-mono text-[11px] truncate text-[var(--tx2)]">{preview.url || "no preview"}</span>
          {urls.length > 0 && (
            <Dropdown align="right" width={230} trigger={<button className="chip !py-0 !text-[9.5px] ml-auto flex-none">detected ×{urls.length}</button>}>
              {(close) => (
                <>
                  {urls.map((u) => (
                    <MenuItem key={u} onClick={() => { void navigator.clipboard?.writeText(u); useStore.getState().toast("info", "URL copied", u); close(); }}>
                      <span className="truncate font-mono text-[11px]">{u}</span>
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
          )}
        </div>
        <button
          className="btn !px-2" title="Auto-rebuild on save (HMR-like)"
          onClick={() => setPreview({ autoRefresh: !preview.autoRefresh })}
          style={preview.autoRefresh ? { color: "var(--ember)", borderColor: "var(--ember)" } : undefined}
        >
          <Zap size={12} /> auto
        </button>
        <Dropdown width={190} align="right" trigger={<button className="btn !px-2" title="Device size"><Monitor size={12} /></button>}>
          {(close) => (
            <>
              {DEVICES.map((d) => (
                <MenuItem key={d.label} onClick={() => { setPreview({ device: d }); close(); }}>
                  {d.w === 0 ? <Monitor size={12} /> : d.w < 500 ? <Smartphone size={12} /> : <Tablet size={12} />}
                  {d.label}
                  {preview.device.label === d.label && <span className="ml-auto" style={{ color: "var(--ember)" }}>●</span>}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
        <select className="select !w-[64px] !py-[3px] !text-[11px]" value={preview.zoom} onChange={(e) => setPreview({ zoom: Number(e.target.value) })} title="Zoom">
          {[0.4, 0.6, 0.8, 1].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
        <button
          className="btn !px-2" title="Inspect element — click in the preview"
          onClick={() => setPreview({ inspectOn: !preview.inspectOn })}
          style={preview.inspectOn ? { color: "var(--ember)", borderColor: "var(--ember)", background: "var(--ember-soft)" } : undefined}
        >
          <MousePointer2 size={12} />
        </button>
        <button className="btn !px-2" title="Copy URL" onClick={copyUrl}><Copy size={12} /></button>
        <button className="btn !px-2" title="Open in new tab" onClick={openExternal}><ExternalLink size={12} /></button>
      </div>

      {/* inspect strip */}
      {preview.inspectInfo && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b text-[11.5px] font-mono anim-fade" style={{ borderColor: "var(--ember)", background: "var(--ember-soft)", color: "var(--tx)" }}>
          <MousePointer2 size={11} style={{ color: "var(--ember)" }} />
          <span className="truncate flex-1">{preview.inspectInfo}</span>
          <button className="chip !py-0 cursor-pointer" onClick={() => {
            const info = preview.inspectInfo ?? "";
            setPreview({ inspectOn: false, inspectInfo: null });
            const st = useStore.getState();
            st.setAiView("chat");
            st.toast("info", "Element captured", "Describe the change in chat — the element context is attached.");
            useStore.getState().setSelection(`Inspect target: ${info}`);
          }}>
            send to AI
          </button>
          <button onClick={() => setPreview({ inspectInfo: null })}><X size={12} /></button>
        </div>
      )}

      {/* stage */}
      <div className="flex-1 min-h-0 dotgrid overflow-auto scroll-thin flex items-start justify-center p-3">
        {preview.building ? (
          <div className="m-auto flex flex-col items-center gap-3 text-[var(--tx2)] text-[12.5px]">
            <Spinner size={22} />
            <span className="font-display tracking-wide">compiling workspace…</span>
            <span className="text-[11px] text-[var(--tx3)]">esbuild is bundling the module graph</span>
          </div>
        ) : preview.mode === "none" || !preview.doc ? (
          <div className="m-auto text-center space-y-2 max-w-[380px]">
            <Monitor size={30} className="mx-auto text-[var(--tx3)]" />
            <p className="text-[13px] text-[var(--tx2)]">{preview.note || "Run the project to open its live preview here."}</p>
            <button className="btn btn-primary mx-auto" onClick={refresh}><RefreshCw size={12} /> Build preview now</button>
          </div>
        ) : (
          <div className="raised rounded-lg overflow-hidden anim-fade-up" style={{ ...frameStyle, minWidth: dev.w ? undefined : "100%", minHeight: dev.h ? undefined : "100%", boxShadow: "var(--shadow)", transformOrigin: "top center" }}>
            <iframe
              key={frameKey}
              ref={iframeRef}
              title="LocalForge preview"
              srcDoc={preview.doc}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
              style={{ width: dev.w ? dev.w : "100%", height: dev.h ? dev.h : "100%", border: "none", background: "#fff", transform: `scale(${preview.zoom})`, transformOrigin: "top left", display: "block" }}
            />
          </div>
        )}
      </div>

      {/* status strip */}
      <div className="flex items-center gap-2 px-3 h-[26px] flex-none border-t border-[var(--line)] bg-[var(--bg1)] text-[10.5px] text-[var(--tx3)]">
        <span className="uppercase tracking-wide">{preview.kind}</span>
        <span className="truncate flex-1">{preview.note}</span>
        {hasErrors && (
          <button className="btn btn-danger !py-0 !px-2 !text-[10.5px]" onClick={fixPreviewErrorWithAI}>
            <Wand2 size={10} /> Fix with AI
          </button>
        )}
        <button className="chip !py-0 cursor-pointer" onClick={() => setShowConsole((v) => !v)}>
          console · {preview.consoleLines.length}
        </button>
      </div>

      {/* console drawer */}
      {showConsole && (
        <div className="h-[130px] flex-none border-t border-[var(--line)] bg-[var(--bg1)] flex flex-col anim-fade">
          <div className="flex items-center px-2.5 h-[24px] border-b border-[var(--line)] text-[10.5px] text-[var(--tx3)]">
            <span className="font-display tracking-widest uppercase">preview console</span>
            <div className="flex-1" />
            <button className="p-0.5 hover:text-[var(--tx)]" title="Clear console" onClick={() => useStore.getState().setPreview({ consoleLines: [] })}><Eraser size={11} /></button>
            <button className="p-0.5 hover:text-[var(--tx)]" onClick={() => setShowConsole(false)}><Square size={10} /></button>
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin px-3 py-1.5 font-mono text-[11px] leading-[1.6]">
            {preview.consoleLines.length === 0 && <span className="text-[var(--tx3)] italic">console.log / warn / error from the previewed page appear here.</span>}
            {preview.consoleLines.map((l, i) => (
              <div key={i} style={{ color: l.kind === "err" ? "var(--danger)" : l.kind === "sys" ? "var(--warn)" : "var(--tx2)", whiteSpace: "pre-wrap" }}>{l.text}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
