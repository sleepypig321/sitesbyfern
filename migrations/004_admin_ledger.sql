-- Apply after 003_monthly_reports.sql; admin routes fail closed until secrets exist.
CREATE TABLE IF NOT EXISTS admin_projects (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, name TEXT NOT NULL,
 client_name TEXT NOT NULL, client_email TEXT NOT NULL DEFAULT '',
 url TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('handover','managed')),
 status TEXT NOT NULL CHECK(status IN ('planned','active','completed','paused')),
 notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS admin_receipts (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, date TEXT NOT NULL,
 project_id TEXT REFERENCES admin_projects(id),
 type TEXT NOT NULL CHECK(type IN ('income','refund')),
 description TEXT NOT NULL, gross_cents INTEGER NOT NULL CHECK(gross_cents>=0),
 sales_tax_cents INTEGER NOT NULL DEFAULT 0 CHECK(sales_tax_cents>=0),
 fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fee_cents>=0),
 payment_ref TEXT NOT NULL DEFAULT '',
 CHECK(sales_tax_cents+fee_cents<=gross_cents)
);
CREATE INDEX IF NOT EXISTS admin_receipts_date ON admin_receipts(date);
CREATE INDEX IF NOT EXISTS admin_receipts_project ON admin_receipts(project_id);
CREATE TABLE IF NOT EXISTS admin_login_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL
);
