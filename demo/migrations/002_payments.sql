-- The payment ledger, one row per PaymentIntent. It lives here, not on one server's disk, so a refund received by one
-- instance holds on every other, and survives a redeploy.
--
-- A row only gathers facts. paid_at and refunded_at are set once and never cleared, so events can arrive in any order
-- and any number of times, and no later event can undo a refund. Whether a payment counts is derived from them.
--
-- A row can exist before its report is known, because a refund can overtake its payment event. So report_id can be null
-- and isn't a foreign key. Rows also outlive a deleted report. They hold Stripe ids and amounts, never letter text or
-- anything about the customer. Each row is purged at the retention limit from created_at, which always falls after its
-- report's own limit, since a report exists before anyone can pay for it.

CREATE TABLE IF NOT EXISTS redline_payments (
  id              text PRIMARY KEY,
  session_id      text,
  report_id       text,
  amount_total    integer,
  amount_refunded integer NOT NULL DEFAULT 0,
  currency        text,
  livemode        boolean,
  paid_at         timestamptz,
  refunded_at     timestamptz,
  created_at      timestamptz NOT NULL
);
-- Answers "does this report still have a payment that counts?"
CREATE INDEX IF NOT EXISTS redline_payments_active_report ON redline_payments (report_id) WHERE paid_at IS NOT NULL AND refunded_at IS NULL;
CREATE INDEX IF NOT EXISTS redline_payments_created_at ON redline_payments (created_at);
