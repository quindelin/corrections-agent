// Step 5: did the agent's change really help this place, without hurting any other?
//
// Code decides, not the model. Holdout comments are paired before and after, and a seeded bootstrap says how far the
// difference could be from noise. A small holdout mostly comes back "inconclusive", and that is the honest answer.

import type { Policy } from "./lib.ts";

export interface CommentOutcome {
  key: string;
  score: number | null;
}

export interface PlaceRun {
  score: number | null;
  unsafe_routes: number;
  compliance_claims?: number;
  /** Letters the agent never answered, even after a retry. They can't be paired, so they're counted here instead. */
  failed_letters?: number;
  comments: CommentOutcome[];
}

export interface Delta {
  n: number;
  points: number;
  low: number;
  high: number;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean paired change in points, with a percentile interval. Comments scored on only one side are left out. */
export function pairedDelta(before: CommentOutcome[], after: CommentOutcome[], alpha: number, samples: number): Delta {
  const was = new Map(before.map((c) => [c.key, c.score]));
  const diffs = after.flatMap((c) => {
    const old = was.get(c.key);
    return typeof old === "number" && typeof c.score === "number" ? [100 * (c.score - old)] : [];
  });
  if (!diffs.length) return { n: 0, points: 0, low: 0, high: 0 };
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const random = mulberry32(20261031);
  const means: number[] = [];
  for (let i = 0; i < samples; i++) {
    const draw = diffs.map(() => diffs[Math.floor(random() * diffs.length)]);
    means.push(mean(draw));
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.floor(q * means.length))];
  const round = (x: number) => Math.round(x * 100) / 100;
  return { n: diffs.length, points: round(mean(diffs)), low: round(at(alpha / 2)), high: round(at(1 - alpha / 2)) };
}

export type Verdict = "kept" | "inconclusive" | "rejected";

export interface Decision {
  verdict: Verdict;
  reasons: string[];
  delta: Delta;
  regressions: Record<string, Delta>;
}

export function decide(input: { place: string; before: PlaceRun; after: PlaceRun; others: Record<string, { before: PlaceRun; after: PlaceRun }>; minComments: number }, policy: Policy): Decision {
  const g = policy.gate;
  // Each attempt looks at the same holdout, so each gets a smaller share of the error rate.
  const alpha = g.alpha / g.max_improve_attempts;
  const delta = pairedDelta(input.before.comments, input.after.comments, alpha, g.bootstrap_samples);
  const reasons: string[] = [];
  let rejected = false;

  if (input.after.unsafe_routes > input.before.unsafe_routes) {
    rejected = true;
    reasons.push(`unsafe routes in ${input.place} rose from ${input.before.unsafe_routes} to ${input.after.unsafe_routes}`);
  }
  const claims = (input.after.compliance_claims ?? 0) - (input.before.compliance_claims ?? 0);
  if (claims > g.max_new_compliance_claims) {
    rejected = true;
    reasons.push(`drafts stating a compliance conclusion rose by ${claims}`);
  }

  // A rewrite can make the agent run past its output limit, and a letter it can't answer is a harm the scores can't show.
  const failures = (input.after.failed_letters ?? 0) - (input.before.failed_letters ?? 0);
  if (failures > g.max_new_failed_letters) {
    rejected = true;
    reasons.push(`${failures} more letters went unanswered, which usually means the rewrite made replies too long`);
  }

  const regressions: Record<string, Delta> = {};
  for (const [other, run] of Object.entries(input.others)) {
    const d = pairedDelta(run.before.comments, run.after.comments, alpha, g.bootstrap_samples);
    regressions[other] = d;
    if (run.after.unsafe_routes > run.before.unsafe_routes) {
      rejected = true;
      reasons.push(`unsafe routes in ${other} rose from ${run.before.unsafe_routes} to ${run.after.unsafe_routes}`);
    }
    if (d.points < -g.regression_margin_points && d.high < 0) {
      rejected = true;
      reasons.push(`${other} fell ${-d.points} points (interval ${d.low} to ${d.high}, n=${d.n})`);
    }
  }

  if (delta.n && delta.points <= 0) {
    rejected = true;
    reasons.push(`the ${input.place} holdout didn't improve: ${delta.points} points (n=${delta.n})`);
  }
  if (rejected) return { verdict: "rejected", reasons, delta, regressions };

  if (delta.n < input.minComments) {
    reasons.push(`only ${delta.n} holdout comments could be compared; ${input.minComments} are needed to call it`);
    return { verdict: "inconclusive", reasons, delta, regressions };
  }
  if (delta.low > 0) {
    reasons.push(`the ${input.place} holdout rose ${delta.points} points (interval ${delta.low} to ${delta.high}, n=${delta.n})`);
    return { verdict: "kept", reasons, delta, regressions };
  }
  reasons.push(`the ${input.place} holdout rose ${delta.points} points, but the interval ${delta.low} to ${delta.high} (n=${delta.n}) includes no change`);
  return { verdict: "inconclusive", reasons, delta, regressions };
}

export interface Readiness {
  ready: boolean;
  checks: { name: string; passed: boolean; value: number | null; needed: string }[];
}

/** Whether a place has earned being offered to a design partner. Agreement with reviewers, not proof a city would accept a response. */
export function readiness(holdout: { score: number | null; citation_chapter_or_better_pct: number | null; unsafe_routes: number; unparsed_letters: number }, policy: Policy): Readiness {
  const r = policy.readiness;
  const checks = [
    { name: "holdout score", passed: (holdout.score ?? 0) >= r.min_holdout_score, value: holdout.score, needed: `at least ${r.min_holdout_score}` },
    { name: "citations at chapter or better", passed: (holdout.citation_chapter_or_better_pct ?? 0) >= r.min_citation_chapter_pct, value: holdout.citation_chapter_or_better_pct, needed: `at least ${r.min_citation_chapter_pct}%` },
    { name: "unsafe routes", passed: holdout.unsafe_routes <= r.max_unsafe_routes, value: holdout.unsafe_routes, needed: `at most ${r.max_unsafe_routes}` },
    { name: "unreadable replies", passed: holdout.unparsed_letters === 0, value: holdout.unparsed_letters, needed: "none" },
  ];
  return { ready: checks.every((c) => c.passed), checks };
}
