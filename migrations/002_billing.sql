CREATE TABLE IF NOT EXISTS billing_sales (
 client_id TEXT NOT NULL, session_id TEXT NOT NULL, month TEXT NOT NULL,
 revenue_cents INTEGER NOT NULL CHECK(revenue_cents>=0), event_id TEXT NOT NULL,
 PRIMARY KEY(client_id,session_id)
);
CREATE TABLE IF NOT EXISTS billing_holds (
 client_id TEXT NOT NULL, event_id TEXT NOT NULL, reason TEXT NOT NULL,
 PRIMARY KEY(client_id,event_id)
);
CREATE TABLE IF NOT EXISTS billing_reviews (
 client_id TEXT NOT NULL, month TEXT NOT NULL, revenue_cents INTEGER NOT NULL,
 approved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(client_id,month)
);
CREATE TABLE IF NOT EXISTS billing_runs (
 client_id TEXT NOT NULL, month TEXT NOT NULL, revenue_cents INTEGER NOT NULL,
 total_cents INTEGER NOT NULL, invoice_id TEXT, status TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), PRIMARY KEY(client_id,month)
);
