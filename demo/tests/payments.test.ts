// npm run test:payments
// Offline tests of the payment path. Every event is built here and signed with a made-up secret. Nothing talks to
// Stripe: the only sockets are to a copy of demo/server.ts on localhost, and global fetch throws if anything calls it.
// This shows the code agrees with Stripe's documented format. It doesn't show that Stripe agrees.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { applyPaidSession, applyRefund, type CheckoutSession, confirmPayment, processWebhook, readPayment, requiresServiceKey, SIGNATURE_TOLERANCE_SECONDS, verifySignature, WEBHOOK_PATH } from "../payments.ts";
import { dataDir, loadReport, newReportId, permitAlreadyUnlocked, publicView, type Report, saveReport } from "../reports.ts";

const SECRET = "whsec_made_up_for_tests_only";
const SERVICE_KEY = "made-up-service-key";
const NOW = 1_800_000_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sign = (body: Buffer | string, t = NOW, secret = SECRET) => createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");
const header = (body: Buffer | string, t = NOW, secret = SECRET) => `t=${t},v1=${sign(body, t, secret)}`;

let eventCount = 0;
const event = (type: string, object: object) => Buffer.from(JSON.stringify({ id: `evt_${++eventCount}`, object: "event", type, data: { object } }));
const paidSession = (reportId: string, paymentIntent = "pi_one", overrides: object = {}): CheckoutSession => ({
  id: `cs_test_${paymentIntent}`,
  object: "checkout.session",
  payment_status: "paid",
  client_reference_id: reportId,
  payment_intent: paymentIntent,
  amount_total: 5900,
  currency: "usd",
  livemode: false,
  ...overrides,
} as CheckoutSession);
const refundedCharge = (paymentIntent = "pi_one", overrides: object = {}) => ({ id: "ch_one", object: "charge", amount: 5900, amount_refunded: 5900, refunded: true, payment_intent: paymentIntent, ...overrides });
const deliver = (type: string, object: object) => {
  const body = event(type, object);
  return processWebhook(body, header(body), SECRET, NOW);
};
const pay = (reportId: string, paymentIntent = "pi_one") => deliver("checkout.session.completed", paidSession(reportId, paymentIntent));
const refund = (paymentIntent = "pi_one") => deliver("charge.refunded", refundedCharge(paymentIntent));

function makeReport(overrides: Partial<Report> = {}): Report {
  const report: Report = {
    id: newReportId(),
    created_at: "2026-10-31T00:00:00.000Z",
    jurisdiction: "seattle",
    place: "Seattle",
    permit_number: null,
    project: "A fictional project",
    comments: [1, 2, 3, 4, 5].map((n) => ({ id: `C${n}`, heading: "Pasted", text: `Fictional comment ${n}` })),
    items: [1, 2, 3, 4, 5].map((n) => ({ comment: `C${n}`, route: "agent_draft", discipline: null, citation: `SECRET-CITATION-${n}`, draft: `SECRET-DRAFT-${n}`, sheets: [] })) as unknown as Report["items"],
    session_id: "session_fictional",
    trace: [],
    unlocked: false,
    unlocked_by: null,
    learning_opt_in: false,
    decisions: {},
    ...overrides,
  };
  saveReport(report);
  return report;
}
const reload = (r: Report) => loadReport(r.id) as Report;

const scratch = mkdtempSync(join(tmpdir(), "redline-payments-"));
let runs = 0;

before(() => {
  // Any stray call to Stripe fails the test rather than leaving the machine.
  globalThis.fetch = (() => {
    throw new Error("Network call attempted in an offline test");
  }) as typeof fetch;
  console.warn = () => {};
  console.error = () => {};
});
beforeEach(() => {
  process.env.REDLINE_DATA_DIR = join(scratch, `run-${++runs}`);
});
after(() => rmSync(scratch, { recursive: true, force: true }));

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
  it("rejects an old timestamp even with a valid signature", () => {
    const old = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
    assert.equal(reasonOf(body, header(body, old)), "stale_timestamp");
  });
  it("rejects a timestamp far in the future", () => {
    const future = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
    assert.equal(reasonOf(body, header(body, future)), "stale_timestamp");
  });
  it("accepts a timestamp right at the limit", () => assert.equal(reasonOf(body, header(body, NOW - SIGNATURE_TOLERANCE_SECONDS)), "ok"));
  it("checks the exact bytes: reformatting the same JSON fails", () => {
    const raw = Buffer.from('{ "id" : "evt_x",\n  "name": "Café ✓" }');
    assert.equal(reasonOf(raw, header(raw)), "ok");
    assert.equal(reasonOf(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), header(raw)), "bad_signature");
  });
});

describe("webhook delivery", () => {
  it("a paid session unlocks the right report and no other", () => {
    const target = makeReport();
    const bystander = makeReport();
    const reply = pay(target.id);
    assert.equal(reply.status, 200);
    assert.equal(reply.body.outcome, "unlocked");
    assert.equal(reply.body.report_id, target.id);
    assert.equal(reload(target).unlocked, true);
    assert.equal(reload(target).unlocked_by, "stripe");
    assert.equal(reload(bystander).unlocked, false);
    assert.equal(readPayment("pi_one")?.report_id, target.id);
  });

  it("unlocking is what reveals the drafts", () => {
    const report = makeReport();
    assert.ok(publicView(reload(report)).items.some((i) => i.locked));
    pay(report.id);
    assert.ok(publicView(reload(report)).items.every((i) => !i.locked));
  });

  it("does nothing on a bad signature and on an old timestamp", () => {
    const report = makeReport();
    const body = event("checkout.session.completed", paidSession(report.id));
    assert.equal(processWebhook(body, header(body, NOW, "whsec_forged"), SECRET, NOW).status, 400);
    assert.equal(processWebhook(body, undefined, SECRET, NOW).status, 400);
    assert.equal(processWebhook(body, header(body, NOW - 301), SECRET, NOW).status, 400);
    assert.equal(reload(report).unlocked, false);
    assert.equal(readPayment("pi_one"), null);
  });

  it("refuses everything while no secret is set, so Stripe retries later", () => {
    const report = makeReport();
    const body = event("checkout.session.completed", paidSession(report.id));
    assert.equal(processWebhook(body, header(body), "", NOW).status, 503);
    assert.equal(reload(report).unlocked, false);
  });

  it("a replay of the same bytes changes nothing", () => {
    const report = makeReport();
    const body = event("checkout.session.completed", paidSession(report.id));
    assert.equal(processWebhook(body, header(body), SECRET, NOW).body.outcome, "unlocked");
    const reportBytes = readFileSync(join(dataDir(), "reports", `${report.id}.json`));
    const ledgerBytes = readFileSync(join(dataDir(), "payments", "pi_one.json"));
    const again = processWebhook(body, header(body), SECRET, NOW);
    assert.equal(again.status, 200);
    assert.equal(again.body.outcome, "already_unlocked");
    assert.deepEqual(readFileSync(join(dataDir(), "reports", `${report.id}.json`)), reportBytes);
    assert.deepEqual(readFileSync(join(dataDir(), "payments", "pi_one.json")), ledgerBytes);
  });

  it("the same payment under a new event id is also harmless", () => {
    const report = makeReport();
    pay(report.id);
    assert.equal(pay(report.id).body.outcome, "already_unlocked");
    assert.equal(reload(report).unlocked_by, "stripe");
  });

  it("doesn't unlock an unpaid session", () => {
    const report = makeReport();
    const reply = deliver("checkout.session.completed", paidSession(report.id, "pi_one", { payment_status: "unpaid" }));
    assert.equal(reply.status, 200);
    assert.equal(reply.body.outcome, "not_paid");
    assert.equal(reload(report).unlocked, false);
  });

  it("unlocks when a delayed payment clears, and not before", () => {
    const report = makeReport();
    deliver("checkout.session.completed", paidSession(report.id, "pi_one", { payment_status: "unpaid" }));
    assert.equal(reload(report).unlocked, false);
    assert.equal(deliver("checkout.session.async_payment_succeeded", paidSession(report.id)).body.outcome, "unlocked");
    assert.equal(reload(report).unlocked, true);
  });

  it("accepts a payment for an unknown report without retrying forever, and records it", () => {
    const reply = pay("0".repeat(32));
    assert.equal(reply.status, 200);
    assert.equal(reply.body.outcome, "unknown_report");
    assert.equal(readPayment("pi_one")?.status, "paid");
    assert.equal(readPayment("pi_one")?.report_id, null);
  });

  it("can't reach outside the folder through client_reference_id or payment_intent", () => {
    assert.equal(pay("../../etc/passwd").body.outcome, "unknown_report");
    assert.equal(deliver("checkout.session.completed", paidSession(makeReport().id, "../../evil")).body.outcome, "invalid");
    assert.equal(deliver("charge.refunded", refundedCharge("../../evil")).body.outcome, "invalid");
  });

  it("acknowledges event types it doesn't handle", () => {
    const reply = deliver("customer.created", { id: "cus_x" });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.outcome, "ignored");
  });

  it("rejects signed bodies that aren't usable events, including thin events", () => {
    const notJson = Buffer.from("not json");
    assert.equal(processWebhook(notJson, header(notJson), SECRET, NOW).status, 400);
    const thin = Buffer.from(JSON.stringify({ id: "evt_x", object: "v2.core.event", type: "checkout.session.completed", related_object: { id: "cs_x" } }));
    assert.equal(processWebhook(thin, header(thin), SECRET, NOW).status, 400);
    const nullBody = Buffer.from("null");
    assert.equal(processWebhook(nullBody, header(nullBody), SECRET, NOW).status, 400);
  });
});

describe("refunds", () => {
  it("a full refund re-locks and hides the drafts, and keeps the decisions", () => {
    const decisions = { C1: { decision: "approve" as const, note: "fine", at: "2026-10-31T00:00:00.000Z" } };
    const report = makeReport({ decisions });
    pay(report.id);
    const reply = refund();
    assert.equal(reply.body.outcome, "refunded");
    assert.deepEqual(reply.body.relocked, [report.id]);
    const after = reload(report);
    assert.equal(after.unlocked, false);
    assert.equal(after.unlocked_by, null);
    assert.deepEqual(after.decisions, decisions);
    assert.equal(readPayment("pi_one")?.status, "refunded");
    const view = JSON.stringify(publicView(after));
    assert.ok(!view.includes("SECRET-DRAFT-4"));
    assert.ok(view.includes("SECRET-DRAFT-1"), "the free preview stays");
  });

  it("a partial refund leaves it unlocked", () => {
    const report = makeReport();
    pay(report.id);
    const reply = deliver("charge.refunded", refundedCharge("pi_one", { refunded: false, amount_refunded: 1000 }));
    assert.equal(reply.body.outcome, "partial");
    assert.equal(reload(report).unlocked, true);
    assert.equal(readPayment("pi_one")?.status, "paid");
    assert.equal(readPayment("pi_one")?.amount_refunded, 1000);
  });

  it("a partial refund followed by the rest re-locks", () => {
    const report = makeReport();
    pay(report.id);
    deliver("charge.refunded", refundedCharge("pi_one", { refunded: false, amount_refunded: 1000 }));
    refund();
    assert.equal(reload(report).unlocked, false);
    assert.equal(readPayment("pi_one")?.amount_refunded, 5900);
  });

  it("a replayed payment event can't undo a refund", () => {
    const report = makeReport();
    const body = event("checkout.session.completed", paidSession(report.id));
    processWebhook(body, header(body), SECRET, NOW);
    refund();
    assert.equal(processWebhook(body, header(body), SECRET, NOW).body.outcome, "refunded");
    assert.equal(reload(report).unlocked, false);
  });

  it("a replayed refund is harmless", () => {
    const report = makeReport();
    pay(report.id);
    refund();
    const refundedAt = readPayment("pi_one")?.refunded_at;
    assert.equal(refund().body.outcome, "refunded");
    assert.equal(reload(report).unlocked, false);
    assert.equal(readPayment("pi_one")?.refunded_at, refundedAt);
  });

  it("handles a refund that arrives before its payment event", () => {
    const report = makeReport();
    assert.equal(refund().body.outcome, "refunded");
    assert.equal(pay(report.id).body.outcome, "refunded");
    assert.equal(reload(report).unlocked, false);
    assert.equal(readPayment("pi_one")?.report_id, report.id);
  });

  it("paying again after a refund unlocks, and replaying the old refund doesn't re-lock", () => {
    const report = makeReport();
    pay(report.id, "pi_first");
    refund("pi_first");
    assert.equal(pay(report.id, "pi_second").body.outcome, "unlocked");
    assert.deepEqual(refund("pi_first").body.relocked, []);
    assert.equal(reload(report).unlocked, true);
  });

  it("refunding one of two payments for a report leaves it unlocked", () => {
    const report = makeReport();
    pay(report.id, "pi_first");
    pay(report.id, "pi_second");
    refund("pi_first");
    assert.equal(reload(report).unlocked, true);
    refund("pi_second");
    assert.equal(reload(report).unlocked, false);
  });

  it("never locks a design partner's report", () => {
    const report = makeReport({ unlocked: true, unlocked_by: "design_partner" });
    assert.equal(pay(report.id).body.outcome, "already_unlocked");
    assert.equal(reload(report).unlocked_by, "design_partner");
    refund();
    assert.equal(reload(report).unlocked, true);
  });

  it("locks the permit's free rounds too, so the permit stops being open", () => {
    const paid = makeReport({ permit_number: "6000001-CN" });
    pay(paid.id);
    assert.equal(permitAlreadyUnlocked("6000001-CN"), true);
    const round2 = makeReport({ permit_number: "6000001-CN", unlocked: true, unlocked_by: "next_round" });
    const otherPermit = makeReport({ permit_number: "6000002-CN", unlocked: true, unlocked_by: "next_round" });
    const reply = refund();
    assert.deepEqual([...(reply.body.relocked as string[])].sort(), [paid.id, round2.id].sort());
    assert.equal(reload(round2).unlocked, false);
    assert.equal(reload(otherPermit).unlocked, true);
    assert.equal(permitAlreadyUnlocked("6000001-CN"), false);
  });

  it("keeps free rounds open while another payment or a design partner holds the permit open", () => {
    const paid = makeReport({ permit_number: "6000003-CN" });
    pay(paid.id);
    const partner = makeReport({ permit_number: "6000003-CN", unlocked: true, unlocked_by: "design_partner" });
    const round2 = makeReport({ permit_number: "6000003-CN", unlocked: true, unlocked_by: "next_round" });
    refund();
    assert.equal(reload(paid).unlocked, false);
    assert.equal(reload(partner).unlocked, true);
    assert.equal(reload(round2).unlocked, true);
  });

  it("ignores a charge with no PaymentIntent", () => {
    assert.equal(deliver("charge.refunded", refundedCharge("pi_one", { payment_intent: null })).body.outcome, "invalid");
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
    const report = makeReport();
    assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id))), report.id);
    assert.equal(reload(report).unlocked, true);
    assert.equal(readPayment("pi_one")?.report_id, report.id);
  });

  it("agrees with the webhook, in either order", async () => {
    const report = makeReport();
    assert.equal(pay(report.id).body.outcome, "unlocked");
    assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id))), report.id);
    const second = makeReport();
    assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(second.id, "pi_two"))), second.id);
    assert.equal(pay(second.id, "pi_two").body.outcome, "already_unlocked");
  });

  it("can't unlock with an old link after a refund, though Stripe still says paid", async () => {
    const report = makeReport();
    pay(report.id);
    refund();
    assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id))), null);
    assert.equal(reload(report).unlocked, false);
  });

  it("refuses unpaid sessions, Stripe errors and unknown reports", async () => {
    const report = makeReport();
    assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession(report.id, "pi_one", { payment_status: "unpaid" }))), null);
    assert.equal(await confirmPayment("cs_test_abc", stripeReturning({}, false)), null);
    assert.equal(await confirmPayment("cs_test_abc", stripeReturning(paidSession("f".repeat(32)))), null);
    assert.equal(reload(report).unlocked, false);
  });

  it("never calls out for a malformed session id or without a key", async () => {
    const report = makeReport();
    const refuse = (async () => assert.fail("should not call Stripe")) as typeof fetch;
    assert.equal(await confirmPayment("../../v1/charges", refuse), null);
    assert.equal(await confirmPayment("", refuse), null);
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(await confirmPayment("cs_test_abc", refuse), null);
    assert.equal(reload(report).unlocked, false);
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
  it("doesn't exempt other methods at the webhook path through a parsed URL", () => assert.equal(requiresServiceKey(undefined, WEBHOOK_PATH), true));
});

describe("the real server on localhost, with no network beyond it", () => {
  let server: ChildProcess;
  let port = 0;
  let serverDir = "";

  /** A raw request, so the path reaches the server exactly as written. */
  const call = (method: string, path: string, options: { headers?: Record<string, string>; chunks?: Buffer[] } = {}) =>
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
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const signed = (body: Buffer) => ({ "stripe-signature": header(body, nowSeconds()), "content-type": "application/json" });
  const report = () => {
    process.env.REDLINE_DATA_DIR = serverDir;
    return makeReport();
  };

  /** A free port in the range this project may use. */
  const freePort = async () => {
    for (let candidate = 8800; candidate <= 8899; candidate++) {
      const free = await new Promise<boolean>((resolve) => {
        const probe = createServer();
        probe.once("error", () => resolve(false));
        probe.listen(candidate, "127.0.0.1", () => probe.close(() => resolve(true)));
      });
      if (free) return candidate;
    }
    throw new Error("No free port in 8800-8899");
  };

  before(async () => {
    port = await freePort();
    serverDir = join(scratch, "server");
    server = spawn(process.execPath, ["--import", "tsx", join(ROOT, "demo", "server.ts")], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DEMO_PORT: String(port), REDLINE_HOST: "127.0.0.1", REDLINE_API_KEY: SERVICE_KEY, REDLINE_DATA_DIR: serverDir, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "", STRIPE_PAYMENT_LINK: "" },
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The server didn't start")), 30_000);
      server.stdout?.on("data", (d) => {
        if (String(d).includes("Redline on")) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.once("exit", (code) => reject(new Error(`The server exited with ${code}`)));
    });
  });
  after(() => {
    server?.removeAllListeners("exit");
    server?.kill();
  });

  it("takes a signed webhook with no service key, and unlocks the report", async () => {
    const r = report();
    const body = event("checkout.session.completed", paidSession(r.id));
    const reply = await call("POST", WEBHOOK_PATH, { headers: signed(body), chunks: [body] });
    assert.equal(reply.status, 200, reply.body);
    assert.equal(JSON.parse(reply.body).outcome, "unlocked");
    const view = await call("GET", `/api/report/${r.id}`, { headers: keyed });
    assert.equal(JSON.parse(view.body).unlocked, true);
    const replay = await call("POST", WEBHOOK_PATH, { headers: signed(body), chunks: [body] });
    assert.equal(JSON.parse(replay.body).outcome, "already_unlocked");
  });

  it("verifies the raw bytes when a character is split across network chunks", async () => {
    const r = report();
    const body = Buffer.from(JSON.stringify({ id: "evt_split", type: "checkout.session.completed", note: "Café ✓", data: { object: paidSession(r.id, "pi_split") } }));
    const middle = body.indexOf(Buffer.from("✓")) + 1;
    const reply = await call("POST", WEBHOOK_PATH, { headers: signed(body), chunks: [body.subarray(0, middle), body.subarray(middle)] });
    assert.equal(reply.status, 200, reply.body);
    assert.equal(JSON.parse(reply.body).outcome, "unlocked");
  });

  it("refuses a bad signature and an old timestamp with no service key", async () => {
    const r = report();
    const body = event("checkout.session.completed", paidSession(r.id, "pi_refused"));
    assert.equal((await call("POST", WEBHOOK_PATH, { headers: { "stripe-signature": header(body, nowSeconds(), "whsec_forged") }, chunks: [body] })).status, 400);
    assert.equal((await call("POST", WEBHOOK_PATH, { headers: { "stripe-signature": header(body, nowSeconds() - 3600) }, chunks: [body] })).status, 400);
    assert.equal((await call("POST", WEBHOOK_PATH, { chunks: [body] })).status, 400);
    const view = await call("GET", `/api/report/${r.id}`, { headers: keyed });
    assert.equal(JSON.parse(view.body).unlocked, false);
  });

  it("answers an oversized body with 413", async () => {
    const big = Buffer.alloc(1_000_001, 32);
    assert.equal((await call("POST", WEBHOOK_PATH, { chunks: [big] })).status, 413);
  });

  it("still needs the service key everywhere else, including through path tricks", async () => {
    const r = report();
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
      const reply = await call("GET", path);
      assert.equal(reply.status, 401, `GET ${path} answered ${reply.status}`);
      assert.ok(!reply.body.includes("SECRET-DRAFT"), path);
    }
    for (const path of [`${WEBHOOK_PATH}/`, `${WEBHOOK_PATH}x`, `${WEBHOOK_PATH}/../report/${r.id}/unlock`, `/x/../api/report/${r.id}/unlock`, "/api/analyze"]) {
      assert.equal((await call("POST", path)).status, 401, `POST ${path}`);
    }
    assert.equal((await call("GET", `/api/report/${r.id}`, { headers: keyed })).status, 200);
  });

  it("keeps the customer pages and the redirect open", async () => {
    assert.equal((await call("GET", "/start")).status, 200);
    // With no Stripe key configured this returns before any network call.
    assert.equal((await call("GET", "/paid?session_id=cs_test_x")).status, 302);
  });
});
