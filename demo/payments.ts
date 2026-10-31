// Everything about being paid: the Payment Link, the redirect check, the Stripe webhook and refunds.
// Setup steps are in docs/stripe-setup.md. Nothing here has been run against Stripe itself: the tests build their own
// events with a made-up secret.
//
// Stripe can repeat an event, send the same change as two events with different ids, and deliver events in any order,
// to any instance. So an event doesn't change a report directly. It adds a fact to the payment ledger in the Store, and
// then the report is brought in line with the ledger (settleReport). That gives three properties:
// - Safe to receive twice: merging a fact again changes nothing, and neither does settling a report that's already right.
// - Any order: facts merge to the same result in any order, and the report follows the ledger, not the latest event.
// - A refund can't be undone by a later message: nothing clears refunded_at. A Checkout Session still says
//   payment_status "paid" after a refund, so the redirect and the webhook both go through the ledger before unlocking.
//
// Refund policy: a full refund re-locks the report, and a partial refund doesn't.
// - Access follows payment. The price is what unlocks the drafts, and with a 14-day no-questions refund, keeping access
//   would make every report free for anyone who asks.
// - The permit's free later rounds depended on that payment, so they re-lock too. Otherwise one free round would keep
//   the permit open forever, because permitAlreadyUnlocked counts any unlocked report on the permit.
// - It takes back access, not work. The free preview stays, the customer's decisions are kept and paying again restores
//   the report. Anything already exported can't be recalled, and the policy doesn't pretend otherwise.
// - A partial refund is a goodwill credit on a sale that still stands.
// - Design partner reports were never paid for, so no refund can lock them.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Report } from "./reports.ts";
import { getStore, PAYMENT_ID_PATTERN, type Store } from "./store.ts";

export const WEBHOOK_PATH = "/api/stripe/webhook";
/** The same five minutes Stripe's own libraries default to. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_WEBHOOK_BYTES = 1_000_000;

// ---------- configuration ----------

const paymentLink = () => process.env.STRIPE_PAYMENT_LINK || "";
const stripeKey = () => process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || "";

export const paymentsOn = () => Boolean(paymentLink() && stripeKey());
export const checkoutUrl = (reportId: string) => `${paymentLink()}?client_reference_id=${reportId}`;

/** Selling without the webhook works until a refund arrives, and then the refund never re-locks anything. */
export function configWarning(): string | null {
  return paymentsOn() && !webhookSecret() ? "Payments are on but STRIPE_WEBHOOK_SECRET isn't set, so the webhook is refused and refunds won't re-lock reports." : null;
}

// ---------- which requests need the service key ----------

/** The path the router will act on. new URL() resolves "..", "%2e%2e" and backslashes, so checks must use this, not req.url. */
function routedPath(url: string | undefined): string | null {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}

const isWebhook = (method: string | undefined, url: string | undefined) => method === "POST" && routedPath(url) === WEBHOOK_PATH;

/**
 * Every /api/ route needs the service key except a POST to exactly WEBHOOK_PATH, which proves itself with Stripe's
 * signature instead. A URL that can't be parsed needs the key, so a surprise fails closed.
 */
export function requiresServiceKey(method: string | undefined, url: string | undefined): boolean {
  const path = routedPath(url);
  if (path === null) return true;
  return path.startsWith("/api/") && !isWebhook(method, url);
}

// ---------- signature ----------

export type SignatureCheck = { ok: true } | { ok: false; reason: "no_secret" | "no_header" | "malformed_header" | "bad_signature" | "stale_timestamp" };

/** Checks Stripe-Signature against the exact bytes received. Only v1 counts: Stripe says to ignore other schemes. */
export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string, nowSeconds = Date.now() / 1000): SignatureCheck {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "no_header" };
  const timestamps: string[] = [];
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamps.push(value);
    else if (key === "v1" && /^[0-9a-fA-F]{64}$/.test(value)) signatures.push(Buffer.from(value, "hex"));
  }
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0]) || !signatures.length) return { ok: false, reason: "malformed_header" };
  const expected = createHmac("sha256", secret).update(`${timestamps[0]}.`).update(rawBody).digest();
  // While a secret is being rolled there is one v1 per active secret, so any match counts.
  if (!signatures.map((s) => timingSafeEqual(s, expected)).includes(true)) return { ok: false, reason: "bad_signature" };
  // The timestamp is covered by the signature, so this is what turns away a captured request sent again later.
  if (Math.abs(nowSeconds - Number(timestamps[0])) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };
  return { ok: true };
}

// ---------- what a payment or refund does ----------

export interface CheckoutSession {
  id?: unknown;
  payment_status?: unknown;
  client_reference_id?: unknown;
  payment_intent?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  livemode?: unknown;
}

export interface Charge {
  refunded?: unknown;
  amount_refunded?: unknown;
  payment_intent?: unknown;
}

const text = (v: unknown) => (typeof v === "string" ? v : null);
const count = (v: unknown) => (typeof v === "number" ? v : null);
const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
const lock = (r: Report): Report => ({ ...r, unlocked: false, unlocked_by: null });

/** Plenty for real traffic, since each extra pass needs a new ledger change. Failing means a 500, and Stripe retries. */
const MAX_SETTLE_PASSES = 8;

/** The free rounds on a permit lean on something else opening it. When nothing does any more, they lock too. */
async function relockFreeRounds(store: Store, permit: string | null): Promise<string[]> {
  if (!permit) return [];
  const open = await store.unlockedOnPermit(permit);
  if (open.some((r) => r.unlocked_by !== "next_round")) return [];
  const relocked: string[] = [];
  for (const { id } of open) {
    let locked = false;
    await store.updateReport(id, (current) => {
      locked = current.unlocked && current.unlocked_by === "next_round";
      return locked ? lock(current) : current;
    });
    if (locked) relocked.push(id);
  }
  return relocked;
}

/**
 * Brings a report in line with the ledger, and runs on every event, so a retry after a crash finishes the job.
 *
 * updateReport keeps each change atomic, but the ledger is read before it. So an instance can read "paid", lose the
 * race to a refund on another instance, and then unlock a report that instance just locked. Reading the ledger again
 * after writing closes that gap. If the refund came before this second read, this instance sees it and locks. If it
 * came after, the refunding instance's own lock is what lands last. Either way the report ends up locked.
 */
async function settleReport(store: Store, reportId: string): Promise<{ report: Report; opened: boolean; relocked: string[] } | null> {
  let opened = false;
  const relocked: string[] = [];
  for (let pass = 0; pass < MAX_SETTLE_PASSES; pass++) {
    const paid = await store.reportHasActivePayment(reportId);
    // updateReport can run this more than once, and the run that was saved is always the last.
    let openedNow = false;
    let lockedNow = false;
    const report = await store.updateReport(reportId, (current) => {
      openedNow = paid && !current.unlocked;
      // Only a payment's own unlock can be taken back: a design partner's report never was paid for.
      lockedNow = !paid && current.unlocked && current.unlocked_by === "stripe";
      if (openedNow) return { ...current, unlocked: true, unlocked_by: "stripe" };
      return lockedNow ? lock(current) : current;
    });
    if (!report) return null;
    opened ||= openedNow;
    if (lockedNow && !relocked.includes(report.id)) relocked.push(report.id);
    if ((await store.reportHasActivePayment(reportId)) === paid) {
      // Whichever instance locks last sees every other lock, so the free rounds can't be left open.
      if (!report.unlocked) relocked.push(...(await relockFreeRounds(store, report.permit_number)));
      return { report, opened, relocked };
    }
  }
  throw new Error("That report's payments kept changing. Try again.");
}

export type PaidOutcome = "unlocked" | "already_unlocked" | "refunded" | "not_paid" | "unknown_report" | "invalid";

/** Records a Checkout Session and unlocks its report. Both the webhook and the redirect come through here. */
export async function applyPaidSession(session: CheckoutSession, store?: Store): Promise<{ outcome: PaidOutcome; report_id: string | null }> {
  // A session can complete unpaid with a delayed payment method. checkout.session.async_payment_succeeded follows if it clears.
  if (session.payment_status !== "paid") return { outcome: "not_paid", report_id: null };
  const sessionId = text(session.id);
  const paymentId = text(session.payment_intent) ?? sessionId;
  if (!paymentId || !PAYMENT_ID_PATTERN.test(paymentId)) return { outcome: "invalid", report_id: null };

  const s = store ?? (await getStore());
  const reference = text(session.client_reference_id);
  const known = reference ? await s.getReport(reference) : null;
  const payment = await s.mergePayment({
    id: paymentId,
    session_id: sessionId,
    report_id: known?.id ?? null,
    amount_total: count(session.amount_total),
    currency: text(session.currency),
    livemode: flag(session.livemode),
    paid: true,
  });

  const settled = payment.report_id ? await settleReport(s, payment.report_id) : null;
  if (!settled) {
    if (payment.refunded_at) return { outcome: "refunded", report_id: null };
    // The customer has paid and there is nothing to give them, so someone has to refund this by hand.
    console.error(`Stripe: paid session ${sessionId} has no matching report. Refund it or find the report. See docs/stripe-setup.md.`);
    return { outcome: "unknown_report", report_id: null };
  }
  // A locked report here means a refund landed while this ran, even if this event read the ledger first.
  if (payment.refunded_at || !settled.report.unlocked) return { outcome: "refunded", report_id: settled.report.id };
  return { outcome: settled.opened ? "unlocked" : "already_unlocked", report_id: settled.report.id };
}

export type RefundOutcome = "refunded" | "partial" | "invalid";

/** Applies a charge.refunded event. See the refund policy at the top of this file. */
export async function applyRefund(charge: Charge, store?: Store): Promise<{ outcome: RefundOutcome; relocked: string[] }> {
  const paymentId = text(charge.payment_intent);
  if (!paymentId || !PAYMENT_ID_PATTERN.test(paymentId)) return { outcome: "invalid", relocked: [] };
  const s = store ?? (await getStore());
  // charge.refunded also fires for partial refunds. Stripe's `refunded` field is true only once the whole charge is back.
  const full = charge.refunded === true;
  // With no prior record the refund overtook the payment event, so this entry stops that event unlocking when it lands.
  const payment = await s.mergePayment({ id: paymentId, amount_refunded: count(charge.amount_refunded) ?? 0, refunded: full });
  if (!full) return { outcome: "partial", relocked: [] };
  const settled = payment.report_id ? await settleReport(s, payment.report_id) : null;
  return { outcome: "refunded", relocked: settled?.relocked ?? [] };
}

// ---------- the redirect ----------

/** Stripe redirects here. The session is checked with Stripe, so the URL alone can't unlock anything. */
export async function confirmPayment(sessionId: string, fetchImpl: typeof fetch = fetch, store?: Store): Promise<string | null> {
  const key = stripeKey();
  if (!key || !/^cs_\w+$/.test(sessionId)) return null;
  const res = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const { outcome, report_id } = await applyPaidSession((await res.json()) as CheckoutSession, store);
  return outcome === "unlocked" || outcome === "already_unlocked" ? report_id : null;
}

// ---------- the webhook ----------

export interface WebhookReply {
  status: number;
  body: Record<string, unknown>;
}

/** Decides the reply for one delivery. A 2xx tells Stripe to stop, so only a fault worth retrying may answer 5xx. */
export async function processWebhook(rawBody: Buffer, signature: string | undefined, secret: string, nowSeconds = Date.now() / 1000, store?: Store): Promise<WebhookReply> {
  // No secret means nothing can be verified. Stripe keeps retrying, so events aren't lost while this gets fixed.
  if (!secret) return { status: 503, body: { error: "Webhook isn't configured." } };
  const check = verifySignature(rawBody, signature, secret, nowSeconds);
  if (!check.ok) {
    console.warn(`Stripe webhook refused: ${check.reason}`);
    return { status: 400, body: { error: "Invalid signature." } };
  }

  let event: { type?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Body isn't JSON." } };
  }
  const object = event?.data?.object;
  // Thin events, the Dashboard's suggested format, carry no object. docs/stripe-setup.md says to choose Snapshot.
  if (typeof event?.type !== "string" || typeof object !== "object" || object === null) {
    console.error("Stripe webhook: a signed event had no data.object. Is the destination set to Snapshot, not Thin?");
    return { status: 400, body: { error: "Expected a snapshot event." } };
  }

  // The second type is for delayed payment methods, which Stripe can enable on an account without this code knowing.
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") return { status: 200, body: { received: true, ...(await applyPaidSession(object as CheckoutSession, store)) } };
  if (event.type === "charge.refunded") return { status: 200, body: { received: true, ...(await applyRefund(object as Charge, store)) } };
  return { status: 200, body: { received: true, outcome: "ignored" } };
}

/** The exact bytes, because the signature covers them. Parsing or decoding first can change them. */
async function readRawBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  // Reads to the end even when over the limit, because leaving this loop early would close the socket before the reply.
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_WEBHOOK_BYTES) chunks.push(chunk as Buffer);
  }
  return size <= MAX_WEBHOOK_BYTES ? Buffer.concat(chunks) : null;
}

/** Answers POST WEBHOOK_PATH and returns true, or returns false for any other request. */
export async function handleStripeWebhook(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!isWebhook(req.method, req.url)) return false;
  let reply: WebhookReply;
  try {
    const raw = await readRawBody(req);
    reply = raw ? await processWebhook(raw, req.headers["stripe-signature"] as string | undefined, webhookSecret()) : { status: 413, body: { error: "Body too large." } };
  } catch (e) {
    // This route is public, so the detail goes to the log only. The 500 makes Stripe retry.
    console.error("Stripe webhook failed:", e);
    reply = { status: 500, body: { error: "Couldn't process the event." } };
  }
  res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
  return true;
}
