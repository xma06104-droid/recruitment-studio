import { getDb } from '@/app/server/db';
import { ResumeJob } from '@/app/server/resume-parser';

type JobRow = Record<string, string | number | null>;

export async function getResumeJobs(ownerId: string): Promise<ResumeJob[]> {
  const rows = await getDb().prepare(`SELECT j.id, j.title, j.department, j.city,
    r.min_education, r.majors_json, r.min_years, r.certificates_json, r.industries_json, r.keywords_json,
    r.keyword_weight, r.experience_weight, r.education_weight, r.stability_weight
    FROM jobs j LEFT JOIN screening_rules r ON r.owner_id = j.owner_id AND r.job_id = j.id AND r.enabled = 1
    WHERE j.owner_id = ? ORDER BY j.updated_at DESC`).bind(ownerId).all<JobRow>();
  return (rows.results || []).map(row => ({
    id: String(row.id),
    title: String(row.title),
    department: String(row.department || ''),
    city: String(row.city || ''),
    minEducation: String(row.min_education || ''),
    majors: jsonList(row.majors_json),
    minYears: optionalNumber(row.min_years),
    certificates: jsonList(row.certificates_json),
    industries: jsonList(row.industries_json),
    keywords: jsonList(row.keywords_json),
    keywordWeight: optionalNumber(row.keyword_weight) ?? 45,
    experienceWeight: optionalNumber(row.experience_weight) ?? 25,
    educationWeight: optionalNumber(row.education_weight) ?? 18,
    stabilityWeight: optionalNumber(row.stability_weight) ?? 12,
  }));
}

function jsonList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [];
  } catch {
    return [];
  }
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return value === null || value === '' || !Number.isFinite(parsed) ? null : parsed;
}
