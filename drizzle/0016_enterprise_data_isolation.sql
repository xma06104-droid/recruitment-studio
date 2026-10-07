CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_account_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE accounts ADD COLUMN organization_id TEXT NOT NULL DEFAULT '';

DELETE FROM accounts
WHERE id IN ('test-account-01', 'test-account-02', 'test-account-03', 'test-account-04', 'test-account-05')
   OR email LIKE 'test%@xingjian.ai';

INSERT OR IGNORE INTO organizations (id, name, owner_account_id, created_at, updated_at)
SELECT id, contact || '的企业', id, created_at, datetime('now')
FROM accounts
WHERE role = 'super_admin' AND organization_id = '';

UPDATE accounts
SET organization_id = id
WHERE role = 'super_admin' AND organization_id = '';

UPDATE accounts
SET organization_id = COALESCE(
  (
    SELECT owner.organization_id
    FROM candidate_assignments assignment
    JOIN accounts owner ON owner.id = assignment.owner_id
    WHERE assignment.hr_account_id = accounts.id
      AND owner.organization_id <> ''
    ORDER BY assignment.assigned_at DESC
    LIMIT 1
  ),
  (
    SELECT organization_id
    FROM accounts administrator
    WHERE administrator.role = 'super_admin'
      AND administrator.organization_id <> ''
    ORDER BY administrator.created_at ASC
    LIMIT 1
  ),
  id
)
WHERE organization_id = '';

INSERT OR IGNORE INTO organizations (id, name, owner_account_id, created_at, updated_at)
SELECT organization_id, contact || '的企业', id, created_at, datetime('now')
FROM accounts
WHERE organization_id <> ''
GROUP BY organization_id;

DELETE FROM candidate_assignments
WHERE NOT EXISTS (
  SELECT 1
  FROM accounts owner
  JOIN accounts recipient ON owner.organization_id = recipient.organization_id
  WHERE owner.id = candidate_assignments.owner_id
    AND recipient.id = candidate_assignments.hr_account_id
);

CREATE INDEX IF NOT EXISTS idx_accounts_organization_role
ON accounts(organization_id, role, created_at);
