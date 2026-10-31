// Shared helpers for the outreach agent: where its files live, its records, and its TrueForge agent.
// The client, turn and session helpers come from scripts/lib.ts. Nothing here touches agent/, evals/ or runs/.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrueForge, TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { die, findAgent, option, runTurn } from "../scripts/lib.ts";

export const OUTREACH_DIR = dirname(fileURLToPath(import.meta.url));

// ---------- records ----------

export type Dataset = "real" | "test";
export type Segment = "architecture_firm" | "permit_expediter";

/** One sourced fact. `evidence` is verbatim from the page, or the query that produced the value. */
export interface Fact {
  id: string;
  kind: string;
  value: string;
  source_url: string;
  retrieved_at: string;
  evidence: string;
  verification: "verbatim_on_page" | "dataset_query";
}

export interface ContactEmail {
  email: string;
  source_url: string;
  evidence: string;
  retrieved_at: string;
  on_site_domain: boolean;
  role_address: boolean;
}

export interface Prospect {
  id: string;
  dataset: Dataset;
  segment: Segment;
  firm_name: string;
  domain: string;
  website: string;
  facts: Fact[];
  emails: ContactEmail[];
  to_email: string | null;
  contact_form_url: string | null;
  status: "ready" | "needs_review" | "excluded" | "no_contact" | "blocked";
  status_reasons: string[];
  researched_at: string;
}

export interface Message {
  id: string;
  dataset: Dataset;
  prospect_id: string;
  firm_name: string;
  domain: string;
  to_email: string | null;
  contact_form_url: string | null;
  segment: Segment;
  variant_id: string;
  variant_sha: string;
  playbook_sha: string;
  subject: string;
  body: string; // the model's text, with {{claim:id}} tokens. The footer is added at render time.
  claims_used: string[];
  facts_used: string[];
  gate: { status: "pending_review" | "blocked"; issues: Issue[]; audit: string };
  session_id: string | null;
  created_at: string;
}

export type EventType = "approved" | "rejected" | "exported" | "sent" | "replied" | "positive" | "bounced" | "unsubscribed" | "resumed" | "prospect_review";

export interface OutreachEvent {
  type: EventType;
  dataset: Dataset;
  message_id?: string;
  prospect_id?: string;
  at: string;
  note?: string;
  rendered_sha?: string;
  over_limit?: boolean;
}

export interface Suppression {
  email?: string;
  domain?: string;
  dataset: Dataset;
  reason: string;
  at: string;
}

export interface Issue {
  severity: "block" | "flag";
  code: string;
  message: string;
}

export interface Claim {
  id: string;
  wording: string;
  source_url: string;
  evidence_grade: string;
  required: boolean;
  verified_by_human: boolean;
}

export interface Variant {
  id: string;
  status: "active" | "proposed" | "retired";
  segments: Segment[];
  angle: string;
  ask: string;
  required_claims: string[];
}

export interface Policy {
  contact_limits: { max_per_day: number; max_per_week: number; max_touches_per_domain: number; min_days_between_touches_same_domain: number };
  experiment: { primary_metric: "positive"; min_delivered_per_arm: number; alpha: number; maturity_days: number };
  guardrails: { window_sent: number; max_bounce_rate: number; max_unsubscribe_rate: number; min_unsubscribes: number };
  budget: { max_usd_per_command: number; max_usd_total: number };
}

export interface Sender {
  from_name: string;
  from_email: string;
  organization: string;
  postal_address: string;
  opt_out_mailbox_monitored: boolean;
  /** Optional, for example "ADV: ". See "Needs your legal judgment" in README.md. */
  subject_prefix?: string;
}

// ---------- the home directory ----------

/**
 * A home holds one playbook and one set of records. The real home is outreach/. A test home is a scratch
 * copy with data/DATASET saying "test", so fictional outcomes can never reach the real playbook.
 */
export interface Home {
  dir: string;
  dataset: Dataset;
  data: string;
  playbook: string;
  claims: string;
  policy: string;
  sender: string;
  prospects: string;
  candidates: string;
  seeds: string;
  messages: string;
  events: string;
  suppression: string;
  spend: string;
  outbox: string;
  reports: string;
}

export function openHome(dir?: string): Home {
  const root = resolve(dir ?? option("home") ?? process.env.OUTREACH_HOME ?? OUTREACH_DIR);
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  const marker = join(data, "DATASET");
  const dataset: Dataset = existsSync(marker) && readFileSync(marker, "utf8").trim() === "test" ? "test" : "real";
  return {
    dir: root,
    dataset,
    data,
    playbook: join(root, "agent", "playbook.md"),
    claims: join(root, "agent", "claims.json"),
    policy: join(root, "agent", "policy.json"),
    sender: join(data, "sender.json"),
    prospects: join(data, "prospects.jsonl"),
    candidates: join(data, "candidates.jsonl"),
    seeds: join(data, "seeds.jsonl"),
    messages: join(data, "messages.jsonl"),
    events: join(data, "events.jsonl"),
    suppression: join(data, "suppression.jsonl"),
    spend: join(data, "spend.jsonl"),
    outbox: join(data, "outbox"),
    reports: join(root, "reports"),
  };
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(value) + "\n");
}

export function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** --as-of lets test data be replayed at a fixed date. */
export function now(): Date {
  const asOf = option("as-of");
  return asOf ? new Date(asOf) : new Date();
}

export function loadClaims(h: Home): Claim[] {
  return (JSON.parse(readFileSync(h.claims, "utf8")) as { claims: Claim[] }).claims;
}

export function loadPolicy(h: Home): Policy {
  return JSON.parse(readFileSync(h.policy, "utf8")) as Policy;
}

export function loadSender(h: Home): Sender | null {
  return existsSync(h.sender) ? (JSON.parse(readFileSync(h.sender, "utf8")) as Sender) : null;
}

export function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// ---------- the playbook file ----------

const VARIANTS_RE = /<!-- variants:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- variants:end -->/;
const STANDING_RE = /<!-- standing:start -->[\s\S]*?<!-- standing:end -->/;

export function parseVariants(text: string): Variant[] {
  const m = text.match(VARIANTS_RE);
  if (!m) throw new Error("The playbook has no variants block.");
  return JSON.parse(m[1]) as Variant[];
}

export function replaceVariants(text: string, variants: Variant[]): string {
  return text.replace(VARIANTS_RE, () => `<!-- variants:start -->\n\`\`\`json\n${JSON.stringify(variants, null, 2)}\n\`\`\`\n<!-- variants:end -->`);
}

export function replaceStanding(text: string, standing: string): string {
  return text.replace(STANDING_RE, () => `<!-- standing:start -->\n${standing.trim()}\n<!-- standing:end -->`);
}

export function withoutStanding(text: string): string {
  return text.replace(STANDING_RE, "");
}

/** The playbook as the model sees it for a rewrite: existing variants and Standing aren't in it, so it can't edit them. */
export function toSkeleton(text: string): string {
  return text.replace(VARIANTS_RE, "<!-- VARIANTS -->").replace(STANDING_RE, "<!-- STANDING -->");
}

export function fromSkeleton(skeleton: string, variants: Variant[], standing: string): string | null {
  if (!skeleton.includes("<!-- VARIANTS -->") || !skeleton.includes("<!-- STANDING -->")) return null;
  return skeleton
    .replace("<!-- VARIANTS -->", () => `<!-- variants:start -->\n\`\`\`json\n${JSON.stringify(variants, null, 2)}\n\`\`\`\n<!-- variants:end -->`)
    .replace("<!-- STANDING -->", () => `<!-- standing:start -->\n${standing.trim()}\n<!-- standing:end -->`);
}

/** A variant's id for the experiment: the fields that define it, not its status. */
export function variantSha(v: Variant): string {
  return sha(JSON.stringify({ id: v.id, segments: v.segments, angle: v.angle, ask: v.ask, required_claims: v.required_claims })).slice(0, 12);
}

// ---------- the TrueForge agent ----------

/**
 * Create or update the agent. It gets no tools at all: no MCP servers, no web search, no sandbox, no sub-agents.
 * That is what "no sending tool" rests on, so it's checked again after saving.
 */
export async function syncOutreachAgent(tf: TrueForge): Promise<TrueForgeApi.Agent> {
  const file = JSON.parse(readFileSync(join(OUTREACH_DIR, "agent", "agent.json"), "utf8")) as { name: string; description: string; model: { name: string; params?: Record<string, unknown> } };
  const instructions = readFileSync(join(OUTREACH_DIR, "agent", "instructions.md"), "utf8").trim();
  const manifest: TrueForgeApi.AgentSpec = {
    model: file.model,
    instructions,
    mcpServers: [],
    config: {
      askUserQuestions: { enabled: false },
      generativeUi: { enabled: false },
      dynamicSubAgents: { enabled: false },
      webSearch: { enabled: false },
      sandbox: { enabled: false },
    },
  };
  const existing = await findAgent(tf, file.name);
  const { data } = existing
    ? await tf.agents.update(existing.id, { description: file.description, manifest })
    : await tf.agents.create({ name: file.name, description: file.description, manifest });
  if ((data.manifest.mcpServers ?? []).length) die(`The outreach agent has MCP servers attached. It must have no tools.`);
  return data;
}

// ---------- spend ----------

export interface Ledger {
  command: string;
  usd: number;
  tokens: number;
  turns: number;
}

export function totalSpend(h: Home): number {
  return readJsonl<{ usd: number }>(h.spend).reduce((a, r) => a + r.usd, 0);
}

export function startLedger(h: Home, command: string): Ledger {
  const policy = loadPolicy(h);
  const total = totalSpend(h);
  if (total >= policy.budget.max_usd_total) die(`Outreach has spent an estimated $${total.toFixed(2)}, at the $${policy.budget.max_usd_total} limit in policy.json. Raise it deliberately to continue.`);
  return { command, usd: 0, tokens: 0, turns: 0 };
}

/** One model turn with a budget check first, and its cost added to the ledger. TrueForge reports an estimated cost per turn. */
export async function billedTurn(h: Home, tf: TrueForge, sessionId: string, ledger: Ledger, prompt: string): Promise<string> {
  const policy = loadPolicy(h);
  if (ledger.usd >= policy.budget.max_usd_per_command) {
    throw new BudgetStop(`Stopped: this command reached its $${policy.budget.max_usd_per_command} limit (estimated $${ledger.usd.toFixed(4)}).`);
  }
  const turn = await runTurn(tf, sessionId, prompt);
  if (turn.status !== "done") throw new Error(`The turn ended with status ${turn.status}${turn.error ? `: ${turn.error}` : ""}`);
  for await (const t of await tf.sessions.listTurns(sessionId)) {
    if (t.id !== turn.turnId) continue;
    const metrics = "metrics" in t.state ? t.state.metrics : undefined;
    ledger.usd += metrics?.totalCostInUsd ?? 0;
    ledger.tokens += metrics?.totalTokens ?? 0;
  }
  ledger.turns += 1;
  return turn.text;
}

export class BudgetStop extends Error {}

export function closeLedger(h: Home, ledger: Ledger, sessionId: string | null): void {
  if (ledger.turns) appendJsonl(h.spend, { at: new Date().toISOString(), command: ledger.command, session_id: sessionId, usd: ledger.usd, tokens: ledger.tokens, turns: ledger.turns });
  console.log(`Model spend for this command: ~$${ledger.usd.toFixed(4)} (${ledger.tokens} tokens, ${ledger.turns} turns). Outreach total in this home: ~$${totalSpend(h).toFixed(4)}.`);
}

/** The last ```json block in a reply, parsed. */
export function parseJsonReply<T>(text: string): T | null {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const raw = blocks.length ? blocks[blocks.length - 1][1] : text.trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
