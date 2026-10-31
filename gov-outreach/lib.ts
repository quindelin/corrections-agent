// Shared helpers for the records agent: where its files live, its records, and its TrueForge agent.
// The client and turn helpers come from scripts/lib.ts. Nothing here touches agent/, evals/, runs/ or outreach/.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrueForge, TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { die, findAgent, option, runTurn } from "../scripts/lib.ts";

export const GOV_DIR = dirname(fileURLToPath(import.meta.url));

export type Dataset = "real" | "test";
export type AskKind = "records_request" | "permission_ask";
export type RequesterClass = "any" | "commercial" | "noncommercial";

// ---------- what the agent is given: law and targets, both human-owned ----------

export interface DayCount {
  count: number | null;
  unit: "business" | "calendar" | null;
  label: string;
  cite: string;
}

export interface Extension {
  count: number;
  unit: "business" | "calendar";
  from: "original_due";
  cite: string;
  note: string;
}

export interface AppealOption {
  forum: string;
  window_days: number | null;
  window_unit: "calendar" | null;
  from: "final_denial" | "denial" | "claim_of_exemption_or_last_production";
  requires: "agency_classified_commercial" | null;
  cite: string;
  note: string;
}

export interface LawRule {
  id: string;
  classes: RequesterClass[];
  applies_from: string;
  applies_until: string | null;
  first_response: DayCount;
  second_response?: DayCount & { from: "first_due" };
  extension: Extension | null;
  agency_estimate?: boolean;
  completion_note?: string;
  silence: "denial" | "unclear";
  silence_note: string;
  fees: string;
  appeals: AppealOption[];
  sources: string[];
}

export interface Law {
  id: string;
  name: string;
  request_name: string;
  citation: string;
  verification: "primary_read" | "official_summary_read" | "mirror_read" | "excerpt_only" | "unconfirmed";
  verification_note: string;
  default_class: RequesterClass;
  commercial: { disclosure: "required_if_asked" | "required_at_request" | "not_required"; basis: string; paragraph: string; lawyer: string };
  submission_rules: string[];
  rules: LawRule[];
  denial_content: string | null;
  sources: string[];
}

export interface LawFile {
  laws: Law[];
  sources: Record<string, { url: string; read: string; checked: string }>;
}

export interface Contact {
  channel: "email" | "portal" | "form" | "mail" | "phone" | "unknown";
  value: string | null;
  evidence: "read_directly" | "search_excerpt" | "unknown" | "fictional";
  source_url: string;
  checked: string;
  note?: string;
}

export interface Ask {
  key: string;
  kind: AskKind;
  subject: string;
  summary: string;
  records?: string[];
  format_note?: string;
  exclude?: string;
  sample_size: number;
  items_label?: string | null;
  items?: string[];
  narrowing?: string;
  must_keep?: string[];
  follow_on?: string | null;
  site?: string;
  access_so_far?: string;
  questions?: string[];
  fallback?: string;
}

export interface Target {
  id: string;
  place: string;
  state: string;
  law_id: string;
  agency: string;
  office: string;
  salutation: string;
  holds: string;
  why: string;
  status: "draft_ready" | "hold";
  hold_reason?: string;
  contact: Contact;
  other_contacts: Contact[];
  access: { host: string; finding: string; rule: string; source_url: string; checked: string }[];
  asks: Ask[];
  sequence?: string;
  extra_ask?: string;
  pre_send: string[];
  lawyer: string[];
  fictional?: boolean;
}

export interface TargetFile {
  purpose: string;
  targets: Target[];
}

export interface Policy {
  limits: { max_open_per_target: number; max_requests_per_target_per_180_days: number; max_sample_first_request: number };
  tracking: { due_soon_days: number; overdue_grace_business_days: number; checkin_no_fixed_deadline_business_days: number; maturity_calendar_days: number };
  learning: {
    min_closed_per_arm: number;
    min_agencies: number;
    min_states: number;
    max_counted_per_agency_per_arm: number;
    alpha: number;
    min_places_for_general_hypothesis: number;
    min_states_for_general_hypothesis: number;
    features: Record<string, { label: string; learned_text_true: string; learned_text_false: string }>;
  };
  spotcheck: { per_run: number; seed: number };
  budget: { max_usd_per_command: number; max_usd_total: number };
}

export interface Sender {
  full_name: string;
  entity: string;
  mailing_address: string;
  email: string;
  phone: string;
  fee_notice_usd: number;
  /** Only true if you will keep the promise not to resell or republish the records as a collection. */
  no_republish_promise: boolean;
}

// ---------- records ----------

export interface Features {
  sample_size: number;
  small_sample: boolean;
  named_items: boolean;
  formal_route: boolean;
  channel: string;
}

export interface RequestRecord {
  id: string;
  dataset: Dataset;
  target_id: string;
  place: string;
  state: string;
  law_id: string;
  ask_key: string;
  kind: AskKind;
  subject: string;
  sections: { summary: string; records: string[] };
  features: Features;
  rules_used: string[];
  playbook_sha: string;
  source: "model" | "template";
  gate: { status: "pending_review" | "blocked"; issues: Issue[] };
  session_id: string | null;
  created_at: string;
}

export type EventType =
  | "approved" | "rejected" | "exported"
  | "sent" | "acknowledged" | "estimate" | "extension" | "classified" | "clarification_requested" | "clarification_answered"
  | "fee_quote" | "fee_response" | "narrowed" | "partial_grant" | "records_received" | "denial" | "no_records"
  | "appeal_filed" | "appeal_decided" | "withdrawn" | "closed" | "followup_drafted";

export interface RecordsEvent {
  type: EventType;
  dataset: Dataset;
  request_id: string;
  at: string;
  date?: string; // for dates the agency set: new due date, estimate, or fee reply date
  note?: string;
  rendered_sha?: string;
  channel?: string;
  as?: RequesterClass;
  amount_usd?: number;
  count?: number;
  exemption?: string;
  final?: boolean;
  outcome?: string;
}

export interface Issue {
  severity: "block" | "flag";
  code: string;
  message: string;
}

// ---------- the home directory ----------

/** One home holds one set of playbooks and records. The real home is gov-outreach/. A test home is a scratch copy with data/DATASET saying "test". */
export interface Home {
  dir: string;
  dataset: Dataset;
  data: string;
  agent: string;
  playbook: string;
  laws: string;
  targets: string;
  policy: string;
  sender: string;
  requests: string;
  events: string;
  confirmations: string;
  rulelog: string;
  spotchecks: string;
  spend: string;
  outbox: string;
  followups: string;
  received: string;
  scrubbed: string;
  letters: string;
  intake: string;
  reports: string;
}

export function openHome(dir?: string): Home {
  const root = resolve(dir ?? option("home") ?? process.env.GOV_OUTREACH_HOME ?? GOV_DIR);
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  const marker = join(data, "DATASET");
  const dataset: Dataset = existsSync(marker) && readFileSync(marker, "utf8").trim() === "test" ? "test" : "real";
  return {
    dir: root,
    dataset,
    data,
    agent: join(root, "agent"),
    playbook: join(root, "agent", "playbook"),
    laws: join(root, "agent", "laws.json"),
    targets: join(root, "agent", "targets.json"),
    policy: join(root, "agent", "policy.json"),
    sender: join(data, "sender.json"),
    requests: join(data, "requests.jsonl"),
    events: join(data, "events.jsonl"),
    confirmations: join(data, "contact-confirmations.jsonl"),
    rulelog: join(data, "rule-log.jsonl"),
    spotchecks: join(data, "spotchecks.jsonl"),
    spend: join(data, "spend.jsonl"),
    outbox: join(data, "outbox"),
    followups: join(data, "followups"),
    received: join(data, "received"),
    scrubbed: join(data, "scrubbed"),
    letters: join(data, "letters"),
    intake: join(data, "intake.jsonl"),
    reports: join(root, "reports"),
  };
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(value) + "\n");
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** --as-of lets test data be replayed at a fixed date. */
export function now(): Date {
  const asOf = option("as-of");
  return asOf ? new Date(asOf) : new Date();
}

export function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export const loadLaws = (h: Home) => JSON.parse(readFileSync(h.laws, "utf8")) as LawFile;
export const loadTargets = (h: Home) => JSON.parse(readFileSync(h.targets, "utf8")) as TargetFile;
export const loadPolicy = (h: Home) => JSON.parse(readFileSync(h.policy, "utf8")) as Policy;
export const loadSender = (h: Home): Sender | null => (existsSync(h.sender) ? (JSON.parse(readFileSync(h.sender, "utf8")) as Sender) : null);

export function lawById(file: LawFile, id: string): Law {
  const law = file.laws.find((l) => l.id === id);
  if (!law) throw new Error(`No law data for ${id}. Add it to agent/laws.json by hand.`);
  return law;
}

export function targetById(file: TargetFile, id: string): Target {
  const t = file.targets.find((x) => x.id === id);
  if (!t) throw new Error(`No target ${id}.`);
  return t;
}

// ---------- the TrueForge agent ----------

/** Create or update the agent. It gets no tools at all, which is what "nothing is sent" rests on, so that's checked after saving. */
export async function syncAgent(tf: TrueForge, h: Home): Promise<TrueForgeApi.Agent> {
  const file = JSON.parse(readFileSync(join(h.agent, "agent.json"), "utf8")) as { name: string; description: string; model: { name: string; params?: Record<string, unknown> } };
  const manifest: TrueForgeApi.AgentSpec = {
    model: file.model,
    instructions: readFileSync(join(h.agent, "instructions.md"), "utf8").trim(),
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
  if ((data.manifest.mcpServers ?? []).length) die("The records agent has MCP servers attached. It must have no tools.");
  return data;
}

// ---------- spend ----------

export interface Ledger {
  command: string;
  usd: number;
  tokens: number;
  turns: number;
}

export const totalSpend = (h: Home) => readJsonl<{ usd: number }>(h.spend).reduce((a, r) => a + r.usd, 0);

export function startLedger(h: Home, command: string): Ledger {
  const total = totalSpend(h);
  const max = loadPolicy(h).budget.max_usd_total;
  if (total >= max) die(`This home has spent an estimated $${total.toFixed(2)}, at the $${max} limit in policy.json. Raise it deliberately to continue.`);
  return { command, usd: 0, tokens: 0, turns: 0 };
}

export class BudgetStop extends Error {}

/** One model turn with a budget check first, and its cost added to the ledger. TrueForge reports an estimated cost per turn. */
export async function billedTurn(h: Home, tf: TrueForge, sessionId: string, ledger: Ledger, prompt: string): Promise<string> {
  const max = loadPolicy(h).budget.max_usd_per_command;
  if (ledger.usd >= max) throw new BudgetStop(`Stopped: this command reached its $${max} limit (estimated $${ledger.usd.toFixed(4)}).`);
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

export function closeLedger(h: Home, ledger: Ledger, sessionId: string | null): void {
  if (ledger.turns) appendJsonl(h.spend, { at: new Date().toISOString(), command: ledger.command, session_id: sessionId, usd: ledger.usd, tokens: ledger.tokens, turns: ledger.turns });
  console.log(`Model spend for this command: ~$${ledger.usd.toFixed(4)} (${ledger.tokens} tokens, ${ledger.turns} turns). Total in this home: ~$${totalSpend(h).toFixed(4)}.`);
}

/** The last ```json block in a reply, or the whole reply, parsed. */
export function parseJsonReply<T>(text: string): T | null {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const raw = blocks.length ? blocks[blocks.length - 1][1] : text.trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
