// Reads outcomes and says what they do and don't show. Pure functions, no model involved.
// The measure is usable records obtained per request. A prompt denial is a response, and it gets us nothing.

import { fisherExact, wilson } from "../outreach/stats.ts";
import { daysBetween } from "./law.ts";
import type { Law, Policy, RecordsEvent, RequestRecord } from "./lib.ts";
import { stateOf } from "./track.ts";

export interface IntakeRecord {
  id: string;
  dataset: string;
  request_id: string;
  target_id: string;
  place: string;
  state: string;
  status: "registered" | "needs_review" | "passed" | "refused";
  usable: boolean;
  comments: number;
  raw_file: string;
  raw_sha: string;
  received_date: string;
  document_date: string | null;
  source_note: string;
  review_type: string;
  conditions: { text: string; may_test: "yes" | "no" | "unknown"; may_send_to_model: "yes" | "no" | "unknown"; may_publish: "yes" | "no" | "unknown" };
  publish_decision: "undecided";
  hits: { kind: string; text: string; resolved: boolean }[];
  out_file: string | null;
  permit: string | null;
  updated_at: string;
}

/** Each snapshot is appended, so the last one per id wins. */
export function latestIntake(rows: IntakeRecord[]): IntakeRecord[] {
  const byId = new Map<string, IntakeRecord>();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

export interface EvidenceRow {
  id: string;
  target_id: string;
  place: string;
  state: string;
  kind: string;
  sample_size: number;
  small_sample: boolean;
  named_items: boolean;
  formal_route: boolean;
  channel: string;
  sent_at: string;
  closed: boolean;
  closed_how: "event" | "matured" | null;
  responded: boolean;
  first_response_days: number | null;
  documents_received: number;
  usable_records: number;
  usable_comments: number;
  denied: boolean;
  exemptions: string[];
  fee_quoted_usd: number | null;
  narrowed: boolean;
  notes: string[];
}

/**
 * One row per sent request. A request counts as closed when you close it, or after the maturity window, when silence counts as zero usable records.
 * Without that, slow agencies would drop out and make a route look better than it is.
 */
export function evidenceRows(requests: RequestRecord[], events: RecordsEvent[], intake: IntakeRecord[], lawOf: (id: string) => Law, policy: Policy, today: string): EvidenceRow[] {
  const latest = latestIntake(intake);
  const rows: EvidenceRow[] = [];
  for (const r of requests) {
    const law = lawOf(r.law_id);
    const s = stateOf(r, events, law);
    if (!s.sent_at) continue;
    const mine = events.filter((e) => e.request_id === r.id);
    const matured = daysBetween(s.sent_at, today) >= policy.tracking.maturity_calendar_days;
    const firstResponse = mine.filter((e) => ["acknowledged", "estimate", "extension", "fee_quote", "clarification_requested", "partial_grant", "records_received", "denial", "no_records"].includes(e.type)).map((e) => e.at.slice(0, 10)).sort()[0];
    const letters = latest.filter((l) => l.request_id === r.id && l.usable);
    rows.push({
      id: r.id,
      target_id: r.target_id,
      place: r.place,
      state: r.state,
      kind: r.kind,
      sample_size: r.features.sample_size,
      small_sample: r.features.small_sample,
      named_items: r.features.named_items,
      formal_route: r.features.formal_route,
      channel: r.features.channel,
      sent_at: s.sent_at,
      closed: !!s.closed || matured,
      closed_how: s.closed ? "event" : matured ? "matured" : null,
      responded: s.responded,
      first_response_days: firstResponse ? daysBetween(s.sent_at, firstResponse) : null,
      documents_received: s.records_received,
      usable_records: letters.length,
      usable_comments: letters.reduce((a, l) => a + l.comments, 0),
      denied: s.denials.length > 0,
      exemptions: [...new Set([...s.denials.map((d) => d.exemption), ...s.partial.map((d) => d.exemption)].filter((x): x is string => !!x))],
      fee_quoted_usd: s.fee_quotes.length ? s.fee_quotes[s.fee_quotes.length - 1].amount : null,
      narrowed: s.narrowed.length > 0,
      notes: mine.filter((e) => e.note && e.type !== "followup_drafted" && e.type !== "rejected").map((e) => `(${e.type}) ${e.note}`),
    });
  }
  return rows;
}

export interface Summary {
  sent: number;
  closed: number;
  responded: number;
  with_usable: number;
  usable_records: number;
  usable_per_closed: number;
  usable_share_ci: [number, number];
  response_rate: number;
}

export function summarize(rows: EvidenceRow[]): Summary {
  const closed = rows.filter((r) => r.closed);
  const withUsable = closed.filter((r) => r.usable_records > 0).length;
  const usable = closed.reduce((a, r) => a + r.usable_records, 0);
  return {
    sent: rows.length,
    closed: closed.length,
    responded: rows.filter((r) => r.responded).length,
    with_usable: withUsable,
    usable_records: usable,
    usable_per_closed: closed.length ? usable / closed.length : 0,
    usable_share_ci: wilson(withUsable, closed.length),
    response_rate: rows.length ? rows.filter((r) => r.responded).length / rows.length : 0,
  };
}

export interface FeatureVerdict {
  feature: string;
  label: string;
  status: "insufficient_data" | "no_clear_difference" | "one_place_only" | "supported";
  leader: boolean | null;
  reason: string;
  counts: { true_arm: { n: number; usable: number }; false_arm: { n: number; usable: number } };
  look: number;
  alpha_used: number | null;
  p: number | null;
  agencies: number;
  states: number;
}

/**
 * Does a design choice change usable records across places? The model never decides this. See README.md, "How much data is enough".
 * The checks, in order:
 * - Enough closed requests in each arm, spread over enough agencies and states. At most N per agency per arm, because replies from one office aren't independent.
 * - Fixed looks with alpha halved each time, so checking repeatedly can't produce a win.
 * - Fisher exact on "got any usable record", and usable records per request must point the same way.
 * - Leave one state out: the direction must survive dropping each state, and at least two states must show it. This is the check a one-city rule fails.
 */
export function featureVerdict(feature: string, rows: EvidenceRow[], policy: Policy): FeatureVerdict {
  const cfg = policy.learning;
  const label = cfg.features[feature]?.label ?? feature;
  const value = (r: EvidenceRow) => (r as unknown as Record<string, boolean>)[feature];
  const closed = rows.filter((r) => r.closed).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const capped = (arm: boolean) => {
    const perAgency = new Map<string, number>();
    return closed.filter((r) => {
      if (value(r) !== arm) return false;
      const n = perAgency.get(r.target_id) ?? 0;
      if (n >= cfg.max_counted_per_agency_per_arm) return false;
      perAgency.set(r.target_id, n + 1);
      return true;
    });
  };
  const yes = capped(true);
  const no = capped(false);
  const counted = [...yes, ...no];
  const agencies = new Set(counted.map((r) => r.target_id)).size;
  const states = new Set(counted.map((r) => r.state)).size;
  const usable = (list: EvidenceRow[]) => list.filter((r) => r.usable_records > 0).length;
  const base = { feature, label, counts: { true_arm: { n: yes.length, usable: usable(yes) }, false_arm: { n: no.length, usable: usable(no) } }, agencies, states, look: 0, alpha_used: null, p: null, leader: null };

  const missing: string[] = [];
  if (Math.min(yes.length, no.length) < cfg.min_closed_per_arm) missing.push(`each side needs ${cfg.min_closed_per_arm} closed requests (now ${yes.length} and ${no.length})`);
  if (agencies < cfg.min_agencies) missing.push(`${cfg.min_agencies} agencies (now ${agencies})`);
  if (states < cfg.min_states) missing.push(`${cfg.min_states} states (now ${states})`);
  if (missing.length) return { ...base, status: "insufficient_data", reason: `Nothing can be learned yet: ${missing.join("; ")}.` };

  const look = Math.floor(Math.min(yes.length, no.length) / cfg.min_closed_per_arm);
  const n = look * cfg.min_closed_per_arm;
  const a = yes.slice(0, n);
  const b = no.slice(0, n);
  const alpha = cfg.alpha / 2 ** look;
  const p = fisherExact(usable(a), n, usable(b), n);
  const mean = (list: EvidenceRow[]) => list.reduce((t, r) => t + r.usable_records, 0) / list.length;
  const leader = usable(a) > usable(b);
  const tested = { ...base, look, alpha_used: alpha, p, leader };
  const line = `${usable(a)}/${n} vs ${usable(b)}/${n} requests got usable records, p=${p.toFixed(4)}, alpha ${alpha.toFixed(4)}`;
  const meansAgree = leader ? mean(a) > mean(b) : mean(b) > mean(a);
  if (p >= alpha || !meansAgree) return { ...tested, status: "no_clear_difference", reason: `${line}. This data can't separate them.` };

  // Generalization. A difference that vanishes when one state is removed is about that state.
  const inState = (list: EvidenceRow[], st: string) => list.filter((r) => r.state === st);
  const rate = (list: EvidenceRow[]) => (list.length ? usable(list) / list.length : null);
  const allStates = [...new Set([...a, ...b].map((r) => r.state))];
  for (const st of allStates) {
    const ra = rate(a.filter((r) => r.state !== st));
    const rb = rate(b.filter((r) => r.state !== st));
    if (ra === null || rb === null || (leader ? ra <= rb : rb <= ra)) return { ...tested, status: "one_place_only", reason: `${line}, but the difference disappears without ${st}. Treat it as a rule for ${st}, not a general one.` };
  }
  const agreeing = allStates.filter((st) => {
    const ra = rate(inState(a, st));
    const rb = rate(inState(b, st));
    return ra !== null && rb !== null && (leader ? ra > rb : rb > ra);
  });
  if (agreeing.length < 2) return { ...tested, status: "one_place_only", reason: `${line}, but only ${agreeing.length} state shows it directly. That isn't general.` };
  return { ...tested, status: "supported", reason: `${line}, and the direction holds without any one state (shown directly in ${agreeing.join(", ")}).` };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function summaryTable(rows: EvidenceRow[], groupBy: (r: EvidenceRow) => string): string {
  const groups = [...new Set(rows.map(groupBy))].sort();
  const head = "| | Sent | Responded | Closed | Got usable records | Usable records | Per closed request |\n|---|---|---|---|---|---|---|";
  const line = (name: string, list: EvidenceRow[]) => {
    const s = summarize(list);
    return `| ${name} | ${s.sent} | ${s.responded} | ${s.closed} | ${s.with_usable} of ${s.closed} | ${s.usable_records} | ${s.closed ? s.usable_per_closed.toFixed(1) : "n/a"} |`;
  };
  return [head, ...groups.map((g) => line(g, rows.filter((r) => groupBy(r) === g))), line("**All**", rows)].join("\n");
}

export function verdictTable(verdicts: FeatureVerdict[]): string {
  const head = "| Design choice | Verdict | With | Without | Why |\n|---|---|---|---|---|";
  return [head, ...verdicts.map((v) => `| ${v.label} | ${v.status} | ${v.counts.true_arm.usable} of ${v.counts.true_arm.n} | ${v.counts.false_arm.usable} of ${v.counts.false_arm.n} | ${v.reason} |`)].join("\n");
}

export function metricsText(rows: EvidenceRow[], verdicts: FeatureVerdict[]): string {
  const s = summarize(rows);
  const days = rows.map((r) => r.first_response_days).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const median = days.length ? days[Math.floor(days.length / 2)] : null;
  const exemptions = new Map<string, number>();
  for (const r of rows) for (const e of r.exemptions) exemptions.set(e, (exemptions.get(e) ?? 0) + 1);
  return [
    `**Usable records per closed request: ${s.closed ? s.usable_per_closed.toFixed(1) : "n/a"}.** ${s.with_usable} of ${s.closed} closed requests got any usable record (95% CI ${pct(s.usable_share_ci[0])} to ${pct(s.usable_share_ci[1])}).`,
    `Response rate, shown only for context: ${s.responded} of ${s.sent}. A response isn't a record. Median days to first response: ${median ?? "n/a"}.`,
    exemptions.size ? `Exemptions cited: ${[...exemptions].map(([k, v]) => `${k} (${v})`).join(", ")}.` : "No exemptions cited yet.",
    "",
    summaryTable(rows, (r) => r.target_id),
    "",
    verdictTable(verdicts),
  ].join("\n");
}
