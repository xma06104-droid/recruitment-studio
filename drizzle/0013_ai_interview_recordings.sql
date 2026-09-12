CREATE TABLE IF NOT EXISTS ai_interview_recordings (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_title TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(invitation_id, question_id),
  FOREIGN KEY (invitation_id) REFERENCES ai_interview_invitations(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_recordings_candidate_created
ON ai_interview_recordings(candidate_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_recordings_owner_candidate
ON ai_interview_recordings(owner_id, candidate_id);
