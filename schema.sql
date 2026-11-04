CREATE TABLE IF NOT EXISTS inquiries (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, email TEXT NOT NULL,
 data TEXT NOT NULL, token TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
 notified INTEGER NOT NULL DEFAULT 0, client_notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS inquiries_email_created ON inquiries(email, created_at);
