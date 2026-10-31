// How a parsed letter is scored against the dataset's comments. Both sides are compared as words, because the
// dataset's text comes from the city's own extraction, with its own stray spaces and line breaks.

/** The dataset's text ends with the group heading it was grouped under, such as "Zoning (5)" or a reviewer's name. */
export function cleanTruth(row: { comment?: string; commentsubject?: string; reviewtype?: string }): string {
  let text = (row.comment ?? "").trim();
  for (const tail of [row.commentsubject, row.reviewtype]) {
    if (tail) text = text.replace(new RegExp(`\\s*${tail.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(\\d+\\)\\s*$`), "");
  }
  return text.replace(/\s*[A-Za-z][\w'’.-]*\s*\(\d+\)\s*$/, "").trim();
}

const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

function overlap(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of b) {
    const n = counts.get(t) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(t, n - 1);
    }
  }
  return shared;
}

export interface Compared {
  truth: number;
  parsed: number;
  matched: number; // pairs one-to-one with a Dice score of 0.8 or more: the right text, split the right way
  found: number; // truth comments whose words appear (80%+) inside some parsed comment, even if merged with others
  spurious: number; // parsed comments that are not a match for any truth comment
}

export function compare(truth: string[], parsed: string[]): Compared {
  const t = truth.map(tokens);
  const p = parsed.map(tokens);
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < t.length; i++) {
    for (let j = 0; j < p.length; j++) {
      const shared = overlap(t[i], p[j]);
      if (shared) pairs.push([(2 * shared) / (t[i].length + p[j].length), i, j]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0]);
  const usedT = new Set<number>();
  const usedP = new Set<number>();
  for (const [score, i, j] of pairs) {
    if (score < 0.8) break;
    if (usedT.has(i) || usedP.has(j)) continue;
    usedT.add(i);
    usedP.add(j);
  }
  const found = t.filter((words) => words.length > 0 && p.some((q) => overlap(words, q) / words.length >= 0.8)).length;
  return { truth: t.length, parsed: p.length, matched: usedT.size, found, spurious: p.length - usedP.size };
}
