import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, ensureSchema, getDb } from '@/app/server/db';

type DataRow = Record<string, string | number | null>;
type RuleRow = DataRow & {
  logic: string;
  min_education: string;
  majors_json: string;
  min_years: number | null;
  certificates_json: string;
  age_min: number | null;
  age_max: number | null;
  cities_json: string;
  salary_max: number | null;
  industries_json: string;
  keywords_json: string;
  keyword_weight: number;
  experience_weight: number;
  education_weight: number;
  stability_weight: number;
};

const transitionStages = ['面试待安排', '待复核', '初筛淘汰', '淘汰人才库', 'AI 初面待发起'];
const educationRanks: Record<string, number> = { '高中': 1, '中专': 1, '大专': 2, '本科': 3, '硕士': 4, '博士': 5 };

export async function GET(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  await ensureSchema();
  const db = getDb();
  await db.prepare(`INSERT OR IGNORE INTO resume_profiles (
    candidate_id, owner_id, parsing_status, created_at, updated_at
  ) SELECT id, owner_id, '结构化完成', created_at, updated_at FROM candidates WHERE owner_id = ?`).bind(account.id).run();

  const [profiles, applications, rules, templates, reviews, logs] = await Promise.all([
    db.prepare('SELECT * FROM resume_profiles WHERE owner_id = ? ORDER BY updated_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM resume_applications WHERE owner_id = ? ORDER BY applied_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM screening_rules WHERE owner_id = ? ORDER BY updated_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM screening_templates WHERE owner_id = ? ORDER BY updated_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM screening_reviews WHERE owner_id = ? ORDER BY updated_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM screening_logs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 300').bind(account.id).all<DataRow>(),
  ]);

  return NextResponse.json({
    profiles: profiles.results.map(mapProfile),
    applications: applications.results.map(mapApplication),
    rules: rules.results.map(mapRule),
    templates: templates.results.map(mapTemplate),
    reviews: reviews.results.map(mapReview),
    logs: logs.results.map(mapLog),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = text(body?.action, 50);
  const db = getDb();
  const now = new Date().toISOString();

  if (action === 'saveRule') {
    const jobId = text(body?.jobId, 80);
    if (jobId && !await ownedJob(jobId, account.id)) return invalid('所选职位不存在。');
    const weights = [
      integer(body?.keywordWeight, 0, 100, 45),
      integer(body?.experienceWeight, 0, 100, 25),
      integer(body?.educationWeight, 0, 100, 18),
      integer(body?.stabilityWeight, 0, 100, 12),
    ];
    if (weights.reduce((sum, value) => sum + value, 0) !== 100) return invalid('四项评分权重之和必须等于 100%。');
    const values = {
      name: text(body?.name, 80) || (jobId ? '岗位初筛规则' : '通用初筛规则'),
      logic: body?.logic === 'OR' ? 'OR' : 'AND',
      minEducation: text(body?.minEducation, 20),
      majors: list(body?.majors),
      minYears: optionalNumber(body?.minYears, 0, 60),
      certificates: list(body?.certificates),
      ageMin: optionalInteger(body?.ageMin, 16, 80),
      ageMax: optionalInteger(body?.ageMax, 16, 80),
      cities: list(body?.cities),
      salaryMax: optionalInteger(body?.salaryMax, 1, 1_000_000),
      industries: list(body?.industries),
      keywords: list(body?.keywords),
    };
    if (values.ageMin !== null && values.ageMax !== null && values.ageMin > values.ageMax) return invalid('最低年龄不能大于最高年龄。');
    await db.prepare(`INSERT INTO screening_rules (
      id, owner_id, job_id, name, logic, min_education, majors_json, min_years, certificates_json,
      age_min, age_max, cities_json, salary_max, industries_json, keywords_json,
      keyword_weight, experience_weight, education_weight, stability_weight, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(owner_id, job_id) DO UPDATE SET
      name = excluded.name, logic = excluded.logic, min_education = excluded.min_education,
      majors_json = excluded.majors_json, min_years = excluded.min_years,
      certificates_json = excluded.certificates_json, age_min = excluded.age_min,
      age_max = excluded.age_max, cities_json = excluded.cities_json,
      salary_max = excluded.salary_max, industries_json = excluded.industries_json,
      keywords_json = excluded.keywords_json, keyword_weight = excluded.keyword_weight,
      experience_weight = excluded.experience_weight, education_weight = excluded.education_weight,
      stability_weight = excluded.stability_weight, enabled = 1, updated_at = excluded.updated_at`).bind(
      crypto.randomUUID(), account.id, jobId, values.name, values.logic, values.minEducation,
      JSON.stringify(values.majors), values.minYears, JSON.stringify(values.certificates), values.ageMin,
      values.ageMax, JSON.stringify(values.cities), values.salaryMax, JSON.stringify(values.industries),
      JSON.stringify(values.keywords), ...weights, now, now,
    ).run();
    await insertLog(account.id, null, jobId || null, account.contact, '规则配置', `保存“${values.name}”，硬性条件采用${values.logic === 'AND' ? '且' : '或'}逻辑`);
    return NextResponse.json({ ok: true });
  }

  if (action === 'runScreening') {
    const jobId = text(body?.jobId, 80);
    const rule = await db.prepare('SELECT * FROM screening_rules WHERE owner_id = ? AND job_id = ? AND enabled = 1').bind(account.id, jobId).first<RuleRow>();
    if (!rule) return invalid('请先保存该岗位的初筛规则。');
    const selectedIds = list(body?.candidateIds).slice(0, 100);
    const candidates = await db.prepare(`SELECT c.*, p.* FROM candidates c
      JOIN resume_profiles p ON p.candidate_id = c.id AND p.owner_id = c.owner_id
      WHERE c.owner_id = ? AND p.parsing_status = '结构化完成' AND (? = '' OR c.job_id = ?)`
    ).bind(account.id, jobId, jobId).all<DataRow>();
    const target = candidates.results.filter(row => selectedIds.length === 0 || selectedIds.includes(String(row.id)));
    if (target.length === 0) return invalid('当前条件下没有可执行初筛的简历。');
    const statements: D1PreparedStatement[] = [];
    for (const row of target) {
      const outcome = scoreCandidate(row, rule);
      statements.push(db.prepare(`UPDATE resume_profiles SET keyword_score = ?, experience_score = ?, education_score = ?,
        stability_score = ?, match_score = ?, match_level = ?, highlights_json = ?, risks_json = ?, screened_at = ?, updated_at = ?
        WHERE candidate_id = ? AND owner_id = ?`).bind(
        outcome.keywordScore, outcome.experienceScore, outcome.educationScore, outcome.stabilityScore,
        outcome.total, outcome.level, JSON.stringify(outcome.highlights), JSON.stringify(outcome.risks), now, now, row.id, account.id,
      ));
      statements.push(db.prepare('UPDATE candidates SET score = ?, stage = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(
        outcome.total, outcome.knockout ? '初筛淘汰' : '待复核', now, row.id, account.id,
      ));
      statements.push(db.prepare('UPDATE resume_applications SET status = ? WHERE candidate_id = ? AND owner_id = ?').bind(
        outcome.knockout ? '初筛淘汰' : '待复核', row.id, account.id,
      ));
      statements.push(db.prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
        VALUES (?, ?, ?, ?, ?, '自动初筛', ?, ?)`).bind(
        crypto.randomUUID(), account.id, row.id, row.job_id, account.contact,
        outcome.knockout ? `命中硬性淘汰：${outcome.failures.join('、')}` : `匹配度 ${outcome.total} 分，标记${outcome.level}`, now,
      ));
    }
    await executeBatches(db, statements);
    return NextResponse.json({ ok: true, count: target.length });
  }

  if (action === 'saveReview') {
    const candidateId = text(body?.candidateId, 80);
    const candidate = await ownedCandidate(candidateId, account.id);
    if (!candidate) return invalid('候选人不存在。');
    const tags = list(body?.tags).slice(0, 20);
    const comment = text(body?.comment, 2000);
    const riskNote = text(body?.riskNote, 2000);
    const rejectReason = text(body?.rejectReason, 500);
    await db.prepare(`INSERT INTO screening_reviews (candidate_id, owner_id, tags_json, comment, risk_note, reject_reason, reviewer, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET tags_json = excluded.tags_json, comment = excluded.comment,
      risk_note = excluded.risk_note, reject_reason = excluded.reject_reason, reviewer = excluded.reviewer,
      updated_at = excluded.updated_at`).bind(candidateId, account.id, JSON.stringify(tags), comment, riskNote, rejectReason, account.contact, now).run();
    await insertLog(account.id, candidateId, candidate.job_id ? String(candidate.job_id) : null, account.contact, '人工核验', comment ? '更新筛选评语与标签' : '更新人工标注');
    return NextResponse.json({ ok: true });
  }

  if (action === 'confirmParsing') {
    const candidateId = text(body?.candidateId, 80);
    const candidate = await ownedCandidate(candidateId, account.id);
    if (!candidate) return invalid('候选人不存在。');
    await db.prepare(`UPDATE resume_profiles SET parsing_status = '结构化完成', updated_at = ?
      WHERE candidate_id = ? AND owner_id = ?`).bind(now, candidateId, account.id).run();
    await insertLog(account.id, candidateId, candidate.job_id ? String(candidate.job_id) : null, account.contact, '解析核验', '原始简历与结构化字段已完成人工核验，进入筛选池');
    return NextResponse.json({ ok: true });
  }

  if (action === 'batchTransition') {
    const candidateIds = list(body?.candidateIds).slice(0, 100);
    const stage = text(body?.stage, 40);
    const reason = text(body?.reason, 500);
    if (!candidateIds.length || !transitionStages.includes(stage)) return invalid('请选择候选人和有效流转动作。');
    if (['初筛淘汰', '淘汰人才库'].includes(stage) && !reason) return invalid('淘汰操作必须填写淘汰原因。');
    const placeholders = candidateIds.map(() => '?').join(',');
    const owned = await db.prepare(`SELECT id, job_id FROM candidates WHERE owner_id = ? AND id IN (${placeholders})`).bind(account.id, ...candidateIds).all<DataRow>();
    if (owned.results.length !== candidateIds.length) return invalid('部分候选人不存在或无权操作。');
    const statements: D1PreparedStatement[] = [];
    for (const row of owned.results) {
      statements.push(db.prepare('UPDATE candidates SET stage = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(stage, now, row.id, account.id));
      statements.push(db.prepare('UPDATE resume_applications SET status = ? WHERE candidate_id = ? AND owner_id = ?').bind(stage, row.id, account.id));
      if (reason) statements.push(db.prepare(`INSERT INTO screening_reviews (candidate_id, owner_id, tags_json, comment, risk_note, reject_reason, reviewer, updated_at)
        VALUES (?, ?, '[]', '', '', ?, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET reject_reason = excluded.reject_reason, reviewer = excluded.reviewer, updated_at = excluded.updated_at`
      ).bind(row.id, account.id, reason, account.contact, now));
      statements.push(db.prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
        VALUES (?, ?, ?, ?, ?, '结果流转', ?, ?)`).bind(crypto.randomUUID(), account.id, row.id, row.job_id, account.contact, `${stage}${reason ? `：${reason}` : ''}`, now));
    }
    await executeBatches(db, statements);
    return NextResponse.json({ ok: true, count: owned.results.length });
  }

  if (action === 'saveTemplate') {
    const name = text(body?.name, 80);
    if (!name) return invalid('请输入筛选模板名称。');
    const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {};
    await db.prepare(`INSERT INTO screening_templates (id, owner_id, name, filters_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), account.id, name, JSON.stringify(filters), now, now).run();
    return NextResponse.json({ ok: true });
  }

  return invalid('不支持的筛选操作。');
}

function scoreCandidate(row: DataRow, rule: RuleRow) {
  const majors = jsonList(rule.majors_json);
  const requiredCertificates = jsonList(rule.certificates_json);
  const cities = jsonList(rule.cities_json);
  const industries = jsonList(rule.industries_json);
  const keywords = jsonList(rule.keywords_json);
  const certificates = jsonList(row.certificates_json);
  const skills = jsonList(row.skills_json);
  const failures: string[] = [];
  const education = String(row.education || '');
  const years = Number(row.work_years || parseFloat(String(row.years || '0')) || 0);
  const age = Number(row.age || 0);
  const expectedSalary = Number(row.expected_salary || 0);
  if (rule.min_education && (educationRanks[education] || 0) < (educationRanks[rule.min_education] || 0)) failures.push('学历不符');
  if (majors.length && !majors.some(item => String(row.major || '').includes(item))) failures.push('专业不符');
  if (rule.min_years !== null && years < Number(rule.min_years)) failures.push('工作年限不足');
  if (requiredCertificates.length && !requiredCertificates.every(item => certificates.some(current => current.includes(item)))) failures.push('缺少必备证书');
  if (rule.age_min !== null && (!age || age < Number(rule.age_min))) failures.push('年龄低于要求');
  if (rule.age_max !== null && (!age || age > Number(rule.age_max))) failures.push('年龄超过要求');
  if (cities.length && !cities.includes(String(row.city || ''))) failures.push('工作地点不符');
  if (rule.salary_max !== null && expectedSalary > Number(rule.salary_max)) failures.push('期望薪资超出上限');
  if (industries.length && !industries.some(item => String(row.industry || '').includes(item))) failures.push('行业背景不符');
  const knockout = rule.logic === 'OR' ? failures.length > 0 && failures.length === hardRuleCount(rule) : failures.length > 0;
  const haystack = [row.title, row.role, row.company, row.raw_text, ...skills, ...certificates].join(' ').toLowerCase();
  const keywordScore = keywords.length ? Math.round(keywords.filter(item => haystack.includes(item.toLowerCase())).length / keywords.length * 100) : 0;
  const experienceScore = rule.min_years ? Math.min(100, Math.round(years / Number(rule.min_years) * 100)) : Math.min(100, Math.round(years / 5 * 100));
  const educationScore = education ? Math.min(100, Math.round((educationRanks[education] || 0) / 5 * 100)) : 0;
  const stabilityMonths = Number(row.stability_months || 0);
  const stabilityScore = stabilityMonths ? Math.min(100, Math.round(stabilityMonths / 24 * 100)) : 50;
  const weightTotal = Number(rule.keyword_weight) + Number(rule.experience_weight) + Number(rule.education_weight) + Number(rule.stability_weight);
  const total = knockout ? 0 : Math.round((keywordScore * Number(rule.keyword_weight) + experienceScore * Number(rule.experience_weight) + educationScore * Number(rule.education_weight) + stabilityScore * Number(rule.stability_weight)) / Math.max(1, weightTotal));
  const level = total >= 80 ? '高匹配' : total >= 60 ? '中匹配' : '低匹配';
  const highlights: string[] = [];
  const risks = [...failures];
  const school = String(row.school || '');
  const experienceText = [row.company, row.raw_text, ...jsonList(row.work_history_json)].join(' ');
  if (/985|211|双一流/.test(school)) highlights.push('985/211/双一流院校');
  if (/阿里巴巴|腾讯|字节跳动|华为|美团|百度|京东|小米/.test(experienceText)) highlights.push('大厂工作经验');
  if (years >= 5 && /管理|负责人|主管|经理|总监/.test(experienceText)) highlights.push('5年以上管理经验');
  if (certificates.length) highlights.push('持证上岗');
  if (years >= 5) highlights.push('5年以上经验');
  if (stabilityMonths && stabilityMonths < 12) risks.push('职业稳定性偏低');
  return { knockout, failures, keywordScore, experienceScore, educationScore, stabilityScore, total, level, highlights, risks: [...new Set(risks)] };
}

function hardRuleCount(rule: RuleRow) {
  return [rule.min_education, jsonList(rule.majors_json).length, rule.min_years, jsonList(rule.certificates_json).length,
    rule.age_min, rule.age_max, jsonList(rule.cities_json).length, rule.salary_max, jsonList(rule.industries_json).length].filter(value => value !== '' && value !== null && value !== 0).length;
}

async function insertLog(ownerId: string, candidateId: string | null, jobId: string | null, operator: string, action: string, detail: string) {
  await getDb().prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), ownerId, candidateId, jobId, operator, action, detail, new Date().toISOString()).run();
}

async function executeBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
}

async function ownedJob(id: string, ownerId: string) {
  return Boolean(await getDb().prepare('SELECT id FROM jobs WHERE id = ? AND owner_id = ?').bind(id, ownerId).first());
}

async function ownedCandidate(id: string, ownerId: string) {
  return getDb().prepare('SELECT id, job_id FROM candidates WHERE id = ? AND owner_id = ?').bind(id, ownerId).first<DataRow>();
}

function mapProfile(row: DataRow) {
  return { candidateId: row.candidate_id, education: row.education, major: row.major, school: row.school, age: row.age, gender: row.gender, industry: row.industry, expectedSalary: row.expected_salary, workYears: row.work_years, stabilityMonths: row.stability_months, workHistory: jsonList(row.work_history_json), projectHistory: jsonList(row.project_history_json), certificates: jsonList(row.certificates_json), highlights: jsonList(row.highlights_json), risks: jsonList(row.risks_json), parsingStatus: row.parsing_status, fileName: row.file_name, fileType: row.file_type, fileSize: row.file_size, keywordScore: row.keyword_score, experienceScore: row.experience_score, educationScore: row.education_score, stabilityScore: row.stability_score, matchScore: row.match_score, matchLevel: row.match_level, screenedAt: row.screened_at, updatedAt: row.updated_at };
}
function mapApplication(row: DataRow) { return { id: row.id, candidateId: row.candidate_id, jobId: row.job_id, channel: row.channel, appliedAt: row.applied_at, status: row.status, createdAt: row.created_at }; }
function mapRule(row: DataRow) { return { id: row.id, jobId: row.job_id, name: row.name, logic: row.logic, minEducation: row.min_education, majors: jsonList(row.majors_json), minYears: row.min_years, certificates: jsonList(row.certificates_json), ageMin: row.age_min, ageMax: row.age_max, cities: jsonList(row.cities_json), salaryMax: row.salary_max, industries: jsonList(row.industries_json), keywords: jsonList(row.keywords_json), keywordWeight: row.keyword_weight, experienceWeight: row.experience_weight, educationWeight: row.education_weight, stabilityWeight: row.stability_weight, updatedAt: row.updated_at }; }
function mapTemplate(row: DataRow) { return { id: row.id, name: row.name, filters: jsonObject(row.filters_json), updatedAt: row.updated_at }; }
function mapReview(row: DataRow) { return { candidateId: row.candidate_id, tags: jsonList(row.tags_json), comment: row.comment, riskNote: row.risk_note, rejectReason: row.reject_reason, reviewer: row.reviewer, updatedAt: row.updated_at }; }
function mapLog(row: DataRow) { return { id: row.id, candidateId: row.candidate_id, jobId: row.job_id, operatorName: row.operator_name, action: row.action, detail: row.detail, createdAt: row.created_at }; }

function text(value: unknown, maxLength: number) { return String(value ?? '').trim().slice(0, maxLength); }
function integer(value: unknown, min: number, max: number, fallback: number) { const parsed = Number.parseInt(String(value ?? ''), 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function optionalInteger(value: unknown, min: number, max: number) { if (value === '' || value === null || value === undefined) return null; return integer(value, min, max, min); }
function optionalNumber(value: unknown, min: number, max: number) { if (value === '' || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null; }
function list(value: unknown) { if (Array.isArray(value)) return value.map(item => text(item, 80)).filter(Boolean); return String(value ?? '').split(/[,，\n]/).map(item => item.trim().slice(0, 80)).filter(Boolean); }
function jsonList(value: unknown): string[] { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(item => String(item)) : []; } catch { return []; } }
function jsonObject(value: unknown) { try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
function unauthorized() { return NextResponse.json({ ok: false, message: '请先登录。' }, { status: 401 }); }
function invalid(message: string) { return NextResponse.json({ ok: false, message }, { status: 400 }); }
