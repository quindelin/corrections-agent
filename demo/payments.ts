// Everything about being paid: the Payment Link, the redirect check, the Stripe webhook and refunds.
// Setup steps are in docs/stripe-setup.md. Nothing here has been run against Stripe itself: the tests build their own
// events with a made-up secret.
//
// A ledger of payments, one file per PaymentIntent, is what makes this safe to receive twice. Stripe can repeat an event,
// send the same change as two events with different ids, and deliver events in any order, so a log of event ids wouldn't
// be enough. Each handler reads the ledger and the report, and moves them to the state the event implies.
//
// A refund is the one fact that can't be undone by a later message. A Checkout Session still says payment_status "paid"
// after a refund, so both the redirect and the webhook check the ledger before unlocking.
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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { dataDir, listReports, loadReport, type Report, saveReport } from "./reports.ts";

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

// ---------- the payment ledger ----------

export interface PaymentRecord {
  /** The PaymentIntent id, which is the only thing a charge and a Checkout Session have in common. */
  id: string;
  status: "paid" | "refunded";
  session_id: string | null;
  report_id: string | null;
  amount_total: number | null;
  amount_refunded: number;
  currency: string | null;
  livemode: boolean | null;
  paid_at: string | null;
  refunded_at: string | null;
}

const paymentsDir = () => join(dataDir(), "payments");
const SAFE_ID = /^[\w-]{1,255}$/;

export function readPayment(id: string): PaymentRecord | null {
  if (!SAFE_ID.test(id)) return null;
  const file = join(paymentsDir(), `${id}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PaymentRecord) : null;
}

function writePayment(record: PaymentRecord): void {
  mkdirSync(paymentsDir(), { recursive: true });
  const file = join(paymentsDir(), `${record.id}.json`);
  // Written whole or not at all, because a torn file here would make the ledger unreadable.
  writeFileSync(`${file}.tmp`, JSON.stringify(record));
  renameSync(`${file}.tmp`, file);
}

function listPayments(): PaymentRecord[] {
  if (!existsSync(paymentsDir())) return [];
  return readdirSync(paymentsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(paymentsDir(), f), "utf8")) as PaymentRecord);
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

export type PaidOutcome = "unlocked" | "already_unlocked" | "refunded" | "not_paid" | "unknown_report" | "invalid";

/** Records a Checkout Session and unlocks its report. Both the webhook and the redirect come through here. */
export function applyPaidSession(session: CheckoutSession): { outcome: PaidOutcome; report_id: string | null } {
  // A session can complete unpaid with a delayed payment method. checkout.session.async_payment_succeeded follows if it clears.
  if (session.payment_status !== "paid") return { outcome: "not_paid", report_id: null };
  const sessionId = text(session.id);
  const paymentId = text(session.payment_intent) ?? sessionId;
  if (!paymentId || !SAFE_ID.test(paymentId)) return { outcome: "invalid", report_id: null };

  const prior = readPayment(paymentId);
  const reference = text(session.client_reference_id);
  const report = reference ? loadReport(reference) : null;
  writePayment({
    id: paymentId,
    status: prior?.status ?? "paid",
    session_id: sessionId,
    report_id: report?.id ?? prior?.report_id ?? null,
    amount_total: count(session.amount_total),
    amount_refunded: prior?.amount_refunded ?? 0,
    currency: text(session.currency),
    livemode: flag(session.livemode),
    paid_at: prior?.paid_at ?? new Date().toISOString(),
    refunded_at: prior?.refunded_at ?? null,
  });

  // Checked first, because the refund may have come before this event, or this may be an old event sent again.
  if (prior?.status === "refunded") return { outcome: "refunded", report_id: report?.id ?? null };
  // The customer has paid and there is nothing to give them, so someone has to refund this by hand.
  if (!report) {
    console.error(`Stripe: paid session ${sessionId} has no matching report. Refund it or find the report. See docs/stripe-setup.md.`);
    return { outcome: "unknown_report", report_id: null };
  }
  // A report already open, as a design partner's for instance, keeps the reason it was opened.
  if (report.unlocked) return { outcome: "already_unlocked", report_id: report.id };
  saveReport({ ...report, unlocked: true, unlocked_by: "stripe" });
  return { outcome: "unlocked", report_id: report.id };
}

const lock = (r: Report) => saveReport({ ...r, unlocked: false, unlocked_by: null });

/** The free rounds on a permit lean on something else opening it. When nothing does any more, they lock too. */
function relockFreeRounds(permit: string | null): string[] {
  if (!permit) return [];
  const onPermit = listReports().filter((r) => r.permit_number === permit && r.unlocked);
  if (onPermit.some((r) => r.unlocked_by !== "next_round")) return [];
  onPermit.forEach(lock);
  return onPermit.map((r) => r.id);
}

export type RefundOutcome = "refunded" | "partial" | "invalid";

/** Applies a charge.refunded event. See the refund policy at the top of this file. */
export function applyRefund(charge: Charge): { outcome: RefundOutcome; relocked: string[] } {
  const paymentId = text(charge.payment_intent);
  if (!paymentId || !SAFE_ID.test(paymentId)) return { outcome: "invalid", relocked: [] };
  const prior = readPayment(paymentId);
  const amountRefunded = count(charge.amount_refunded) ?? 0;

  // charge.refunded also fires for partial refunds. Stripe's `refunded` field is true only once the whole charge is back.
  if (charge.refunded !== true) {
    if (prior) writePayment({ ...prior, amount_refunded: Math.max(prior.amount_refunded, amountRefunded) });
    return { outcome: "partial", relocked: [] };
  }

  // With no prior record the refund overtook the payment event, so this entry stops that event unlocking when it lands.
  writePayment({
    id: paymentId,
    session_id: prior?.session_id ?? null,
    report_id: prior?.report_id ?? null,
    amount_total: prior?.amount_total ?? null,
    currency: prior?.currency ?? null,
    livemode: prior?.livemode ?? null,
    paid_at: prior?.paid_at ?? null,
    status: "refunded",
    amount_refunded: Math.max(prior?.amount_refunded ?? 0, amountRefunded),
    refunded_at: prior?.refunded_at ?? new Date().toISOString(),
  });

  // This runs on every delivery, so a retry after a crash finishes the job. Each step only acts on the current state.
  const report = prior?.report_id ? loadReport(prior.report_id) : null;
  if (!report) return { outcome: "refunded", relocked: [] };
  const relocked: string[] = [];
  const stillPaid = listPayments().some((p) => p.report_id === report.id && p.status === "paid");
  if (report.unlocked && report.unlocked_by === "stripe" && !stillPaid) {
    lock(report);
    relocked.push(report.id);
  }
  relocked.push(...relockFreeRounds(report.permit_number));
  return { outcome: "refunded", relocked };
}

// ---------- the redirect ----------

/** Stripe redirects here. The session is checked with Stripe, so the URL alone can't unlock anything. */
export async function confirmPayment(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const key = stripeKey();
  if (!key || !/^cs_\w+$/.test(sessionId)) return null;
  const res = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const { outcome, report_id } = applyPaidSession((await res.json()) as CheckoutSession);
  return outcome === "unlocked" || outcome === "already_unlocked" ? report_id : null;
}

// ---------- the webhook ----------

export interface WebhookReply {
  status: number;
  body: Record<string, unknown>;
}

/** Decides the reply for one delivery. A 2xx tells Stripe to stop, so only a fault worth retrying may answer 5xx. */
export function processWebhook(rawBody: Buffer, signature: string | undefined, secret: string, nowSeconds = Date.now() / 1000): WebhookReply {
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
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") return { status: 200, body: { received: true, ...applyPaidSession(object as CheckoutSession) } };
  if (event.type === "charge.refunded") return { status: 200, body: { received: true, ...applyRefund(object as Charge) } };
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
    reply = raw ? processWebhook(raw, req.headers["stripe-signature"] as string | undefined, webhookSecret()) : { status: 413, body: { error: "Body too large." } };
  } catch (e) {
    // This route is public, so the detail goes to the log only. The 500 makes Stripe retry.
    console.error("Stripe webhook failed:", e);
    reply = { status: 500, body: { error: "Couldn't process the event." } };
  }
  res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
  return true;
}
