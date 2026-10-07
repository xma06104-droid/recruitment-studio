import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { accountFromRequest, ensureSchema, getDb } from '@/app/server/db';
import { deleteStoredObject, deleteStoredObjects } from '@/app/server/object-storage';
import { repairResumeProfiles } from '@/app/server/resume-repair';
import { getResumeJobs } from '@/app/server/resume-jobs';
import { buildSystemResumeJob, matchResumeJob, parseResumeText, ResumeJob } from '@/app/server/resume-parser';
import { CANDIDATE_STAGES } from '@/app/candidate-stages';

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
  custom_conditions_json: string;
  keywords_json: string;
  keyword_weight: number;
  experience_weight: number;
  education_weight: number;
  stability_weight: number;
};

type CustomCondition = { field: string; operator: string; value: string };

const transitionStages: string[] = [...CANDIDATE_STAGES, '已淘汰'];
const educationRanks: Record<string, number> = { '高中': 1, '中专': 1, '大专': 2, '本科': 3, '硕士': 4, '博士': 5 };

export async function GET(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  const departmentReviewScope = new URL(request.url).searchParams.get('scope') === 'department-review';
  await ensureSchema();
  await repairResumeProfiles(account.id);
  const db = getDb();
  await db.prepare(`INSERT OR IGNORE INTO resume_profiles (
    candidate_id, owner_id, parsing_status, created_at, updated_at
  ) SELECT id, owner_id, '结构化完成', created_at, updated_at FROM candidates WHERE owner_id = ?`).bind(account.id).run();

  const assignedCandidateSql = 'SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?';
  const [profiles, applications, rules, templates, reviews, logs, hrAccounts, assignments] = await Promise.all([
    db.prepare(`SELECT * FROM resume_profiles WHERE owner_id = ? OR candidate_id IN (${assignedCandidateSql}) ORDER BY updated_at DESC`).bind(account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM resume_applications WHERE owner_id = ? OR candidate_id IN (${assignedCandidateSql}) ORDER BY applied_at DESC`).bind(account.id, account.id).all<DataRow>(),
    db.prepare('SELECT * FROM screening_rules WHERE owner_id = ? ORDER BY updated_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM screening_templates WHERE owner_id = ? ORDER BY updated_at DESC').bind(account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM screening_reviews WHERE owner_id = ? OR candidate_id IN (${assignedCandidateSql}) ORDER BY updated_at DESC`).bind(account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM screening_logs WHERE owner_id = ? OR candidate_id IN (${assignedCandidateSql}) ORDER BY created_at DESC LIMIT 300`).bind(account.id, account.id).all<DataRow>(),
    account.role === 'super_admin'
      ? db.prepare("SELECT id, contact, phone, email, role FROM accounts WHERE organization_id = ? ORDER BY contact ASC, created_at ASC").bind(account.organizationId).all<DataRow>()
      : Promise.resolve({ results: [] as DataRow[] }),
    db.prepare(`SELECT ca.*, a.contact AS hr_name, a.email AS hr_email FROM candidate_assignments ca JOIN accounts a ON a.id = ca.hr_account_id
      WHERE ca.owner_id = ? OR ca.hr_account_id = ? ORDER BY ca.assigned_at DESC`).bind(account.id, account.id).all<DataRow>(),
  ]);

  const departmentCandidates = departmentReviewScope
    ? await db.prepare(`SELECT c.id FROM candidates c JOIN candidate_assignments ca ON ca.candidate_id = c.id
        WHERE ca.hr_account_id = ? AND c.stage = '用人部门筛选'`).bind(account.id).all<{id:string}>()
    : { results: [] as {id:string}[] };
  const scopedCandidateIds = new Set(departmentCandidates.results.map(row => row.id));
  const scoped = <T extends DataRow>(rows:T[], field='candidate_id') => departmentReviewScope
    ? rows.filter(row => scopedCandidateIds.has(String(row[field] || '')))
    : rows;

  return NextResponse.json({
    profiles: scoped(profiles.results).map(mapProfile),
    applications: scoped(applications.results).map(mapApplication),
    rules: departmentReviewScope ? [] : rules.results.map(mapRule),
    templates: departmentReviewScope ? [] : templates.results.map(mapTemplate),
    reviews: scoped(reviews.results).map(mapReview),
    logs: scoped(logs.results).map(mapLog),
    hrAccounts: departmentReviewScope ? [] : hrAccounts.results.map(row => ({ id: row.id, contact: row.contact, phone: row.phone, email: row.email, role: row.role })),
    assignments: scoped(assignments.results).filter(row => String(row.hr_account_id) === account.id).map(row => ({ candidateId: row.candidate_id, hrAccountId: row.hr_account_id, hrName: row.hr_name, hrEmail: row.hr_email, assignedBy: row.assigned_by, assignedAt: row.assigned_at })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = text(body?.action, 50);
  const db = getDb();
  const now = new Date().toISOString();

  if (action === 'assignToHr' || action === 'assignCandidate') {
    if (account.role !== 'super_admin') return forbidden();
    const candidateIds = list(body?.candidateIds).slice(0, 100);
    const hrAccountIds = [...new Set(list(body?.hrAccountIds).concat(text(body?.hrAccountId, 80) || []).slice(0, 50))];
    if (!candidateIds.length || !hrAccountIds.length) return invalid('请选择候选人和接收账号。');
    const hrPlaceholders = hrAccountIds.map(() => '?').join(',');
    const accountRows = await db.prepare(`SELECT id, contact, email, role FROM accounts
      WHERE organization_id = ? AND id IN (${hrPlaceholders})`).bind(account.organizationId,...hrAccountIds).all<{id:string;contact:string;email:string;role:string}>();
    if (accountRows.results.length !== hrAccountIds.length) return invalid('部分所选人员不是有效账号。');
    const hrAccounts = hrAccountIds.map(id => accountRows.results.find(item => item.id === id)).filter(Boolean) as {id:string;contact:string;email:string;role:string}[];
    const placeholders = candidateIds.map(() => '?').join(',');
    const owned = await db.prepare(`SELECT c.id, c.job_id, c.name, c.role, c.stage, j.title AS job_title
      FROM candidates c LEFT JOIN jobs j ON j.id = c.job_id
      WHERE c.owner_id = ? AND c.id IN (${placeholders})`).bind(account.id, ...candidateIds).all<DataRow>();
    if (owned.results.length !== candidateIds.length) return invalid('部分候选人不存在或无权推荐。');
    if (owned.results.some(row => String(row.stage || '') !== '简历筛选')) return invalid('只有处于简历筛选阶段的候选人可以推送给用人部门。');
    const statements: D1PreparedStatement[] = [];
    for (const row of owned.results) {
      statements.push(db.prepare('DELETE FROM candidate_assignments WHERE candidate_id = ? AND owner_id = ?').bind(row.id, account.id));
      for (const hrAccount of hrAccounts) {
        statements.push(db.prepare(`INSERT INTO candidate_assignments (candidate_id, owner_id, hr_account_id, assigned_by, assigned_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(candidate_id, hr_account_id) DO UPDATE SET assigned_by = excluded.assigned_by,
          assigned_at = excluded.assigned_at, updated_at = excluded.updated_at`).bind(row.id, account.id, hrAccount.id, account.contact, now, now));
      }
      statements.push(db.prepare("UPDATE candidates SET stage = '用人部门筛选', updated_at = ? WHERE id = ? AND owner_id = ?").bind(now, row.id, account.id));
      statements.push(db.prepare("UPDATE resume_applications SET status = '用人部门筛选' WHERE candidate_id = ? AND owner_id = ?").bind(row.id, account.id));
      statements.push(db.prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
        VALUES (?, ?, ?, ?, ?, '用人部门推荐', ?, ?)`).bind(crypto.randomUUID(), account.id, row.id, row.job_id, account.contact, `已将${row.name}推送给${hrAccounts.map(item => item.contact).join('、')}`, now));
    }
    await executeBatches(db, statements);
    const publicOrigin = assignmentPublicOrigin(request);
    const deliveries = await Promise.all(hrAccounts.map(recipient => deliverAssignmentEmail({
      to:recipient.email,
      recipientName:recipient.contact,
      senderName:account.contact,
      candidates:owned.results.map(row => ({
        id:String(row.id), name:String(row.name), role:String(row.job_title || row.role || '未关联职位'),
      })),
      publicOrigin,
    })));
    return NextResponse.json({ ok: true, count: owned.results.length, recipientAccounts: hrAccounts, emailSent:deliveries.filter(Boolean).length });
  }

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
      customConditions: customConditions(body?.customConditions),
      keywords: list(body?.keywords),
    };
    if (values.ageMin !== null && values.ageMax !== null && values.ageMin > values.ageMax) return invalid('最低年龄不能大于最高年龄。');
    await db.prepare(`INSERT INTO screening_rules (
      id, owner_id, job_id, name, logic, min_education, majors_json, min_years, certificates_json,
      age_min, age_max, cities_json, salary_max, industries_json, custom_conditions_json, keywords_json,
      keyword_weight, experience_weight, education_weight, stability_weight, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(owner_id, job_id) DO UPDATE SET
      name = excluded.name, logic = excluded.logic, min_education = excluded.min_education,
      majors_json = excluded.majors_json, min_years = excluded.min_years,
      certificates_json = excluded.certificates_json, age_min = excluded.age_min,
      age_max = excluded.age_max, cities_json = excluded.cities_json,
      salary_max = excluded.salary_max, industries_json = excluded.industries_json,
      custom_conditions_json = excluded.custom_conditions_json,
      keywords_json = excluded.keywords_json, keyword_weight = excluded.keyword_weight,
      experience_weight = excluded.experience_weight, education_weight = excluded.education_weight,
      stability_weight = excluded.stability_weight, enabled = 1, updated_at = excluded.updated_at`).bind(
      crypto.randomUUID(), account.id, jobId, values.name, values.logic, values.minEducation,
      JSON.stringify(values.majors), values.minYears, JSON.stringify(values.certificates), values.ageMin,
      values.ageMax, JSON.stringify(values.cities), values.salaryMax, JSON.stringify(values.industries),
      JSON.stringify(values.customConditions), JSON.stringify(values.keywords), ...weights, now, now,
    ).run();
    await insertLog(account.id, null, jobId || null, account.contact, '规则配置', `保存“${values.name}”，硬性条件采用${values.logic === 'AND' ? '且' : '或'}逻辑`);
    return NextResponse.json({ ok: true });
  }

  if (action === 'runScreening') {
    const jobId = text(body?.jobId, 80);
    let rule = await db.prepare('SELECT * FROM screening_rules WHERE owner_id = ? AND job_id = ? AND enabled = 1').bind(account.id, jobId).first<RuleRow>();
    if (!rule && jobId) {
      const jobRow = await db.prepare('SELECT id, title, city FROM jobs WHERE id = ? AND owner_id = ?').bind(jobId, account.id).first<{id:string;title:string;city:string}>();
      if (jobRow) {
        const generated = buildSystemResumeJob(jobRow.title, jobRow.id, jobRow.city || '');
        await db.prepare(`INSERT OR IGNORE INTO screening_rules (
          id, owner_id, job_id, name, logic, min_education, majors_json, min_years, certificates_json,
          age_min, age_max, cities_json, salary_max, industries_json, custom_conditions_json, keywords_json,
          keyword_weight, experience_weight, education_weight, stability_weight, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'AND', ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, '[]', ?, ?, ?, ?, ?, 1, ?, ?)`
        ).bind(
          crypto.randomUUID(), account.id, jobId, `${jobRow.title}初筛规则`, generated.minEducation || '', JSON.stringify(generated.majors || []),
          generated.minYears ?? null, JSON.stringify(generated.certificates || []), JSON.stringify(generated.city && generated.city !== '待设置' ? [generated.city] : []),
          JSON.stringify(generated.industries || []), JSON.stringify(generated.keywords || []), generated.keywordWeight ?? 45,
          generated.experienceWeight ?? 25, generated.educationWeight ?? 18, generated.stabilityWeight ?? 12, now, now,
        ).run();
        await insertLog(account.id, null, jobId, account.contact, '系统规则配置', `岗位“${jobRow.title}”尚无初筛规则，重新筛选时已自动生成系统规则`);
        rule = await db.prepare('SELECT * FROM screening_rules WHERE owner_id = ? AND job_id = ? AND enabled = 1').bind(account.id, jobId).first<RuleRow>();
      }
    }
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
      const parsedIdentity = parseResumeText(String(row.raw_text || ''));
      if ((row.age === null || row.age === '') && parsedIdentity.age !== null) row.age = parsedIdentity.age;
      if (!row.education && parsedIdentity.education) row.education = parsedIdentity.education;
      const outcome = scoreCandidate(row, rule);
      const stage = outcome.knockout ? '已淘汰' : '简历筛选';
      statements.push(db.prepare(`UPDATE resume_profiles SET age = COALESCE(age, ?),
        gender = CASE WHEN gender = '' THEN ? ELSE gender END,
        education = CASE WHEN education = '' THEN ? ELSE education END,
        keyword_score = ?, experience_score = ?, education_score = ?,
        stability_score = ?, match_score = ?, match_level = ?, highlights_json = ?, risks_json = ?, screened_at = ?, updated_at = ?
        WHERE candidate_id = ? AND owner_id = ?`).bind(
        parsedIdentity.age, parsedIdentity.gender, parsedIdentity.education,
        outcome.keywordScore, outcome.experienceScore, outcome.educationScore, outcome.stabilityScore,
        outcome.total, outcome.level, JSON.stringify(outcome.highlights), JSON.stringify(outcome.risks), now, now, row.id, account.id,
      ));
      statements.push(db.prepare(`UPDATE candidates SET
        phone = CASE WHEN phone = '' THEN ? ELSE phone END,
        email = CASE WHEN email = '' THEN ? ELSE email END,
        score = ?, stage = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(
        parsedIdentity.phone, parsedIdentity.email, outcome.total, stage, now, row.id, account.id,
      ));
      statements.push(db.prepare('UPDATE resume_applications SET status = ? WHERE candidate_id = ? AND owner_id = ?').bind(
        stage, row.id, account.id,
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

  if (action === 'rescreenCandidate') {
    const candidateId = text(body?.candidateId, 80);
    if (!candidateId) return invalid('请选择需要重新筛选的简历。');
    const row = await db.prepare(`SELECT c.*, p.* FROM candidates c
      JOIN resume_profiles p ON p.candidate_id = c.id AND p.owner_id = c.owner_id
      WHERE c.id = ? AND c.owner_id = ? AND p.parsing_status = '结构化完成' LIMIT 1`
    ).bind(candidateId, account.id).first<DataRow>();
    if (!row) return invalid('简历不存在或尚未完成结构化解析。');

    const resolved = await ensureCandidateJob(account.id, account.contact, row, now);
    if (!resolved) return invalid('无法识别应聘岗位，请先在简历中补充岗位名称。');
    const rule = await ensureScreeningRule(account.id, account.contact, resolved.job.id, now);
    if (!rule) return invalid('系统未能生成该岗位的初筛规则，请稍后重试。');

    row.job_id = resolved.job.id;
    const parsedIdentity = parseResumeText(String(row.raw_text || ''));
    if ((row.age === null || row.age === '') && parsedIdentity.age !== null) row.age = parsedIdentity.age;
    if (!row.education && parsedIdentity.education) row.education = parsedIdentity.education;
    const outcome = scoreCandidate(row, rule);
    const stage = outcome.knockout ? '已淘汰' : '简历筛选';
    const statements: D1PreparedStatement[] = [
      db.prepare(`UPDATE resume_profiles SET age = COALESCE(age, ?),
        gender = CASE WHEN gender = '' THEN ? ELSE gender END,
        education = CASE WHEN education = '' THEN ? ELSE education END,
        keyword_score = ?, experience_score = ?, education_score = ?,
        stability_score = ?, match_score = ?, match_level = ?, highlights_json = ?, risks_json = ?, screened_at = ?, updated_at = ?
        WHERE candidate_id = ? AND owner_id = ?`).bind(
        parsedIdentity.age, parsedIdentity.gender, parsedIdentity.education,
        outcome.keywordScore, outcome.experienceScore, outcome.educationScore, outcome.stabilityScore,
        outcome.total, outcome.level, JSON.stringify(outcome.highlights), JSON.stringify(outcome.risks), now, now, candidateId, account.id,
      ),
      db.prepare(`UPDATE candidates SET job_id = ?,
        phone = CASE WHEN phone = '' THEN ? ELSE phone END,
        email = CASE WHEN email = '' THEN ? ELSE email END,
        score = ?, stage = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(
        resolved.job.id, parsedIdentity.phone, parsedIdentity.email, outcome.total, stage, now, candidateId, account.id,
      ),
      db.prepare('UPDATE resume_applications SET job_id = ?, status = ? WHERE candidate_id = ? AND owner_id = ?').bind(
        resolved.job.id, stage, candidateId, account.id,
      ),
      db.prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
        VALUES (?, ?, ?, ?, ?, '自动初筛', ?, ?)`).bind(
        crypto.randomUUID(), account.id, candidateId, resolved.job.id, account.contact,
        outcome.knockout ? `岗位“${resolved.job.title}”命中硬性淘汰：${outcome.failures.join('、')}` : `岗位“${resolved.job.title}”匹配度 ${outcome.total} 分，等待推送用人部门筛选`, now,
      ),
    ];
    await db.batch(statements);
    return NextResponse.json({
      ok: true, count: 1, score: outcome.total, level: outcome.level,
      jobId: resolved.job.id, jobTitle: resolved.job.title, createdJob: resolved.created,
    });
  }

  if (action === 'saveReview') {
    const candidateId = text(body?.candidateId, 80);
    const candidate = await accessibleScreeningCandidate(candidateId, account.id);
    if (!candidate) return invalid('候选人不存在。');
    const tags = list(body?.tags).slice(0, 20);
    const comment = text(body?.comment, 2000);
    const riskNote = text(body?.riskNote, 2000);
    const rejectReason = text(body?.rejectReason, 500);
    await db.prepare(`INSERT INTO screening_reviews (candidate_id, owner_id, tags_json, comment, risk_note, reject_reason, reviewer, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET tags_json = excluded.tags_json, comment = excluded.comment,
      risk_note = excluded.risk_note, reject_reason = excluded.reject_reason, reviewer = excluded.reviewer,
      updated_at = excluded.updated_at`).bind(candidateId, candidate.owner_id, JSON.stringify(tags), comment, riskNote, rejectReason, account.contact, now).run();
    await insertLog(candidate.owner_id, candidateId, candidate.job_id ? String(candidate.job_id) : null, account.contact, '人工核验', comment ? '更新筛选评语与标签' : '更新人工标注');
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

  if (action === 'deleteResume') {
    const candidateId = text(body?.candidateId, 80);
    if (!candidateId) return invalid('请选择需要删除的简历。');
    const resume = await db.prepare(`SELECT c.id, c.name, p.file_key
      FROM candidates c
      JOIN resume_profiles p ON p.candidate_id = c.id AND p.owner_id = c.owner_id
      WHERE c.id = ? AND c.owner_id = ? LIMIT 1`
    ).bind(candidateId, account.id).first<{ id: string; name: string; file_key: string | null }>();
    if (!resume) return invalid('简历不存在或已被删除。');
    const recordingObjects = await db.prepare('SELECT object_key FROM ai_interview_recordings WHERE candidate_id = ? AND owner_id = ?')
      .bind(candidateId, account.id).all<{object_key:string}>();

    await db.batch([
      db.prepare('DELETE FROM ai_interview_invitations WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM ai_interviews WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM interviews WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM offers WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM screening_logs WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM screening_reviews WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM resume_applications WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM resume_profiles WHERE candidate_id = ? AND owner_id = ?').bind(candidateId, account.id),
      db.prepare('DELETE FROM candidates WHERE id = ? AND owner_id = ?').bind(candidateId, account.id),
    ]);

    if (resume.file_key) {
      try {
        await deleteStoredObject(resume.file_key);
      } catch (error) {
        console.error('Failed to remove deleted resume object', { candidateId, error });
      }
    }
    if(recordingObjects.results.length){
      try{await deleteStoredObjects(recordingObjects.results.map(item=>item.object_key))}
      catch(error){console.error('Failed to remove deleted interview recordings',{candidateId,error})}
    }
    return NextResponse.json({ ok: true, candidateId, candidateName: resume.name });
  }

  if (action === 'batchTransition') {
    const candidateIds = list(body?.candidateIds).slice(0, 100);
    const stage = text(body?.stage, 40);
    const reason = text(body?.reason, 500);
    if (!candidateIds.length || !transitionStages.includes(stage)) return invalid('请选择候选人和有效流转动作。');
    if (stage !== '已淘汰') return invalid('简历筛选阶段只能推送用人部门或淘汰候选人。');
    if (stage === '已淘汰' && !reason) return invalid('淘汰操作必须填写淘汰原因。');
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
  const custom = jsonCustomConditions(rule.custom_conditions_json);
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
  for (const condition of custom) {
    if (!matchesCustomCondition(row, condition)) failures.push(`${customFieldLabels[condition.field] || '自定义条件'}不符`);
  }
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
    rule.age_min, rule.age_max, jsonList(rule.cities_json).length, rule.salary_max, jsonList(rule.industries_json).length,
    ...jsonCustomConditions(rule.custom_conditions_json).map(() => 1)].filter(value => value !== '' && value !== null && value !== 0).length;
}

async function insertLog(ownerId: string, candidateId: string | null, jobId: string | null, operator: string, action: string, detail: string) {
  await getDb().prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), ownerId, candidateId, jobId, operator, action, detail, new Date().toISOString()).run();
}

async function ensureScreeningRule(ownerId: string, ownerName: string, jobId: string, now: string) {
  if (!jobId) return null;
  const db = getDb();
  let rule = await db.prepare('SELECT * FROM screening_rules WHERE owner_id = ? AND job_id = ? AND enabled = 1')
    .bind(ownerId, jobId).first<RuleRow>();
  if (rule) return rule;
  const job = await db.prepare('SELECT id, title, city FROM jobs WHERE id = ? AND owner_id = ?')
    .bind(jobId, ownerId).first<{ id: string; title: string; city: string }>();
  if (!job) return null;
  const generated = buildSystemResumeJob(job.title, job.id, job.city || '');
  await db.prepare(`INSERT OR IGNORE INTO screening_rules (
    id, owner_id, job_id, name, logic, min_education, majors_json, min_years, certificates_json,
    age_min, age_max, cities_json, salary_max, industries_json, custom_conditions_json, keywords_json,
    keyword_weight, experience_weight, education_weight, stability_weight, enabled, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'AND', ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, '[]', ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    crypto.randomUUID(), ownerId, jobId, `${job.title}初筛规则`, generated.minEducation || '', JSON.stringify(generated.majors || []),
    generated.minYears ?? null, JSON.stringify(generated.certificates || []), JSON.stringify(generated.city && generated.city !== '待设置' ? [generated.city] : []),
    JSON.stringify(generated.industries || []), JSON.stringify(generated.keywords || []), generated.keywordWeight ?? 45,
    generated.experienceWeight ?? 25, generated.educationWeight ?? 18, generated.stabilityWeight ?? 12, now, now,
  ).run();
  await insertLog(ownerId, null, jobId, ownerName, '系统规则配置', `岗位“${job.title}”尚无初筛规则，已自动生成系统规则`);
  rule = await db.prepare('SELECT * FROM screening_rules WHERE owner_id = ? AND job_id = ? AND enabled = 1')
    .bind(ownerId, jobId).first<RuleRow>();
  return rule || null;
}

async function ensureCandidateJob(ownerId: string, ownerName: string, row: DataRow, now: string) {
  const db = getDb();
  const linkedJobId = text(row.job_id, 80);
  if (linkedJobId) {
    const linked = await db.prepare('SELECT id, title, department, city FROM jobs WHERE id = ? AND owner_id = ?')
      .bind(linkedJobId, ownerId).first<{ id: string; title: string; department: string; city: string }>();
    if (linked) return { job: linked satisfies ResumeJob, created: false };
  }

  const rawText = String(row.raw_text || '');
  const role = text(row.role, 80) || parseResumeText(rawText).role;
  if (!role) return null;
  const matched = matchResumeJob(role, rawText, await getResumeJobs(ownerId));
  if (matched) {
    await db.batch([
      db.prepare('UPDATE candidates SET job_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(matched.id, now, row.id, ownerId),
      db.prepare('UPDATE resume_applications SET job_id = ? WHERE candidate_id = ? AND owner_id = ?').bind(matched.id, row.id, ownerId),
    ]);
    await insertLog(ownerId, String(row.id), matched.id, ownerName, '岗位自动关联', `重新筛选时已将简历关联至岗位“${matched.title}”`);
    return { job: matched satisfies ResumeJob, created: false };
  }

  const generatedId = crypto.randomUUID();
  const draft = buildSystemResumeJob(role, generatedId, text(row.city, 50));
  await db.prepare(`INSERT OR IGNORE INTO jobs (id, owner_id, title, department, city, status, headcount, owner_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '招聘中', 1, ?, ?, ?)`).bind(
    generatedId, ownerId, draft.title, draft.department, draft.city, ownerName, now, now,
  ).run();
  const persisted = await db.prepare(`SELECT id, title, department, city FROM jobs WHERE owner_id = ? AND title = ? COLLATE NOCASE
    AND department = ? COLLATE NOCASE AND city = ? COLLATE NOCASE LIMIT 1`).bind(
    ownerId, draft.title, draft.department, draft.city,
  ).first<{ id: string; title: string; department: string; city: string }>();
  if (!persisted) return null;
  const created = persisted.id === generatedId;
  await db.batch([
    db.prepare('UPDATE candidates SET job_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(persisted.id, now, row.id, ownerId),
    db.prepare('UPDATE resume_applications SET job_id = ? WHERE candidate_id = ? AND owner_id = ?').bind(persisted.id, row.id, ownerId),
  ]);
  await insertLog(
    ownerId, String(row.id), persisted.id, ownerName, created ? '岗位自动创建' : '岗位自动关联',
    created ? `重新筛选识别到新岗位“${persisted.title}”，已自动新增岗位并关联简历` : `重新筛选时已将简历关联至岗位“${persisted.title}”`,
  );
  return { job: persisted satisfies ResumeJob, created };
}

async function executeBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
}

function assignmentPublicOrigin(request:NextRequest) {
  const requestUrl = new URL(request.url);
  if (requestUrl.hostname.endsWith('.chatgpt.site')) return requestUrl.origin;
  const configured = (env as unknown as { APP_PUBLIC_ORIGIN?:string; INTERVIEW_PUBLIC_ORIGIN?:string }).APP_PUBLIC_ORIGIN
    || (env as unknown as { INTERVIEW_PUBLIC_ORIGIN?:string }).INTERVIEW_PUBLIC_ORIGIN;
  try {
    const url = new URL(String(configured || ''));
    if (['http:', 'https:'].includes(url.protocol)) return url.origin;
  } catch {}
  return requestUrl.origin;
}

async function deliverAssignmentEmail({to,recipientName,senderName,candidates,publicOrigin}:{
  to:string;recipientName:string;senderName:string;candidates:{id:string;name:string;role:string}[];publicOrigin:string;
}) {
  const bindings = env as unknown as { RESEND_API_KEY?:string; INTERVIEW_EMAIL_FROM?:string };
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !bindings.RESEND_API_KEY || !bindings.INTERVIEW_EMAIL_FROM) return false;
  const rows = candidates.map(candidate => {
    const url = `${publicOrigin}/interviewer-candidate?candidateId=${encodeURIComponent(candidate.id)}`;
    return `<tr><td style="padding:12px;border-bottom:1px solid #e8edf3">${escapeHtml(candidate.role)}</td><td style="padding:12px;border-bottom:1px solid #e8edf3">${escapeHtml(candidate.name)}</td><td style="padding:12px;border-bottom:1px solid #e8edf3"><a href="${escapeHtml(url)}" style="color:#1687ff;font-weight:700">查看候选人</a></td></tr>`;
  }).join('');
  const html = `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#172033;line-height:1.65"><h2>${escapeHtml(recipientName)}，您好！</h2><p>${escapeHtml(senderName)} 给您推荐了候选人，请登录星鉴人才查看并提供反馈。</p><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f2f6fa"><th style="padding:12px;text-align:left">职位</th><th style="padding:12px;text-align:left">候选人</th><th style="padding:12px;text-align:left">操作</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:22px;color:#667085">链接将打开正式候选人工作台，仅被指定的接收账号登录后可查看对应候选人。请勿转发邮件。</p></div>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ Authorization:`Bearer ${bindings.RESEND_API_KEY}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ from:bindings.INTERVIEW_EMAIL_FROM, to:[to], subject:`${senderName}给您推荐了${candidates.length}位候选人`, html }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function escapeHtml(value:string) {
  return value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character] || character));
}

async function ownedJob(id: string, ownerId: string) {
  return Boolean(await getDb().prepare('SELECT id FROM jobs WHERE id = ? AND owner_id = ?').bind(id, ownerId).first());
}

async function ownedCandidate(id: string, ownerId: string) {
  return getDb().prepare('SELECT id, job_id FROM candidates WHERE id = ? AND owner_id = ?').bind(id, ownerId).first<DataRow>();
}

async function accessibleScreeningCandidate(id: string, accountId: string) {
  return getDb().prepare(`SELECT id, owner_id, job_id FROM candidates WHERE id = ? AND (
    owner_id = ? OR id IN (SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?)
  ) LIMIT 1`).bind(id, accountId, accountId).first<{id:string;owner_id:string;job_id:string|null}>();
}

function mapProfile(row: DataRow) {
  return { candidateId: row.candidate_id, education: row.education, major: row.major, school: row.school, age: row.age, gender: row.gender, industry: row.industry, expectedSalary: row.expected_salary, workYears: row.work_years, stabilityMonths: row.stability_months, workHistory: readableTextList(row.work_history_json), projectHistory: readableTextList(row.project_history_json), certificates: jsonList(row.certificates_json), highlights: jsonList(row.highlights_json), risks: jsonList(row.risks_json), parsingStatus: row.parsing_status, fileName: row.file_name, fileType: row.file_type, fileSize: row.file_size, keywordScore: row.keyword_score, experienceScore: row.experience_score, educationScore: row.education_score, stabilityScore: row.stability_score, matchScore: row.match_score, matchLevel: row.match_level, screenedAt: row.screened_at, updatedAt: row.updated_at };
}
function mapApplication(row: DataRow) { return { id: row.id, candidateId: row.candidate_id, jobId: row.job_id, channel: row.channel, appliedAt: row.applied_at, status: row.status, createdAt: row.created_at }; }
function mapRule(row: DataRow) { return { id: row.id, jobId: row.job_id, name: row.name, logic: row.logic, minEducation: row.min_education, majors: jsonList(row.majors_json), minYears: row.min_years, certificates: jsonList(row.certificates_json), ageMin: row.age_min, ageMax: row.age_max, cities: jsonList(row.cities_json), salaryMax: row.salary_max, industries: jsonList(row.industries_json), customConditions: jsonCustomConditions(row.custom_conditions_json), keywords: jsonList(row.keywords_json), keywordWeight: row.keyword_weight, experienceWeight: row.experience_weight, educationWeight: row.education_weight, stabilityWeight: row.stability_weight, updatedAt: row.updated_at }; }
function mapTemplate(row: DataRow) { return { id: row.id, name: row.name, filters: jsonObject(row.filters_json), updatedAt: row.updated_at }; }
function mapReview(row: DataRow) { return { candidateId: row.candidate_id, tags: jsonList(row.tags_json), comment: row.comment, riskNote: row.risk_note, rejectReason: row.reject_reason, reviewer: row.reviewer, updatedAt: row.updated_at }; }
function mapLog(row: DataRow) { return { id: row.id, candidateId: row.candidate_id, jobId: row.job_id, operatorName: row.operator_name, action: row.action, detail: row.detail, createdAt: row.created_at }; }

function text(value: unknown, maxLength: number) { return String(value ?? '').trim().slice(0, maxLength); }
function integer(value: unknown, min: number, max: number, fallback: number) { const parsed = Number.parseInt(String(value ?? ''), 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function optionalInteger(value: unknown, min: number, max: number) { if (value === '' || value === null || value === undefined) return null; return integer(value, min, max, min); }
function optionalNumber(value: unknown, min: number, max: number) { if (value === '' || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null; }
function list(value: unknown) { if (Array.isArray(value)) return value.map(item => text(item, 80)).filter(Boolean); return String(value ?? '').split(/[,，\n]/).map(item => item.trim().slice(0, 80)).filter(Boolean); }
function jsonList(value: unknown): string[] { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(item => String(item)) : []; } catch { return []; } }
function readableTextList(value: unknown) {
  return jsonList(value).map(item => item.trim()).filter(item => {
    if (!item) return false;
    if (/^[A-Za-z0-9_~+/=-]{24,}$/.test(item)) return false;
    const readable = item.match(/[\u4e00-\u9fa5A-Za-z0-9]/g)?.length || 0;
    return readable / item.length >= 0.55;
  });
}
const customFieldLabels: Record<string, string> = { education:'学历', major:'专业', workYears:'工作年限', certificates:'职业证书', age:'年龄', city:'工作所在地', expectedSalary:'期望薪资', industry:'行业背景', skills:'技能关键词', company:'最近公司', role:'应聘职位', stabilityMonths:'平均任职月数' };
const customFields = new Set(Object.keys(customFieldLabels));
const customOperators = new Set(['contains','not_contains','equals','not_equals','gte','lte']);
function customConditions(value: unknown): CustomCondition[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).map(item => ({ field:text(item?.field, 40), operator:text(item?.operator, 30), value:text(item?.value, 120) }))
      .filter(item => customFields.has(item.field) && customOperators.has(item.operator) && item.value);
  } catch { return []; }
}
function jsonCustomConditions(value: unknown): CustomCondition[] { try { return customConditions(JSON.parse(String(value || '[]'))); } catch { return []; } }
function matchesCustomCondition(row: DataRow, condition: CustomCondition) {
  const raw = customFieldValue(row, condition.field);
  const expected = condition.value.trim();
  if (condition.operator === 'gte' || condition.operator === 'lte') {
    const actualNumber = Number(raw);
    const expectedNumber = Number(expected);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
    return condition.operator === 'gte' ? actualNumber >= expectedNumber : actualNumber <= expectedNumber;
  }
  const actual = String(raw || '').trim().toLowerCase();
  const normalizedExpected = expected.toLowerCase();
  if (condition.operator === 'contains') return actual.includes(normalizedExpected);
  if (condition.operator === 'not_contains') return !actual.includes(normalizedExpected);
  if (condition.operator === 'equals') return actual === normalizedExpected;
  if (condition.operator === 'not_equals') return actual !== normalizedExpected;
  return false;
}
function customFieldValue(row: DataRow, field: string) {
  if (field === 'workYears') return Number(row.work_years || parseFloat(String(row.years || '0')) || 0);
  if (field === 'expectedSalary') return Number(row.expected_salary || 0);
  if (field === 'stabilityMonths') return Number(row.stability_months || 0);
  if (field === 'certificates') return jsonList(row.certificates_json).join(' ');
  if (field === 'skills') return jsonList(row.skills_json).join(' ');
  const columns: Record<string,string> = { education:'education', major:'major', age:'age', city:'city', industry:'industry', company:'company', role:'role' };
  return row[columns[field] || ''] || '';
}
function jsonObject(value: unknown) { try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
function unauthorized() { return NextResponse.json({ ok: false, message: '请先登录。' }, { status: 401 }); }
function forbidden() { return NextResponse.json({ ok: false, message: '仅超级管理员可以向 HR 推荐候选人。' }, { status: 403 }); }
function invalid(message: string) { return NextResponse.json({ ok: false, message }, { status: 400 }); }
