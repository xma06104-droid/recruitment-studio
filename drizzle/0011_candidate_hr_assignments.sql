CREATE TABLE IF NOT EXISTS candidate_assignments (
  candidate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  hr_account_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (hr_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_hr_time
ON candidate_assignments(hr_account_id, assigned_at);

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_owner_time
ON candidate_assignments(owner_id, assigned_at);
