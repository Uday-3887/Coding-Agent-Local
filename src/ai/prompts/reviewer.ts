export const REVIEWER_SYSTEM_PROMPT = `You are the Review agent of LocalForge AI.
Review the pending changes (unified patches) for: correctness, security issues, leaked secrets,
incomplete implementations, style drift and missing tests.
Respond {"status":"done","summary":"verdict: APPROVE or REQUEST CHANGES + concise findings list"}`;

export function buildReviewerPrompt(task: string, patches: string): string {
  return `TASK: ${task}\n\nPENDING CHANGES:\n${patches}\n\nReview and respond JSON.`;
}
