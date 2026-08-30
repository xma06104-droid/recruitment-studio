UPDATE candidates
SET job_id = (
  SELECT keeper.id
  FROM jobs source
  JOIN jobs keeper
    ON keeper.owner_id = source.owner_id
   AND keeper.title = source.title COLLATE NOCASE
   AND keeper.department = source.department COLLATE NOCASE
   AND keeper.city = source.city COLLATE NOCASE
  WHERE source.id = candidates.job_id
  ORDER BY keeper.created_at ASC, keeper.id ASC
  LIMIT 1
)
WHERE job_id IS NOT NULL;

UPDATE resume_applications
SET job_id = (
  SELECT keeper.id
  FROM jobs source
  JOIN jobs keeper
    ON keeper.owner_id = source.owner_id
   AND keeper.title = source.title COLLATE NOCASE
   AND keeper.department = source.department COLLATE NOCASE
   AND keeper.city = source.city COLLATE NOCASE
  WHERE source.id = resume_applications.job_id
  ORDER BY keeper.created_at ASC, keeper.id ASC
  LIMIT 1
)
WHERE job_id IS NOT NULL;

UPDATE screening_logs
SET job_id = (
  SELECT keeper.id
  FROM jobs source
  JOIN jobs keeper
    ON keeper.owner_id = source.owner_id
   AND keeper.title = source.title COLLATE NOCASE
   AND keeper.department = source.department COLLATE NOCASE
   AND keeper.city = source.city COLLATE NOCASE
  WHERE source.id = screening_logs.job_id
  ORDER BY keeper.created_at ASC, keeper.id ASC
  LIMIT 1
)
WHERE job_id IS NOT NULL;

DELETE FROM jobs
WHERE EXISTS (
  SELECT 1 FROM jobs keeper
  WHERE keeper.owner_id = jobs.owner_id
    AND keeper.title = jobs.title COLLATE NOCASE
    AND keeper.department = jobs.department COLLATE NOCASE
    AND keeper.city = jobs.city COLLATE NOCASE
    AND (keeper.created_at < jobs.created_at OR (keeper.created_at = jobs.created_at AND keeper.id < jobs.id))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_owner_identity
ON jobs(owner_id, title COLLATE NOCASE, department COLLATE NOCASE, city COLLATE NOCASE);

PRAGMA optimize;
