CREATE TABLE IF NOT EXISTS ai_interview_invitations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  recipient_email TEXT NOT NULL,
  job_title TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '已发送',
  sent_at TEXT NOT NULL,
  opened_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_invites_owner_candidate
ON ai_interview_invitations(owner_id, candidate_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_invites_token_hash
ON ai_interview_invitations(token_hash);
