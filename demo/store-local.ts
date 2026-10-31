// The local-file backend: one process on one machine. Each operation runs without yielding between its read and its
// write, so it's atomic within the process, and writes go through a rename, so a crash can't leave half a file.
// Report files keep the format they've always had, so existing reports still load.

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Report } from "./reports.ts";
import { ID_PATTERN, isExpired, JOB_TTL_MS, keepIdentity, mergePaymentFact, PAYMENT_ID_PATTERN, retentionDays, type JobRecord, type PaymentRecord, type PurgeCounts, type Store, type StoreOptions, type WaitlistEntry } from "./store.ts";

interface JobFile {
  status: "running" | "done";
  code?: number;
  value?: unknown;
  heartbeat_at: string;
  expires_at: string;
}

const REPORT_FILE = /^[a-f0-9]{32}\.json$/;
const TMP_MAX_AGE_MS = 3_600_000;

export function createLocalStore(dir: string, options: StoreOptions = {}): Store {
  const reportsDir = join(dir, "reports");
  const jobsDir = join(dir, "jobs");
  const paymentsDir = join(dir, "payments");
  const rateFile = join(dir, "rate-limits.json");
  const waitlistFile = join(dir, "waitlist.jsonl");
  const retentionMs = (options.retentionDays ?? retentionDays()) * 86_400_000;
  const now = options.now ?? Date.now;

  const write = (file: string, data: string) => {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, file);
  };
  const reportFile = (id: string) => join(reportsDir, `${id}.json`);
  const jobFile = (id: string) => join(jobsDir, `${id}.json`);
  const paymentFile = (id: string) => join(paymentsDir, `${id}.json`);
  const paymentFiles = () => (existsSync(paymentsDir) ? readdirSync(paymentsDir).filter((f) => f.endsWith(".json")).map((f) => join(paymentsDir, f)) : []);
  const readJson = <T>(file: string): T | null => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch {
      return null; // missing or unreadable
    }
  };
  const live = (id: string): Report | null => {
    if (!ID_PATTERN.test(id)) return null;
    const report = readJson<Report>(reportFile(id));
    return report && !isExpired(report.created_at, now(), retentionMs) ? report : null;
  };
  const reportIds = () => (existsSync(reportsDir) ? readdirSync(reportsDir).filter((f) => REPORT_FILE.test(f)).map((f) => f.slice(0, 32)) : []);
  const readRates = () => readJson<Record<string, number[]>>(rateFile) ?? {};
  const liveJob = (id: string): JobFile | null => {
    if (!ID_PATTERN.test(id)) return null;
    const job = readJson<JobFile>(jobFile(id));
    return job && Date.parse(job.expires_at) > now() ? job : null;
  };
  /** A crash mid-write can leave a temp file that holds a copy of a letter, which retention must also cover. */
  const removeOldTemp = (folder: string) => {
    if (!existsSync(folder)) return;
    for (const f of readdirSync(folder)) {
      const file = join(folder, f);
      if (f.endsWith(".tmp") && statSync(file).mtimeMs < now() - TMP_MAX_AGE_MS) rmSync(file, { force: true });
    }
  };

  return {
    kind: "local",

    async createReport(report) {
      if (!ID_PATTERN.test(report.id)) throw new Error("Bad report id.");
      if (existsSync(reportFile(report.id))) throw new Error("That report already exists.");
      write(reportFile(report.id), JSON.stringify(report));
    },
    getReport: async (id) => live(id),
    async updateReport(id, change) {
      const current = live(id);
      if (!current) return null;
      const next = keepIdentity(current, change(current));
      write(reportFile(id), JSON.stringify(next));
      return next;
    },
    async deleteReport(id) {
      if (!ID_PATTERN.test(id) || !existsSync(reportFile(id))) return false;
      rmSync(reportFile(id), { force: true });
      return true;
    },
    async permitUnlocked(permit) {
      return reportIds().some((id) => {
        const report = live(id);
        return report?.unlocked === true && report.permit_number === permit;
      });
    },
    async unlockedOnPermit(permit) {
      return reportIds().flatMap((id) => {
        const report = live(id);
        return report?.unlocked === true && report.permit_number === permit ? [{ id: report.id, unlocked_by: report.unlocked_by }] : [];
      });
    },

    async mergePayment(fact) {
      if (!PAYMENT_ID_PATTERN.test(fact.id)) throw new Error("Bad payment id.");
      const next = mergePaymentFact(readJson<PaymentRecord>(paymentFile(fact.id)), fact, new Date(now()).toISOString());
      write(paymentFile(fact.id), JSON.stringify(next));
      return next;
    },
    getPayment: async (id) => (PAYMENT_ID_PATTERN.test(id) ? readJson<PaymentRecord>(paymentFile(id)) : null),
    async reportHasActivePayment(reportId) {
      return paymentFiles().some((file) => {
        const payment = readJson<PaymentRecord>(file);
        return payment?.report_id === reportId && Boolean(payment.paid_at) && !payment.refunded_at;
      });
    },

    async purgeExpired() {
      const counts: PurgeCounts = { reports: 0, jobs: 0, rateLimits: 0, payments: 0 };
      for (const id of reportIds()) {
        const report = readJson<Report>(reportFile(id));
        // An unreadable file has no date inside it, so its age comes from the file itself.
        const expired = report ? isExpired(report.created_at, now(), retentionMs) : statSync(reportFile(id)).mtimeMs <= now() - retentionMs;
        if (expired) {
          rmSync(reportFile(id), { force: true });
          counts.reports++;
        }
      }
      if (existsSync(jobsDir)) {
        for (const f of readdirSync(jobsDir).filter((name) => REPORT_FILE.test(name))) {
          if (!liveJob(f.slice(0, 32))) {
            rmSync(join(jobsDir, f), { force: true });
            counts.jobs++;
          }
        }
      }
      for (const file of paymentFiles()) {
        const payment = readJson<PaymentRecord>(file);
        if (payment ? isExpired(payment.created_at, now(), retentionMs) : statSync(file).mtimeMs <= now() - retentionMs) {
          rmSync(file, { force: true });
          counts.payments++;
        }
      }
      removeOldTemp(paymentsDir);
      removeOldTemp(reportsDir);
      removeOldTemp(jobsDir);
      removeOldTemp(dir);
      const rates = readRates();
      // A hit only counts inside its window, and the longest window in use is an hour.
      const kept = Object.entries(rates).filter(([, hits]) => hits.some((t) => t > now() - 3_600_000));
      counts.rateLimits = Object.keys(rates).length - kept.length;
      if (counts.rateLimits) write(rateFile, JSON.stringify(Object.fromEntries(kept)));
      return counts;
    },

    async createJob(id) {
      if (!ID_PATTERN.test(id)) throw new Error("Bad job id.");
      const job: JobFile = { status: "running", heartbeat_at: new Date(now()).toISOString(), expires_at: new Date(now() + JOB_TTL_MS).toISOString() };
      write(jobFile(id), JSON.stringify(job));
    },
    async heartbeatJob(id) {
      const job = liveJob(id);
      if (job?.status === "running") write(jobFile(id), JSON.stringify({ ...job, heartbeat_at: new Date(now()).toISOString() }));
    },
    async finishJob(id, code, value) {
      const job = liveJob(id);
      if (job?.status === "running") write(jobFile(id), JSON.stringify({ ...job, status: "done", code, value, heartbeat_at: new Date(now()).toISOString() }));
    },
    async getJob(id): Promise<JobRecord | null> {
      const job = liveJob(id);
      if (!job) return null;
      return job.status === "running" ? { status: "running", heartbeat_at: job.heartbeat_at } : { status: "done", code: job.code ?? 500, value: job.value ?? null, heartbeat_at: job.heartbeat_at };
    },

    async hitRateLimit(keyHash, limit, windowMs) {
      const rates = readRates();
      const recent = (rates[keyHash] ?? []).filter((t) => t > now() - windowMs);
      if (recent.length >= limit) return false;
      rates[keyHash] = [...recent, now()];
      write(rateFile, JSON.stringify(rates));
      return true;
    },

    async addWaitlist(entry) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      appendFileSync(waitlistFile, JSON.stringify({ at: entry.at, email: entry.email, place: entry.place, reason: entry.reason }) + "\n", { mode: 0o600 });
    },
    async listWaitlist() {
      if (!existsSync(waitlistFile)) return [];
      return readFileSync(waitlistFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as WaitlistEntry);
    },

    close: async () => {},
  };
}
