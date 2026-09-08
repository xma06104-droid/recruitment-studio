CREATE TABLE IF NOT EXISTS manual_assessments (
  candidate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  total INTEGER NOT NULL,
  professional INTEGER NOT NULL,
  communication INTEGER NOT NULL,
  culture INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  reviewer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manual_assessments_owner_updated
ON manual_assessments(owner_id, updated_at);
