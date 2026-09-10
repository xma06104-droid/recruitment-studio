CREATE TABLE IF NOT EXISTS deleted_accounts (
  account_id TEXT PRIMARY KEY,
  deleted_by TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
