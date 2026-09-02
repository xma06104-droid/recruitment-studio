import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, ensureSchema, getDb, getResumeBucket } from '@/app/server/db';
import { extractResumeFileText, ResumeFileExtraction } from '@/app/server/resume-file-text';
import { getResumeJobs } from '@/app/server/resume-jobs';
import { matchResumeJob, parseResumeFileName, parseResumeText, ParsedResume, scoreResumeForJob } from '@/app/server/resume-parser';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedExtensions = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp', 'txt', 'html', 'htm'];

export async function POST(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return NextResponse.json({ message: '请先登录。' }, { status: 401 });
  await ensureSchema();
  const form = await request.formData().catch(() => null);
  if (!form) return invalid('导入内容无法读取。');
  const fileValue = form.get('resume');
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  if (file && file.size > MAX_FILE_SIZE) return invalid('简历附件不能超过 10MB。');
  if (file && !allowedExtensions.includes(extension(file.name))) return invalid('仅支持 PDF、Word、图片、TXT 和 HTML 简历。');

  let rawText = field(form, 'rawText', 120_000);
  let extraction: ResumeFileExtraction | null = null;
  if (file) {
    extraction = await extractResumeFileText(file);
    if (extraction.text) rawText = extraction.text;
  }
  let parsed = parseResumeText(rawText);
  if (file) {
    const fallback = parseResumeFileName(file.name);
    parsed = { ...parsed, name: fallback.name || parsed.name, role: fallback.role || parsed.role };
  }
  const db = getDb();
  const jobs = await getResumeJobs(account.id);
  let jobId = field(form, 'jobId', 80) || null;
  let job = jobId ? jobs.find(item => item.id === jobId) || null : null;
  if (jobId && !job) return invalid('关联职位不存在。');
  let matchedJob = null;
  if (!jobId) {
    matchedJob = matchResumeJob(parsed.role, rawText, jobs);
    if (matchedJob) { jobId = matchedJob.id; job = matchedJob; }
  }
  const name = field(form, 'name', 60) || parsed.name;
  const role = field(form, 'role', 100) || job?.title || parsed.role;
  const phone = field(form, 'phone', 30) || parsed.phone;
  const email = field(form, 'email', 120) || parsed.email;
  if (file && extraction && !extraction.text && !rawText && (!name || !role)) return invalid(extraction.message);
  if (!name || !role) return invalid('解析未能识别姓名或应聘职位，请补充后再入库。');
  const channel = field(form, 'channel', 80) || '手动上传';
  const now = new Date().toISOString();

  const existing = phone ? await db.prepare('SELECT id, job_id FROM candidates WHERE owner_id = ? AND name = ? AND phone = ? LIMIT 1').bind(account.id, name, phone).first<{ id: string; job_id: string | null }>() : null;
  const candidateId = existing?.id || crypto.randomUUID();
  const skills = mergeLists(splitList(field(form, 'skills', 1000)), parsed.skills).slice(0, 20);
  const certificates = mergeLists(splitList(field(form, 'certificates', 1000)), parsed.certificates).slice(0, 20);
  const education = field(form, 'education', 20) || parsed.education;
  const major = field(form, 'major', 80) || parsed.major;
  const school = field(form, 'school', 120) || parsed.school;
  const age = numberField(form, 'age', 16, 80) ?? parsed.age;
  const workYears = decimalField(form, 'workYears', 0, 60) ?? parsed.workYears;
  const industry = field(form, 'industry', 100) || parsed.industry;
  const expectedSalary = numberField(form, 'expectedSalary', 1, 1_000_000) ?? parsed.expectedSalary;
  const stabilityMonths = numberField(form, 'stabilityMonths', 1, 600) ?? parsed.stabilityMonths;
  const suppliedWorkHistory = splitLines(field(form, 'workHistory', 10_000));
  const suppliedProjectHistory = splitLines(field(form, 'projectHistory', 10_000));
  const workHistory = suppliedWorkHistory.length ? suppliedWorkHistory : parsed.workHistory;
  const projectHistory = suppliedProjectHistory.length ? suppliedProjectHistory : parsed.projectHistory;
  const city = field(form, 'city', 80) || parsed.city;
  const company = field(form, 'company', 100) || parsed.company;
  const scoredResume: ParsedResume = {
    ...parsed, name, role, phone, email, education, major, school, age, workYears, stabilityMonths,
    city, company, industry, expectedSalary, skills, certificates, workHistory, projectHistory,
  };
  const match = job ? scoreResumeForJob(scoredResume, rawText, job) : null;
  const fileKey = file ? `${account.id}/${candidateId}/${crypto.randomUUID()}-${safeFileName(file.name)}` : null;
  const parsingStatus = file && extraction?.status !== 'extracted' && !rawText ? '解析待复核' : '结构化完成';

  if (file && fileKey) {
    await getResumeBucket().put(fileKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { ownerId: account.id, candidateId, originalName: file.name },
    });
  }

  if (!existing) {
    await db.prepare(`INSERT INTO candidates (
      id, owner_id, job_id, name, role, company, years, stage, source, skills_json, score, phone, email, city, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '待初筛', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      candidateId, account.id, jobId, name, role, company, workYears === null ? '' : `${workYears} 年`, channel,
      JSON.stringify(skills), match?.score ?? null, phone, email, city, now, now,
    ).run();
  } else {
    await db.prepare(`UPDATE candidates SET job_id = COALESCE(?, job_id), role = CASE WHEN ? <> '' THEN ? ELSE role END,
      company = CASE WHEN ? <> '' THEN ? ELSE company END, years = CASE WHEN ? <> '' THEN ? ELSE years END,
      source = ?, skills_json = CASE WHEN ? <> '[]' THEN ? ELSE skills_json END, score = COALESCE(?, score),
      phone = CASE WHEN ? <> '' THEN ? ELSE phone END, email = CASE WHEN ? <> '' THEN ? ELSE email END,
      city = CASE WHEN ? <> '' THEN ? ELSE city END, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(
      jobId, role, role, company, company, workYears === null ? '' : `${workYears} 年`, workYears === null ? '' : `${workYears} 年`,
      channel, JSON.stringify(skills), JSON.stringify(skills), match?.score ?? null, phone, phone, email, email, city, city, now, candidateId, account.id,
    ).run();
  }

  await db.batch([
    db.prepare(`INSERT INTO resume_profiles (
      candidate_id, owner_id, education, major, school, age, gender, industry, expected_salary, work_years, stability_months,
      work_history_json, project_history_json, certificates_json, highlights_json, risks_json, raw_text, parsing_status,
      file_key, file_name, file_type, file_size, keyword_score, experience_score, education_score, stability_score,
      match_score, match_level, screened_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET
      education = CASE WHEN excluded.education <> '' THEN excluded.education ELSE resume_profiles.education END,
      major = CASE WHEN excluded.major <> '' THEN excluded.major ELSE resume_profiles.major END,
      school = CASE WHEN excluded.school <> '' THEN excluded.school ELSE resume_profiles.school END,
      age = COALESCE(excluded.age, resume_profiles.age), gender = CASE WHEN excluded.gender <> '' THEN excluded.gender ELSE resume_profiles.gender END,
      industry = CASE WHEN excluded.industry <> '' THEN excluded.industry ELSE resume_profiles.industry END,
      expected_salary = COALESCE(excluded.expected_salary, resume_profiles.expected_salary),
      work_years = COALESCE(excluded.work_years, resume_profiles.work_years),
      stability_months = COALESCE(excluded.stability_months, resume_profiles.stability_months),
      work_history_json = CASE WHEN excluded.work_history_json <> '[]' THEN excluded.work_history_json ELSE resume_profiles.work_history_json END,
      project_history_json = CASE WHEN excluded.project_history_json <> '[]' THEN excluded.project_history_json ELSE resume_profiles.project_history_json END,
      certificates_json = CASE WHEN excluded.certificates_json <> '[]' THEN excluded.certificates_json ELSE resume_profiles.certificates_json END,
      highlights_json = CASE WHEN excluded.highlights_json <> '[]' THEN excluded.highlights_json ELSE resume_profiles.highlights_json END,
      risks_json = CASE WHEN excluded.risks_json <> '[]' THEN excluded.risks_json ELSE resume_profiles.risks_json END,
      raw_text = CASE WHEN excluded.raw_text <> '' THEN excluded.raw_text ELSE resume_profiles.raw_text END,
      parsing_status = excluded.parsing_status,
      file_key = COALESCE(excluded.file_key, resume_profiles.file_key),
      file_name = CASE WHEN excluded.file_name <> '' THEN excluded.file_name ELSE resume_profiles.file_name END,
      file_type = CASE WHEN excluded.file_type <> '' THEN excluded.file_type ELSE resume_profiles.file_type END,
      file_size = CASE WHEN excluded.file_size > 0 THEN excluded.file_size ELSE resume_profiles.file_size END,
      keyword_score = COALESCE(excluded.keyword_score, resume_profiles.keyword_score),
      experience_score = COALESCE(excluded.experience_score, resume_profiles.experience_score),
      education_score = COALESCE(excluded.education_score, resume_profiles.education_score),
      stability_score = COALESCE(excluded.stability_score, resume_profiles.stability_score),
      match_score = COALESCE(excluded.match_score, resume_profiles.match_score),
      match_level = CASE WHEN excluded.match_level <> '' THEN excluded.match_level ELSE resume_profiles.match_level END,
      screened_at = COALESCE(excluded.screened_at, resume_profiles.screened_at),
      updated_at = excluded.updated_at`).bind(
      candidateId, account.id, education, major, school, age, field(form, 'gender', 20), industry, expectedSalary, workYears, stabilityMonths,
      JSON.stringify(workHistory), JSON.stringify(projectHistory), JSON.stringify(certificates), JSON.stringify(match?.highlights || []),
      JSON.stringify(match?.risks || []), rawText, parsingStatus, fileKey, file?.name || '', file?.type || '', file?.size || 0,
      match?.keywordScore ?? null, match?.experienceScore ?? null, match?.educationScore ?? null, match?.stabilityScore ?? null,
      match?.score ?? null, match?.level || '', null, now, now,
    ),
    db.prepare(`INSERT INTO resume_applications (id, owner_id, candidate_id, job_id, channel, applied_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '待初筛', ?)`).bind(crypto.randomUUID(), account.id, candidateId, jobId, channel, now, now),
    db.prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
      VALUES (?, ?, ?, ?, ?, '简历入库', ?, ?)`).bind(
      crypto.randomUUID(), account.id, candidateId, jobId, account.contact,
      `${existing ? '识别重复投递并合并' : '新简历完成结构化入库'}，来源：${channel}${match ? `；${job?.title}匹配度 ${match.score} 分（${match.level}）` : ''}`, now,
    ),
  ]);

  return NextResponse.json({
    ok: true, candidateId, duplicate: Boolean(existing), parsingStatus,
    matchedJob: matchedJob || (job ? { ...job, confidence: 100, reason: '已选择关联岗位' } : null), match,
  }, { status: 201 });
}

function field(form: FormData, key: string, max: number) { const value = form.get(key); return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function numberField(form: FormData, key: string, min: number, max: number) { const value = field(form, key, 40); if (!value) return null; const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null; }
function decimalField(form: FormData, key: string, min: number, max: number) { const value = field(form, key, 40); if (!value) return null; const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null; }
function splitList(value: string) { return value.split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean); }
function splitLines(value: string) { return value.split(/\n+/).map(item => item.trim()).filter(Boolean).slice(0, 50); }
function mergeLists(a: string[], b: string[]) { return [...new Set([...a, ...b])]; }
function extension(name: string) { return name.split('.').pop()?.toLowerCase() || ''; }
function safeFileName(name: string) { return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(-120); }
function invalid(message: string) { return NextResponse.json({ ok: false, message }, { status: 400 }); }
