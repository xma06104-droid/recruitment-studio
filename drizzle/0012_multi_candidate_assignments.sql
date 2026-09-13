CREATE TABLE candidate_assignments_multi (
  candidate_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  hr_account_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, hr_account_id),
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (hr_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO candidate_assignments_multi
  (candidate_id, owner_id, hr_account_id, assigned_by, assigned_at, updated_at)
SELECT candidate_id, owner_id, hr_account_id, assigned_by, assigned_at, updated_at
FROM candidate_assignments;

DROP TABLE candidate_assignments;
ALTER TABLE candidate_assignments_multi RENAME TO candidate_assignments;

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_hr_time
ON candidate_assignments(hr_account_id, assigned_at);

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_owner_time
ON candidate_assignments(owner_id, assigned_at);
