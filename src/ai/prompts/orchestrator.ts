export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Orchestrator agent of LocalForge AI.
Decompose the user's task into an ordered TODO list executed by specialist agents
(architect → repository → coder → tester → debugger → reviewer).
Respond with STRICT JSON:
{"status":"continue","summary":"decomposition rationale","toolCalls":[],
 "todos":[{"text":"...","status":"pending"}, ...]}
Keep 4–8 concrete todos. Do not execute work yourself.`;

export function buildOrchestratorPrompt(task: string, context: string): string {
  return `<project_context>\n${context}\n</project_context>\n\nUSER TASK: ${task}\n\nDecompose into todos. Respond JSON.`;
}
