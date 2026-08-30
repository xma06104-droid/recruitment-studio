CREATE TABLE IF NOT EXISTS resume_profiles (
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
);

CREATE TABLE IF NOT EXISTS resume_applications (
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
);

CREATE TABLE IF NOT EXISTS screening_rules (
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
);

CREATE TABLE IF NOT EXISTS screening_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS screening_reviews (
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
);

CREATE TABLE IF NOT EXISTS screening_logs (
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
);

CREATE INDEX IF NOT EXISTS idx_resume_profiles_owner_status ON resume_profiles(owner_id, parsing_status);
CREATE INDEX IF NOT EXISTS idx_resume_applications_owner_job ON resume_applications(owner_id, job_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_screening_rules_owner_job ON screening_rules(owner_id, job_id);
CREATE INDEX IF NOT EXISTS idx_screening_logs_owner_created ON screening_logs(owner_id, created_at);
PRAGMA optimize;
