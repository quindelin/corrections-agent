// npm run test:payments (also part of npm run test:demo)
// Offline tests of the payment path, on both storage backends. Every event is built here and signed with a made-up
// secret. Nothing talks to Stripe: the only sockets are to copies of demo/server.ts and a PGlite stand-in on localhost,
// and fetch throws if anything calls it. This shows the code agrees with Stripe's documented format, not that Stripe agrees.
// PGlite has one backend process, so statements interleave but never truly run in parallel. Hence the forced interleavings.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { applyPaidSession, applyRefund, type CheckoutSession, confirmPayment, processWebhook, requiresServiceKey, SIGNATURE_TOLERANCE_SECONDS, verifySignature, WEBHOOK_PATH } from "./payments.ts";
import { publicView, type Report } from "./reports.ts";
import { createLocalStore } from "./store-local.ts";
import { applyMigrations, createPostgresStore } from "./store-postgres.ts";
import type { Store, StoreOptions } from "./store.ts";
import { fixtureReport, freePorts, LOCKED_SECRETS, startPostgresStandIn } from "./test-support.ts";

const SECRET = "whsec_made_up_for_tests_only";
const SERVICE_KEY = "made-up-service-key";
const NOW = 1_800_000_000;
const DAY = 86_400_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sign = (body: Buffer | string, t = NOW, secret = SECRET) => createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");
const header = (body: Buffer | string, t = NOW, secret = SECRET) => `t=${t},v1=${sign(body, t, secret)}`;

let eventCount = 0;
const event = (type: string, object: object) => Buffer.from(JSON.stringify({ id: `evt_${++eventCount}`, object: "event", type, data: { object } }));
const paidSession = (reportId: string, paymentIntent = "pi_one", overrides: object = {}): CheckoutSession =>
  ({
    id: `cs_test_${paymentIntent}`,
    object: "checkout.session",
    payment_status: "paid",
    client_reference_id: reportId,
    payment_intent: paymentIntent,
    amount_total: 5900,
    currency: "usd",
    livemode: false,
    ...overrides,
  }) as CheckoutSession;
const refundedCharge = (paymentIntent = "pi_one", overrides: object = {}) => ({ id: "ch_one", object: "charge", amount: 5900, amount_refunded: 5900, refunded: true, payment_intent: paymentIntent, ...overrides });

const fixture = (overrides: Partial<Report> = {}) => fixtureReport({ permit_number: null, ...overrides });

before(() => {
  // Any stray call to Stripe fails the test rather than leaving the machine.
  globalThis.fetch = (() => {
    throw new Error("Network call attempted in an offline test");
  }) as typeof fetch;
  console.warn = () => {};
  console.error = () => {};
});

describe("signature", () => {
  const body = Buffer.from('{"id":"evt_x"}');
  const reasonOf = (b: Buffer, h: string | undefined, secret = SECRET, now = NOW) => {
    const r = verifySignature(b, h, secret, now);
    return r.ok ? "ok" : r.reason;
  };

  it("accepts a valid signature", () => assert.equal(reasonOf(body, header(body)), "ok"));
  it("rejects one made with another secret", () => assert.equal(reasonOf(body, header(body, NOW, "whsec_other")), "bad_signature"));
  it("rejects a changed body", () => assert.equal(reasonOf(Buffer.from('{"id":"evt_y"}'), header(body)), "bad_signature"));
  it("rejects a changed timestamp, since it is part of what's signed", () => assert.equal(reasonOf(body, `t=${NOW + 1},v1=${sign(body)}`, SECRET, NOW + 1), "bad_signature"));
  it("rejects a missing header", () => assert.equal(reasonOf(body, undefined), "no_header"));
  it("rejects junk headers", () => {
    for (const h of ["junk", "t=,v1=", `v1=${sign(body)}`, `t=${NOW}`, `t=abc,v1=${sign(body)}`, `t=${NOW},v1=nothex`, `t=${NOW},t=${NOW},v1=${sign(body)}`]) assert.equal(reasonOf(body, h), "malformed_header", h);
  });
  it("ignores the v0 scheme, so a downgrade can't pass", () => assert.equal(reasonOf(body, `t=${NOW},v0=${sign(body)}`), "malformed_header"));
  it("never verifies with an empty secret, even against a signature made with an empty key", () => assert.equal(reasonOf(body, header(body, NOW, ""), ""), "no_secret"));
  it("accepts any matching v1, as during a secret roll", () => assert.equal(reasonOf(body, `t=${NOW},v1=${sign(body, NOW, "whsec_old")},v1=${sign(body)}`), "ok"));
  it("rejects an old timestamp even with a valid signature", () => assert.equal(reasonOf(body, header(body, NOW - SIGNATURE_TOLERANCE_SECONDS - 1)), "stale_timestamp"));
  it("rejects a timestamp far in the future", () => assert.equal(reasonOf(body, header(body, NOW + SIGNATURE_TOLERANCE_SECONDS + 1)), "stale_timestamp"));
  it("accepts a timestamp right at the limit", () => assert.equal(reasonOf(body, header(body, NOW - SIGNATURE_TOLERANCE_SECONDS)), "ok"));
  it("checks the exact bytes: reformatting the same JSON fails", () => {
    const raw = Buffer.from('{ "id" : "evt_x",\n  "name": "Café ✓" }');
    assert.equal(reasonOf(raw, header(raw)), "ok");
    assert.equal(reasonOf(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), header(raw)), "bad_signature");
  });
});

describe("which requests need the service key", () => {
  it("exempts only a POST to the webhook path", () => {
    assert.equal(requiresServiceKey("POST", WEBHOOK_PATH), false);
    assert.equal(requiresServiceKey("POST", `${WEBHOOK_PATH}?x=1`), false);
  });
  it("keeps the key on everything else under /api/", () => {
    const id = "a".repeat(32);
    for (const [method, url] of [
      ["GET", WEBHOOK_PATH],
      ["PUT", WEBHOOK_PATH],
      ["POST", `${WEBHOOK_PATH}/`],
      ["POST", `${WEBHOOK_PATH}x`],
      ["POST", `${WEBHOOK_PATH}/extra`],
      ["POST", `${WEBHOOK_PATH}/../../analyze`],
      ["POST", `${WEBHOOK_PATH}/%2e%2e/%2e%2e/analyze`],
      ["POST", "/api/stripe"],
      ["POST", "/api/analyze"],
      ["GET", "/api/bootstrap"],
      ["GET", "/api/paid"],
      ["GET", `/api/report/${id}`],
      ["GET", `/x/../api/report/${id}`],
      ["GET", `/./api/report/${id}`],
      ["GET", `/%2e%2e/api/report/${id}`],
      ["GET", `/x/..\\api/report/${id}`],
      ["GET", `http://elsewhere/api/report/${id}`],
    ] as const) assert.equal(requiresServiceKey(method, url), true, `${method} ${url}`);
  });
  it("fails closed on a URL it can't parse", () => assert.equal(requiresServiceKey("GET", "http://"), true));
  it("leaves the customer pages open", () => {
    for (const url of ["/", "/start", `/r/${"a".repeat(32)}`, "/paid?session_id=cs_test_x"]) assert.equal(requiresServiceKey("GET", url), false, url);
  });
  it("doesn't exempt an unknown method at the webhook path", () => assert.equal(requiresServiceKey(undefined, WEBHOOK_PATH), true));
});

// ---------- forcing a particular interleaving ----------

function gate() {
  let open = () => {};
  let hit = () => {};
  const opened = new Promise<void>((r) => (open = r));
  const reached = new Promise<void>((r) => (hit = r));
  return {
    open,
    reached,
    wait: async () => {
      hit();
      await opened;
    },
  };
}
type Gate = ReturnType<typeof gate>;

/** A store whose nth call to a method first waits at a gate, so a test can hold one instance mid-event. */
function withGates(store: Store, gates: { [K in keyof Store]?: (Gate | null)[] }): Store {
  const wrapped: Record<string, unknown> = { ...store };
  for (const [name, list] of Object.entries(gates)) {
    let call = 0;
    wrapped[name] = async (...args: unknown[]) => {
      await (list as (Gate | null)[])[call++]?.wait();
      return (store as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
    };
  }
  return wrapped as unknown as Store;
}

// ---------- both backends ----------

interface Backend {
  name: string;
  setup(): Promise<void>;
  reset(): Promise<void>;
  /** Each call is another handle, which stands for another instance on Postgres. */
  open(options?: StoreOptions): Store;
  teardown(): Promise<void>;
  admin?: () => Awaited<ReturnType<typeof startPostgresStandIn>>["admin"];
}

function localBackend(): Backend {
  let dir = "";
  return {
    name: "local files",
    setup: async () => {},
    reset: async () => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "redline-payments-"));
    },
    open: (options) => createLocalStore(dir, options),
    teardown: async () => rmSync(dir, { recursive: true, force: true }),
  };
}

function postgresBackend(): Backend {
  let standIn: Awaited<ReturnType<typeof startPostgresStandIn>>;
  return {
    name: "postgres (PGlite)",
    setup: async () => {
      standIn = await startPostgresStandIn((await freePorts(1))[0]);
    },
    reset: async () => {
      await standIn.admin.query("TRUNCATE redline_reports, redline_jobs, redline_rate_limits, redline_waitlist, redline_payments");
    },
    open: (options) => createPostgresStore(standIn.url, options),
    teardown: async () => standIn.stop(),
    admin: () => standIn.admin,
  };
}

for (const backend of [localBackend(), postgresBackend()]) {
  describe(`payments on ${backend.name}`, () => {
    let store: Store;
    let other: Store;
    let opened: Store[] = [];
    const open = (options?: StoreOptions) => {
      const s = backend.open(options);
      opened.push(s);
      return s;
    };

    const deliver = (type: string, object: object, s: Store = store) => {
      const body = event(type, object);
      return processWebhook(body, header(body), SECRET, NOW, s);
    };
    const pay = (reportId: string, paymentIntent = "pi_one", s: Store = store) => deliver("checkout.session.completed", paidSession(reportId, paymentIntent), s);
    const refund = (paymentIntent = "pi_one", s: Store = store) => deliver("charge.refunded", refundedCharge(paymentIntent), s);
    const add = async (overrides: Partial<Report> = {}) => {
      const report = fixture(overrides);
      await store.createReport(report);
      return report;
    };
    const reload = async (r: Report) => (await store.getReport(r.id)) as Report;

    before(() => backend.setup());
    beforeEach(async () => {
      await Promise.all(opened.map((s) => s.close()));
      opened = [];
      await backend.reset();
      store = open();
      other = open();
    });
    after(async () => {
      await Promise.all(opened.map((s) => s.close()));
      await backend.teardown();
    });

    describe("the ledger", () => {
      it("gathers facts in any order, to the same result", async () => {
        const facts = [
          { id: "pi_a", session_id: "cs_a", report_id: "r".repeat(32), amount_total: 5900, currency: "usd", livemode: false, paid: true },
          { id: "pi_a", amount_refunded: 1000 },
          { id: "pi_a", amount_refunded: 5900, refunded: true },
        ];
        const clean = ({ id: _id, paid_at, refunded_at, created_at, ...rest }: NonNullable<Awaited<ReturnType<Store["getPayment"]>>>) => ({ ...rest, paid: Boolean(paid_at), refunded: Boolean(refunded_at), created: Boolean(created_at) });
        const results = [];
        for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]]) {
          await backend.reset();
          for (const i of order) await store.mergePayment(facts[i]);
          results.push(clean((await store.getPayment("pi_a"))!));
        }
        for (const r of results) assert.deepEqual(r, results[0]);
        assert.equal(results[0].amount_refunded, 5900);
        assert.equal(results[0].refunded, true);
        assert.equal(results[0].paid, true);
      });

      it("never clears a refund, whatever is merged after it", async () => {
        const refunded = await store.mergePayment({ id: "pi_a", refunded: true, amount_refunded: 5900 });
        for (const fact of [{ id: "pi_a", paid: true }, { id: "pi_a", refunded: false }, { id: "pi_a", amount_refunded: 0 }]) await store.mergePayment(fact);
        const after = (await store.getPayment("pi_a"))!;
        assert.equal(after.refunded_at, refunded.refunded_at);
        assert.equal(after.amount_refunded, 5900);
        assert.equal(await store.reportHasActivePayment("r".repeat(32)), false);
      });

      it("keeps every fact when instances merge at the same moment", async () => {
        const reportId = "a".repeat(32);
        await Promise.all([
          store.mergePayment({ id: "pi_a", session_id: "cs_a" }),
          other.mergePayment({ id: "pi_a", report_id: reportId }),
          store.mergePayment({ id: "pi_a", paid: true }),
          other.mergePayment({ id: "pi_a", amount_refunded: 100 }),
          store.mergePayment({ id: "pi_a", currency: "usd" }),
          other.mergePayment({ id: "pi_a", amount_total: 5900 }),
        ]);
        const merged = (await store.getPayment("pi_a"))!;
        assert.deepEqual([merged.session_id, merged.report_id, Boolean(merged.paid_at), merged.amount_refunded, merged.currency, merged.amount_total], ["cs_a", reportId, true, 100, "usd", 5900]);
        assert.equal(await other.reportHasActivePayment(reportId), true);
      });

      it("shares refunds between instances", async () => {
        const reportId = "a".repeat(32);
        await store.mergePayment({ id: "pi_a", report_id: reportId, paid: true });
        assert.equal(await other.reportHasActivePayment(reportId), true);
        await other.mergePayment({ id: "pi_a", refunded: true });
        assert.equal(await store.reportHasActivePayment(reportId), false);
      });

      it("refuses a malformed id, and treats one as missing", async () => {
        for (const id of ["../../evil", "", "pi a", "pi_'; DROP TABLE redline_payments; --"]) {
          await assert.rejects(store.mergePayment({ id, paid: true }));
          assert.equal(await store.getPayment(id), null);
        }
      });

      it("finds a permit's unlocked reports and says why, leaving out locked and expired ones", async () => {
        const paid = await add({ permit_number: "P-1", unlocked: true, unlocked_by: "stripe" });
        const round = await add({ permit_number: "P-1", unlocked: true, unlocked_by: "next_round" });
        await add({ permit_number: "P-1" });
        await add({ permit_number: "P-2", unlocked: true, unlocked_by: "stripe" });
        await add({ permit_number: "P-1", unlocked: true, unlocked_by: "stripe", created_at: new Date(Date.now() - 91 * DAY).toISOString() });
        const found = (await other.unlockedOnPermit("P-1")).sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(found, [{ id: paid.id, unlocked_by: "stripe" }, { id: round.id, unlocked_by: "next_round" }].sort((a, b) => a.id.localeCompare(b.id)));
        assert.deepEqual(await store.unlockedOnPermit("P-none"), []);
      });

      it("outlives the report it refers to, then is purged, and an old event can't bring anything back", async () => {
        let clock = Date.now();
        const timed = open({ now: () => clock, retentionDays: 90 });
        const report = fixture();
        await timed.createReport(report);
        clock += 10 * DAY;
        await pay(report.id, "pi_old", timed);
        await refund("pi_old", timed);
        clock += 81 * DAY; // 91 days after the report, 81 after the payment.
        assert.deepEqual([(await timed.purgeExpired()).reports, (await timed.purgeExpired()).payments], [1, 0]);
        assert.ok((await timed.getPayment("pi_old"))?.refunded_at, "still remembered once the report has gone");
        clock += 10 * DAY;
        assert.equal((await timed.purgeExpired()).payments, 1);
        assert.equal(await timed.getPayment("pi_old"), null);
        assert.equal((await pay(report.id, "pi_old", timed)).body.outcome, "unknown_report");
      });
    });

    describe("webhook delivery", () => {
      it("a paid session unlocks the right report and no other", async () => {
        const target = await add();
        const bystander = await add();
        const reply = await pay(target.id);
        assert.equal(reply.status, 200);
        assert.equal(reply.body.outcome, "unlocked");
        assert.equal(reply.body.report_id, target.id);
        assert.equal((await reload(target)).unlocked, true);
        assert.equal((await reload(target)).unlocked_by, "stripe");
        assert.equal((await reload(bystander)).unlocked, false);
        assert.equal((await store.getPayment("pi_one"))?.report_id, target.id);
      });

      it("unlocking is what reveals the drafts", async () => {
        const report = await add();
        assert.ok(publicView(await reload(report)).items.some((i) => i.locked));
        await pay(report.id);
        assert.ok(publicView(await reload(report)).items.every((i) => !i.locked));
      });

      it("does nothing on a bad signature and on an old timestamp, without touching the store", async () => {
        const report = await add();
        const body = event("checkout.session.completed", paidSession(report.id));
        const untouchable = new Proxy({} as Store, {
          get: () => () => assert.fail("a refused event must not reach the store"),
        });
        assert.equal((await processWebhook(body, header(body, NOW, "whsec_forged"), SECRET, NOW, untouchable)).status, 400);
        assert.equal((await processWebhook(body, undefined, SECRET, NOW, untouchable)).status, 400);
        assert.equal((await processWebhook(body, header(body, NOW - 301), SECRET, NOW, untouchable)).status, 400);
        assert.equal((await reload(report)).unlocked, false);
        assert.equal(await store.getPayment("pi_one"), null);
      });

      it("refuses everything while no secret is set, so Stripe retries later", async () => {
        const report = await add();
        const body = event("checkout.session.completed", paidSession(report.id));
        assert.equal((await processWebhook(body, header(body), "", NOW, store)).status, 503);
        assert.equal((await reload(report)).unlocked, false);
      });

      it("a replay of the same bytes changes nothing", async () => {
        const report = await add();
        const body = event("checkout.session.completed", paidSession(report.id));
        assert.equal((await processWebhook(body, header(body), SECRET, NOW, store)).body.outcome, "unlocked");
        const [reportBefore, ledgerBefore] = [await reload(report), await store.getPayment("pi_one")];
        const again = await processWebhook(body, header(body), SECRET, NOW, other);
        assert.equal(again.status, 200);
        assert.equal(again.body.outcome, "already_unlocked");
        assert.deepEqual(await reload(report), reportBefore);
        assert.deepEqual(await store.getPayment("pi_one"), ledgerBefore);
      });

      it("the same payment under a new event id is also harmless", async () => {
        const report = await add();
        await pay(report.id);
        assert.equal((await pay(report.id)).body.outcome, "already_unlocked");
        assert.equal((await reload(report)).unlocked_by, "stripe");
      });

      it("doesn't unlock an unpaid session", async () => {
        const report = await add();
        const reply = await deliver("checkout.session.completed", paidSession(report.id, "pi_one", { payment_status: "unpaid" }));
        assert.equal(reply.status, 200);
        assert.equal(reply.body.outcome, "not_paid");
        assert.equal((await reload(report)).unlocked, false);
      });

      it("unlocks when a delayed payment clears, and not before", async () => {
        const report = await add();
        await deliver("checkout.session.completed", paidSession(report.id, "pi_one", { payment_status: "unpaid" }));
        assert.equal((await reload(report)).unlocked, false);
        assert.equal((await deliver("checkout.session.async_payment_succeeded", paidSession(report.id))).body.outcome, "unlocked");
        assert.equal((await reload(report)).unlocked, true);
      });

      it("accepts a payment for an unknown report without retrying forever, and records it", async () => {
        const reply = await pay("0".repeat(32));
        assert.equal(reply.status, 200);
        assert.equal(reply.body.outcome, "unknown_report");
        assert.ok((await store.getPayment("pi_one"))?.paid_at);
        assert.equal((await store.getPayment("pi_one"))?.report_id, null);
      });

      it("rejects hostile values in client_reference_id and payment_intent", async () => {
        assert.equal((await pay("../../etc/passwd")).body.outcome, "unknown_report");
        const report = await add();
        assert.equal((await deliver("checkout.session.completed", paidSession(report.id, "../../evil"))).body.outcome, "invalid");
        assert.equal((await deliver("charge.refunded", refundedCharge("../../evil"))).body.outcome, "invalid");
        assert.equal((await reload(report)).unlocked, false);
      });

      it("acknowledges event types it doesn't handle", async () => {
        const reply = await deliver("customer.created", { id: "cus_x" });
        assert.equal(reply.status, 200);
        assert.equal(reply.body.outcome, "ignored");
      });

      it("rejects signed bodies that aren't usable events, including thin events", async () => {
        for (const raw of ["not json", "null", JSON.stringify({ id: "evt_x", object: "v2.core.event", type: "checkout.session.completed", related_object: { id: "cs_x" } })]) {
          const body = Buffer.from(raw);
          assert.equal((await processWebhook(body, header(body), SECRET, NOW, store)).status, 400, raw);
        }
      });

      it("answers 500 when the store fails, so Stripe retries", async () => {
        const report = await add();
        const broken = { ...store, mergePayment: async () => { throw new Error("database down"); } };
        await assert.rejects(pay(report.id, "pi_one", broken));
        assert.equal((await reload(report)).unlocked, false);
        assert.equal((await pay(report.id)).body.outcome, "unlocked", "the retry finishes the job");
      });

      it("a retry finishes the job after a crash between the ledger and the report", async () => {
        const report = await add();
        const crashing = { ...store, updateReport: async () => { throw new Error("crashed"); } };
        await assert.rejects(pay(report.id, "pi_one", crashing));
        assert.ok((await store.getPayment("pi_one"))?.paid_at);
        assert.equal((await reload(report)).unlocked, false);
        assert.equal((await pay(report.id)).body.outcome, "unlocked");
        await assert.rejects(refund("pi_one", crashing));
        assert.equal((await reload(report)).unlocked, true);
        assert.deepEqual((await refund()).body.relocked, [report.id]);
        assert.equal((await reload(report)).unlocked, false);
      });

      it("a retry locks the free rounds after a crash between locking the report and looking for them", async () => {
        const paid = await add({ permit_number: "P-CRASH" });
        await pay(paid.id);
        const round = await add({ permit_number: "P-CRASH", unlocked: true, unlocked_by: "next_round" });
        const crashing = { ...store, unlockedOnPermit: async () => { throw new Error("crashed"); } };
        await assert.rejects(refund("pi_one", crashing));
        assert.equal((await reload(paid)).unlocked, false);
        assert.equal((await reload(round)).unlocked, true);
        assert.deepEqual((await refund()).body.relocked, [round.id]);
        assert.equal((await reload(round)).unlocked, false);
      });
    });

    describe("refunds", () => {
      it("a full refund re-locks and hides the drafts, and keeps the decisions", async () => {
        const decisions = { C1: { decision: "approve" as const, note: "fine", at: "2026-10-31T00:00:00.000Z" } };
        const report = await add({ decisions });
        await pay(report.id);
        const reply = await refund();
        assert.equal(reply.body.outcome, "refunded");
        assert.deepEqual(reply.body.relocked, [report.id]);
        const locked = await reload(report);
        assert.equal(locked.unlocked, false);
        assert.equal(locked.unlocked_by, null);
        assert.deepEqual(locked.decisions, decisions);
        assert.ok((await store.getPayment("pi_one"))?.refunded_at);
        const view = JSON.stringify(publicView(locked));
        for (const secret of LOCKED_SECRETS) assert.ok(!view.includes(secret), secret);
        assert.ok(view.includes("DRAFT-C1"), "the free preview stays");
      });

      it("a partial refund leaves it unlocked", async () => {
        const report = await add();
        await pay(report.id);
        const reply = await deliver("charge.refunded", refundedCharge("pi_one", { refunded: false, amount_refunded: 1000 }));
        assert.equal(reply.body.outcome, "partial");
        assert.equal((await reload(report)).unlocked, true);
        assert.equal((await store.getPayment("pi_one"))?.refunded_at, null);
        assert.equal((await store.getPayment("pi_one"))?.amount_refunded, 1000);
      });

      it("a partial refund followed by the rest re-locks", async () => {
        const report = await add();
        await pay(report.id);
        await deliver("charge.refunded", refundedCharge("pi_one", { refunded: false, amount_refunded: 1000 }));
        await refund();
        assert.equal((await reload(report)).unlocked, false);
        assert.equal((await store.getPayment("pi_one"))?.amount_refunded, 5900);
      });

      it("a partial refund that arrives before its payment doesn't stop the unlock", async () => {
        const report = await add();
        await deliver("charge.refunded", refundedCharge("pi_one", { refunded: false, amount_refunded: 1000 }));
        assert.equal((await pay(report.id)).body.outcome, "unlocked");
        assert.equal((await store.getPayment("pi_one"))?.amount_refunded, 1000);
      });

      it("a replayed payment event can't undo a refund", async () => {
        const report = await add();
        const body = event("checkout.session.completed", paidSession(report.id));
        await processWebhook(body, header(body), SECRET, NOW, store);
        await refund();
        assert.equal((await processWebhook(body, header(body), SECRET, NOW, other)).body.outcome, "refunded");
        assert.equal((await reload(report)).unlocked, false);
      });

      it("a replayed refund is harmless", async () => {
        const report = await add();
        await pay(report.id);
        await refund();
        const refundedAt = (await store.getPayment("pi_one"))?.refunded_at;
        const again = await refund("pi_one", other);
        assert.equal(again.body.outcome, "refunded");
        assert.deepEqual(again.body.relocked, []);
        assert.equal((await reload(report)).unlocked, false);
        assert.equal((await store.getPayment("pi_one"))?.refunded_at, refundedAt);
      });

      it("handles a refund that arrives before its payment event", async () => {
        const report = await add();
        assert.equal((await refund()).body.outcome, "refunded");
        assert.equal((await pay(report.id)).body.outcome, "refunded");
        assert.equal((await reload(report)).unlocked, false);
        assert.equal((await store.getPayment("pi_one"))?.report_id, report.id);
      });

      it("paying again after a refund unlocks, and replaying the old refund doesn't re-lock", async () => {
        const report = await add();
        await pay(report.id, "pi_first");
        await refund("pi_first");
        assert.equal((await pay(report.id, "pi_second")).body.outcome, "unlocked");
        assert.deepEqual((await refund("pi_first")).body.relocked, []);
        assert.equal((await reload(report)).unlocked, true);
      });

      it("refunding one of two payments for a report leaves it unlocked", async () => {
        const report = await add();
        await pay(report.id, "pi_first");
        await pay(report.id, "pi_second");
        await refund("pi_first");
        assert.equal((await reload(report)).unlocked, true);
        await refund("pi_second");
        assert.equal((await reload(report)).unlocked, false);
      });

      it("never locks a design partner's report", async () => {
        const report = await add({ unlocked: true, unlocked_by: "design_partner" });
        assert.equal((await pay(report.id)).body.outcome, "already_unlocked");
        assert.equal((await reload(report)).unlocked_by, "design_partner");
        await refund();
        assert.equal((await reload(report)).unlocked, true);
      });

      it("locks the permit's free rounds too, so the permit stops being open", async () => {
        const paid = await add({ permit_number: "6000001-CN" });
        await pay(paid.id);
        assert.equal(await store.permitUnlocked("6000001-CN"), true);
        const round2 = await add({ permit_number: "6000001-CN", unlocked: true, unlocked_by: "next_round" });
        const otherPermit = await add({ permit_number: "6000002-CN", unlocked: true, unlocked_by: "next_round" });
        const reply = await refund();
        assert.deepEqual([...(reply.body.relocked as string[])].sort(), [paid.id, round2.id].sort());
        assert.equal((await reload(round2)).unlocked, false);
        assert.equal((await reload(otherPermit)).unlocked, true);
        assert.equal(await other.permitUnlocked("6000001-CN"), false);
      });

      it("keeps free rounds open while a design partner holds the permit open", async () => {
        const paid = await add({ permit_number: "6000003-CN" });
        await pay(paid.id);
        const partner = await add({ permit_number: "6000003-CN", unlocked: true, unlocked_by: "design_partner" });
        const round2 = await add({ permit_number: "6000003-CN", unlocked: true, unlocked_by: "next_round" });
        await refund();
        assert.equal((await reload(paid)).unlocked, false);
        assert.equal((await reload(partner)).unlocked, true);
        assert.equal((await reload(round2)).unlocked, true);
      });

      it("keeps free rounds open while another payment holds the permit open", async () => {
        const first = await add({ permit_number: "6000004-CN" });
        const second = await add({ permit_number: "6000004-CN" });
        await pay(first.id, "pi_first");
        await pay(second.id, "pi_second");
        const round = await add({ permit_number: "6000004-CN", unlocked: true, unlocked_by: "next_round" });
        await refund("pi_first");
        assert.equal((await reload(round)).unlocked, true);
        await refund("pi_second");
        assert.equal((await reload(round)).unlocked, false);
      });

      it("ignores a charge with no PaymentIntent", async () => {
        assert.equal((await deliver("charge.refunded", refundedCharge("pi_one", { payment_intent: null }))).body.outcome, "invalid");
      });
    });

    describe("events arriving together", () => {
      it("the instance that read 'paid' just before a refund still ends up locking", async () => {
        const report = await add();
        const beforeUnlock = gate();
        const a = withGates(store, { updateReport: [beforeUnlock] });
        const paying = applyPaidSession(paidSession(report.id), a);
        await beforeUnlock.reached; // A has read "paid" and is about to unlock.
        assert.deepEqual((await applyRefund(refundedCharge(), other)).outcome, "refunded");
        assert.equal((await reload(report)).unlocked, false);
        beforeUnlock.open();
        assert.equal((await paying).outcome, "refunded");
        assert.equal((await reload(report)).unlocked, false, "A's unlock must not outlast the refund");
      });

      it("free rounds still lock when a stale unlock made the permit look open to the refund", async () => {
        const paid = await add({ permit_number: "P-RACE" });
        await pay(paid.id);
        const round = await add({ permit_number: "P-RACE", unlocked: true, unlocked_by: "next_round" });
        // Refund the report, so a replay of the payment reads "paid" only if it read before the refund.
        const aBeforeUnlock = gate();
        const aBeforeRecheck = gate();
        const bBeforeQuery = gate();
        const a = withGates(store, { updateReport: [aBeforeUnlock], reportHasActivePayment: [null, aBeforeRecheck] });
        const b = withGates(other, { unlockedOnPermit: [bBeforeQuery] });
        const replay = applyPaidSession(paidSession(paid.id), a);
        await aBeforeUnlock.reached;
        const refunding = applyRefund(refundedCharge(), b);
        await bBeforeQuery.reached; // B has locked the report, and is about to look for what holds the permit open.
        aBeforeUnlock.open();
        await aBeforeRecheck.reached; // A's stale write has now reopened the report.
        assert.equal((await reload(paid)).unlocked, true);
        bBeforeQuery.open();
        await refunding; // B sees an open report, so leaves the free round alone.
        assert.equal((await reload(round)).unlocked, true);
        aBeforeRecheck.open();
        assert.equal((await replay).outcome, "refunded");
        assert.equal((await reload(paid)).unlocked, false);
        assert.equal((await reload(round)).unlocked, false);
        assert.equal(await store.permitUnlocked("P-RACE"), false);
      });

      it("a paid session and a refund sent together always end refunded and locked", async () => {
        for (let i = 0; i < 25; i++) {
          const report = await add();
          const id = `pi_race${i}`;
          const events = [() => pay(report.id, id, i % 2 ? store : other), () => refund(id, i % 2 ? other : store)];
          if (i % 4 < 2) events.reverse();
          const replies = await Promise.all(events.map((send) => send()));
          for (const reply of replies) assert.equal(reply.status, 200, JSON.stringify(reply.body));
          const payment = (await store.getPayment(id))!;
          assert.ok(payment.paid_at && payment.refunded_at, `round ${i}: the ledger kept both facts`);
          assert.equal(payment.report_id, report.id, `round ${i}`);
          assert.equal((await reload(report)).unlocked, false, `round ${i}`);
        }
      });

      it("the same goes when each is delivered several times at once", async () => {
        for (let i = 0; i < 8; i++) {
          const report = await add();
          const id = `pi_many${i}`;
          const replies = await Promise.all([pay(report.id, id, store), refund(id, other), pay(report.id, id, other), refund(id, store), pay(report.id, id, store), refund(id, other)]);
          for (const reply of replies) assert.equal(reply.status, 200, JSON.stringify(reply.body));
          assert.equal((await reload(report)).unlocked, false, `round ${i}`);
        }
      });

      it("a new payment and a refund of an old one leave the report unlocked", async () => {
        for (let i = 0; i < 10; i++) {
          const report = await add();
          await pay(report.id, `pi_old${i}`);
          await Promise.all([refund(`pi_old${i}`, store), pay(report.id, `pi_new${i}`, other)]);
          assert.equal((await reload(report)).unlocked, true, `round ${i}`);
        }
      });

      it("refunds of a report's two payments together lock it", async () => {
        for (let i = 0; i < 10; i++) {
          const report = await add();
          await pay(report.id, `pi_a${i}`);
          await pay(report.id, `pi_b${i}`);
          await Promise.all([refund(`pi_a${i}`, store), refund(`pi_b${i}`, other)]);
          assert.equal((await reload(report)).unlocked, false, `round ${i}`);
        }
      });

      it("doesn't lose a sign-off made during a payment or a refund", async () => {
        const decide = (s: Store, id: string, comment: string) => s.updateReport(id, (r) => ({ ...r, decisions: { ...r.decisions, [comment]: { decision: "approve", note: "", at: "2026-10-31T00:00:00.000Z" } } }));
        for (let i = 0; i < 8; i++) {
          const report = await add();
          await Promise.all([pay(report.id, `pi_d${i}`, store), decide(other, report.id, "C1")]);
          assert.equal((await reload(report)).unlocked, true, `round ${i}`);
          await Promise.all([decide(other, report.id, "C2"), refund(`pi_d${i}`, store)]);
          const after = await reload(report);
          assert.equal(after.unlocked, false, `round ${i}`);
          assert.deepEqual(Object.keys(after.decisions).sort(), ["C1", "C2"], `round ${i}`);
        }
      });
    });

    describe("the redirect", () => {
      const stripeReturning = (session: object, ok = true) => (async () => new Response(JSON.stringify(session), { status: ok ? 200 : 404 })) as typeof fetch;
      beforeEach(() => {
        process.env.STRIPE_SECRET_KEY = "sk_test_made_up";
      });
      after(() => {
        delete process.env.STRIPE_SECRET_KEY;
      });

      it("unlocks the right report from a paid session", async () => {
        const report = await add();
        assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id)), store), report.id);
        assert.equal((await reload(report)).unlocked, true);
        assert.equal((await store.getPayment("pi_one"))?.report_id, report.id);
      });

      it("agrees with the webhook, in either order", async () => {
        const report = await add();
        assert.equal((await pay(report.id)).body.outcome, "unlocked");
        assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id)), other), report.id);
        const second = await add();
        assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(second.id, "pi_two")), other), second.id);
        assert.equal((await pay(second.id, "pi_two")).body.outcome, "already_unlocked");
      });

      it("can't unlock with an old link after a refund, though Stripe still says paid", async () => {
        const report = await add();
        await pay(report.id);
        await refund();
        assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id)), other), null);
        assert.equal((await reload(report)).unlocked, false);
      });

      it("refuses unpaid sessions, Stripe errors and unknown reports", async () => {
        const report = await add();
        assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id, "pi_one", { payment_status: "unpaid" })), store), null);
        assert.equal(await confirmPayment("cs_test_abc", stripeReturning({}, false), store), null);
        assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession("f".repeat(32))), store), null);
        assert.equal((await reload(report)).unlocked, false);
      });

      it("never calls out for a malformed session id or without a key", async () => {
        const report = await add();
        const refuse = (async () => assert.fail("should not call Stripe")) as typeof fetch;
        assert.equal(await confirmPayment("../../v1/charges", refuse, store), null);
        assert.equal(await confirmPayment("", refuse, store), null);
        delete process.env.STRIPE_SECRET_KEY;
        assert.equal(await confirmPayment("cs_test_abc", refuse, store), null);
        assert.equal((await reload(report)).unlocked, false);
      });
    });

    if (backend.admin) {
      describe("the migration", () => {
        it("adds the ledger to a database already holding reports, once, and keeps them", async () => {
          const admin = backend.admin!();
          const report = await add();
          await admin.query("DROP TABLE redline_payments");
          await admin.query("DELETE FROM redline_migrations WHERE name = '002_payments.sql'");
          assert.deepEqual(await applyMigrations(admin), ["002_payments.sql"]);
          assert.deepEqual(await applyMigrations(admin), []);
          assert.ok(await store.getReport(report.id));
          assert.equal((await pay(report.id)).body.outcome, "unlocked");
        });
      });
    }
  });
}

// ---------- the real server, on both backends ----------

interface Deployment {
  name: string;
  start(ports: number[]): Promise<{ store: Store; env: Record<string, string>; stop: () => Promise<void> }>;
  /** Local files are safe for one process only, so only Postgres gets a second instance. */
  instances: 1 | 2;
  dataDir?: () => string;
}

let localDir = "";
const deployments: Deployment[] = [
  {
    name: "local files, one instance, in a scratch REDLINE_DATA_DIR",
    instances: 1,
    dataDir: () => localDir,
    start: async () => {
      localDir = mkdtempSync(join(tmpdir(), "redline-payments-server-"));
      return { store: createLocalStore(localDir), env: { REDLINE_DATA_DIR: localDir }, stop: async () => rmSync(localDir, { recursive: true, force: true }) };
    },
  },
  {
    name: "Postgres (PGlite), two instances",
    instances: 2,
    start: async () => {
      const [port] = await freePorts(1);
      const standIn = await startPostgresStandIn(port);
      const store = createPostgresStore(standIn.url);
      return {
        store,
        env: { DATABASE_URL: standIn.url },
        stop: async () => {
          await store.close();
          await standIn.stop();
        },
      };
    },
  },
];

for (const deployment of deployments) {
  describe(`the real server on ${deployment.name}`, () => {
    let servers: ChildProcess[] = [];
    let store: Store;
    let stopBackend = async () => {};
    let ports: number[] = [];

    /** A raw request, so the path reaches the server exactly as written. */
    const call = (port: number, method: string, path: string, options: { headers?: Record<string, string>; chunks?: Buffer[] } = {}) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, method, path, headers: options.headers }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        void (async () => {
          for (const chunk of options.chunks ?? []) {
            req.write(chunk);
            await new Promise((r) => setTimeout(r, 15));
          }
          req.end();
        })();
      });
    const keyed = { "x-redline-key": SERVICE_KEY };
    /** Two different instances when there are two, so a write and the next read cross between them. */
    const a = () => ports[0];
    const b = () => ports[ports.length - 1];
    const nowSeconds = () => Math.floor(Date.now() / 1000);
    const signed = (body: Buffer) => ({ "stripe-signature": header(body, nowSeconds()), "content-type": "application/json" });
    const send = (port: number, type: string, object: object) => {
      const body = event(type, object);
      return call(port, "POST", WEBHOOK_PATH, { headers: signed(body), chunks: [body] });
    };
    const payOver = (port: number, id: string, pi: string) => send(port, "checkout.session.completed", paidSession(id, pi));
    const refundOver = (port: number, pi: string) => send(port, "charge.refunded", refundedCharge(pi));
    const add = async (overrides: Partial<Report> = {}) => {
      const report = fixture(overrides);
      await store.createReport(report);
      return report;
    };
    const unlockedOver = async (port: number, id: string) => (JSON.parse((await call(port, "GET", `/api/report/${id}`, { headers: keyed })).body) as { unlocked: boolean }).unlocked;

    /** Every route that could show a locked report's contents. */
    async function assertLockedOverHttp(port: number, report: Report, jobId: string) {
      for (const path of [`/api/report/${report.id}`, `/api/job/${jobId}`]) {
        const res = await call(port, "GET", path, { headers: keyed });
        assert.equal(res.status, 200, path);
        for (const secret of LOCKED_SECRETS) assert.ok(!res.body.includes(secret), `${secret} leaked from ${path}`);
        assert.ok(res.body.includes("DRAFT-C1"), "the free preview stays");
      }
      const exported = await call(port, "GET", `/api/report/${report.id}/export`, { headers: keyed });
      assert.equal(exported.status, 402);
      for (const secret of LOCKED_SECRETS) assert.ok(!exported.body.includes(secret), `${secret} leaked from export`);
      const decision = Buffer.from(JSON.stringify({ comment: "C4", decision: "approve", note: "" }));
      assert.equal((await call(port, "POST", `/api/report/${report.id}/review`, { headers: keyed, chunks: [decision] })).status, 402);
      assert.equal((await call(port, "POST", `/api/report/${report.id}/optin`, { headers: keyed, chunks: [Buffer.from('{"opt_in":true}')] })).status, 402);
    }

    before(async () => {
      ports = await freePorts(deployment.instances);
      const backend = await deployment.start(ports);
      store = backend.store;
      stopBackend = backend.stop;
      servers = await Promise.all(
        ports.map(
          (port) =>
            new Promise<ChildProcess>((resolve, reject) => {
              const child = spawn(process.execPath, ["--import", "tsx", "--import", "./demo/test-no-network.ts", "demo/server.ts"], {
                cwd: ROOT,
                stdio: ["ignore", "pipe", "ignore"],
                // Empty values win over a developer's .env, so nothing here can reach a real database or payment account.
                env: { PATH: process.env.PATH, HOME: process.env.HOME, DEMO_PORT: String(port), REDLINE_HOST: "127.0.0.1", REDLINE_API_KEY: SERVICE_KEY, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "", STRIPE_PAYMENT_LINK: "", DATABASE_URL: "", TRUEFORGE_BASE_URL: "http://127.0.0.1:1", TRUEFORGE_TOKEN: "", ...backend.env },
              });
              const timer = setTimeout(() => reject(new Error("The server didn't start")), 30_000);
              child.stdout?.on("data", (d) => {
                if (String(d).includes("Redline on")) {
                  clearTimeout(timer);
                  resolve(child);
                }
              });
              child.once("exit", (code) => reject(new Error(`The server exited with ${code}`)));
            }),
        ),
      );
    });
    after(async () => {
      for (const server of servers) {
        server.removeAllListeners("exit");
        server.kill();
      }
      await stopBackend();
    });

    it("takes a signed webhook with no service key, and unlocks the report for every instance", async () => {
      const r = await add();
      const reply = await payOver(a(), r.id, "pi_http1");
      assert.equal(reply.status, 200, reply.body);
      assert.equal(JSON.parse(reply.body).outcome, "unlocked");
      assert.equal(await unlockedOver(b(), r.id), true);
      assert.equal(JSON.parse((await payOver(b(), r.id, "pi_http1")).body).outcome, "already_unlocked");
    });

    it("verifies the raw bytes when a character is split across network chunks", async () => {
      const r = await add();
      const body = Buffer.from(JSON.stringify({ id: "evt_split", type: "checkout.session.completed", note: "Café ✓", data: { object: paidSession(r.id, "pi_split") } }));
      const middle = body.indexOf(Buffer.from("✓")) + 1;
      const reply = await call(a(), "POST", WEBHOOK_PATH, { headers: signed(body), chunks: [body.subarray(0, middle), body.subarray(middle)] });
      assert.equal(reply.status, 200, reply.body);
      assert.equal(JSON.parse(reply.body).outcome, "unlocked");
    });

    it("refuses a bad signature and an old timestamp with no service key", async () => {
      const r = await add();
      const body = event("checkout.session.completed", paidSession(r.id, "pi_refused"));
      assert.equal((await call(a(), "POST", WEBHOOK_PATH, { headers: { "stripe-signature": header(body, nowSeconds(), "whsec_forged") }, chunks: [body] })).status, 400);
      assert.equal((await call(a(), "POST", WEBHOOK_PATH, { headers: { "stripe-signature": header(body, nowSeconds() - 3600) }, chunks: [body] })).status, 400);
      assert.equal((await call(a(), "POST", WEBHOOK_PATH, { chunks: [body] })).status, 400);
      assert.equal(await unlockedOver(a(), r.id), false);
      assert.equal(await store.getPayment("pi_refused"), null);
    });

    it("answers an oversized body with 413", async () => {
      assert.equal((await call(a(), "POST", WEBHOOK_PATH, { chunks: [Buffer.alloc(1_000_001, 32)] })).status, 413);
    });

    it("still needs the service key everywhere else, including through path tricks", async () => {
      const r = await add();
      for (const port of [a(), b()]) {
        const paths = [
          `/api/report/${r.id}`,
          `/x/../api/report/${r.id}`,
          `/./api/report/${r.id}`,
          `/%2e%2e/api/report/${r.id}`,
          `/x/..\\api/report/${r.id}`,
          `http://elsewhere/api/report/${r.id}`,
          `${WEBHOOK_PATH}/../../report/${r.id}`,
          "/api/bootstrap",
          WEBHOOK_PATH,
        ];
        for (const path of paths) {
          const reply = await call(port, "GET", path);
          assert.equal(reply.status, 401, `GET ${path} answered ${reply.status}`);
          assert.ok(!reply.body.includes("DRAFT-"), path);
        }
        for (const path of [`${WEBHOOK_PATH}/`, `${WEBHOOK_PATH}x`, `${WEBHOOK_PATH}/../report/${r.id}/unlock`, `/x/../api/report/${r.id}/unlock`, "/api/analyze"]) {
          assert.equal((await call(port, "POST", path)).status, 401, `POST ${path}`);
        }
        assert.equal((await call(port, "GET", `/api/report/${r.id}`, { headers: keyed })).status, 200);
      }
    });

    it("keeps the customer pages and the redirect open", async () => {
      assert.equal((await call(a(), "GET", "/start")).status, 200);
      // With no Stripe key configured this returns before any network call.
      const paid = await call(a(), "GET", "/paid?session_id=cs_test_x");
      assert.equal(paid.status, 302);
    });

    it("never shows locked drafts or citations over HTTP: before paying, after a refund, and after a replayed payment", async () => {
      const report = await add();
      const jobId = fixture().id;
      await store.createJob(jobId);
      await store.finishJob(jobId, 200, { report_id: report.id });

      await assertLockedOverHttp(a(), report, jobId);
      await assertLockedOverHttp(b(), report, jobId);

      await payOver(a(), report.id, "pi_paywall");
      const open = await call(b(), "GET", `/api/report/${report.id}`, { headers: keyed });
      for (const secret of LOCKED_SECRETS) assert.ok(open.body.includes(secret), `${secret} should show once paid`);
      assert.equal((await call(b(), "GET", `/api/report/${report.id}/export`, { headers: keyed })).status, 200);

      await refundOver(b(), "pi_paywall");
      await assertLockedOverHttp(a(), report, jobId);
      await assertLockedOverHttp(b(), report, jobId);

      assert.equal(JSON.parse((await payOver(a(), report.id, "pi_paywall")).body).outcome, "refunded");
      await assertLockedOverHttp(a(), report, jobId);
      await assertLockedOverHttp(b(), report, jobId);
    });

    it("a paid session and a refund sent together, across instances, leave the drafts hidden", async () => {
      const jobId = fixture().id;
      for (let i = 0; i < 12; i++) {
        const report = await add();
        const pi = `pi_together${i}`;
        const sends = i % 2 ? [() => payOver(a(), report.id, pi), () => refundOver(b(), pi)] : [() => refundOver(a(), pi), () => payOver(b(), report.id, pi)];
        const replies = await Promise.all(sends.map((go) => go()));
        for (const reply of replies) assert.equal(reply.status, 200, reply.body);
        const payment = (await store.getPayment(pi))!;
        assert.ok(payment.paid_at && payment.refunded_at, `round ${i}`);
        if (i === 0) {
          await store.createJob(jobId);
          await store.finishJob(jobId, 200, { report_id: report.id });
          await assertLockedOverHttp(a(), report, jobId);
          await assertLockedOverHttp(b(), report, jobId);
        } else {
          const view = await call(b(), "GET", `/api/report/${report.id}`, { headers: keyed });
          for (const secret of LOCKED_SECRETS) assert.ok(!view.body.includes(secret), `round ${i}: ${secret} leaked`);
        }
        assert.equal(await unlockedOver(a(), report.id), false, `round ${i}`);
      }
    });

    if (deployment.dataDir) {
      it("keeps reports and the ledger in REDLINE_DATA_DIR, not the default folder", async () => {
        const r = await add();
        await payOver(a(), r.id, "pi_scratch");
        const dir = deployment.dataDir!();
        assert.ok(existsSync(join(dir, "reports", `${r.id}.json`)));
        assert.ok(existsSync(join(dir, "payments", "pi_scratch.json")));
        assert.equal(existsSync(join(ROOT, ".cache", "payments", "pi_scratch.json")), false);
        assert.equal(existsSync(join(ROOT, ".cache", "reports", `${r.id}.json`)), false);
      });
    }
  });
}
