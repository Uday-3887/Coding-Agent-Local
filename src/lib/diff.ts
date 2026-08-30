export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** LCS line diff. Falls back to block comparison for very large files. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const CAP = 450;
  if (a.length > CAP || b.length > CAP) {
    const out: DiffLine[] = [];
    let on = 1, nn = 1;
    for (const t of a) out.push({ type: "del", text: t, oldNo: on++ });
    for (const t of b) out.push({ type: "add", text: t, newNo: nn++ });
    return out;
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0, on = 1, nn = 1;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i], oldNo: on++, newNo: nn++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i], oldNo: on++ }); i++; }
    else { out.push({ type: "add", text: b[j], newNo: nn++ }); j++; }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++], oldNo: on++ });
  while (j < b.length) out.push({ type: "add", text: b[j++], newNo: nn++ });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    if (l.type === "del") removed++;
  }
  return { added, removed };
}

/** Unified patch text used in summaries / agent context. */
export function makePatch(path: string, oldText: string, newText: string): string {
  const lines = diffLines(oldText, newText).filter((l) => l.type !== "same");
  const head = `--- a/${path}\n+++ b/${path}`;
  if (lines.length === 0) return `${head}\n(no line changes)`;
  const capped = lines.slice(0, 120);
  const body = capped.map((l) => (l.type === "add" ? `+ ${l.text}` : `- ${l.text}`)).join("\n");
  const more = lines.length > 120 ? `\n… ${lines.length - 120} more changed lines` : "";
  return `${head}\n${body}${more}`;
}
