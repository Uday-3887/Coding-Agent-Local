/**
 * Plan Mode — thinks before implementing. NEVER modifies files.
 * Produces a structured plan (via Ollama when connected, otherwise via
 * real workspace heuristics), then routes approval into Agent Mode.
 */
import { z } from "zod";
import { buildContext, computeFacts } from "../ai/context";
import { classifyIntent, pascalCase } from "../ai/heuristics";
import { OllamaProvider } from "../ai/provider";
import { PLANNER_SYSTEM_PROMPT, buildPlannerPrompt } from "../ai/prompts/planner";
import type { Plan } from "../lib/types";
import { getMergedFiles, resolveModel, uid, useStore } from "../state/store";
import { runAgentTask } from "./engine";

const PlanSchema = z.object({
  task: z.string().catch(""),
  analysis: z.string().catch(""),
  filesToModify: z.array(z.string()).catch([]),
  filesToCreate: z.array(z.string()).catch([]),
  dependencies: z.array(z.string()).catch([]),
  steps: z.array(z.string()).catch([]),
  testing: z.string().catch(""),
  risks: z.array(z.string()).catch([]),
});

export async function generatePlan(taskPrompt: string): Promise<void> {
  const s = useStore.getState();
  if (!s.workspace) { s.toast("warn", "Open a project first"); return; }
  useStore.setState({ aiView: "plan" });
  s.log("AI", `plan requested: ${taskPrompt.slice(0, 80)}`);
  s.toast("info", "Planning…", "The planner never modifies files.");

  const files = getMergedFiles(s);
  const facts = computeFacts(files);
  const { model, useOllama } = resolveModel(s, "planner");

  let draft: Omit<Plan, "id" | "status" | "createdAt">;
  if (useOllama) {
    try {
      const ctx = buildContext({ files, facts, mentions: [], budget: 18000 });
      const provider = new OllamaProvider(s.settings.ollamaUrl);
      let raw = "";
      await provider.streamChat({
        model,
        messages: [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: buildPlannerPrompt(taskPrompt, ctx.text) },
        ],
        params: s.settings.params,
        signal: new AbortController().signal,
        onToken: (t) => { raw += t; },
      });
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const parsed = PlanSchema.parse(JSON.parse(raw.slice(start, end + 1)));
      draft = { ...parsed, task: parsed.task || taskPrompt };
    } catch (e) {
      s.toast("warn", "Plan parse failed — using heuristic planner", (e as Error).message.slice(0, 100));
      draft = heuristicPlan(taskPrompt, files);
    }
  } else {
    await new Promise((r) => setTimeout(r, 600));
    draft = heuristicPlan(taskPrompt, files);
  }

  const plan: Plan = { ...draft, id: uid(), status: "draft", createdAt: Date.now() };
  useStore.getState().setPlan(plan);
  useStore.getState().openSpecialTab({ id: "plan-tab", kind: "plan", title: "Plan" });
  useStore.getState().log("AI", `plan generated: ${plan.filesToCreate.length} to create, ${plan.filesToModify.length} to modify`);
  useStore.getState().toast("success", "Plan ready", "Review it, then approve or send to the agents.");
}

function heuristicPlan(taskPrompt: string, files: Record<string, string>): Omit<Plan, "id" | "status" | "createdAt"> {
  const intent = classifyIntent(taskPrompt);
  const paths = Object.keys(files).sort();
  const facts = computeFacts(files);

  const keywords = (taskPrompt.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(0, 4);
  const related = paths.filter((p) => keywords.some((k) => p.toLowerCase().includes(k) || files[p].toLowerCase().includes(k))).slice(0, 6);

  let toCreate: string[] = [];
  let steps: string[] = [];
  const name = pascalCase(keywords[0] ?? "feature");

  switch (intent) {
    case "auth":
      toCreate = ["src/lib/auth.ts", "src/components/LoginForm.tsx"];
      steps = [
        "1. Add `src/lib/auth.ts` — session create/read/clear helpers backed by localStorage (no plaintext secrets).",
        "2. Add `src/components/LoginForm.tsx` — controlled form with validation via `validateCredentials`.",
        "3. Wire the form into the app shell behind a signed-in check.",
        "4. Add unit tests for the session helpers.",
      ];
      break;
    case "test": {
      const target = paths.find((p) => /utils\.(ts|js)$/.test(p)) ?? "src/lib/utils.ts";
      toCreate = [target.replace(/\.(ts|js)$/, ".generated.test.ts")];
      steps = [
        `1. Co-locate a new Vitest file next to \`${target}\`.`,
        "2. Import the module's real exported functions and assert on their return values.",
        "3. Run the unit suite from the Test panel and fix any red cases.",
      ];
      break;
    }
    case "api":
      toCreate = ["src/lib/apiClient.ts"];
      steps = [
        "1. Add a typed `request<T>()` wrapper around fetch reading `VITE_API_BASE`.",
        "2. Define response interfaces next to the call sites.",
        "3. Replace ad-hoc fetch calls incrementally.",
      ];
      break;
    case "component":
    case "page":
      toCreate = [`${intent === "page" ? "src/pages" : "src/components"}/${name}.tsx`];
      steps = [
        `1. Create the ${intent} with typed props, matching existing component conventions.`,
        "2. Import it where needed (route or parent component).",
        "3. Add minimal styles consistent with the current stylesheet.",
      ];
      break;
    default:
      toCreate = [`src/lib/${name.toLowerCase()}.ts`];
      steps = [
        "1. Add a self-contained module implementing the requested behavior.",
        "2. Export a small typed surface; avoid touching unrelated files.",
        "3. Cover it with a co-located test file.",
      ];
  }

  return {
    task: taskPrompt,
    analysis: `${facts.framework} project "${facts.name}" (${facts.fileCount} files, ${facts.packageManager}, tests via ${facts.testFramework}). ` +
      (related.length ? `Related files found by keyword search: ${related.join(", ")}. ` : "No strongly related files found — implementation will be additive. ") +
      `Intent classified as "${intent}". The change is designed to be additive so existing behavior stays intact.`,
    filesToModify: related.slice(0, 3),
    filesToCreate: toCreate,
    dependencies: [],
    steps,
    testing: `Run ${facts.testFramework === "none detected" ? "the static build + lint validation" : `\`${facts.packageManager} run test\` (${facts.testFramework})`} plus the Type Check and Build suites in the Test panel; add a co-located test for any new module.`,
    risks: [
      related.length ? `Touching ${related[0]} may affect existing consumers — verify imports after edits.` : "Low risk: additive files only.",
      facts.tsConfig ? "TypeScript strict mode is on — new code must be fully typed." : "No tsconfig found; type errors won't be caught statically.",
      "Heuristic plan (no LLM connected) — review file list carefully before approving.",
    ],
  };
}

export function approvePlan(): void {
  const p = useStore.getState().plan;
  if (!p) return;
  useStore.getState().setPlan({ ...p, status: "approved" });
  useStore.getState().toast("success", "Plan approved", "Send it to the agents when ready.");
  useStore.getState().log("AGENT", `plan approved: ${p.task.slice(0, 60)}`);
}

export function rejectPlan(): void {
  const p = useStore.getState().plan;
  if (!p) return;
  useStore.getState().setPlan({ ...p, status: "rejected" });
  useStore.getState().toast("info", "Plan rejected");
}

export function sendPlanToAgent(): void {
  const p = useStore.getState().plan;
  if (!p) return;
  const prompt = [
    p.task,
    "",
    "Approved plan:",
    ...p.steps,
    "",
    p.filesToCreate.length ? `Files to create: ${p.filesToCreate.join(", ")}` : "",
    p.filesToModify.length ? `Files to modify: ${p.filesToModify.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  useStore.getState().setPlan({ ...p, status: "approved" });
  void runAgentTask(prompt, { planId: p.id });
}
