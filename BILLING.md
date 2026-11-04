# Monthly reports and maintenance adjustments

Implemented: a Clover CSV preview/upload page, private client reporting links, owner review by email, signed Stripe sales webhooks, and sandbox adjustment drafts. Uploaded totals are not automatically treated as website sales. No money is collected by this module. Live keys are rejected; draft generation remains disabled by default.

## Pricing and scope

The $30 monthly subscription covers the minimum. The separate adjustment is `max(0, rounded 7% of qualifying USD website sales - 3000 cents)`. Example: $1,000 website sales means $70 total, made up of the $30 subscription and a $40 adjustment. No adjustment invoice is created at or below the minimum. The $100 initial build payment remains separate. Existing full-fee billing runs are held for manual reconciliation and are never reused as adjustments.

Periods are UTC calendar months, billed in arrears. Enroll only for the first full agreed service month; partial months need separate agreed handling. Revenue means paid, one-time Stripe Checkout sales from the maintained website after discounts, excluding tax. Shipping is currently included; agree that policy in the written terms. The automatic webhook ledger does not support subscription sales, other processors, custom PaymentIntent-only checkouts, currencies other than USD, historical imports, or Stripe Connect onboarding. Clover CSV reports are a separate reviewed input source.

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

After separate verification of the matching month's $30 base payment, the next daily run creates a $40 **sandbox draft** in Fern's Stripe account. New sales changing that total invalidate the approval. The job excludes pending invoice items from other services, freezes the calculated amount, stores the invoice ID and uses deterministic idempotency keys for retries. If a request remains unresolved for 23 hours it stops retrying; inspect Stripe and D1 before repairing the run. Never delete run records and blindly rerun: that can duplicate an invoice. Do not change a client's customer mapping while a run is pending.

Review the draft's amount, tax treatment, customer, ledger, refund/dispute activity, service period and duplicate subscription charges before finalizing anything. No production finalization/automatic payment path is implemented. Activation for real billing needs completed sandbox tests, processor reconciliation/recovery, agreed terms, live account configuration and an explicit collection workflow. Do not advertise automated collection as operational yet.

## Validation

Run `node --test` (Node 24 for the SQLite-backed billing tests). Tests use local SQLite, signed mock events and mocked Stripe responses; they never send email or move money.


## Clover CSV upload and review

Apply `migrations/003_monthly_reports.sql` once after migration 002 before using uploads or enabling drafts. Leave `BILLING_DRAFTS_ENABLED=false` while setting up. The ALTER statements are one-time operations; do not repeatedly rerun the migration after success.

The public `/monthly-report.html` page previews a Clover Sales Report locally. Files are not sent until the client presses Send report for review using a private reporting link. Original CSV contents are stored in D1 for owner review. Keep the source reports private and remove them when no longer needed for the agreed retention period. The uploaded example business report is not included in the repository or public site.

Supported format: English Clover Sales Report, USD amounts, one complete calendar month, daily columns and the Gross sales, Discounts, Refunds, Net sales, Taxes, Amount collected rows. The importer checks daily/monthly sums, the summary, and gross/discount/refund/net/tax reconciliation. Other formats fail with an explanation rather than guessing. Unexpected accounting adjustments, tips, different currencies and partial months require a supported export or manual review.

Net sales already exclude tax, discounts and refunds; never subtract those amounts again. A storewide export cannot establish website revenue. The preview leaves that amount blank. The owner must verify website-specific evidence and enter the approved website amount, including zero for a store-only sample. Client estimates are not approved billing inputs.

Issue a private link for an existing agreed client ID in D1 (replace only the example ID):

```sql
INSERT INTO report_access (client_id,token) VALUES ('example-shop',lower(hex(randomblob(32))));
SELECT 'https://sitesbyfern.fern-croxton.workers.dev/monthly-report.html?token=' || token AS private_report_link
FROM report_access WHERE client_id='example-shop';
```

Treat that link like a password; do not put tokens in GitHub or public pages. Set active=0 to revoke. The page removes the token from its address bar after loading and submits it as a Bearer header. Existing unguessable owner review tokens are separate from client access tokens.

A successful submission stores a pending report and attempts the existing owner EmailJS inquiry template with approve/decline review links. Check `monthly_reports.notified` if email delivery fails; the report remains saved. GET never approves anything. Confirming approval requires a same-origin POST, a website-only amount no greater than report net sales, and evidence notes. It records `billing_reviews.source='csv'`. A CSV review replaces webhook-derived revenue for that client/month; the two are never added. Duplicated client/month uploads return a conflict. Replacing a report after decline currently requires owner database maintenance, and an existing billing run must be reconciled first.

CSV-only clients can use this registry entry in BILLING_CLIENTS (customer belongs to Fern's sandbox):

```json
[{"id":"example-shop","customer":"cus_REPLACE","source":"csv","startMonth":"2026-12","live":false,"enabled":true}]
```

No webhook signing secret is required for a CSV-only client. Preserve any other existing client entries when enrolling one. Enrollment and monthly reminders are not automated yet.

## Verifying the base subscription payment

Before an adjustment can be drafted, the owner must check the customer's actual Stripe subscription invoice: correct customer, maintenance service, full $30 paid, matching service month, and no refund/credit. The CSV does not prove that the maintenance subscription was paid. Discounted, prorated, unpaid, refunded, cancelled or mismatched service periods require manual reconciliation. Align subscription service periods with the calendar-month revenue period; do not assume an anniversary-month invoice covers the same month. Stripe invoice status is not fetched automatically in this pilot.

Only after checking the records, save the evidence using the actual invoice ID:

```sql
INSERT INTO billing_base_payments (client_id,month,invoice_id,paid_cents,verified)
VALUES ('example-shop','2026-12','in_REPLACE',3000,1);
```

An invoice ID cannot be credited to more than one month/client. Records without verified=1 are skipped. Base-payment evidence is a manual attestation, not Stripe confirmation. Missing records block adjustments. The scheduled job remains sandbox-only and creates drafts for the previous month; it neither activates subscriptions nor finalizes/sends/charges invoices. Live maintenance billing still needs its production collection workflow and end-to-end validation. Live build Payment Links remain separate.
