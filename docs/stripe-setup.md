# Setting up Stripe for Redline

**Nothing here has been tested against Stripe itself, or on a real Postgres server.** No real or sandbox Stripe account, key or event has touched this code. `npm run test:payments` builds its own events, signs them with a made-up secret and runs offline, on local files and on PGlite, so it shows the code matches Stripe's documented format, not that Stripe agrees. PGlite is the Postgres engine with a single backend process, so its statements interleave but never truly run in parallel. The steps in [Prove it in the sandbox](#prove-it-in-the-sandbox) are that first real test, and they need to pass before going live.

The Dashboard steps were written from Stripe's public docs on 2026-10-31, without opening the Dashboard. Labels may differ slightly. Stripe now calls its test environment a **sandbox**, so that's the word used here.

## How the payment path works

The customer sees a free preview, clicks unlock and pays on a Stripe Payment Link carrying the report ID as `client_reference_id`. The code is in `demo/payments.ts`.

| Stripe sends or does | What Redline does |
|---|---|
| Redirects the customer to `/paid?session_id=...` | Asks Stripe about the session, and unlocks the report if it's paid |
| `checkout.session.completed` to `POST /api/stripe/webhook` | Unlocks the same report if it's paid. This covers a customer who never comes back |
| `checkout.session.async_payment_succeeded` | The same, for a delayed payment method that has now cleared |
| `charge.refunded`, full refund | Re-locks the report and the permit's free rounds |
| `charge.refunded`, partial refund | Records the amount and leaves the report unlocked |

**Which requests are checked.** The webhook is the only `/api/` route that doesn't need `REDLINE_API_KEY`, and only for a `POST` to exactly that path. It must carry a valid `Stripe-Signature`, checked against the raw bytes with a five-minute limit on the timestamp.

**Receiving an event twice, or out of order, is safe.** Stripe can repeat an event, send one change as two events with different IDs, deliver events out of order, and reach any instance. So an event doesn't change a report directly. It adds a fact to a payment ledger in the store (`redline_payments` on Postgres, `.cache/payments/` on local files), and the report is then brought in line with the ledger.

**A refund can't be undone by a later message.** Nothing ever clears a refund from the ledger. This matters because a Checkout Session still says `paid` after a refund, so an old redirect link or a resent event would otherwise unlock the report again.

**A payment and a refund can arrive together on different instances.** One instance can read "paid", lose the race to the refund, and then unlock a report the other instance just locked. So each instance reads the ledger again after writing, and corrects the report if it changed. Stress tests didn't catch this bug when the re-read was removed, on either backend. Only the tests that force the exact order did, so keep those if this code changes.

### Does a refund re-lock the report?

**Yes for a full refund, no for a partial one.**

- **Access follows payment.** The $59 is what unlocks the drafts. With a [14-day no-questions refund](pricing-and-onboarding.md#recommended-pricing), keeping access would make every report free for anyone who asks.
- **The permit's free rounds re-lock too**, unless another payment or a design partner report still holds the permit open. Otherwise a single free round would keep the permit open for good.
- **It takes back access, not work.** The free preview stays, the customer's sign-offs are kept and paying again restores the report. A Word export already downloaded can't be recalled.
- **A partial refund is a goodwill credit** on a sale that still stands.
- **Design partner reports never re-lock**, because they were never paid for.

Tell customers this in the refund wording. It's a business choice and easy to reverse: it lives in `settleReport` and `relockFreeRounds` in `demo/payments.ts`.

## Set up the sandbox

You'll end up with three values, which go in `.env` (never committed) and always change together. Don't paste them into chat, tickets or commits.

| Variable | Sandbox value starts with | Comes from step |
|---|---|---|
| `STRIPE_PAYMENT_LINK` | `https://buy.stripe.com/test_` | 3 |
| `STRIPE_SECRET_KEY` | `rk_test_` | 2 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_` | 5 or 6 |

1. **Open a sandbox.** In the [Dashboard](https://dashboard.stripe.com/sandboxes), use the account picker to create or select one. Check that you're in it before each step below, since each mode has its own keys and objects.

2. **Create a restricted key.** On [API keys](https://dashboard.stripe.com/apikeys), click **Create restricted key**, name it `redline-sandbox`, and set the Checkout Sessions permission to **Read** with everything else at **None**. That's the only call Redline makes. Click **Create key**, then copy the value to `STRIPE_SECRET_KEY`. I couldn't confirm the exact label for that permission. If `/paid` fails later, the key's **View request logs** shows which permission is missing.

3. **Create the Payment Link.** On [Payment Links](https://dashboard.stripe.com/payment-links/create), click **+New**, then **+Add a new product**.
   - Name it `Redline permit unlock`, as a one-time price of $59.00 USD, and click **Add product**.
   - Under **After the payment**, choose to redirect customers to your website instead of showing a confirmation page, and enter this URL with the placeholder exactly as written:
     ```
     http://localhost:8792/paid?session_id={CHECKOUT_SESSION_ID}
     ```
     If the Dashboard refuses a localhost address, use a tunnel such as ngrok and enter its HTTPS address instead.
   - Leave **Let customers adjust quantity** off, and don't enable promotion codes. A 100% code completes with `no_payment_required`, which doesn't unlock anything.
   - Optional, from the [recommended flow](pricing-and-onboarding.md#recommended-flow): under **Options**, **Add custom fields** for a project or permit number. For the terms checkbox, first set a terms URL in [Public details](https://dashboard.stripe.com/settings/public).
   - Click **Create link** and copy the URL to `STRIPE_PAYMENT_LINK`. Don't add `client_reference_id` yourself, because Redline appends it per report.

4. **Limit payment methods to cards and wallets.** In [Payment method settings](https://dashboard.stripe.com/settings/payment_methods), turn off bank debits, vouchers and anything else that can take days to confirm. This setting applies to the account, not the link, and Stripe says it may enable more methods after notifying you, so recheck it now and then. If a delayed method does slip through, Redline unlocks when it clears, but the customer sees a failed-payment message on return.

5. **Receive events locally** with the [Stripe CLI](https://docs.stripe.com/cli/install), which needs no public URL:
   ```bash
   stripe login
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.refunded \
     --forward-to localhost:8792/api/stripe/webhook
   ```
   It prints a signing secret. Copy it to `STRIPE_WEBHOOK_SECRET`. It belongs to the CLI and differs from a Dashboard destination's secret.

6. **Or use a deployed sandbox server**, which needs a public HTTPS URL. On [Webhooks](https://dashboard.stripe.com/webhooks), click **Create an event destination**:
   - Select **Your account**.
   - **Choose Snapshot as the payload format, not Thin, which is what the Dashboard suggests.** Thin events carry no payment details, and Redline answers them with a 400.
   - Select the three events: `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`.
   - Click **Continue**, choose **Webhook endpoint**, click **Continue**, and enter `https://<your-host>/api/stripe/webhook`.
   - On the settings page, click **Reveal secret** and copy it to `STRIPE_WEBHOOK_SECRET`.

7. **Start Redline** with `npm run demo`. If you see a warning that `STRIPE_WEBHOOK_SECRET` isn't set, fix that first.

## Prove it in the sandbox

Pay with test card `4242 4242 4242 4242`, any future expiry such as 12/34 and any three-digit CVC. Run a real letter through `http://localhost:8792/start`, or any letter that gives you a locked report. Sandbox retries are limited to three over a few hours, so watch for failures as you go.

On local files, each report's state is in `.cache/reports/<id>.json`, and each payment's is in `.cache/payments/<pi_id>.json`. On Postgres, they're in `redline_reports` and `redline_payments`.

| # | Do this | Expect |
|---|---|---|
| 1 | Pay on a locked report and let the redirect finish | You land on `/r/<id>`, unlocked. The webhook gets a 200 |
| 2 | **Webhook alone:** create a second sandbox link with a confirmation page and no redirect, set it as `STRIPE_PAYMENT_LINK`, restart and pay on a new report | The report unlocks with no redirect at all. This is the backstop. Set the first link back afterwards |
| 3 | Check a second report you didn't pay for | It stays locked |
| 4 | **Resend** the event from the Dashboard's **Event deliveries** tab | 200. The report and ledger are unchanged |
| 5 | Send to the webhook with no signature: `curl -i -X POST localhost:8792/api/stripe/webhook -d '{}'` | 400 |
| 6 | In [Payments](https://dashboard.stripe.com/payments), open the ⋯ menu, **Refund payment**, and enter part of the amount | The report stays unlocked, and the ledger shows `amount_refunded` |
| 7 | Refund the rest | The report re-locks. Three free drafts remain, and the rest are hidden |
| 8 | Open the old `/paid?session_id=...` address again | It says the payment couldn't be confirmed, and the report stays locked |
| 9 | Pay for that report again | It unlocks |
| 10 | Run another letter with the same permit number on a paid permit, then fully refund the paid report | The free round opens at first, and re-locks with the refund |

Item 1 also tests something the offline tests can't: that a real Stripe signature verifies. If it fails, see [Troubleshooting](#troubleshooting) before anything else.

`stripe trigger checkout.session.completed` is handy for checking delivery and signatures. It has no report ID, so expect a 200 and no unlock.

## Go live

**Don't start until the [conditions for charging anyone](pricing-and-onboarding.md#recommended-pricing) are met:** the remaining unsafe route is fixed, at least 3 real letters have passed a licensed architect with zero unsafe routes, and the Certified Plan Corrections rules are confirmed against the city's pages. The Illinois seal question in that document also needs a lawyer before any charge. Also finish your Stripe account activation and review Stripe's [go-live checklist](https://docs.stripe.com/get-started/checklist/go-live.md).

**The service needs these first:**

- **A public HTTPS address for the webhook.** Stripe requires one, and the server listens only on localhost unless `REDLINE_HOST` says otherwise. Simplest is to expose just `POST /api/stripe/webhook` and `GET /paid` on the service directly. If it has to go through the Emris proxy, that route must forward the unchanged bytes and the `Stripe-Signature` header. In Next.js that means reading `await req.arrayBuffer()`, never `req.json()`. Parsing and re-encoding breaks the signature. A redirect also counts as a failed delivery.
- **Postgres.** Set `DATABASE_URL` and run `npm run store -- migrate` before starting the service. Local files lose reports and the record of refunds if the disk changes, and they're safe for one process only. Without the migration, the webhook answers 500, and Stripe retries for up to three days.
- **An accurate clock**, kept in sync by NTP, since timestamps more than five minutes off are refused.

**Then, with the Dashboard switched to live mode.** Nothing carries over from the sandbox, so every object is created again:

1. Create a live restricted key, `redline-live`, as in step 2. You can only see its value once, so save it straight to your secrets store.
2. Create the live Payment Link, as in step 3, with the redirect pointing at `https://<your-host>/paid?session_id={CHECKOUT_SESSION_ID}`.
3. Repeat step 4 for payment methods.
4. Create a live event destination, as in step 6. Snapshot again, and its secret differs from the sandbox one.
5. In the production environment, set all three variables together, and point `DATABASE_URL` at a database that sandbox testing never used, so no sandbox report or payment comes along. Keep `REDLINE_API_KEY` set.
6. Restart and check that no warning appears.
7. **Make one real purchase and refund it**, working through items 1, 3, 7 and 8 above. Stripe keeps its fee of about $2 on a refund. Check **Event deliveries** shows 200s.

**To pause sales, deactivate the Payment Link in Stripe. Don't unset the variables.** Without `STRIPE_PAYMENT_LINK` or `STRIPE_SECRET_KEY`, Redline falls back to the free design-partner offer, and anyone can unlock anything. For the same reason, check those two are present on every deploy.

**To roll the webhook secret**, open the destination, choose **Roll secret** from the ⋯ menu and delay the old secret's expiry. Redline accepts a delivery if any signature matches, so you can update `STRIPE_WEBHOOK_SECRET` during that window.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| 400 on every delivery, log says `bad_signature` | Wrong secret: sandbox and live differ, and so do the CLI and Dashboard. Or a proxy changed the body |
| 400, log says `stale_timestamp` | The server clock is off. Stripe signs each retry afresh, so a real retry isn't stale |
| 400, "Expected a snapshot event" | The destination uses Thin. Create a Snapshot one |
| 401 at the webhook | The URL isn't exactly `/api/stripe/webhook` (a trailing slash counts), or a proxy changed the method |
| 500 at the webhook, log says `redline_payments` doesn't exist | Run `npm run store -- migrate`. Stripe retries, so events aren't lost if you fix it in time |
| 503 at the webhook | `STRIPE_WEBHOOK_SECRET` isn't set where the service runs. Stripe keeps retrying, so events aren't lost if you fix it in time |
| 3xx in **Event deliveries** | Point the destination at the final URL. Stripe treats a redirect as a failure |
| Paid, but `/paid` shows a failure | Key lacks read access to Checkout Sessions, the key is from the other mode, or the payment method was delayed. Check the key's **View request logs** |
| Log says "paid session ... has no matching report" | The customer paid and there's nothing to unlock: the report was deleted, or the link was opened without a report ID. Find the rows with no `report_id` in `redline_payments` (or `.cache/payments/` on local files), and refund it or fix it by hand |

Live mode retries for up to three days, and you can **Resend** an event for up to 15 days.

## The $490 pack: left out for now

**It isn't simple here, so it isn't built.** A payment for one report can use the report ID as its key, but a pack has no report to attach to, and Redline has no accounts to hold a balance.

It needs:

1. **Something to hold the balance.** A pack code, or the emailed magic link the flow plans at step 7. Neither exists.
2. **A way to deliver it, including when the buyer never returns.** That's the case the webhook is for, and it has no one to show a code to, so it needs email sending, which Redline doesn't have.
3. **Redemption.** A new route and a code field in `start.html`, drawing down exactly one credit per permit, safely under concurrent requests.
4. **A second Payment Link, and telling them apart.** The webhook treats any paid session with a report ID as a $59 unlock. It would need to read `payment_link` from the session and compare it with a new `STRIPE_PACK_PAYMENT_LINK`.
5. **A refund rule.** For instance, refund the unused credits at $49 each, and re-lock which permits? A used pack has no equivalent to today's clean rule, and "no expiry" makes it an open-ended obligation.

**Don't reuse this webhook for a pack link in the meantime.** A paid session without a report ID is logged as unmatched, and no credits are granted.

Experiment 3 in the pricing doc offers the pack by link to 10 expediters, keeping it if 2 or more buy. That's a good reason to wait, and that test can be run by hand with a Stripe invoice and manually unlocked reports.

## Known limits

- **Disputes aren't handled.** A chargeback doesn't send `charge.refunded`, so the report stays unlocked. To automate it, add `charge.dispute.funds_withdrawn`, whose object is a dispute with its own `payment_intent`.
- **A failed refund isn't handled.** The report re-locks on `charge.refunded` and stays locked if the refund later fails (`refund.failed`). That's rare, and a support matter.
- **Re-buying doesn't reopen free rounds locked by an earlier refund.** The paid report reopens, but a free round on that permit stays locked until someone unlocks it by hand.
- **Permit numbers are self-declared.** Anyone who types a paid permit's number into a new letter gets that round free, as `permitAlreadyUnlocked` did before this work. It's worth closing before launch.
- **The 12-month limit on a permit isn't enforced.**
- **Two narrow races on free rounds, both in the customer's favor or fixable by support.** A new round being created at the moment of a refund can miss the re-lock and stay open. And a refund on one report arriving together with a first payment on another report on the same permit can lock free rounds that the new payment should have kept open.
- **The ledger is kept as long as reports are.** Each row is purged at the retention limit (90 days by default), counted from when it was first seen, which is always after its report's own limit. Stripe stays the record for accounting. It holds Stripe IDs and amounts, not letter text.
- **No emails are sent**, so the receipt and magic link in steps 6 and 7 of the flow aren't here. Stripe can send its own receipts.
