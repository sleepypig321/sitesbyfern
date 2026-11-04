# Revenue-share billing — sandbox pilot

Implemented: signed, per-client Stripe Checkout webhooks, a D1 sales ledger, exact cent-based fees, reconciliation holds, and monthly Stripe **draft** invoices. No money is collected and no invoice email is sent by this module. Live keys are intentionally rejected. Draft generation is disabled by default.

## Pricing and scope

One invoice covers the entire monthly fee: `max(3000 cents, rounded 7% of qualifying USD sales)`. Do **not** also start the $30 subscription for the same service period. This implementation replaces that subscription with a variable monthly invoice. The $100 initial build payment remains separate.

Periods are UTC calendar months, billed in arrears. Enroll only for the first full agreed service month; partial months need separate agreed handling. Revenue means paid, one-time Stripe Checkout sales from the maintained website after discounts, excluding tax. Shipping is currently included; agree that policy in the written terms. Subscriptions, other processors, custom PaymentIntent-only checkouts, currencies other than USD, historical imports, and Stripe Connect onboarding are not implemented.

Refunds and disputes stop draft generation for the entire client until reconciled. The system does not estimate their tax allocation or silently count them as revenue. A refund arriving after a draft was created still requires checking/voiding/editing that draft before any future collection.

## Cloudflare setup

1. Execute `migrations/002_billing.sql` on the existing `sites-by-fern` D1 database. It adds tables; existing inquiries are retained.
2. Save `STRIPE_SECRET_KEY` as a Cloudflare secret using your **Sites by Fern sandbox** secret key (`sk_test_...`). Never paste keys in chat or commit them.
3. Save `BILLING_CLIENTS` as a Cloudflare secret containing a JSON array. Example placeholders:

```json
[{"id":"example-shop","customer":"cus_REPLACE","webhookSecret":"whsec_REPLACE","startMonth":"2026-12","live":false,"enabled":true}]
```

The `customer` is this client's customer ID in **Fern's sandbox**. The webhook secret comes from the endpoint in **the client's sandbox**, not Fern's account. Clients retain their own Stripe accounts; no client API secret key is needed. Obtain written agreement to revenue reporting and the fee before enrolling a real client.

4. In that client's sandbox, create a webhook endpoint:
   `https://sitesbyfern.fern-croxton.workers.dev/api/billing/webhooks/example-shop`
   Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`, `refund.created`, `refund.updated`, and `refund.failed`.
5. In the maintained site's **server-side** Checkout Session creation, set `metadata[sites_by_fern_client_id]` to `example-shop`. Apply it only to that website's sales. This requires integration with each site's checkout. Unmarked payments are excluded. Do not expose a client secret to the browser.
6. Test paid, unpaid, duplicate, unrelated and refunded sales. Verify totals against the client's Stripe records. Missing webhooks are not automatically recovered; monthly reconciliation is required in this pilot.
7. Set `BILLING_DRAFTS_ENABLED` to `true` only after the migration and sandbox configuration are complete. The daily 06:15 UTC job considers the previous month. It skips clients without an approved reconciliation record.

## Monthly reconciliation and review

Read the client/month ledger and all holds in D1:

```sql
SELECT client_id,month,SUM(revenue_cents) AS revenue_cents
FROM billing_sales GROUP BY client_id,month;
SELECT * FROM billing_holds;
SELECT * FROM billing_runs;
```

Confirm coverage from the first day, remove test/outside-site sales, and resolve refunds/disputes against the actual tax-exclusive refunded amount. Correct the ledger only from verified processor records, with an external audit record of changes. Clear a hold only once the reason has been reconciled. Approve the exact reviewed total (replace example values):

```sql
INSERT OR REPLACE INTO billing_reviews
(client_id,month,revenue_cents,approved)
VALUES ('example-shop','2026-12',100000,1);
```

The next daily run creates a $70 **sandbox draft** in Fern's Stripe account. New sales changing that total invalidate the approval. The job excludes pending invoice items from other services, freezes the calculated amount, stores the invoice ID and uses deterministic idempotency keys for retries. If a request remains unresolved for 23 hours it stops retrying; inspect Stripe and D1 before repairing the run. Never delete run records and blindly rerun: that can duplicate an invoice. Do not change a client's customer mapping while a run is pending.

Review the draft's amount, tax treatment, customer, ledger, refund/dispute activity, service period and duplicate subscription charges before finalizing anything. No production finalization/automatic payment path is implemented. Activation for real billing needs completed sandbox tests, processor reconciliation/recovery, agreed terms, live account configuration and an explicit collection workflow. Do not advertise automated collection as operational yet.

## Validation

Run `node --test` (Node 24 for the SQLite-backed billing tests). Tests use local SQLite, signed mock events and mocked Stripe responses; they never send email or move money.
