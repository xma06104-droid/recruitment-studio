ALTER TABLE ai_questions
ADD COLUMN job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_questions_owner_job
ON ai_questions(owner_id, job_id, created_at);

PRAGMA optimize;
