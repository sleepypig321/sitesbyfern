# Private studio ledger

This dashboard tracks Sites by Fern's inquiries, client projects, and manually recorded business receipts. It also displays the separate website sales data available from the existing client billing ledger. Client-site sales **are not Sites by Fern's own revenue**.

## Activate securely

The dashboard fails closed until configured. On the Cloudflare account that deploys this Worker:

1. Apply `migrations/004_admin_ledger.sql` to the existing production D1 database (`sites-by-fern`). If the prior migrations have not been applied, apply them in order first. Back up existing data before changing production schema.
2. Set Worker **secrets** `ADMIN_LOGIN_PASSWORD` (a unique strong password) and `ADMIN_SESSION_SECRET` (at least 32 unpredictable characters). Never commit these to GitHub, put them in plaintext Wrangler variables, or send them in chat.
3. Deploy the Worker after the migration and secrets are in place.
4. Visit `/admin`, sign in, and verify an empty dashboard. Enter project records and real transactions only after confirming live persistence.

The dashboard uses an 8-hour signed HttpOnly/Secure/SameSite cookie, rejects cross-origin writes, and rate-limits failed logins per source IP. Owner credentials are stored only as Worker secrets. This is a single-owner login, not a public sign-up system.

## Record-keeping distinctions

- **Projects:** `Built & handed over` versus `Built & managed`, each with a status you can change.
- **Inquiries:** Read-only view of inquiry records already collected by the website; existing email decision links remain the approval workflow.
- **Income/refunds:** Manually enter Sites by Fern payments, any included sales tax, processing fees, payment reference, and date. Do not record a client's own website sales as your income.
- **CSV export:** One calendar-year CSV of manually recorded transactions, with signed refund rows, gross amounts, sales tax, processing fees, and net receipts. Reconcile it to Stripe and bank statements; it does not automatically fetch all Stripe charges or calculate taxable profit, expenses, or tax owed.

For tax filing, keep supporting statements, invoices, receipts, expense records, and donation confirmations. Your tax preparer can decide how they should be reported.
