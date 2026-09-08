ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'hr';

UPDATE accounts SET role = 'super_admin'
WHERE id = COALESCE(
  (SELECT id FROM accounts WHERE id = 'test-account-01' LIMIT 1),
  (SELECT id FROM accounts ORDER BY created_at ASC, id ASC LIMIT 1)
);

CREATE INDEX IF NOT EXISTS idx_accounts_role_created ON accounts(role, created_at);

PRAGMA optimize;
