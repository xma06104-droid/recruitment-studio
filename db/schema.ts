export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    contact TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
    ('test-account-01', '测试账号 01', '10000000001', 'test01@xingjian.ai', 'pbkdf2$100000$gcD5EEPQb5M28g90T8+xpw==$tOVjzMJHr5I5bqAYa05jQzdpUGPAG/X4LC1OHOZdJac=', '2026-08-31T00:00:00.000Z')`,
  `INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
    ('test-account-02', '测试账号 02', '10000000002', 'test02@xingjian.ai', 'pbkdf2$100000$5+uYI2rPTz+vX13iQ+m+8g==$mLz+bWfoJ/DAhkiaVnKG1TE3MiBSTfrZjRsihk836G0=', '2026-08-31T00:00:00.000Z')`,
  `INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
    ('test-account-03', '测试账号 03', '10000000003', 'test03@xingjian.ai', 'pbkdf2$100000$DfTZ2Mu75x61HYirESmK5w==$GGCO1jTRqG2BVYFhMPZMmT/n1jy5S74IoOZqqJyeeYk=', '2026-08-31T00:00:00.000Z')`,
  `INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
    ('test-account-04', '测试账号 04', '10000000004', 'test04@xingjian.ai', 'pbkdf2$100000$2ti+224owAONvkA1xzWsQA==$/Z+DGFdNoVatlnvESN3t5JCj+sPKnbf2b141o5VLbIM=', '2026-08-31T00:00:00.000Z')`,
  `INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
    ('test-account-05', '测试账号 05', '10000000005', 'test05@xingjian.ai', 'pbkdf2$100000$bV7maY+JSQK3CrMCM/kzhA==$SIZT8I45x7/A5PBPRicI7i5BWAHad8MVW2FLTXhMjiU=', '2026-08-31T00:00:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    city TEXT NOT NULL,
    status TEXT NOT NULL,
    headcount INTEGER NOT NULL DEFAULT 1,
    owner_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    job_id TEXT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    years TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    skills_json TEXT NOT NULL DEFAULT '[]',
    score INTEGER,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    round TEXT NOT NULL,
    mode TEXT NOT NULL,
    interviewer TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    job_title TEXT NOT NULL,
    salary TEXT NOT NULL,
    recipient_email TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    owner_name TEXT NOT NULL,
    status TEXT NOT NULL,
    deadline TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS ai_questions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    job_id TEXT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    question_type TEXT NOT NULL,
    duration INTEGER NOT NULL,
    competency TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '',
    reference_answer TEXT NOT NULL DEFAULT '',
    follow_up INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_interviews (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    job_title TEXT NOT NULL,
    status TEXT NOT NULL,
    score INTEGER,
    duration_seconds INTEGER,
    summary TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS ai_interview_invitations (
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
  )`,
  `CREATE TABLE IF NOT EXISTS resume_profiles (
    candidate_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    education TEXT NOT NULL DEFAULT '',
    major TEXT NOT NULL DEFAULT '',
    school TEXT NOT NULL DEFAULT '',
    age INTEGER,
    gender TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    expected_salary INTEGER,
    work_years REAL,
    stability_months INTEGER,
    work_history_json TEXT NOT NULL DEFAULT '[]',
    project_history_json TEXT NOT NULL DEFAULT '[]',
    certificates_json TEXT NOT NULL DEFAULT '[]',
    highlights_json TEXT NOT NULL DEFAULT '[]',
    risks_json TEXT NOT NULL DEFAULT '[]',
    raw_text TEXT NOT NULL DEFAULT '',
    parsing_status TEXT NOT NULL DEFAULT '待复核',
    file_key TEXT,
    file_name TEXT NOT NULL DEFAULT '',
    file_type TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    keyword_score INTEGER,
    experience_score INTEGER,
    education_score INTEGER,
    stability_score INTEGER,
    match_score INTEGER,
    match_level TEXT NOT NULL DEFAULT '',
    screened_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS resume_applications (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    job_id TEXT,
    channel TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待初筛',
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS screening_rules (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    job_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    logic TEXT NOT NULL DEFAULT 'AND',
    min_education TEXT NOT NULL DEFAULT '',
    majors_json TEXT NOT NULL DEFAULT '[]',
    min_years REAL,
    certificates_json TEXT NOT NULL DEFAULT '[]',
    age_min INTEGER,
    age_max INTEGER,
    cities_json TEXT NOT NULL DEFAULT '[]',
    salary_max INTEGER,
    industries_json TEXT NOT NULL DEFAULT '[]',
    custom_conditions_json TEXT NOT NULL DEFAULT '[]',
    keywords_json TEXT NOT NULL DEFAULT '[]',
    keyword_weight INTEGER NOT NULL DEFAULT 45,
    experience_weight INTEGER NOT NULL DEFAULT 25,
    education_weight INTEGER NOT NULL DEFAULT 18,
    stability_weight INTEGER NOT NULL DEFAULT 12,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(owner_id, job_id)
  )`,
  `CREATE TABLE IF NOT EXISTS screening_templates (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS screening_reviews (
    candidate_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    comment TEXT NOT NULL DEFAULT '',
    risk_note TEXT NOT NULL DEFAULT '',
    reject_reason TEXT NOT NULL DEFAULT '',
    reviewer TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS screening_logs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    candidate_id TEXT,
    job_id TEXT,
    operator_name TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
  )`,
  `UPDATE candidates
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
    WHERE job_id IS NOT NULL`,
  `UPDATE resume_applications
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
    WHERE job_id IS NOT NULL`,
  `UPDATE screening_logs
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
    WHERE job_id IS NOT NULL`,
  `DELETE FROM jobs
    WHERE EXISTS (
      SELECT 1 FROM jobs keeper
      WHERE keeper.owner_id = jobs.owner_id
        AND keeper.title = jobs.title COLLATE NOCASE
        AND keeper.department = jobs.department COLLATE NOCASE
        AND keeper.city = jobs.city COLLATE NOCASE
        AND (keeper.created_at < jobs.created_at OR (keeper.created_at = jobs.created_at AND keeper.id < jobs.id))
    )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_account_expiry ON sessions(account_id, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_owner_created ON jobs(owner_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_owner_identity ON jobs(owner_id, title COLLATE NOCASE, department COLLATE NOCASE, city COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_owner_created ON candidates(owner_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_owner_stage ON candidates(owner_id, stage)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_owner_schedule ON interviews(owner_id, scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_offers_owner_created ON offers(owner_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_questions_owner_created ON ai_questions(owner_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_questions_owner_job ON ai_questions(owner_id, job_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_interviews_owner_status ON ai_interviews(owner_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_invites_owner_candidate ON ai_interview_invitations(owner_id, candidate_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_invites_token_hash ON ai_interview_invitations(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_resume_profiles_owner_status ON resume_profiles(owner_id, parsing_status)`,
  `CREATE INDEX IF NOT EXISTS idx_resume_applications_owner_job ON resume_applications(owner_id, job_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_screening_rules_owner_job ON screening_rules(owner_id, job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_screening_logs_owner_created ON screening_logs(owner_id, created_at)`,
] as const;
