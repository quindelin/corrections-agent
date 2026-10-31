// Agent runs can outlast a proxied request, so a run returns a job id right away and the client polls, possibly
// through a different instance. A job keeps only a report's id, never its contents. Each poll builds the view from
// the report as it is now, so a job can't hold a copy of a letter or show anything the report's lock wouldn't.

import { newReportId, publicView } from "./reports.ts";
import { getStore, type Store } from "./store.ts";

export const HEARTBEAT_MS = 30_000;
/** A running job with no recent heartbeat lost its instance, so it will never finish. */
export const STALE_JOB_MS = 150_000;
const MAX_ERROR_CHARS = 500;

export interface JobOutcome {
  status: number;
  value: { report_id: string } | { stop: string; message: string } | { error: string };
}

export async function startJob(work: () => Promise<JobOutcome>, store?: Store): Promise<string> {
  const s = store ?? (await getStore());
  const id = newReportId();
  // Recorded before the id goes out, because the client's first poll may reach another instance.
  await s.createJob(id);
  const heartbeat = setInterval(() => void s.heartbeatJob(id).catch(() => {}), HEARTBEAT_MS);
  heartbeat.unref();
  void (async () => {
    let outcome: JobOutcome;
    try {
      outcome = await work();
    } catch (e) {
      outcome = { status: 500, value: { error: String((e as Error).message).slice(0, MAX_ERROR_CHARS) } };
    }
    clearInterval(heartbeat);
    try {
      await s.finishJob(id, outcome.status, outcome.value);
    } catch (e) {
      // With the heartbeat stopped, pollers will see this job as interrupted.
      console.error(`Couldn't save a job's result: ${(e as Error).message}`);
    }
  })();
  return id;
}

const NOT_FOUND = { status: 404, body: { error: "Job not found. Try running the letter again." } };

export async function jobResponse(id: string, store?: Store, now = Date.now()): Promise<{ status: number; body: unknown }> {
  const s = store ?? (await getStore());
  const job = await s.getJob(id);
  if (!job) return NOT_FOUND;
  if (job.status === "running") {
    if (Date.parse(job.heartbeat_at) > now - STALE_JOB_MS) return { status: 200, body: { status: "running" } };
    return { status: 500, body: { error: "That run was interrupted. Try running the letter again." } };
  }
  const value = job.value as { report_id?: unknown } | null;
  if (job.code !== 200) return { status: job.code, body: value };
  if (typeof value?.report_id !== "string") return { status: 200, body: { status: "done", result: value } };
  const report = await s.getReport(value.report_id);
  return report ? { status: 200, body: { status: "done", result: publicView(report) } } : NOT_FOUND;
}
