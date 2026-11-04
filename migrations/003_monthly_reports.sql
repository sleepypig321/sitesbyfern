-- Apply once after 002_billing.sql. Billing stays disabled until configured.
ALTER TABLE billing_runs ADD COLUMN billing_model TEXT NOT NULL DEFAULT 'full_fee';
ALTER TABLE billing_reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'stripe';
CREATE TABLE IF NOT EXISTS billing_base_payments (
 client_id TEXT NOT NULL, month TEXT NOT NULL, invoice_id TEXT NOT NULL UNIQUE,
 paid_cents INTEGER NOT NULL CHECK(paid_cents=3000), verified INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(client_id,month)
);
CREATE TABLE IF NOT EXISTS report_access (
 client_id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS monthly_reports (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, month TEXT NOT NULL, created_at INTEGER NOT NULL,
 summary TEXT NOT NULL, csv TEXT NOT NULL, review_token TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending', website_cents INTEGER, evidence TEXT,
 notified INTEGER NOT NULL DEFAULT 0, UNIQUE(client_id,month)
);
