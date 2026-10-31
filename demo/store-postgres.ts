// The Postgres backend, for several instances. Each change is one statement guarded by a version check, so two
// instances can't overwrite each other: the loser changes nothing, reads the new version and tries again.
// Times come from the instance's clock, so instances should keep their clocks in sync.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Report } from "./reports.ts";
import { ID_PATTERN, JOB_TTL_MS, keepIdentity, retentionDays, type JobRecord, type Store, type StoreOptions, type WaitlistEntry } from "./store.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const MAX_ATTEMPTS = 12;
const MIGRATION_LOCK = 727_274_001;

/**
 * Postgres rejects two things that real letters can contain: NUL characters (PDF text) and half an emoji, which
 * the service's .slice() limits can produce. Remove NULs and replace broken pairs, so a letter can't fail on save.
 */
export function cleanText(text: string): string {
  return text.replaceAll("\u0000", "").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "�");
}
export const toJsonb = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === "string" ? cleanText(v) : v));

const iso = (value: Date | string) => new Date(value).toISOString();
const pause = (attempt: number) => sleep(Math.random() * 5 * (attempt + 1));

export function createPostgresStore(connectionString: string, options: StoreOptions = {}): Store {
  const pool = new pg.Pool({ connectionString, max: 5 });
  // Without a listener, losing an idle connection would crash the process.
  pool.on("error", (e) => console.error(`Postgres connection error: ${e.message}`));
  const retentionMs = (options.retentionDays ?? retentionDays()) * 86_400_000;
  const now = options.now ?? Date.now;
  const cutoff = () => new Date(now() - retentionMs).toISOString();
  const nowIso = () => new Date(now()).toISOString();

  return {
    kind: "postgres",

    async createReport(report) {
      if (!ID_PATTERN.test(report.id)) throw new Error("Bad report id.");
      await pool.query("INSERT INTO redline_reports (id, doc, permit_number, unlocked, created_at) VALUES ($1, $2::jsonb, $3, $4, $5)", [
        report.id,
        toJsonb(report),
        report.permit_number === null ? null : cleanText(report.permit_number),
        report.unlocked,
        report.created_at,
      ]);
    },
    async getReport(id) {
      if (!ID_PATTERN.test(id)) return null;
      const { rows } = await pool.query<{ doc: Report }>("SELECT doc FROM redline_reports WHERE id = $1 AND created_at > $2", [id, cutoff()]);
      return rows[0]?.doc ?? null;
    },
    async updateReport(id, change) {
      if (!ID_PATTERN.test(id)) return null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { rows } = await pool.query<{ doc: Report; version: number }>("SELECT doc, version FROM redline_reports WHERE id = $1 AND created_at > $2", [id, cutoff()]);
        if (!rows[0]) return null;
        const next = keepIdentity(rows[0].doc, change(rows[0].doc));
        // An UPDATE, never an upsert, so a change that races a delete can't bring the report back.
        const result = await pool.query("UPDATE redline_reports SET doc = $1::jsonb, permit_number = $2, unlocked = $3, version = version + 1 WHERE id = $4 AND version = $5", [
          toJsonb(next),
          next.permit_number === null ? null : cleanText(next.permit_number),
          next.unlocked,
          id,
          rows[0].version,
        ]);
        if (result.rowCount === 1) return next;
        await pause(attempt);
      }
      throw new Error("That report is busy. Try again.");
    },
    async deleteReport(id) {
      if (!ID_PATTERN.test(id)) return false;
      const result = await pool.query("DELETE FROM redline_reports WHERE id = $1", [id]);
      return result.rowCount === 1;
    },
    async permitUnlocked(permit) {
      const { rows } = await pool.query("SELECT 1 FROM redline_reports WHERE unlocked AND permit_number = $1 AND created_at > $2 LIMIT 1", [cleanText(permit), cutoff()]);
      return rows.length > 0;
    },
    async purgeExpired() {
      const reports = await pool.query("DELETE FROM redline_reports WHERE created_at <= $1", [cutoff()]);
      const jobs = await pool.query("DELETE FROM redline_jobs WHERE expires_at <= $1", [nowIso()]);
      const rateLimits = await pool.query("DELETE FROM redline_rate_limits WHERE expires_at <= $1", [nowIso()]);
      return { reports: reports.rowCount ?? 0, jobs: jobs.rowCount ?? 0, rateLimits: rateLimits.rowCount ?? 0 };
    },

    async createJob(id) {
      if (!ID_PATTERN.test(id)) throw new Error("Bad job id.");
      await pool.query("INSERT INTO redline_jobs (id, status, created_at, heartbeat_at, expires_at) VALUES ($1, 'running', $2, $2, $3)", [id, nowIso(), new Date(now() + JOB_TTL_MS).toISOString()]);
    },
    async heartbeatJob(id) {
      await pool.query("UPDATE redline_jobs SET heartbeat_at = $1 WHERE id = $2 AND status = 'running'", [nowIso(), id]);
    },
    async finishJob(id, code, value) {
      await pool.query("UPDATE redline_jobs SET status = 'done', code = $1, value = $2::jsonb, heartbeat_at = $3 WHERE id = $4 AND status = 'running'", [code, toJsonb(value), nowIso(), id]);
    },
    async getJob(id): Promise<JobRecord | null> {
      if (!ID_PATTERN.test(id)) return null;
      const { rows } = await pool.query<{ status: "running" | "done"; code: number | null; value: unknown; heartbeat_at: Date }>(
        "SELECT status, code, value, heartbeat_at FROM redline_jobs WHERE id = $1 AND expires_at > $2",
        [id, nowIso()],
      );
      const job = rows[0];
      if (!job) return null;
      const heartbeat_at = iso(job.heartbeat_at);
      return job.status === "running" ? { status: "running", heartbeat_at } : { status: "done", code: job.code ?? 500, value: job.value, heartbeat_at };
    },

    async hitRateLimit(keyHash, limit, windowMs) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const time = now();
        const { rows } = await pool.query<{ hits: number[]; version: number }>("SELECT hits, version FROM redline_rate_limits WHERE key_hash = $1", [keyHash]);
        const recent = (rows[0]?.hits ?? []).filter((t) => t > time - windowMs);
        if (recent.length >= limit) return false;
        const hits = JSON.stringify([...recent, time]);
        const expires = new Date(time + windowMs).toISOString();
        const result = rows[0]
          ? await pool.query("UPDATE redline_rate_limits SET hits = $1::jsonb, expires_at = $2, version = version + 1 WHERE key_hash = $3 AND version = $4", [hits, expires, keyHash, rows[0].version])
          : await pool.query("INSERT INTO redline_rate_limits (key_hash, hits, expires_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key_hash) DO NOTHING", [keyHash, hits, expires]);
        if (result.rowCount === 1) return true;
        await pause(attempt);
      }
      return false; // Can't confirm the hit was counted, and a free run spends model credit, so say no.
    },

    async addWaitlist(entry) {
      await pool.query("INSERT INTO redline_waitlist (at, email, place, reason) VALUES ($1, $2, $3, $4)", [entry.at, cleanText(entry.email), cleanText(entry.place), cleanText(entry.reason)]);
    },
    async listWaitlist() {
      const { rows } = await pool.query<Omit<WaitlistEntry, "at"> & { at: Date }>("SELECT at, email, place, reason FROM redline_waitlist ORDER BY id");
      return rows.map((r) => ({ at: iso(r.at), email: r.email, place: r.place, reason: r.reason }));
    },

    close: () => pool.end(),
  };
}

/** Applies each new .sql file, in name order, in one transaction. The lock lets instances start at the same time. */
export async function applyMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query("CREATE TABLE IF NOT EXISTS redline_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      const { rows } = await client.query("SELECT 1 FROM redline_migrations WHERE name = $1", [name]);
      if (rows.length) continue;
      await client.query(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
      await client.query("INSERT INTO redline_migrations (name) VALUES ($1)", [name]);
      applied.push(name);
    }
    await client.query("COMMIT");
    return applied;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
