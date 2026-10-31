// npm run test:demo
// One set of behavior tests, run against both backends.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { jobResponse, STALE_JOB_MS, startJob } from "./jobs.ts";
import { publicView, type Report } from "./reports.ts";
import { createLocalStore } from "./store-local.ts";
import { applyMigrations, cleanText, createPostgresStore, toJsonb } from "./store-postgres.ts";
import { allowFreeRun, DEFAULT_RETENTION_DAYS, hashClient, isExpired, JOB_TTL_MS, retentionDays, type Store, type StoreOptions } from "./store.ts";
import { fixtureReport, freePorts, LOCKED_SECRETS, newId, startPostgresStandIn } from "./test-support.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Backend {
  name: string;
  setup(): Promise<void>;
  reset(): Promise<void>;
  open(options?: StoreOptions): Store;
  /** Everything the backend holds, as text, to look for what shouldn't be there. */
  dump(): Promise<string>;
  teardown(): Promise<void>;
}

function localBackend(): Backend {
  let dir = "";
  return {
    name: "local files",
    setup: async () => {},
    reset: async () => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "redline-store-"));
    },
    open: (options) => createLocalStore(dir, options),
    dump: async () => {
      const out: string[] = [];
      for (const sub of ["", "jobs", "reports", "payments"]) {
        const folder = join(dir, sub);
        if (!existsSync(folder)) continue;
        for (const f of readdirSync(folder)) if (statSync(join(folder, f)).isFile()) out.push(readFileSync(join(folder, f), "utf8"));
      }
      return out.join("\n");
    },
    teardown: async () => rmSync(dir, { recursive: true, force: true }),
  };
}

function postgresBackend(): Backend {
  let standIn: Awaited<ReturnType<typeof startPostgresStandIn>>;
  return {
    name: "postgres",
    setup: async () => {
      standIn = await startPostgresStandIn((await freePorts(1))[0]);
    },
    reset: async () => {
      await standIn.admin.query("TRUNCATE redline_reports, redline_jobs, redline_rate_limits, redline_waitlist, redline_payments");
    },
    open: (options) => createPostgresStore(standIn.url, options),
    dump: async () => {
      const out: string[] = [];
      for (const table of ["redline_reports", "redline_jobs", "redline_rate_limits", "redline_waitlist", "redline_payments"]) {
        out.push(JSON.stringify((await standIn.admin.query(`SELECT * FROM ${table}`)).rows));
      }
      return out.join("\n");
    },
    teardown: async () => standIn.stop(),
  };
}

process.env.REDLINE_RATE_LIMIT_SECRET = "test-only-secret";

for (const backend of [localBackend(), postgresBackend()]) {
  describe(`storage: ${backend.name}`, () => {
    let clock = Date.now();
    let opened: Store[] = [];
    const open = (options: StoreOptions = {}) => {
      const store = backend.open({ now: () => clock, ...options });
      opened.push(store);
      return store;
    };
    const aged = (days: number) => new Date(clock - days * DAY).toISOString();

    before(() => backend.setup());
    beforeEach(async () => {
      await Promise.all(opened.map((s) => s.close()));
      opened = [];
      clock = Date.now();
      await backend.reset();
    });
    after(async () => {
      await Promise.all(opened.map((s) => s.close()));
      await backend.teardown();
    });

    // ---------- reports ----------

    it("saves and loads a report unchanged", async () => {
      const store = open();
      const report = fixtureReport();
      await store.createReport(report);
      assert.deepEqual(await store.getReport(report.id), report);
    });

    it("refuses a second report with the same id, so nothing can be blindly overwritten", async () => {
      const store = open();
      const report = fixtureReport();
      await store.createReport(report);
      await assert.rejects(store.createReport({ ...report, unlocked: true }));
      assert.equal((await store.getReport(report.id))?.unlocked, false);
    });

    it("treats a malformed id as missing, including path traversal", async () => {
      const store = open();
      for (const id of ["../../etc/passwd", "abc", "", `${newId()}'; DROP TABLE redline_reports; --`]) {
        assert.equal(await store.getReport(id), null);
        assert.equal(await store.deleteReport(id), false);
        assert.equal(await store.updateReport(id, (r) => r), null);
        assert.equal(await store.getJob(id), null);
      }
    });

    it("keeps every change when instances update a report at the same moment", async () => {
      const [a, b] = [open(), open()];
      const report = fixtureReport();
      await a.createReport(report);
      const changes = report.items.flatMap((item) =>
        [a, b].map((store, n) =>
          store.updateReport(report.id, (r) => ({ ...r, decisions: { ...r.decisions, [`${item.comment}-${n}`]: { decision: "approve", note: "", at: "t" } } })),
        ),
      );
      await Promise.all(changes);
      assert.equal(Object.keys((await a.getReport(report.id))!.decisions).length, report.items.length * 2);
    });

    it("can't change a report's id or restart its retention clock", async () => {
      const store = open();
      const report = fixtureReport();
      await store.createReport(report);
      const updated = await store.updateReport(report.id, (r) => ({ ...r, id: newId(), created_at: new Date(clock + 10 * DAY).toISOString() }));
      assert.equal(updated?.id, report.id);
      assert.equal((await store.getReport(report.id))?.created_at, report.created_at);
    });

    it("deletes a report, and a later update doesn't bring it back", async () => {
      const store = open();
      const report = fixtureReport();
      await store.createReport(report);
      assert.equal(await store.deleteReport(report.id), true);
      assert.equal(await store.deleteReport(report.id), false);
      assert.equal(await store.getReport(report.id), null);
      assert.equal(await store.updateReport(report.id, (r) => ({ ...r, unlocked: true })), null);
      assert.equal(await store.getReport(report.id), null);
      assert.ok(!(await backend.dump()).includes("DRAFT-C1"), "the letter's content is really gone");
    });

    it("finds a paid permit only from an unlocked, unexpired report", async () => {
      const store = open();
      const report = fixtureReport({ permit_number: "PAID-1" });
      await store.createReport(report);
      assert.equal(await store.permitUnlocked("PAID-1"), false, "locked");
      await store.updateReport(report.id, (r) => ({ ...r, unlocked: true, unlocked_by: "stripe" }));
      assert.equal(await store.permitUnlocked("PAID-1"), true);
      assert.equal(await store.permitUnlocked("OTHER"), false);
      clock += (DEFAULT_RETENTION_DAYS + 1) * DAY;
      assert.equal(await store.permitUnlocked("PAID-1"), false, "expired");
    });

    // ---------- retention ----------

    it("defaults to 90 days, and hides an expired report before the purge runs", async () => {
      const store = open({ retentionDays: retentionDays("") });
      const inside = fixtureReport({ created_at: aged(89) });
      const outside = fixtureReport({ created_at: aged(91) });
      await store.createReport(inside);
      await store.createReport(outside);
      assert.ok(await store.getReport(inside.id));
      assert.equal(await store.getReport(outside.id), null);
      assert.equal(await store.updateReport(outside.id, (r) => ({ ...r, unlocked: true })), null);
    });

    it("purges only what's past the limit, and running it twice is harmless", async () => {
      const [a, b] = [open({ retentionDays: 90 }), open({ retentionDays: 90 })];
      const inside = fixtureReport({ created_at: aged(89) });
      const outside = fixtureReport({ created_at: aged(91), project: "EXPIRED-LETTER" });
      await a.createReport(inside);
      await a.createReport(outside);
      const [first, second] = await Promise.all([a.purgeExpired(), b.purgeExpired()]);
      assert.equal(first.reports + second.reports >= 1, true);
      assert.ok(await a.getReport(inside.id));
      assert.ok(!(await backend.dump()).includes("EXPIRED-LETTER"));
      assert.equal((await a.purgeExpired()).reports, 0);
    });

    it("honors a shorter retention limit", async () => {
      const store = open({ retentionDays: 7 });
      const report = fixtureReport({ created_at: aged(8) });
      await store.createReport(report);
      assert.equal(await store.getReport(report.id), null);
    });

    // ---------- jobs ----------

    it("shows a job's progress on another instance", async () => {
      const [a, b] = [open(), open()];
      const id = newId();
      await a.createJob(id);
      assert.equal((await b.getJob(id))?.status, "running");
      assert.deepEqual((await jobResponse(id, b, clock)).body, { status: "running" });
      await a.finishJob(id, 200, { stop: "uncovered", message: "No." });
      assert.deepEqual((await jobResponse(id, b, clock)).body, { status: "done", result: { stop: "uncovered", message: "No." } });
    });

    it("forgets a job after an hour, finished or not", async () => {
      const store = open();
      const [running, done] = [newId(), newId()];
      await store.createJob(running);
      await store.createJob(done);
      await store.finishJob(done, 200, { stop: "x", message: "y" });
      clock += JOB_TTL_MS + 1;
      assert.equal(await store.getJob(running), null);
      assert.equal((await jobResponse(done, store, clock)).status, 404);
      assert.equal((await store.purgeExpired()).jobs, 2);
    });

    it("reports a job as interrupted when its instance stops sending heartbeats", async () => {
      const store = open();
      const id = newId();
      await store.createJob(id);
      assert.equal((await jobResponse(id, store, clock + STALE_JOB_MS - 1000)).status, 200);
      const stale = await jobResponse(id, store, clock + STALE_JOB_MS + 1000);
      assert.equal(stale.status, 500);
      assert.match(JSON.stringify(stale.body), /interrupted/);
      clock += STALE_JOB_MS;
      await store.heartbeatJob(id);
      assert.deepEqual((await jobResponse(id, store, clock + 1000)).body, { status: "running" });
    });

    it("runs a job to completion, and records a failure instead of crashing", async () => {
      const store = open();
      const report = fixtureReport();
      await store.createReport(report);
      const good = await startJob(async () => ({ status: 200, value: { report_id: report.id } }), store);
      const bad = await startJob(async () => {
        throw new Error("x".repeat(5000));
      }, store);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await jobResponse(good, store)).status, 200);
      const failed = await jobResponse(bad, store);
      assert.equal(failed.status, 500);
      assert.ok(JSON.stringify(failed.body).length < 600, "long errors are cut, since they can quote a letter");
    });

    it("keeps no letter text in a job, and a deleted report is gone from its job too", async () => {
      const store = open();
      const report = fixtureReport({ project: "CONFIDENTIAL-PROJECT" });
      await store.createReport(report);
      const id = newId();
      await store.createJob(id);
      await store.finishJob(id, 200, { report_id: report.id });
      assert.equal(JSON.stringify(await store.getJob(id)).includes("CONFIDENTIAL"), false);
      await store.deleteReport(report.id);
      assert.equal((await jobResponse(id, store)).status, 404);
      assert.equal((await backend.dump()).includes("CONFIDENTIAL"), false);
    });

    // ---------- the paywall ----------

    it("never shows locked drafts or citations, directly or through a job", async () => {
      const store = open();
      const report = fixtureReport();
      await store.createReport(report);
      const job = newId();
      await store.createJob(job);
      await store.finishJob(job, 200, { report_id: report.id });

      const loaded = (await store.getReport(report.id)) as Report;
      for (const body of [publicView(loaded), (await jobResponse(job, store)).body]) {
        const text = JSON.stringify(body);
        for (const secret of LOCKED_SECRETS) assert.ok(!text.includes(secret), `${secret} leaked`);
        assert.ok(text.includes("DRAFT-C1"), "free drafts still show");
      }
      const view = publicView(loaded);
      assert.deepEqual(view.items.filter((i) => i.locked).map((i) => i.comment), ["C4", "C5"]);
      for (const item of view.items.filter((i) => i.locked)) {
        assert.equal(item.draft, "");
        assert.equal(item.citation, null);
      }
    });

    it("shows everything after an unlock, including through a job that finished while locked", async () => {
      const [a, b] = [open(), open()];
      const report = fixtureReport();
      await a.createReport(report);
      const job = newId();
      await a.createJob(job);
      await a.finishJob(job, 200, { report_id: report.id });
      await b.updateReport(report.id, (r) => ({ ...r, unlocked: true, unlocked_by: "stripe" }));
      const text = JSON.stringify((await jobResponse(job, a)).body);
      for (const secret of LOCKED_SECRETS) assert.ok(text.includes(secret));
    });

    it("doesn't lose a payment to a change made at the same moment", async () => {
      const [a, b] = [open(), open()];
      for (let round = 0; round < 10; round++) {
        const report = fixtureReport();
        await a.createReport(report);
        await Promise.all([
          a.updateReport(report.id, (r) => ({ ...r, learning_opt_in: true })),
          b.updateReport(report.id, (r) => ({ ...r, unlocked: true, unlocked_by: "stripe" })),
          a.updateReport(report.id, (r) => ({ ...r, project: "edited" })),
        ]);
        const final = await a.getReport(report.id);
        assert.deepEqual([final?.unlocked, final?.learning_opt_in, final?.project], [true, true, "edited"]);
      }
    });

    // ---------- rate limits ----------

    it("allows exactly the limit across instances, even all at once", async () => {
      const [a, b] = [open(), open()];
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).hitRateLimit("key-1", 6, HOUR)));
      assert.equal(results.filter(Boolean).length, 6);
      assert.equal(await a.hitRateLimit("key-1", 6, HOUR), false);
      assert.equal(await a.hitRateLimit("key-2", 6, HOUR), true, "other clients aren't affected");
    });

    it("uses a sliding window that survives a restart", async () => {
      const first = open();
      for (let i = 0; i < 3; i++) assert.equal(await first.hitRateLimit("k", 6, HOUR), true);
      clock += 30 * 60_000;
      for (let i = 0; i < 3; i++) assert.equal(await first.hitRateLimit("k", 6, HOUR), true);
      const restarted = open();
      assert.equal(await restarted.hitRateLimit("k", 6, HOUR), false);
      clock += 30 * 60_000 + 1;
      assert.equal(await restarted.hitRateLimit("k", 6, HOUR), true, "the first three have aged out");
      for (let i = 0; i < 2; i++) assert.equal(await restarted.hitRateLimit("k", 6, HOUR), true);
      assert.equal(await restarted.hitRateLimit("k", 6, HOUR), false);
    });

    it("never stores a client's address, and purges idle limits", async () => {
      const store = open();
      const address = "203.0.113.77";
      assert.equal(await allowFreeRun(address, 6, store), true);
      const held = await backend.dump();
      assert.ok(!held.includes(address));
      assert.ok(held.includes(hashClient(address)));
      clock += HOUR + 1;
      assert.equal((await store.purgeExpired()).rateLimits, 1);
      assert.ok(!(await backend.dump()).includes(hashClient(address)));
    });

    // ---------- waitlist ----------

    it("appends waitlist entries with only the four existing fields", async () => {
      const store = open();
      const entry = { at: "2026-10-31T12:00:00.000Z", email: "a@example.com", place: "Boise", reason: "uncovered" };
      await store.addWaitlist(entry);
      await store.addWaitlist({ ...entry, email: "b@example.com" });
      await store.addWaitlist({ ...entry, extra: "phone" } as never);
      const list = await store.listWaitlist();
      assert.deepEqual(list[0], entry);
      assert.deepEqual(list.map((e) => e.email), ["a@example.com", "b@example.com", "a@example.com"]);
      assert.ok(!(await backend.dump()).includes("phone"));
    });
  });
}

describe("retention settings", () => {
  it("falls back to 90 days on a value that would delete everything or nothing", () => {
    assert.equal(retentionDays(undefined), 90);
    assert.equal(retentionDays("30"), 30);
    for (const bad of ["0", "-1", "abc", "Infinity"]) assert.equal(retentionDays(bad), 90);
  });
  it("treats an unreadable date as expired", () => {
    assert.equal(isExpired("not a date", Date.now(), DAY), true);
  });
});

describe("local files only", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "redline-local-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("reads report files in the format that already exists, at the same path", async () => {
    const report = fixtureReport();
    mkdirSync(join(dir, "reports"));
    writeFileSync(join(dir, "reports", `${report.id}.json`), JSON.stringify(report));
    assert.deepEqual(await createLocalStore(dir).getReport(report.id), report);
  });

  it("writes the waitlist to the same file, in the same format", async () => {
    const entry = { at: "2026-10-31T12:00:00.000Z", email: "a@example.com", place: "Boise", reason: "edition" };
    await createLocalStore(dir).addWaitlist(entry);
    assert.equal(readFileSync(join(dir, "waitlist.jsonl"), "utf8"), JSON.stringify(entry) + "\n");
  });

  it("keeps confidential files private to the owner", async () => {
    const report = fixtureReport();
    await createLocalStore(dir).createReport(report);
    assert.equal(statSync(join(dir, "reports", `${report.id}.json`)).mode & 0o077, 0);
  });

  it("purges a corrupt report and a crashed write's temp file once they're old, and skips them when scanning", async () => {
    const store = createLocalStore(dir);
    const report = fixtureReport({ permit_number: "P1", unlocked: true });
    await store.createReport(report);
    const corrupt = join(dir, "reports", `${newId()}.json`);
    const temp = join(dir, "reports", `${report.id}.json.abcd.tmp`);
    writeFileSync(corrupt, "{ half a file");
    writeFileSync(temp, "a copy of a letter");
    assert.equal(await store.permitUnlocked("P1"), true);
    await store.purgeExpired();
    assert.ok(existsSync(corrupt) && existsSync(temp), "recent files stay");
    const old = new Date(Date.now() - 100 * DAY);
    utimesSync(corrupt, old, old);
    utimesSync(temp, old, old);
    assert.equal((await store.purgeExpired()).reports, 1);
    assert.ok(!existsSync(corrupt) && !existsSync(temp));
  });
});

describe("postgres only", () => {
  let standIn: Awaited<ReturnType<typeof startPostgresStandIn>>;
  before(async () => {
    standIn = await startPostgresStandIn((await freePorts(1))[0]);
  });
  after(() => standIn.stop());

  it("has applied the migration once, and applying again changes nothing", async () => {
    assert.deepEqual(await applyMigrations(standIn.admin), []);
    const { rows } = await standIn.admin.query("SELECT name FROM redline_migrations ORDER BY name");
    assert.deepEqual(rows, [{ name: "001_init.sql" }, { name: "002_payments.sql" }]);
  });

  it("saves letters holding characters that Postgres would reject in JSON", async () => {
    const store = createPostgresStore(standIn.url);
    const halfEmoji = "😀".slice(0, 1);
    const report = fixtureReport({ project: `PDF\u0000text ${halfEmoji} end`, permit_number: `P\u00002` });
    await store.createReport(report);
    const updated = await store.updateReport(report.id, (r) => ({ ...r, project: `${r.project} ${halfEmoji}\u0000` }));
    assert.ok(updated);
    const loaded = await store.getReport(report.id);
    assert.equal(loaded?.project, "PDFtext � end �");
    assert.equal(loaded?.permit_number, "P2");
    await store.addWaitlist({ at: "2026-10-31T12:00:00.000Z", email: "a\u0000@example.com", place: halfEmoji, reason: "x" });
    await store.close();
  });

  it("only cleans what needs cleaning", () => {
    assert.equal(cleanText("whole 😀 emoji"), "whole 😀 emoji");
    assert.equal(toJsonb({ a: "back\\u0000slash" }), JSON.stringify({ a: "back\\u0000slash" }));
  });

  it("keeps the indexed columns matching the report", async () => {
    const store = createPostgresStore(standIn.url);
    const report = fixtureReport({ permit_number: "COL-1" });
    await store.createReport(report);
    await store.updateReport(report.id, (r) => ({ ...r, unlocked: true, unlocked_by: "stripe", permit_number: "COL-2" }));
    const { rows } = await standIn.admin.query("SELECT unlocked, permit_number, doc->>'unlocked' AS doc_unlocked, doc->>'permit_number' AS doc_permit FROM redline_reports WHERE id = $1", [report.id]);
    assert.deepEqual(rows[0], { unlocked: true, permit_number: "COL-2", doc_unlocked: "true", doc_permit: "COL-2" });
    await store.close();
  });

  it("stores only the four waitlist fields, plus a row id", async () => {
    const { rows } = await standIn.admin.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'redline_waitlist' ORDER BY column_name");
    assert.deepEqual(rows.map((r) => r.column_name), ["at", "email", "id", "place", "reason"]);
  });
});
