// npm run test:demo
// Runs the real server over HTTP, with no network beyond the database (see test-no-network.ts). So this covers the
// routes and the paywall, but not a successful agent run.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { earnsFreeRound } from "./reports.ts";
import { createLocalStore } from "./store-local.ts";
import { createPostgresStore } from "./store-postgres.ts";
import type { Store } from "./store.ts";
import { fixtureReport, freePorts, LOCKED_SECRETS, newId, startPostgresStandIn } from "./test-support.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [LOCAL_PORT, INSTANCE_A, INSTANCE_B, DB_PORT, CLI_DB_PORT, DEAD_PORT] = await freePorts(6);
const DEAD_TRUEFORGE = `http://127.0.0.1:${DEAD_PORT}`;

async function startServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./demo/test-no-network.ts", "demo/server.ts"], {
    cwd: ROOT,
    // Empty values also win over a developer's .env, so a test can't reach a real database or payment account.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DEMO_PORT: String(port), TRUEFORGE_BASE_URL: DEAD_TRUEFORGE, TRUEFORGE_TOKEN: "", DATABASE_URL: "", STRIPE_PAYMENT_LINK: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", REDLINE_API_KEY: "", ...env },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    const up = await fetch(`http://127.0.0.1:${port}/api/offer`, { headers: { "x-redline-key": env.REDLINE_API_KEY ?? "" } }).catch(() => null);
    if (up?.ok) return child;
    await sleep(200);
  }
  child.kill();
  throw new Error(`The server on ${port} didn't start.`);
}

function client(port: number, key = "") {
  const headers = { "content-type": "application/json", "x-redline-key": key };
  return {
    get: (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { headers }),
    post: (path: string, body: unknown = {}, extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }),
  };
}

/** The whole paywall, over HTTP. reader and writer are different instances when the backend allows it. */
async function checkPaywall(store: Store, writer: ReturnType<typeof client>, reader: ReturnType<typeof client>, port: number) {
  const report = fixtureReport();
  await store.createReport(report);
  const job = newId();
  await store.createJob(job);
  await store.finishJob(job, 200, { report_id: report.id });

  for (const path of [`/api/report/${report.id}`, `/api/job/${job}`]) {
    const res = await reader.get(path);
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const secret of LOCKED_SECRETS) assert.ok(!text.includes(secret), `${secret} leaked from ${path}`);
    assert.ok(text.includes("DRAFT-C1"));
  }
  const decision = { comment: "C4", decision: "approve", note: "" };
  assert.equal((await reader.get(`/api/report/${report.id}/export`)).status, 402);
  assert.equal((await writer.post(`/api/report/${report.id}/review`, decision)).status, 402);
  assert.equal((await writer.post(`/api/report/${report.id}/optin`, { opt_in: true })).status, 402);
  assert.equal((await writer.post(`/api/report/${report.id}/unlock`, {})).status, 400, "the terms must be agreed to");
  const forged = await fetch(`http://127.0.0.1:${port}/paid?session_id=cs_forged`, { redirect: "manual" });
  assert.equal(forged.headers.get("location"), "/start?payment=failed");
  assert.equal((await store.getReport(report.id))?.unlocked, false, "a made-up Stripe session unlocks nothing");

  const unlocked = await writer.post(`/api/report/${report.id}/unlock`, { design_partner: true });
  assert.equal(unlocked.status, 200);
  const text = await (await reader.get(`/api/report/${report.id}`)).text();
  for (const secret of LOCKED_SECRETS) assert.ok(text.includes(secret), `${secret} should show once unlocked`);
  const reviewed = await reader.post(`/api/report/${report.id}/review`, decision);
  assert.equal(reviewed.status, 200);
  const exported = await writer.get(`/api/report/${report.id}/export`);
  assert.equal(exported.status, 200);
  assert.ok((await exported.text()).includes("DRAFT-C5"));
  const after = (await store.getReport(report.id))!;
  assert.equal(after.unlocked, true);
  assert.equal(after.decisions.C4.decision, "approve");
}

const runBody = { jurisdiction: "chicago", comments: [{ heading: "Zoning", text: "Fix the setback." }], permit_number: "RUN-1" };

describe("server on local files, as npm run demo runs it", () => {
  let dir = "";
  let server: ChildProcess;
  let store: Store;
  const http = client(LOCAL_PORT);
  const oldReport = fixtureReport({ created_at: new Date(Date.now() - 91 * 86_400_000).toISOString(), project: "OLD-LETTER" });
  const existing = fixtureReport();

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "redline-server-"));
    mkdirSync(join(dir, "reports"));
    // Written the way the previous version wrote them.
    for (const r of [oldReport, existing]) writeFileSync(join(dir, "reports", `${r.id}.json`), JSON.stringify(r));
    server = await startServer(LOCAL_PORT, { REDLINE_DATA_DIR: dir });
    store = createLocalStore(dir);
  });
  after(() => {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the customer flow", async () => {
    assert.equal((await http.get("/start")).status, 200);
    assert.equal(((await (await http.get("/api/offer")).json()) as { payments: boolean }).payments, false);
  });

  it("still opens a report saved before this change, and purged the expired one at startup", async () => {
    assert.equal((await http.get(`/api/report/${existing.id}`)).status, 200);
    assert.equal((await http.get(`/api/report/${oldReport.id}`)).status, 404);
    await sleep(200);
    assert.equal(existsSync(join(dir, "reports", `${oldReport.id}.json`)), false);
  });

  it("holds the paywall", () => checkPaywall(store, http, http, LOCAL_PORT));

  it("adds to the waitlist file", async () => {
    assert.equal((await http.post("/api/waitlist", { email: "not an email" })).status, 400);
    assert.equal((await http.post("/api/waitlist", { email: "a@example.com", place: "Boise", reason: "uncovered", phone: "555" })).status, 200);
    const [entry] = readFileSync(join(dir, "waitlist.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(Object.keys(entry).sort(), ["at", "email", "place", "reason"]);
  });

  it("rate limits runs, and a run's failure reaches the poller", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await http.post("/api/start/run", runBody);
      assert.equal(res.status, 202);
      ids.push(((await res.json()) as { job_id: string }).job_id);
    }
    const final = async (id: string) => {
      for (let i = 0; i < 150; i++) {
        const res = await http.get(`/api/job/${id}`);
        const body = (await res.json()) as { status?: string };
        if (body.status !== "running") return res.status;
        await sleep(200);
      }
      throw new Error("The job never finished.");
    };
    const codes = await Promise.all(ids.map(final));
    assert.equal(codes.filter((c) => c === 429).length, 1, codes.join());
    assert.equal(codes.filter((c) => c === 503).length, 6, codes.join());
    const held = readFileSync(join(dir, "rate-limits.json"), "utf8");
    assert.ok(!held.includes("127.0.0.1"), "no address on disk");
  });
});

describe("two server instances on Postgres, with a service key", () => {
  let standIn: Awaited<ReturnType<typeof startPostgresStandIn>>;
  let servers: ChildProcess[] = [];
  let store: Store;
  const KEY = "test-service-key";
  const a = client(INSTANCE_A, KEY);
  const b = client(INSTANCE_B, KEY);
  const scratch = mkdtempSync(join(tmpdir(), "redline-pg-server-"));
  const expiredAtStart = fixtureReport({ created_at: new Date(Date.now() - 91 * 86_400_000).toISOString(), project: "OLD-LETTER" });

  before(async () => {
    standIn = await startPostgresStandIn(DB_PORT);
    store = createPostgresStore(standIn.url);
    await store.createReport(expiredAtStart);
    const env = { DATABASE_URL: standIn.url, REDLINE_API_KEY: KEY, REDLINE_DATA_DIR: scratch };
    servers = [await startServer(INSTANCE_A, env), await startServer(INSTANCE_B, env)];
  });
  after(async () => {
    servers.forEach((s) => s.kill());
    await store.close();
    await standIn.stop();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("requires the key", async () => {
    assert.equal((await client(INSTANCE_A).get("/api/offer")).status, 401);
  });

  it("holds the paywall when one instance writes and the other reads", () => checkPaywall(store, a, b, INSTANCE_B));

  it("hides and purges an expired report", async () => {
    const { rows } = await standIn.admin.query("SELECT id FROM redline_reports WHERE id = $1", [expiredAtStart.id]);
    assert.deepEqual(rows, [], "purged when the instances started");
    const report = fixtureReport({ created_at: new Date(Date.now() - 91 * 86_400_000).toISOString() });
    await store.createReport(report);
    assert.equal((await a.get(`/api/report/${report.id}`)).status, 404, "hidden before the next purge");
  });

  it("shares the waitlist", async () => {
    assert.equal((await a.post("/api/waitlist", { email: "shared@example.com", place: "Boise", reason: "uncovered" })).status, 200);
    assert.ok((await store.listWaitlist()).some((e) => e.email === "shared@example.com"));
  });

  it("counts a client's runs across instances, polls across instances, and stores no address", async () => {
    const address = "203.0.113.9";
    const results = await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const res = await (i % 2 ? a : b).post("/api/start/run", runBody, { "x-redline-client": address });
      const { job_id } = (await res.json()) as { job_id: string };
      return { job_id, poll: i % 2 ? b : a };
    }));
    const codes = await Promise.all(results.map(async ({ job_id, poll }) => {
      for (let i = 0; i < 150; i++) {
        const res = await poll.get(`/api/job/${job_id}`);
        const body = (await res.json()) as { status?: string };
        if (body.status !== "running") return res.status;
        await sleep(200);
      }
      throw new Error("The job never finished.");
    }));
    assert.equal(codes.filter((c) => c === 429).length, 2, codes.join());
    assert.equal(codes.filter((c) => c === 503).length, 6, codes.join());
    const { rows } = await standIn.admin.query("SELECT * FROM redline_rate_limits");
    assert.ok(rows.length >= 1);
    assert.ok(!JSON.stringify(rows).includes(address));
  });

  it("keeps state after every instance restarts", async () => {
    const report = fixtureReport();
    await store.createReport(report);
    assert.equal((await a.post(`/api/report/${report.id}/unlock`, { design_partner: true })).status, 200);
    servers.forEach((s) => s.kill());
    const env = { DATABASE_URL: standIn.url, REDLINE_API_KEY: KEY, REDLINE_DATA_DIR: scratch };
    servers = [await startServer(INSTANCE_A, env)];
    const view = (await (await a.get(`/api/report/${report.id}`)).json()) as { unlocked: boolean };
    assert.equal(view.unlocked, true);
  });

  it("writes nothing to local files", () => {
    for (const file of ["reports", "jobs", "payments", "rate-limits.json", "waitlist.jsonl"]) assert.equal(existsSync(join(scratch, file)), false, file);
  });
});

describe("npm run store", () => {
  let standIn: Awaited<ReturnType<typeof startPostgresStandIn>>;
  const run = (...args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", "demo/store-cli.ts", ...args], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: standIn.url } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });

  before(async () => {
    standIn = await startPostgresStandIn(CLI_DB_PORT, false);
  });
  after(() => standIn.stop());

  it("migrates a new database once, then deletes and purges", async () => {
    const first = await run("migrate");
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /001_init\.sql/);
    assert.match((await run("migrate")).out, /up to date/);

    const store = createPostgresStore(standIn.url);
    const report = fixtureReport();
    const expired = fixtureReport({ created_at: new Date(Date.now() - 91 * 86_400_000).toISOString() });
    await store.createReport(report);
    await store.createReport(expired);
    assert.match((await run("delete", report.id)).out, /Deleted/);
    assert.equal(await store.getReport(report.id), null);
    assert.match((await run("delete", report.id)).out, /No report/);
    assert.match((await run("purge")).out, /reports: 1/);
    await store.close();
    assert.equal((await run("nonsense")).code, 1);
  });
});

describe("free later rounds", () => {
  const paid = () => fixtureReport({ permit_number: "PAID-9", unlocked: true, unlocked_by: "stripe" });

  it("need an unlocked report on the same permit", () => {
    assert.equal(earnsFreeRound(paid(), "PAID-9"), true);
  });

  it("aren't earned by typing a permit number with no report", () => {
    assert.equal(earnsFreeRound(null, "PAID-9"), false);
  });

  it("aren't earned from a locked report", () => {
    assert.equal(earnsFreeRound(fixtureReport({ permit_number: "PAID-9", unlocked: false }), "PAID-9"), false);
  });

  it("don't carry over to another permit", () => {
    assert.equal(earnsFreeRound(paid(), "OTHER-1"), false);
  });

  it("need a permit number", () => {
    assert.equal(earnsFreeRound(fixtureReport({ permit_number: null, unlocked: true }), null), false);
  });
});
