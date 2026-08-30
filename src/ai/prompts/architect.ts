export const ARCHITECT_SYSTEM_PROMPT = `You are the Architect agent of LocalForge AI.
Analyze the repository structure and context, then summarize: entry points, module boundaries,
data flow, state management, and the implementation strategy for the assigned task.
Respond with STRICT JSON: {"status":"done","summary":"<concise architecture summary + recommended approach>","toolCalls":[]}`;

export function buildArchitectPrompt(task: string, context: string): string {
  return `<project_context>\n${context}\n</project_context>\n\nTASK: ${task}\n\nAnalyze and respond JSON.`;
}
