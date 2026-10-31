// Reads the outcome log and says what it does and doesn't show. Pure functions, no model involved.
// The model never decides whether a variant won: this file does, and learn.ts enforces it.

import type { Message, OutreachEvent, Policy, Segment, Variant } from "./lib.ts";

export interface MessageState {
  approved: boolean;
  approved_sha: string | null;
  rejected: boolean;
  exported: boolean;
  sent_at: string | null;
  replied: boolean;
  positive: boolean;
  bounced: boolean;
  unsubscribed: boolean;
}

export function messageState(id: string, events: OutreachEvent[]): MessageState {
  const s: MessageState = { approved: false, approved_sha: null, rejected: false, exported: false, sent_at: null, replied: false, positive: false, bounced: false, unsubscribed: false };
  for (const e of events) {
    if (e.message_id !== id) continue;
    if (e.type === "approved") {
      s.approved = true;
      s.approved_sha = e.rendered_sha ?? null;
    }
    if (e.type === "rejected") s.rejected = true;
    if (e.type === "exported") s.exported = true;
    if (e.type === "sent") s.sent_at = e.at;
    if (e.type === "replied") s.replied = true;
    if (e.type === "positive") s.replied = s.positive = true;
    if (e.type === "bounced") s.bounced = true;
    if (e.type === "unsubscribed") s.unsubscribed = true;
  }
  return s;
}

// ---------- statistics ----------

function logFactorials(n: number): number[] {
  const f = [0];
  for (let i = 1; i <= n; i++) f[i] = f[i - 1] + Math.log(i);
  return f;
}

/** Two-sided Fisher exact test for a of n1 vs b of n2. Sums every table no more likely than the observed one. */
export function fisherExact(a: number, n1: number, b: number, n2: number): number {
  const total = a + b;
  const N = n1 + n2;
  const lf = logFactorials(N);
  const logP = (x: number) => lf[n1] - lf[x] - lf[n1 - x] + lf[n2] - lf[total - x] - lf[n2 - total + x] - (lf[N] - lf[total] - lf[N - total]);
  const observed = logP(a);
  let p = 0;
  for (let x = Math.max(0, total - n2); x <= Math.min(total, n1); x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-9) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

/** 95% Wilson interval. Honest at small n and near zero, where the usual formula isn't. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// ---------- the verdict ----------

export interface Arm {
  variant_id: string;
  sent: number;
  not_yet_mature: number;
  bounced: number;
  delivered: number;
  replied: number;
  positive: number;
  unsubscribed: number;
  positive_rate: number;
  positive_ci: [number, number];
  reply_rate: number;
  by_segment: Partial<Record<Segment, { delivered: number; positive: number }>>;
}

export interface Verdict {
  status: "no_data" | "insufficient_data" | "no_clear_difference" | "winner" | "single_arm";
  reason: string;
  min_delivered_per_arm: number;
  look: number;
  alpha_used: number | null;
  arms: Arm[];
  comparisons: { leader: string; other: string; leader_positive: number; other_positive: number; n_each: number; p: number; alpha: number }[];
  winner: string | null;
  losers: string[];
  paused: { reason: string } | null;
  total_sent: number;
}

interface SentRecord {
  message: Message;
  state: MessageState;
}

function sentRecords(messages: Message[], events: OutreachEvent[]): SentRecord[] {
  return messages
    .map((message) => ({ message, state: messageState(message.id, events) }))
    .filter((r) => r.state.sent_at)
    .sort((a, b) => a.state.sent_at!.localeCompare(b.state.sent_at!));
}

/**
 * Stop signals act on far less data than a winner, on purpose. A winner changes copy, and being wrong costs little.
 * A high bounce or unsubscribe rate may mean we're annoying people or the list is bad, and waiting for proof costs them.
 * Counted over the most recent sends since the last `resume`.
 */
export function guardrail(messages: Message[], events: OutreachEvent[], policy: Policy): { reason: string } | null {
  const lastResume = events.filter((e) => e.type === "resumed").map((e) => e.at).sort().pop() ?? "";
  const recent = sentRecords(messages, events)
    .filter((r) => r.state.sent_at! > lastResume)
    .slice(-policy.guardrails.window_sent);
  if (recent.length < policy.guardrails.window_sent) return null;
  const bounces = recent.filter((r) => r.state.bounced).length;
  const unsubs = recent.filter((r) => r.state.unsubscribed).length;
  if (bounces / recent.length > policy.guardrails.max_bounce_rate) {
    return { reason: `${bounces} of the last ${recent.length} sends bounced, above the ${policy.guardrails.max_bounce_rate * 100}% limit. Check the list before sending more.` };
  }
  if (unsubs >= policy.guardrails.min_unsubscribes && unsubs / recent.length > policy.guardrails.max_unsubscribe_rate) {
    return { reason: `${unsubs} of the last ${recent.length} sends unsubscribed, above the ${policy.guardrails.max_unsubscribe_rate * 100}% limit. Reread the copy and the targeting before sending more.` };
  }
  return null;
}

/**
 * Who won, if anyone. See "How much data is enough" in README.md.
 * - Only first touches that have had maturity_days to get a reply count, so recent sends don't look like silence.
 * - The primary metric is positive replies per delivered message, fixed in advance.
 * - Tests run only at fixed looks (every min_delivered_per_arm per arm), on exactly that many messages per arm in send order.
 * - Alpha is split across looks (half at the first, a quarter at the second, ...) and across comparisons, so peeking can't manufacture a win.
 */
export function computeVerdict(messages: Message[], events: OutreachEvent[], variants: Variant[], policy: Policy, asOf: Date): Verdict {
  const { min_delivered_per_arm: minN, alpha, maturity_days } = policy.experiment;
  const cutoff = asOf.getTime() - maturity_days * 86_400_000;
  const records = sentRecords(messages, events);
  const ids = [...new Set([...variants.filter((v) => v.status === "active").map((v) => v.id), ...records.map((r) => r.message.variant_id)])];

  const deliveredByArm = new Map<string, SentRecord[]>();
  const arms: Arm[] = ids.map((id) => {
    const mine = records.filter((r) => r.message.variant_id === id);
    const mature = mine.filter((r) => new Date(r.state.sent_at!).getTime() <= cutoff);
    const delivered = mature.filter((r) => !r.state.bounced);
    deliveredByArm.set(id, delivered);
    const positive = delivered.filter((r) => r.state.positive).length;
    const replied = delivered.filter((r) => r.state.replied).length;
    const by_segment: Arm["by_segment"] = {};
    for (const r of delivered) {
      const row = (by_segment[r.message.segment] ??= { delivered: 0, positive: 0 });
      row.delivered += 1;
      if (r.state.positive) row.positive += 1;
    }
    return {
      variant_id: id,
      sent: mine.length,
      not_yet_mature: mine.length - mature.length,
      bounced: mature.filter((r) => r.state.bounced).length,
      delivered: delivered.length,
      replied,
      positive,
      unsubscribed: mine.filter((r) => r.state.unsubscribed).length,
      positive_rate: delivered.length ? positive / delivered.length : 0,
      positive_ci: wilson(positive, delivered.length),
      reply_rate: delivered.length ? replied / delivered.length : 0,
      by_segment,
    };
  });

  const base: Omit<Verdict, "status" | "reason"> = {
    min_delivered_per_arm: minN,
    look: 0,
    alpha_used: null,
    arms,
    comparisons: [],
    winner: null,
    losers: [],
    paused: guardrail(messages, events, policy),
    total_sent: records.length,
  };

  if (!records.length) return { ...base, status: "no_data", reason: "No messages have been sent." };

  const active = variants.filter((v) => v.status === "active").map((v) => v.id);
  const compared = arms.filter((a) => active.includes(a.variant_id));
  if (compared.length < 2) return { ...base, status: "single_arm", reason: "Only one variant is active, so there is nothing to compare it with." };

  const smallest = Math.min(...compared.map((a) => a.delivered));
  if (smallest < minN) {
    const counts = compared.map((a) => `${a.variant_id} ${a.delivered}`).join(", ");
    return { ...base, status: "insufficient_data", reason: `No winner can be declared. Each active variant needs ${minN} delivered, mature messages. Currently: ${counts}. Any gap in these rates may be chance.` };
  }

  // A fixed look: the first look*minN delivered messages per arm, in send order.
  const look = Math.floor(smallest / minN);
  const n = look * minN;
  const comparisons_count = compared.length - 1;
  const alphaUsed = alpha / 2 ** look / comparisons_count;
  const slice = compared.map((a) => ({ id: a.variant_id, positive: deliveredByArm.get(a.variant_id)!.slice(0, n).filter((r) => r.state.positive).length }));
  slice.sort((x, y) => y.positive - x.positive);
  const leader = slice[0];
  const comparisons = slice.slice(1).map((o) => ({ leader: leader.id, other: o.id, leader_positive: leader.positive, other_positive: o.positive, n_each: n, p: fisherExact(leader.positive, n, o.positive, n), alpha: alphaUsed }));

  if (comparisons.every((c) => c.p < alphaUsed)) {
    return {
      ...base,
      look,
      alpha_used: alphaUsed,
      comparisons,
      status: "winner",
      winner: leader.id,
      losers: comparisons.map((c) => c.other),
      reason: `${leader.id} beat every other active variant at look ${look}: ${comparisons.map((c) => `${c.leader_positive}/${n} vs ${c.other_positive}/${n} for ${c.other}, p=${c.p.toFixed(4)}`).join("; ")}, against alpha ${alphaUsed.toFixed(4)}.`,
    };
  }
  return {
    ...base,
    look,
    alpha_used: alphaUsed,
    comparisons,
    status: "no_clear_difference",
    reason: `Enough data to test at look ${look}, but no variant beat every other: ${comparisons.map((c) => `${c.leader_positive}/${n} vs ${c.other_positive}/${n} for ${c.other}, p=${c.p.toFixed(4)}`).join("; ")}, against alpha ${alphaUsed.toFixed(4)}. Keep the variants running.`,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function armTable(arms: Arm[]): string {
  const head = "| Variant | Sent | Not yet mature | Bounced | Delivered | Replied | Positive | Positive rate (95% CI) | Unsubscribed |\n|---|---|---|---|---|---|---|---|---|";
  const rows = arms.map((a) => `| ${a.variant_id} | ${a.sent} | ${a.not_yet_mature} | ${a.bounced} | ${a.delivered} | ${a.replied} | ${a.positive} | ${pct(a.positive_rate)} (${pct(a.positive_ci[0])} to ${pct(a.positive_ci[1])}) | ${a.unsubscribed} |`);
  return [head, ...rows].join("\n");
}

/** The playbook's Standing section. Written by code, so the model can't state a result the data doesn't support. */
export function standingText(v: Verdict, dataset: string, asOf: Date): string {
  const lines = [`Updated ${asOf.toISOString().slice(0, 10)} from ${v.total_sent} sent messages${dataset === "test" ? " of FICTIONAL TEST DATA" : ""}.`, "", `**Verdict: ${v.status}.** ${v.reason}`];
  if (v.paused) lines.push("", `**Outreach paused.** ${v.paused.reason}`);
  if (v.arms.length) lines.push("", armTable(v.arms));
  return lines.join("\n");
}
