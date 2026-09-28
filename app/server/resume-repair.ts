import { getDb } from '@/app/server/db';
import { buildSystemResumeJob, parseResumeFileName, parseResumeText, scoreResumeForJob } from '@/app/server/resume-parser';

type RepairRow = {
  id: string;
  job_id: string | null;
  job_title: string | null;
  job_city: string | null;
  role: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  skills_json: string;
  education: string;
  major: string;
  age: number | null;
  gender: string;
  work_history_json: string;
  project_history_json: string;
  raw_text: string;
  file_name: string;
  system_job: number;
};

const invalidCandidateNames = new Set(['联系方式', '联系信息', '个人信息', '基本信息', '个人资料', '求职意向', '教育经历', '工作经历']);

export async function repairResumeProfiles(ownerId: string) {
  const db = getDb();
  const rows = await db.prepare(`SELECT c.id, c.job_id, c.role, c.name, c.company, c.phone, c.email, c.skills_json,
      p.education, p.major, p.age, p.gender, p.work_history_json,
      p.project_history_json, p.raw_text, p.file_name,
      j.title AS job_title, j.city AS job_city,
      EXISTS(SELECT 1 FROM screening_logs l WHERE l.owner_id = c.owner_id AND l.job_id = c.job_id AND l.action = '系统规则配置') AS system_job
    FROM candidates c JOIN resume_profiles p ON p.candidate_id = c.id AND p.owner_id = c.owner_id
    LEFT JOIN jobs j ON j.id = c.job_id AND j.owner_id = c.owner_id
    WHERE c.owner_id = ? AND (
      p.education = '' OR p.major = '' OR p.age IS NULL OR p.gender = '' OR c.phone = '' OR c.email = '' OR c.company = ''
      OR c.name IN ('联系方式','联系信息','个人信息','基本信息','个人资料','求职意向','教育经历','工作经历')
      OR (c.skills_json LIKE '%"销售"%' AND c.role NOT LIKE '%销售%' AND c.role NOT LIKE '%商务%' AND c.role NOT LIKE '%客户%')
      OR p.work_history_json = '[]' OR p.project_history_json = '[]'
      OR p.work_history_json LIKE '%--%'
      OR p.work_history_json LIKE '%~%' OR p.project_history_json LIKE '%~%'
      OR p.work_history_json LIKE '%"内容:%' OR p.work_history_json LIKE '%"业绩:%'
    ) AND (p.raw_text <> '' OR p.file_name <> '') LIMIT 100`).bind(ownerId).all<RepairRow>();
  const updates: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  for (const row of rows.results || []) {
    const parsed = parseResumeText(row.raw_text || '');
    const fromFile = parseResumeFileName(row.file_name || '');
    const name = invalidCandidateNames.has(row.name) ? fromFile.name || parsed.name : row.name;
    const education = row.education || parsed.education;
    const major = row.major || parsed.major;
    const storedSkills = jsonList(row.skills_json);
    const storedWorkHistory = jsonList(row.work_history_json);
    const storedProjectHistory = jsonList(row.project_history_json);
    const skills = [...new Set([...storedSkills.filter(skill => skill !== '销售' || /销售|商务|客户/.test(row.role)), ...parsed.skills])];
    if (name !== row.name && name) updates.push(db.prepare('UPDATE candidates SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(name, now, row.id, ownerId));
    if (!row.phone && parsed.phone) updates.push(db.prepare('UPDATE candidates SET phone = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(parsed.phone, now, row.id, ownerId));
    if (!row.email && parsed.email) updates.push(db.prepare('UPDATE candidates SET email = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(parsed.email, now, row.id, ownerId));
    if (!row.company && parsed.company) updates.push(db.prepare('UPDATE candidates SET company = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(parsed.company, now, row.id, ownerId));
    if (education !== row.education && education) updates.push(db.prepare('UPDATE resume_profiles SET education = ?, updated_at = ? WHERE candidate_id = ? AND owner_id = ?').bind(education, now, row.id, ownerId));
    if (major !== row.major && major) updates.push(db.prepare('UPDATE resume_profiles SET major = ?, updated_at = ? WHERE candidate_id = ? AND owner_id = ?').bind(major, now, row.id, ownerId));
    if (row.age === null && parsed.age !== null) updates.push(db.prepare('UPDATE resume_profiles SET age = ?, updated_at = ? WHERE candidate_id = ? AND owner_id = ?').bind(parsed.age, now, row.id, ownerId));
    if (!row.gender && parsed.gender) updates.push(db.prepare('UPDATE resume_profiles SET gender = ?, updated_at = ? WHERE candidate_id = ? AND owner_id = ?').bind(parsed.gender, now, row.id, ownerId));
    if (JSON.stringify(skills) !== JSON.stringify(storedSkills)) updates.push(db.prepare('UPDATE candidates SET skills_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(JSON.stringify(skills), now, row.id, ownerId));
    if (parsed.workHistory.length && JSON.stringify(parsed.workHistory) !== JSON.stringify(storedWorkHistory)) updates.push(db.prepare('UPDATE resume_profiles SET work_history_json = ?, updated_at = ? WHERE candidate_id = ? AND owner_id = ?').bind(JSON.stringify(parsed.workHistory), now, row.id, ownerId));
    if (parsed.projectHistory.length && JSON.stringify(parsed.projectHistory) !== JSON.stringify(storedProjectHistory)) updates.push(db.prepare('UPDATE resume_profiles SET project_history_json = ?, updated_at = ? WHERE candidate_id = ? AND owner_id = ?').bind(JSON.stringify(parsed.projectHistory), now, row.id, ownerId));
    if (row.system_job && row.job_id && row.job_title) {
      const job = buildSystemResumeJob(row.job_title, row.job_id, row.job_city || '');
      const resume = { ...parsed, name: name || parsed.name, role: row.role, company: row.company || parsed.company, education: education || parsed.education, major: major || parsed.major, skills };
      const match = scoreResumeForJob(resume, row.raw_text || '', job);
      updates.push(
        db.prepare(`UPDATE screening_rules SET min_education = ?, majors_json = ?, min_years = ?, certificates_json = ?,
          cities_json = ?, industries_json = ?, keywords_json = ?, keyword_weight = ?, experience_weight = ?,
          education_weight = ?, stability_weight = ?, updated_at = ? WHERE owner_id = ? AND job_id = ?`).bind(
          job.minEducation, JSON.stringify(job.majors), job.minYears, JSON.stringify(job.certificates),
          JSON.stringify(job.city !== '待设置' ? [job.city] : []), JSON.stringify(job.industries), JSON.stringify(job.keywords),
          job.keywordWeight, job.experienceWeight, job.educationWeight, job.stabilityWeight, now, ownerId, job.id,
        ),
        db.prepare('UPDATE candidates SET score = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(match.score, now, row.id, ownerId),
        db.prepare(`UPDATE resume_profiles SET keyword_score = ?, experience_score = ?, education_score = ?, stability_score = ?,
          match_score = ?, match_level = ?, highlights_json = ?, risks_json = ?, screened_at = ?, updated_at = ?
          WHERE candidate_id = ? AND owner_id = ?`).bind(
          match.keywordScore, match.experienceScore, match.educationScore, match.stabilityScore, match.score, match.level,
          JSON.stringify(match.highlights), JSON.stringify(match.risks), now, now, row.id, ownerId,
        ),
      );
    }
  }
  if (updates.length) await db.batch(updates);
}

function jsonList(value: string) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}
