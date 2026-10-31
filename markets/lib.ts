// Shared helpers for the market agent: its files, its policy, its spend ledger, and read-only dataset queries.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { robotsAllows } from "../outreach/research.ts";

export const MARKETS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(MARKETS_DIR, "..");
export const DATA = join(MARKETS_DIR, "data");
export const SOURCES = join(MARKETS_DIR, "sources");
export const REPORTS = join(MARKETS_DIR, "reports");
export const CANDIDATES = join(DATA, "candidates.json");
export const LEDGER = join(DATA, "spend.jsonl");
export const WORKTREES = join(REPO, ".market-worktrees");

export const USER_AGENT = "RedlineMarketScout/0.1 (+https://github.com/quindelin/corrections-agent)";

export interface Policy {
  budget: { max_usd_per_cycle: number; max_usd_per_day: number; estimated_usd_per_letter: number };
  discovery: { catalogs: string[]; queries: string[]; max_results_per_query: number; min_rows: number; min_correction_share: number; min_median_text_length: number; min_cycle_rows: number; stale_after_days: number };
  evaluation: { letters: number; min_letters: number; min_holdout_comments: number; min_discipline_labels: number; min_citation_labels: number; max_comments_per_letter: number };
  gate: { alpha: number; max_improve_attempts: number; bootstrap_samples: number; regression_margin_points: number; max_new_compliance_claims: number; max_new_failed_letters: number };
  readiness: { min_holdout_score: number; min_citation_chapter_pct: number; max_unsafe_routes: number };
  exclude: Record<string, string>;
  worktree: { mcp_port: number };
}

export function loadPolicy(): Policy {
  return JSON.parse(readFileSync(join(MARKETS_DIR, "policy.json"), "utf8")) as Policy;
}

export function readJsonFile<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// ---------- spend ----------

export interface SpendRow {
  at: string;
  place: string;
  step: string;
  usd: number;
}

export function logSpend(row: Omit<SpendRow, "at">): void {
  mkdirSync(DATA, { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
}

export function spendRows(): SpendRow[] {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as SpendRow);
}

/** Why spending `usd` more would break the budget, or null if it fits. Pure, so it's testable. */
export function overBudget(rows: SpendRow[], place: string, cycleStartedAt: string, usd: number, policy: Policy, now = new Date()): string | null {
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  const cycle = rows.filter((r) => r.place === place && r.at >= cycleStartedAt).reduce((s, r) => s + r.usd, 0);
  const day = rows.filter((r) => new Date(r.at).getTime() >= dayAgo).reduce((s, r) => s + r.usd, 0);
  if (cycle + usd > policy.budget.max_usd_per_cycle) return `this cycle has spent $${cycle.toFixed(2)}, and the next step would cost about $${usd.toFixed(2)} against the $${policy.budget.max_usd_per_cycle} cycle limit`;
  if (day + usd > policy.budget.max_usd_per_day) return `the last 24 hours have spent $${day.toFixed(2)}, and the next step would cost about $${usd.toFixed(2)} against the $${policy.budget.max_usd_per_day} daily limit`;
  return null;
}

// ---------- read-only dataset queries ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map<string, number>();

const robots = new Map<string, string | null>();

/** Why this URL can't be fetched under its host's robots.txt, or null if it can. Unreadable rules mean no fetch. */
async function robotsProblem(u: URL): Promise<string | null> {
  if (!robots.has(u.origin)) {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res) return `robots.txt unreachable at ${u.origin}, so not fetching`;
    if (res.status === 404 || res.status === 410) robots.set(u.origin, null);
    else if (res.ok) robots.set(u.origin, await res.text());
    else return `robots.txt returned ${res.status} at ${u.origin}, so not fetching`;
  }
  const rules = robots.get(u.origin);
  return rules && !robotsAllows(rules, u.pathname + u.search, "redlinemarketscout") ? `robots.txt disallows ${u.pathname} at ${u.origin}` : null;
}

/** One polite GET. Honors robots.txt, waits a second between calls to a host, and doesn't retry a refusal or try to get around one. */
export async function getJson<T>(url: string): Promise<T> {
  const parsed = new URL(url);
  const refused = await robotsProblem(parsed);
  if (refused) throw new Error(refused);
  const host = parsed.host;
  const wait = (lastHit.get(host) ?? 0) + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as T;
}

export function soql(domain: string, dataset: string, params: Record<string, string | number>): string {
  const query = Object.entries(params).map(([k, v]) => `$${k}=${encodeURIComponent(String(v))}`).join("&");
  return `https://${domain}/resource/${dataset}.json?${query}`;
}

export const quoteSoql = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const median = (xs: number[]): number | null => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
