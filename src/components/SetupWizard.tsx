import { useEffect, useState } from "react";
import {
  Bot, Check, ChevronLeft, ChevronRight, Cpu, FolderOpen, Hammer, Moon, RefreshCw,
  Rocket, ShieldCheck, Sparkles, Sun, Terminal, Wifi, WifiOff, Zap,
} from "lucide-react";
import { APP_NAME, APP_TAGLINE, OFFLINE_MODEL_ID } from "../config/app";
import { useStore } from "../state/store";
import { Kbd, LogoMark, Spinner } from "./ui";

const STEPS = [
  { title: "Welcome", sub: "Shuruaat" },
  { title: "Ollama", sub: "AI backend" },
  { title: "Models", sub: "Model chuniye" },
  { title: "Workspace", sub: "Preferences" },
  { title: "Ready", sub: "Forge!" },
];

declare global {
  interface Window {
    localforge?: {
      getConfig: () => Promise<{ ollamaUrl?: string }>;
      saveConfig: (patch: Record<string, unknown>) => Promise<boolean>;
      pickFolder: () => Promise<string | null>;
    };
  }
}

export default function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const settings = useStore((s) => s.settings);
  const ollama = useStore((s) => s.ollama);
  const updateSettings = useStore((s) => s.updateSettings);
  const connectOllama = useStore((s) => s.connectOllama);
  const refreshModels = useStore((s) => s.refreshModels);
  const [url, setUrl] = useState(settings.ollamaUrl);

  useEffect(() => {
    void window.localforge?.getConfig().then((c) => {
      if (c?.ollamaUrl) setUrl(c.ollamaUrl);
    });
  }, []);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const finish = () => {
    void window.localforge?.saveConfig({ ollamaUrl: url });
    useStore.getState().toast("success", "Setup complete", "LocalForge AI taiyaar hai — happy forging!");
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[95] anim-fade" style={{ background: "color-mix(in srgb, var(--bg0) 88%, black)" }}>
      <div className="h-full w-full max-w-[980px] mx-auto flex items-center px-6">
        <div className="raised rounded-2xl w-full overflow-hidden anim-fade-up flex flex-col md:flex-row" style={{ boxShadow: "var(--shadow)", borderColor: "var(--line2)" }}>
          {/* ── left rail ── */}
          <div className="md:w-[300px] flex-none p-6 flex flex-col border-b md:border-b-0 md:border-r border-[var(--line)] bg-[var(--bg1)]">
            <div className="flex items-center gap-2.5">
              <LogoMark size={34} />
              <div>
                <div className="font-display font-bold text-[17px] tracking-wide leading-none">{APP_NAME}</div>
                <div className="text-[9.5px] text-[var(--tx3)] tracking-[0.16em] uppercase mt-1">setup wizard</div>
              </div>
            </div>
            <div className="ember-line mt-4" />
            <nav className="mt-6 space-y-1">
              {STEPS.map((s, i) => {
                const active = i === step;
                const done = i < step;
                return (
                  <button
                    key={s.title}
                    onClick={() => i < step && setStep(i)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
                    style={active ? { background: "var(--ember-soft)", boxShadow: "inset 0 0 0 1px var(--ember)" } : undefined}
                  >
                    <span
                      className="w-[24px] h-[24px] flex-none rounded-full flex items-center justify-center text-[11px] font-display font-bold transition-all"
                      style={{
                        background: done ? "var(--ok)" : active ? "var(--ember)" : "var(--bg3)",
                        color: done || active ? "#14100a" : "var(--tx3)",
                        boxShadow: active ? "var(--glow)" : "none",
                      }}
                    >
                      {done ? <Check size={12} /> : i + 1}
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium" style={{ color: active ? "var(--tx)" : "var(--tx2)" }}>{s.title}</span>
                      <span className="block text-[10.5px] text-[var(--tx3)]">{s.sub}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
            <div className="flex-1" />
            <p className="text-[10.5px] text-[var(--tx3)] leading-relaxed">
              <ShieldCheck size={11} className="inline mr-1" style={{ color: "var(--ok)" }} />
              Sab kuch aapke laptop par rehta hai — koi cloud, koi telemetry nahi.
            </p>
          </div>

          {/* ── right pane ── */}
          <div className="flex-1 p-7 md:p-9 flex flex-col min-h-[460px]">
            {step === 0 && <WelcomeStep onNext={next} />}
            {step === 1 && <OllamaStep url={url} setUrl={setUrl} onNext={next} />}
            {step === 2 && <ModelStep onNext={next} />}
            {step === 3 && <PrefsStep onNext={next} />}
            {step === 4 && <DoneStep onFinish={finish} />}

            <div className="flex items-center gap-2 mt-auto pt-6 border-t border-[var(--line)]">
              {step > 0 && step < 4 && (
                <button className="btn btn-ghost" onClick={back}><ChevronLeft size={13} /> Back</button>
              )}
              <div className="flex-1" />
              <div className="flex gap-1 mr-3">
                {STEPS.map((_, i) => (
                  <span key={i} className="h-[4px] rounded-full transition-all" style={{ width: i === step ? 22 : 8, background: i <= step ? "var(--ember)" : "var(--line2)" }} />
                ))}
              </div>
              {step === 0 && <button className="btn btn-primary" onClick={next}>Shuru karein <ChevronRight size={13} /></button>}
              {step === 1 && <button className="btn btn-primary" onClick={next}>Next <ChevronRight size={13} /></button>}
              {step === 2 && <button className="btn btn-primary" onClick={next}>Next <ChevronRight size={13} /></button>}
              {step === 3 && <button className="btn btn-primary" onClick={next}>Next <ChevronRight size={13} /></button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────── steps ─────────── */

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="anim-fade-up">
      <h1 className="font-display font-bold text-[26px] leading-tight">
        Welcome to <span style={{ color: "var(--ember)" }}>{APP_NAME}</span>
      </h1>
      <p className="font-display text-[11px] tracking-[0.22em] uppercase text-[var(--tx3)] mt-2">{APP_TAGLINE}</p>
      <p className="text-[13.5px] text-[var(--tx2)] leading-relaxed mt-4 max-w-[520px]">
        Ye 4 chhote steps mein configure ho jayega — Ollama connect, model, workspace.
        Aap poora platform bina Ollama ke bhi use kar sakte hain (built-in heuristic engine ke saath).
      </p>
      <div className="grid grid-cols-2 gap-2.5 mt-6 max-w-[560px]">
        {[
          { icon: Hammer, t: "Multi-agent coding", d: "Architect, coder, tester, reviewer — sab aapke approval se" },
          { icon: Terminal, t: "Live preview + terminal", d: "Web projects IDE ke andar hi run aur preview" },
          { icon: Bot, t: "Ollama local AI", d: "Qwen Coder jaise models, bina internet ke" },
          { icon: ShieldCheck, t: "Diff-reviewed edits", d: "Har AI change pehle diff mein, phir accept" },
        ].map((f) => (
          <div key={f.t} className="raised rounded-xl p-3.5 transition-transform hover:-translate-y-0.5 cursor-default">
            <f.icon size={16} style={{ color: "var(--ember)" }} />
            <div className="text-[12.5px] font-semibold mt-1.5">{f.t}</div>
            <div className="text-[11px] text-[var(--tx3)] mt-0.5 leading-snug">{f.d}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--tx3)] mt-5">
        Shortcut yaad rakhein: <Kbd>Ctrl P</Kbd> quick open · <Kbd>Ctrl Shift P</Kbd> palette · <Kbd>Ctrl K</Kbd> inline AI
      </p>
    </div>
  );
}

function OllamaStep({ url, setUrl, onNext }: { url: string; setUrl: (v: string) => void; onNext: () => void }) {
  const ollama = useStore((s) => s.ollama);
  const connectOllama = useStore((s) => s.connectOllama);
  const refreshModels = useStore((s) => s.refreshModels);
  const updateSettings = useStore((s) => s.updateSettings);

  const connect = async () => {
    updateSettings({ ollamaUrl: url.trim().replace(/\/$/, "") });
    await connectOllama();
    if (useStore.getState().ollama.status === "connected") void refreshModels();
  };

  return (
    <div className="anim-fade-up">
      <h2 className="font-display font-bold text-[21px]">Ollama connect karein</h2>
      <p className="text-[12.5px] text-[var(--tx2)] mt-2 max-w-[520px] leading-relaxed">
        Ollama aapke laptop par chalne wala local model server hai. Agar installed nahi hai — neeche ke steps follow karein,
        ya <button className="underline decoration-dotted hover:text-[var(--tx)]" onClick={onNext}>skip kar dein</button> (heuristic engine chalega).
      </p>

      <div className="flex gap-2 mt-5 max-w-[520px]">
        <input className="input font-mono !text-[12px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:11434" spellCheck={false} />
        <button className="btn btn-primary flex-none" onClick={() => void connect()} disabled={ollama.status === "connecting"}>
          {ollama.status === "connecting" ? <Spinner size={13} /> : <Wifi size={13} />} Connect
        </button>
      </div>

      <div className="raised rounded-xl p-4 mt-4 max-w-[520px]">
        <div className="flex items-center gap-2.5">
          <span className={`led ${ollama.status === "connected" ? "led-ok" : ollama.status === "error" ? "led-danger" : ollama.status === "connecting" ? "led-warn led-pulse" : "led-off"}`} />
          <span className="text-[13px] font-semibold">
            {ollama.status === "connected" ? `Connected — Ollama ${ollama.version ?? ""} · ${ollama.models.length} model mile` :
              ollama.status === "connecting" ? "Connecting…" :
              ollama.status === "error" ? "Connect nahi hua" : "Abhi connected nahi"}
          </span>
          {ollama.status === "connected" && <button className="btn btn-ghost !py-0.5 ml-auto" onClick={() => void refreshModels()}><RefreshCw size={11} /> Refresh</button>}
        </div>
        {ollama.status !== "connected" && (
          <ol className="mt-3 space-y-1.5 text-[12px] text-[var(--tx2)] list-decimal pl-4 leading-relaxed">
            <li>Install: <a className="text-[var(--info)] hover:underline" href="https://ollama.com" target="_blank" rel="noreferrer">ollama.com</a> se download karein</li>
            <li>Start: terminal mein <code className="chip !py-0 font-mono">ollama serve</code></li>
            <li>Model: <code className="chip !py-0 font-mono">ollama pull qwen2.5-coder:7b</code></li>
            <li>Wapas aakar <strong>Connect</strong> dabayein</li>
          </ol>
        )}
        {ollama.status === "connected" && ollama.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {ollama.models.slice(0, 8).map((m) => <span key={m} className="chip font-mono !text-[10.5px]"><Cpu size={10} /> {m}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

function ModelStep({ onNext }: { onNext: () => void }) {
  const ollama = useStore((s) => s.ollama);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [picked, setPicked] = useState("");

  const applyPick = (m: string) => {
    setPicked(m);
    if (m) {
      updateSettings({
        singleModelMode: true,
        models: { chat: m, agent: m, planner: m, tester: m, reviewer: m, autocomplete: m },
      });
    } else {
      updateSettings({ models: { chat: "", agent: "", planner: "", tester: "", reviewer: "", autocomplete: "" } });
    }
  };

  return (
    <div className="anim-fade-up">
      <h2 className="font-display font-bold text-[21px]">Default model chuniye</h2>
      <p className="text-[12.5px] text-[var(--tx2)] mt-2 max-w-[520px]">
        Ek model sab roles ke liye (chat, agent, planner, tester, reviewer) — baad mein Settings mein alag-alag bhi set kar sakte hain.
      </p>
      <div className="mt-5 space-y-2 max-w-[520px]">
        <button
          className={`w-full flex items-center gap-3 raised rounded-xl px-4 py-3 text-left transition-all hover:-translate-y-0.5`}
          style={!picked ? { borderColor: "var(--ember)", boxShadow: "var(--glow)" } : undefined}
          onClick={() => applyPick("")}
        >
          <Zap size={16} style={{ color: "var(--warn)" }} />
          <span className="flex-1">
            <span className="block text-[13px] font-semibold">Auto / Heuristic (built-in)</span>
            <span className="block text-[11px] text-[var(--tx3)]">Bina Ollama ke bhi poora platform chalta hai — real static analysis</span>
          </span>
          {!picked && <Check size={15} style={{ color: "var(--ember)" }} />}
        </button>
        {ollama.models.map((m) => (
          <button
            key={m}
            className="w-full flex items-center gap-3 raised rounded-xl px-4 py-3 text-left transition-all hover:-translate-y-0.5"
            style={picked === m ? { borderColor: "var(--ember)", boxShadow: "var(--glow)" } : undefined}
            onClick={() => applyPick(m)}
          >
            <Cpu size={16} style={{ color: "var(--info)" }} />
            <span className="flex-1">
              <span className="block text-[13px] font-semibold font-mono">{m}</span>
              <span className="block text-[11px] text-[var(--tx3)]">{/coder|code/.test(m) ? "Coding-specialized — recommended" : "General model"}</span>
            </span>
            {picked === m && <Check size={15} style={{ color: "var(--ember)" }} />}
          </button>
        ))}
        {ollama.models.length === 0 && ollama.status === "connected" && (
          <p className="text-[12px] text-[var(--warn)]">Connected hai par koi model installed nahi — <code className="chip !py-0">ollama pull qwen2.5-coder:7b</code> chalayein.</p>
        )}
        {ollama.status !== "connected" && (
          <p className="text-[12px] text-[var(--tx3)]">Ollama connected nahi hai — Auto mode selected rahega, baad mein model milte hi Settings mein switch kar dein.</p>
        )}
      </div>
    </div>
  );
}

function PrefsStep({ onNext }: { onNext: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const openLocal = useStore((s) => s.openLocal);
  const setAutonomy = useStore((s) => s.setAutonomy);
  const workspace = useStore((s) => s.workspace);
  const autonomy = useStore((s) => s.autonomy);

  return (
    <div className="anim-fade-up">
      <h2 className="font-display font-bold text-[21px]">Workspace & preferences</h2>
      <div className="grid md:grid-cols-2 gap-5 mt-5">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--tx3)] font-display mb-2">Theme</div>
          <div className="flex gap-2">
            {([["dark", Moon, "Dark"], ["light", Sun, "Light"], ["system", Sparkles, "System"]] as const).map(([v, Icon, label]) => (
              <button key={v} className="btn flex-1 justify-center" style={settings.theme === v ? { borderColor: "var(--ember)", color: "var(--ember)", background: "var(--ember-soft)" } : undefined}
                onClick={() => updateSettings({ theme: v })}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          <div className="text-[11px] uppercase tracking-wider text-[var(--tx3)] font-display mt-5 mb-2">Agent autonomy</div>
          <div className="space-y-1.5">
            {([
              ["ask", "Ask everything", "har edit/command pe permission"],
              ["normal", "Normal", "safe edits free, risky pe approval"],
              ["auto", "Auto", "edits+tests free, dangerous blocked"],
              ["plan", "Plan only", "koi edit nahi, sirf planning"],
            ] as const).map(([v, t, d]) => (
              <button key={v} className="w-full flex items-center gap-2.5 raised rounded-lg px-3 py-2 text-left transition-all hover:-translate-y-px"
                style={autonomy === v ? { borderColor: "var(--ember)", background: "var(--ember-soft)" } : undefined}
                onClick={() => setAutonomy(v)}>
                <span className="flex-1">
                  <span className="block text-[12.5px] font-medium">{t}</span>
                  <span className="block text-[10.5px] text-[var(--tx3)]">{d}</span>
                </span>
                {autonomy === v && <Check size={13} style={{ color: "var(--ember)" }} />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--tx3)] font-display mb-2">Project folder</div>
          <button className="btn w-full justify-center !py-3" onClick={() => void openLocal()}>
            <FolderOpen size={14} /> {workspace ? workspace.label : "Open Folder…"}
          </button>
          <p className="text-[11px] text-[var(--tx3)] mt-2 leading-relaxed">
            Abhi kholna zaroori nahi — welcome screen se kabhi bhi khol sakte hain.
          </p>

          <div className="text-[11px] uppercase tracking-wider text-[var(--tx3)] font-display mt-5 mb-2">AI autocomplete</div>
          <label className="raised rounded-lg px-3 py-2.5 flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={settings.autocomplete.enabled} className="accent-[var(--ember)]"
              onChange={(e) => updateSettings({ autocomplete: { ...settings.autocomplete, enabled: e.target.checked } })} />
            <span>
              <span className="block text-[12.5px] font-medium">Ghost-text suggestions (Tab = accept)</span>
              <span className="block text-[10.5px] text-[var(--tx3)]">Local models RAM/GPU lete hain — weak laptop par off rakhein</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  const ollama = useStore((s) => s.ollama);
  const settings = useStore((s) => s.settings);
  const autonomy = useStore((s) => s.autonomy);
  return (
    <div className="anim-fade-up flex flex-col items-start">
      <div className="w-[54px] h-[54px] rounded-2xl flex items-center justify-center" style={{ background: "var(--ember-soft)", boxShadow: "var(--glow)" }}>
        <Rocket size={26} style={{ color: "var(--ember)" }} />
      </div>
      <h2 className="font-display font-bold text-[24px] mt-4">Sab taiyaar hai!</h2>
      <div className="raised rounded-xl p-4 mt-4 w-full max-w-[480px] space-y-2 text-[12.5px]">
        <div className="flex justify-between"><span className="text-[var(--tx3)]">AI backend</span>
          <span className="font-medium" style={{ color: ollama.status === "connected" ? "var(--ok)" : "var(--warn)" }}>
            {ollama.status === "connected" ? `Ollama (${ollama.models.length} models)` : "Heuristic engine"}
          </span></div>
        <div className="flex justify-between"><span className="text-[var(--tx3)]">Model</span>
          <span className="font-mono text-[11.5px]">{settings.models.chat || "auto"}</span></div>
        <div className="flex justify-between"><span className="text-[var(--tx3)]">Autonomy</span><span className="font-medium capitalize">{autonomy}</span></div>
        <div className="flex justify-between"><span className="text-[var(--tx3)]">Theme</span><span className="font-medium capitalize">{settings.theme}</span></div>
      </div>
      <p className="text-[12px] text-[var(--tx2)] mt-4 max-w-[480px] leading-relaxed">
        Agla step: <strong>Open Folder</strong> se project kholein, phir AI panel mein likhein —
        <em className="text-[var(--ember)]"> "Understand this project"</em>. Ye wizard kabhi bhi palette se
        (<Kbd>Ctrl Shift P</Kbd> → Setup Wizard) dobara khul sakta hai.
      </p>
      <button className="btn btn-primary !py-2.5 !px-6 !text-[13.5px] mt-6" onClick={onFinish}>
        <Hammer size={15} /> Start forging
      </button>
    </div>
  );
}
