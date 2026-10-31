// Where Redline keeps its state. Local files by default, so `npm run demo` needs no setup. Postgres when
// DATABASE_URL is set, which is what several instances need: the local backend is safe for one process only.

import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/lib.ts";
import type { Report } from "./reports.ts";

export const DEFAULT_RETENTION_DAYS = 90;
/** A job is forgotten an hour after it starts, finished or not. Its report is saved separately. */
export const JOB_TTL_MS = 3_600_000;
export const ID_PATTERN = /^[a-f0-9]{32}$/;
/** Stripe's own ids, such as pi_ and cs_test_. Checked because the local backend makes file names from them. */
export const PAYMENT_ID_PATTERN = /^[\w-]{1,255}$/;

export interface WaitlistEntry {
  at: string;
  email: string;
  place: string;
  reason: string;
}

export type JobRecord = { status: "running"; heartbeat_at: string } | { status: "done"; code: number; value: unknown; heartbeat_at: string };

export interface PurgeCounts {
  reports: number;
  jobs: number;
  rateLimits: number;
  payments: number;
}

/** One payment, as far as Stripe's events have told us. It counts while paid_at is set and refunded_at isn't. */
export interface PaymentRecord {
  /** The PaymentIntent id, which is the only thing a charge and a Checkout Session have in common. */
  id: string;
  session_id: string | null;
  report_id: string | null;
  amount_total: number | null;
  amount_refunded: number;
  currency: string | null;
  livemode: boolean | null;
  paid_at: string | null;
  refunded_at: string | null;
  created_at: string;
}

/** What one event says about a payment. Anything left out is simply not known by this event. */
export interface PaymentFact {
  id: string;
  session_id?: string | null;
  report_id?: string | null;
  amount_total?: number | null;
  amount_refunded?: number;
  currency?: string | null;
  livemode?: boolean | null;
  paid?: boolean;
  refunded?: boolean;
}

/**
 * First value wins, and the refunded amount only grows, so facts can be merged in any order, any number of times, with
 * the same result. Nothing clears refunded_at, which is why no later event can undo a refund. Postgres does the same
 * in one statement in store-postgres.ts.
 */
export function mergePaymentFact(prior: PaymentRecord | null, fact: PaymentFact, at: string): PaymentRecord {
  return {
    id: fact.id,
    session_id: prior?.session_id ?? fact.session_id ?? null,
    report_id: prior?.report_id ?? fact.report_id ?? null,
    amount_total: prior?.amount_total ?? fact.amount_total ?? null,
    amount_refunded: Math.max(prior?.amount_refunded ?? 0, fact.amount_refunded ?? 0),
    currency: prior?.currency ?? fact.currency ?? null,
    livemode: prior?.livemode ?? fact.livemode ?? null,
    paid_at: prior?.paid_at ?? (fact.paid ? at : null),
    refunded_at: prior?.refunded_at ?? (fact.refunded ? at : null),
    created_at: prior?.created_at ?? at,
  };
}

export interface Store {
  readonly kind: "local" | "postgres";
  /** Fails if the id already exists. There is deliberately no blind overwrite: all changes go through updateReport. */
  createReport(report: Report): Promise<void>;
  /** Null when missing or past retention, even if the purge hasn't run yet. */
  getReport(id: string): Promise<Report | null>;
  /** Applies change to the latest version, atomically. Change can run more than once, so it must have no side effects. Null when missing or past retention. */
  updateReport(id: string, change: (current: Report) => Report): Promise<Report | null>;
  /** True if a report was deleted. */
  deleteReport(id: string): Promise<boolean>;
  permitUnlocked(permit: string): Promise<boolean>;
  /** The unlocked, unexpired reports on a permit, and why each one is unlocked. */
  unlockedOnPermit(permit: string): Promise<{ id: string; unlocked_by: Report["unlocked_by"] }[]>;

  /** Merges a fact into the ledger atomically and returns the result. See mergePaymentFact. Throws on a malformed id. */
  mergePayment(fact: PaymentFact): Promise<PaymentRecord>;
  getPayment(id: string): Promise<PaymentRecord | null>;
  /** True if any payment for this report is paid and not refunded. */
  reportHasActivePayment(reportId: string): Promise<boolean>;

  /** Deletes everything past its limit. Safe to run on several instances at once. */
  purgeExpired(): Promise<PurgeCounts>;

  createJob(id: string): Promise<void>;
  heartbeatJob(id: string): Promise<void>;
  finishJob(id: string, code: number, value: unknown): Promise<void>;
  getJob(id: string): Promise<JobRecord | null>;

  /** Records a hit and returns true, or returns false if limit hits are already inside the window. */
  hitRateLimit(keyHash: string, limit: number, windowMs: number): Promise<boolean>;

  addWaitlist(entry: WaitlistEntry): Promise<void>;
  listWaitlist(): Promise<WaitlistEntry[]>;

  close(): Promise<void>;
}

export interface StoreOptions {
  retentionDays?: number;
  now?: () => number;
}

/** Bad values fall back to the default. A typo must not expire every report, or keep them forever. */
export function retentionDays(raw = process.env.REDLINE_RETENTION_DAYS): number {
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  if (Number.isFinite(days) && days > 0) return days;
  console.warn(`Ignoring REDLINE_RETENTION_DAYS (not a positive number). Using ${DEFAULT_RETENTION_DAYS} days.`);
  return DEFAULT_RETENTION_DAYS;
}

/** A date that can't be read counts as expired: confidential text shouldn't outlive the limit because of a bad value. */
export function isExpired(createdAt: string, now: number, retentionMs: number): boolean {
  const created = Date.parse(createdAt);
  return !Number.isFinite(created) || created <= now - retentionMs;
}

/** No change can rename a report or restart its retention clock. */
export const keepIdentity = (current: Report, next: Report): Report => ({ ...next, id: current.id, created_at: current.created_at });

export const dataDir = () => process.env.REDLINE_DATA_DIR || join(ROOT, ".cache");

let store: Promise<Store> | null = null;

export function getStore(): Promise<Store> {
  store ??= (async () => {
    const options = { retentionDays: retentionDays() };
    const url = process.env.DATABASE_URL;
    if (url) return (await import("./store-postgres.ts")).createPostgresStore(url, options);
    return (await import("./store-local.ts")).createLocalStore(dataDir(), options);
  })();
  return store;
}

// ---------- rate limit keys ----------

/** The local key lives beside the data. It's only for a single machine's demo. Services should set a shared secret. */
function localSecret(): string {
  const dir = dataDir();
  const file = join(dir, "rate-limit.key");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return readFileSync(file, "utf8");
}

/** Every instance must get the same value, or a client's hits wouldn't add up across them. */
const rateLimitSecret = () => process.env.REDLINE_RATE_LIMIT_SECRET || process.env.REDLINE_API_KEY || process.env.DATABASE_URL || localSecret();

/**
 * The client is an IP address, which today is only held in memory. It's keyed and hashed before any backend sees it,
 * so durable rate limits don't store addresses.
 */
export const hashClient = (client: string, secret = rateLimitSecret()) => createHmac("sha256", secret).update(client).digest("hex");

export async function allowFreeRun(client: string, limit: number, s?: Store): Promise<boolean> {
  return (s ?? (await getStore())).hitRateLimit(hashClient(client), limit, 3_600_000);
}

// ---------- maintenance ----------

/** Purges at startup and hourly. Logs counts only, never ids or letter text. */
export function startMaintenance(): void {
  const run = async () => {
    try {
      const counts = await (await getStore()).purgeExpired();
      if (counts.reports) console.log(`Retention: deleted ${counts.reports} expired report(s).`);
    } catch (e) {
      console.error(`Storage maintenance failed: ${(e as Error).message}. If Postgres is new, run: npm run store -- migrate`);
    }
  };
  void run();
  setInterval(run, 3_600_000).unref();
}
