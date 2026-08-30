import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, ensureSchema, getDb, getResumeBucket } from '@/app/server/db';

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

  let rawText = field(form, 'rawText', 50_000);
  if (file && ['txt', 'html', 'htm'].includes(extension(file.name))) {
    const extracted = await file.text();
    rawText = extension(file.name).startsWith('htm') ? stripHtml(extracted).slice(0, 50_000) : extracted.slice(0, 50_000);
  }
  const parsed = parseResumeText(rawText);
  const db = getDb();
  const jobId = field(form, 'jobId', 80) || null;
  const job = jobId ? await db.prepare('SELECT id, title FROM jobs WHERE id = ? AND owner_id = ?').bind(jobId, account.id).first<{ id: string; title: string }>() : null;
  if (jobId && !job) return invalid('关联职位不存在。');
  const name = field(form, 'name', 60) || parsed.name;
  const role = field(form, 'role', 100) || job?.title || parsed.role;
  const phone = field(form, 'phone', 30) || parsed.phone;
  const email = field(form, 'email', 120) || parsed.email;
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
  const industry = field(form, 'industry', 100);
  const expectedSalary = numberField(form, 'expectedSalary', 1, 1_000_000);
  const stabilityMonths = numberField(form, 'stabilityMonths', 1, 600);
  const workHistory = splitLines(field(form, 'workHistory', 10_000));
  const projectHistory = splitLines(field(form, 'projectHistory', 10_000));
  const city = field(form, 'city', 80) || parsed.city;
  const company = field(form, 'company', 100) || parsed.company;
  const fileKey = file ? `${account.id}/${candidateId}/${crypto.randomUUID()}-${safeFileName(file.name)}` : null;
  const parsingStatus = file && !['txt', 'html', 'htm'].includes(extension(file.name)) ? '解析待复核' : '结构化完成';

  if (file && fileKey) {
    await getResumeBucket().put(fileKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { ownerId: account.id, candidateId, originalName: file.name },
    });
  }

  if (!existing) {
    await db.prepare(`INSERT INTO candidates (
      id, owner_id, job_id, name, role, company, years, stage, source, skills_json, score, phone, email, city, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '待初筛', ?, ?, NULL, ?, ?, ?, ?, ?)`).bind(
      candidateId, account.id, jobId, name, role, company, workYears === null ? '' : `${workYears} 年`, channel,
      JSON.stringify(skills), phone, email, city, now, now,
    ).run();
  } else {
    await db.prepare(`UPDATE candidates SET job_id = COALESCE(?, job_id), role = CASE WHEN ? <> '' THEN ? ELSE role END,
      company = CASE WHEN ? <> '' THEN ? ELSE company END, years = CASE WHEN ? <> '' THEN ? ELSE years END,
      source = ?, skills_json = CASE WHEN ? <> '[]' THEN ? ELSE skills_json END,
      phone = CASE WHEN ? <> '' THEN ? ELSE phone END, email = CASE WHEN ? <> '' THEN ? ELSE email END,
      city = CASE WHEN ? <> '' THEN ? ELSE city END, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(
      jobId, role, role, company, company, workYears === null ? '' : `${workYears} 年`, workYears === null ? '' : `${workYears} 年`,
      channel, JSON.stringify(skills), JSON.stringify(skills), phone, phone, email, email, city, city, now, candidateId, account.id,
    ).run();
  }

  await db.batch([
    db.prepare(`INSERT INTO resume_profiles (
      candidate_id, owner_id, education, major, school, age, gender, industry, expected_salary, work_years, stability_months,
      work_history_json, project_history_json, certificates_json, highlights_json, risks_json, raw_text, parsing_status,
      file_key, file_name, file_type, file_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?)
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
      raw_text = CASE WHEN excluded.raw_text <> '' THEN excluded.raw_text ELSE resume_profiles.raw_text END,
      parsing_status = excluded.parsing_status,
      file_key = COALESCE(excluded.file_key, resume_profiles.file_key),
      file_name = CASE WHEN excluded.file_name <> '' THEN excluded.file_name ELSE resume_profiles.file_name END,
      file_type = CASE WHEN excluded.file_type <> '' THEN excluded.file_type ELSE resume_profiles.file_type END,
      file_size = CASE WHEN excluded.file_size > 0 THEN excluded.file_size ELSE resume_profiles.file_size END,
      updated_at = excluded.updated_at`).bind(
      candidateId, account.id, education, major, school, age, field(form, 'gender', 20), industry, expectedSalary, workYears, stabilityMonths,
      JSON.stringify(workHistory), JSON.stringify(projectHistory), JSON.stringify(certificates), rawText, parsingStatus,
      fileKey, file?.name || '', file?.type || '', file?.size || 0, now, now,
    ),
    db.prepare(`INSERT INTO resume_applications (id, owner_id, candidate_id, job_id, channel, applied_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '待初筛', ?)`).bind(crypto.randomUUID(), account.id, candidateId, jobId, channel, now, now),
    db.prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
      VALUES (?, ?, ?, ?, ?, '简历入库', ?, ?)`).bind(
      crypto.randomUUID(), account.id, candidateId, jobId, account.contact,
      existing ? `识别重复投递并合并，来源：${channel}` : `新简历完成结构化入库，来源：${channel}`, now,
    ),
  ]);

  return NextResponse.json({ ok: true, candidateId, duplicate: Boolean(existing), parsingStatus }, { status: 201 });
}

function parseResumeText(value: string) {
  const phone = value.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0] || '';
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
  const name = value.match(/(?:姓名|姓\s*名)\s*[：:]\s*([\u4e00-\u9fa5·]{2,12})/)?.[1] || '';
  const role = value.match(/(?:应聘岗位|求职意向|目标岗位)\s*[：:]\s*([^\n\r]{2,40})/)?.[1]?.trim() || '';
  const education = ['博士', '硕士', '本科', '大专', '中专', '高中'].find(item => value.includes(item)) || '';
  const school = value.match(/([\u4e00-\u9fa5]{2,30}(?:大学|学院))/)?.[1] || '';
  const major = value.match(/(?:专业)\s*[：:]\s*([^\n\r]{2,30})/)?.[1]?.trim() || '';
  const ageText = value.match(/(?:年龄)\s*[：:]\s*(\d{2})/)?.[1];
  const yearsText = value.match(/(?:工作经验|工作年限)\s*[：:]?\s*(\d+(?:\.\d+)?)\s*年/)?.[1];
  const city = value.match(/(?:所在城市|现居地|工作地点)\s*[：:]\s*([^\n\r]{2,20})/)?.[1]?.trim() || '';
  const company = value.match(/(?:最近公司|当前公司)\s*[：:]\s*([^\n\r]{2,50})/)?.[1]?.trim() || '';
  const skillText = value.match(/(?:技能|专业技能)\s*[：:]\s*([^\n\r]{2,200})/)?.[1] || '';
  const certificateText = value.match(/(?:证书|资格证书)\s*[：:]\s*([^\n\r]{2,200})/)?.[1] || '';
  return { phone, email, name, role, education, school, major, age: ageText ? Number(ageText) : null, workYears: yearsText ? Number(yearsText) : null, city, company, skills: splitList(skillText), certificates: splitList(certificateText) };
}

function field(form: FormData, key: string, max: number) { const value = form.get(key); return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function numberField(form: FormData, key: string, min: number, max: number) { const value = field(form, key, 40); if (!value) return null; const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null; }
function decimalField(form: FormData, key: string, min: number, max: number) { const value = field(form, key, 40); if (!value) return null; const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null; }
function splitList(value: string) { return value.split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean); }
function splitLines(value: string) { return value.split(/\n+/).map(item => item.trim()).filter(Boolean).slice(0, 50); }
function mergeLists(a: string[], b: string[]) { return [...new Set([...a, ...b])]; }
function extension(name: string) { return name.split('.').pop()?.toLowerCase() || ''; }
function safeFileName(name: string) { return name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(-120); }
function stripHtml(value: string) { return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function invalid(message: string) { return NextResponse.json({ ok: false, message }, { status: 400 }); }
