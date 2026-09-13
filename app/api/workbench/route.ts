import { NextRequest, NextResponse } from 'next/server';
import { CANDIDATE_STAGES, normalizeCandidateStage } from '@/app/candidate-stages';
import { env } from 'cloudflare:workers';
import { accountFromRequest, createInvitationShareToken, ensureSchema, getDb, hashToken } from '@/app/server/db';
import { repairResumeProfiles } from '@/app/server/resume-repair';

type DataRow = Record<string, string | number | null>;

export async function GET(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  await ensureSchema();
  await repairResumeProfiles(account.id);
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare(`UPDATE ai_interview_invitations SET status = '已超时', updated_at = ?
    WHERE owner_id = ? AND expires_at <= ? AND status IN ('待发送', '已发送', '进行中')`).bind(now, account.id, now).run();
  await db.prepare(`UPDATE candidates SET stage = 'AI面试', updated_at = ?
    WHERE owner_id = ? AND stage IN ('简历筛选', 'AI面试', 'AI 初面待发起', '待复核') AND id IN (
      SELECT latest.candidate_id FROM ai_interview_invitations latest
      WHERE latest.owner_id = ? AND latest.status IN ('待发送', '已发送', '进行中')
        AND latest.created_at = (
          SELECT MAX(previous.created_at) FROM ai_interview_invitations previous
          WHERE previous.owner_id = latest.owner_id AND previous.candidate_id = latest.candidate_id
        )
    )`).bind(now, account.id, account.id).run();
  await db.prepare(`UPDATE candidates SET stage = 'AI面试', updated_at = ?
    WHERE owner_id = ? AND stage IN ('AI面试', 'AI 初面待发起', '已发起AI面试邀请') AND id IN (
      SELECT latest.candidate_id FROM ai_interview_invitations latest
      WHERE latest.owner_id = ? AND latest.status = '已超时'
        AND latest.created_at = (
          SELECT MAX(previous.created_at) FROM ai_interview_invitations previous
          WHERE previous.owner_id = latest.owner_id AND previous.candidate_id = latest.candidate_id
        )
    )`).bind(now, account.id, account.id).run();
  const assignedCandidateSql = 'SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?';
  const assignedJobSql = `SELECT c.job_id FROM candidates c JOIN candidate_assignments ca ON ca.candidate_id = c.id
    WHERE ca.hr_account_id = ? AND c.job_id IS NOT NULL`;
  const relatedCandidateSql = `candidate_id IN (SELECT id FROM candidates WHERE owner_id = ?) OR candidate_id IN (${assignedCandidateSql})`;
  const [jobs, candidates, interviews, offers, aiQuestions, aiInterviews, aiInvitations, manualAssessments, recipientAccounts] = await Promise.all([
    db.prepare(`SELECT DISTINCT j.* FROM jobs j WHERE j.owner_id = ? OR j.id IN (${assignedJobSql}) ORDER BY j.created_at DESC`).bind(account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT c.*, ca.hr_account_id, ca.assigned_at, a.contact AS assigned_hr_name,
          rp.gender AS resume_gender, rp.age AS resume_age, rp.education AS resume_education, rp.work_years AS resume_work_years,
          rp.file_name AS resume_file_name
        FROM candidates c LEFT JOIN candidate_assignments ca ON ca.candidate_id = c.id LEFT JOIN accounts a ON a.id = ca.hr_account_id
        LEFT JOIN resume_profiles rp ON rp.candidate_id = c.id
        WHERE c.owner_id = ? OR c.id IN (${assignedCandidateSql}) ORDER BY COALESCE(ca.assigned_at, c.created_at) DESC`).bind(account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM interviews WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY scheduled_at ASC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM offers WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY created_at DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM ai_questions WHERE owner_id = ? OR job_id IN (${assignedJobSql}) ORDER BY created_at DESC`).bind(account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM ai_interviews WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY COALESCE(completed_at, created_at) DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM ai_interview_invitations WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY created_at DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM manual_assessments WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY updated_at DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    account.role === 'super_admin'
      ? db.prepare("SELECT id, contact, phone, email, role FROM accounts WHERE role IN ('super_admin', 'hr') ORDER BY contact ASC, created_at ASC").all<DataRow>()
      : Promise.resolve({ results: [] as DataRow[] }),
  ]);
  const { unique: uniqueQuestions, duplicateIds } = deduplicateAiQuestions(aiQuestions.results);
  if (duplicateIds.length) {
    await db.batch(duplicateIds.map(id => db.prepare('DELETE FROM ai_questions WHERE id = ? AND owner_id = ?').bind(id, account.id)));
  }
  const requestOrigin = validHttpOrigin(new URL(request.url).origin);
  const configuredOrigin = validHttpOrigin((env as unknown as { INTERVIEW_PUBLIC_ORIGIN?:string }).INTERVIEW_PUBLIC_ORIGIN);
  const mappedInvitations = await Promise.all(aiInvitations.results.map(row => mapAiInvitation(row, configuredOrigin || requestOrigin)));
  return NextResponse.json({
    account,
    jobs: jobs.results.map(mapJob),
    candidates: candidates.results.map(mapCandidate),
    interviews: interviews.results.map(mapInterview),
    offers: offers.results.map(mapOffer),
    aiQuestions: uniqueQuestions.map(mapAiQuestion),
    aiInterviews: aiInterviews.results.map(mapAiInterview),
    aiInvitations: mappedInvitations,
    manualAssessments: manualAssessments.results.map(mapManualAssessment),
    recipientAccounts: recipientAccounts.results.map(row => ({ id: row.id, contact: row.contact, phone: row.phone, email: row.email, role: row.role })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const resource = text(body?.resource, 40);
  if (account.role === 'hr' && !['manualAssessment', 'interview'].includes(resource)) return forbidden();
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {};
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const db = getDb();

  if (resource === 'job') {
    const title = text(payload.title, 100);
    const department = text(payload.department, 80);
    const city = text(payload.city, 80) || '待设置';
    if (!title || !department) return invalid('请填写职位名称和所属部门。');
    const duplicate = await db.prepare(`SELECT id FROM jobs
      WHERE owner_id = ? AND title = ? COLLATE NOCASE AND department = ? COLLATE NOCASE AND city = ? COLLATE NOCASE
      LIMIT 1`).bind(account.id, title, department, city).first<{id:string}>();
    if (duplicate) return NextResponse.json({ ok:false, message:'相同职位已存在，不能重复创建。' }, { status:409 });
    try {
      await db.prepare(`INSERT INTO jobs (id, owner_id, title, department, city, status, headcount, owner_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '草稿', ?, ?, ?, ?)`).bind(id, account.id, title, department, city, integer(payload.headcount, 1, 999, 1), account.contact, now, now).run();
    } catch (error) {
      if (String(error).includes('UNIQUE constraint')) return NextResponse.json({ ok:false, message:'相同职位已存在，不能重复创建。' }, { status:409 });
      throw error;
    }
  } else if (resource === 'candidate') {
    const name = text(payload.name, 60);
    const role = text(payload.role, 100);
    if (!name || !role) return invalid('请填写候选人姓名和应聘职位。');
    const jobId = text(payload.jobId, 80) || null;
    if (jobId && !(await ownedRecord('jobs', jobId, account.id))) return invalid('所选职位不存在。');
    const skills = list(payload.skills).slice(0, 12);
    await db.prepare(`INSERT INTO candidates (id, owner_id, job_id, name, role, company, years, stage, source, skills_json, score, phone, email, city, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '简历筛选', ?, ?, NULL, ?, ?, ?, ?, ?)`).bind(id, account.id, jobId, name, role, text(payload.company, 100), text(payload.years, 40), text(payload.source, 80), JSON.stringify(skills), text(payload.phone, 30), text(payload.email, 120), text(payload.city, 80), now, now).run();
  } else if (resource === 'manualAssessment') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await accessibleCandidate(candidateId, account.id) : null;
    if (!candidate) return invalid('请选择有效候选人。');
    const professional = integer(payload.professional, 0, 100, -1);
    const communication = integer(payload.communication, 0, 100, -1);
    const culture = integer(payload.culture, 0, 100, -1);
    if ([professional, communication, culture].some(score => score < 0)) return invalid('请填写有效的人工评估分数。');
    const total = Math.round((professional + communication + culture) / 3);
    await db.batch([
      db.prepare(`INSERT INTO manual_assessments (
        candidate_id, owner_id, total, professional, communication, culture, comment, reviewer, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        total = excluded.total,
        professional = excluded.professional,
        communication = excluded.communication,
        culture = excluded.culture,
        comment = excluded.comment,
        reviewer = excluded.reviewer,
        updated_at = excluded.updated_at
      WHERE manual_assessments.owner_id = excluded.owner_id`).bind(
        candidateId, candidate.owner_id, total, professional, communication, culture,
        text(payload.comment, 4000), account.contact, now, now,
      ),
      db.prepare('UPDATE candidates SET updated_at = ? WHERE id = ?').bind(now, candidateId),
    ]);
  } else if (resource === 'interview') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await accessibleCandidate(candidateId, account.id) : null;
    if (!candidate) return invalid('请选择有效候选人。');
    const scheduledAt = text(payload.scheduledAt, 80);
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return invalid('请选择有效的面试日期和时间。');
    await db.batch([
      db.prepare(`INSERT INTO interviews (id, owner_id, candidate_id, scheduled_at, round, mode, interviewer, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '待确认', ?, ?)`).bind(id, candidate.owner_id, candidateId, new Date(scheduledAt).toISOString(), text(payload.round, 80) || '业务一面', text(payload.mode, 100) || '待确认', account.contact, now, now),
      db.prepare("UPDATE candidates SET stage = '安排面试', updated_at = ? WHERE id = ?").bind(now, candidateId),
      db.prepare("UPDATE resume_applications SET status = '安排面试' WHERE candidate_id = ? AND owner_id = ?").bind(candidateId, candidate.owner_id),
    ]);
  } else if (resource === 'offer') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await db.prepare('SELECT name, role, email FROM candidates WHERE id = ? AND owner_id = ?').bind(candidateId, account.id).first<{ name: string; role: string; email: string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    const completedInterview = await db.prepare(`SELECT id FROM interviews WHERE candidate_id = ? AND owner_id = ?
      AND status = '已完成' AND COALESCE(round, '') <> 'AI 初面' LIMIT 1`).bind(candidateId, account.id).first<{id:string}>();
    if (!completedInterview) return invalid('完成人工面试后，才能进入录用阶段。');
    const salary = text(payload.salary, 80);
    const deadline = text(payload.deadline, 40);
    if (!salary || !deadline || Number.isNaN(Date.parse(deadline))) return invalid('请填写薪资方案和有效截止日期。');
    const jobTitle = text(payload.jobTitle, 100) || candidate.role;
    const recipientEmail = text(payload.recipientEmail, 120) || candidate.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return invalid('该候选人尚未填写有效邮箱，请补充收件邮箱。');
    const content = text(payload.content, 6000) || createOfferContent(candidate.name, jobTitle, salary, deadline);
    await db.batch([
      db.prepare(`INSERT INTO offers (id, owner_id, candidate_id, job_title, salary, recipient_email, content, owner_name, status, deadline, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '待审批', ?, ?, ?)`).bind(id, account.id, candidateId, jobTitle, salary, recipientEmail, content, account.contact, deadline, now, now),
      db.prepare("UPDATE candidates SET stage = '录用', updated_at = ? WHERE id = ? AND owner_id = ?").bind(now, candidateId, account.id),
      db.prepare("UPDATE resume_applications SET status = '录用' WHERE candidate_id = ? AND owner_id = ?").bind(candidateId, account.id),
    ]);
  } else if (resource === 'generateAiQuestions') {
    const jobId = text(payload.jobId, 80);
    const job = jobId ? await db.prepare('SELECT id, title, department FROM jobs WHERE id = ? AND owner_id = ?').bind(jobId, account.id).first<{id:string;title:string;department:string}>() : null;
    if (!job) return invalid('请选择需要生成面试题的岗位。');
    const requestedCount = integer(payload.count, 3, 8, 5);
    const generated = generateInterviewQuestions(job.title, job.department).slice(0, requestedCount);
    const existing = await db.prepare('SELECT title FROM ai_questions WHERE owner_id = ? AND job_id = ?').bind(account.id, job.id).all<{title:string}>();
    const existingTitles = new Set(existing.results.map(item => item.title.trim().toLowerCase()));
    const questions = generated.filter(item => !existingTitles.has(item.title.trim().toLowerCase()));
    if (questions.length) {
      await db.batch(questions.map((question, index) => {
        const createdAt = new Date(Date.parse(now) + index).toISOString();
        return db.prepare(`INSERT INTO ai_questions (id, owner_id, job_id, title, category, question_type, duration, competency, keywords, reference_answer, follow_up, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, '语音提问', 120, ?, ?, ?, 1, ?, ?)`
        ).bind(crypto.randomUUID(), account.id, job.id, question.title, question.category, question.competency, question.keywords, question.referenceAnswer, createdAt, createdAt);
      }));
    }
    return NextResponse.json({ ok:true, count:questions.length, jobTitle:job.title }, { status:201 });
  } else if (resource === 'aiQuestion') {
    const title = text(payload.title, 500);
    if (!title) return invalid('请输入面试问题。');
    const jobId = text(payload.jobId, 80) || null;
    if (jobId && !(await ownedRecord('jobs', jobId, account.id))) return invalid('所选适用岗位不存在。');
    const category = text(payload.category, 80) || '通用素质';
    const questionType = text(payload.questionType, 40) || '语音提问';
    const duration = integer(payload.duration, 30, 900, 120);
    const competency = text(payload.competency, 80) || '综合能力';
    const keywords = text(payload.keywords, 500) || competency;
    const referenceAnswer = text(payload.referenceAnswer, 3000);
    const followUp = payload.followUp ? 1 : 0;
    const duplicate = await db.prepare(`SELECT id FROM ai_questions WHERE owner_id = ? AND COALESCE(job_id, '') = ?
      AND title = ? COLLATE NOCASE AND category = ? COLLATE NOCASE AND question_type = ? COLLATE NOCASE
      AND duration = ? AND competency = ? COLLATE NOCASE AND keywords = ? COLLATE NOCASE
      AND reference_answer = ? COLLATE NOCASE AND follow_up = ? LIMIT 1`
    ).bind(account.id, jobId || '', title, category, questionType, duration, competency, keywords, referenceAnswer, followUp).first<{id:string}>();
    if (duplicate) return NextResponse.json({ ok:false, message:'相同面试题已存在，无需重复保存。' }, { status:409 });
    await db.prepare(`INSERT INTO ai_questions (id, owner_id, job_id, title, category, question_type, duration, competency, keywords, reference_answer, follow_up, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, account.id, jobId, title, category, questionType, duration, competency, keywords, referenceAnswer, followUp, now, now).run();
  } else if (resource === 'aiInterviewInvite') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await db.prepare(`SELECT id, job_id, name, role, email FROM candidates
      WHERE id = ? AND owner_id = ?`).bind(candidateId, account.id).first<{ id:string; job_id:string|null; name:string; role:string; email:string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) return invalid('该候选人尚未填写有效邮箱，请先补充邮箱。');
    const questionRows = await db.prepare(`SELECT * FROM ai_questions WHERE owner_id = ?
      AND (job_id = ? OR job_id IS NULL) ORDER BY created_at ASC`).bind(account.id, candidate.job_id || '').all<DataRow>();
    const specific = questionRows.results.filter(row => candidate.job_id && row.job_id === candidate.job_id);
    const selectedQuestions = (specific.length ? specific : questionRows.results.filter(row => !row.job_id)).slice(0, 12);
    if (!selectedQuestions.length) return invalid('该岗位尚未配置面试题，请先生成或新建面试题。');
    const token = randomToken();
    const invitationId = crypto.randomUUID();
    const requestedHours = Number(payload.validityHours);
    const validityHours = [12, 24, 72].includes(requestedHours) ? requestedHours : 24;
    const expiresAt = new Date(Date.parse(now) + validityHours * 60 * 60 * 1000).toISOString();
    const questions = selectedQuestions.map(row => ({
      id:String(row.id), title:String(row.title), duration:Number(row.duration) || 120,
      questionType:String(row.question_type || '语音提问'), competency:String(row.competency || ''),
      keywords:String(row.keywords || row.competency || ''), referenceAnswer:String(row.reference_answer || ''),
    }));
    const requestUrl = new URL(request.url);
    const runtime = env as unknown as { INTERVIEW_PUBLIC_ORIGIN?:string; APP_ENV?:string };
    const configuredOrigin = validHttpOrigin(runtime.INTERVIEW_PUBLIC_ORIGIN);
    const interviewUrl = `${configuredOrigin || requestUrl.origin}/interview/${encodeURIComponent(token)}`;
    const testMode = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname) || ['test', 'development'].includes(runtime.APP_ENV || '');
    const subject = `星鉴人才｜${candidate.role} AI 面试邀请`;
    const content = createInterviewInvitation(candidate.name, candidate.role, interviewUrl, expiresAt);
    await db.batch([
      db.prepare(`UPDATE ai_interview_invitations SET status = '已失效', updated_at = ?
        WHERE owner_id = ? AND candidate_id = ? AND status IN ('待发送', '已发送', '进行中', '已超时')`).bind(now, account.id, candidateId),
      db.prepare(`INSERT INTO ai_interview_invitations (
        id, owner_id, candidate_id, token_hash, recipient_email, job_title, questions_json,
        status, sent_at, opened_at, completed_at, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).bind(
        invitationId, account.id, candidateId, await hashToken(token), candidate.email, candidate.role, JSON.stringify(questions),
        '待发送', now, expiresAt, now, now,
      ),
      db.prepare(`UPDATE candidates SET stage = 'AI面试', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, candidateId, account.id),
    ]);
    const delivery = await deliverInterviewEmail(candidate.email, subject, content);
    if (delivery.sent) await db.prepare(`UPDATE ai_interview_invitations SET status = '已发送', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), invitationId).run();
    return NextResponse.json({
      ok:true, id:invitationId, sent:delivery.sent, recipientEmail:candidate.email, validityHours, expiresAt, interviewUrl, testMode,
      mailtoUrl:delivery.sent ? '' : `mailto:${encodeURIComponent(candidate.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(content)}`,
    }, { status:201 });
  } else if (resource === 'aiInterview') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await db.prepare('SELECT role FROM candidates WHERE id = ? AND owner_id = ?').bind(candidateId, account.id).first<{ role: string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    const score = integer(payload.score, 0, 100, -1);
    const summary = text(payload.summary, 12000);
    if (score < 0 || !summary) return invalid('请填写真实面试得分和总结。');
    await db.batch([
      db.prepare(`INSERT INTO ai_interviews (id, owner_id, candidate_id, job_title, status, score, duration_seconds, summary, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, '已完成', ?, ?, ?, ?, ?, ?)`).bind(id, account.id, candidateId, text(payload.jobTitle, 100) || candidate.role, score, integer(payload.durationMinutes, 1, 600, 1) * 60, summary, now, now, now),
      db.prepare("UPDATE candidates SET score = ?, stage = 'AI面试', updated_at = ? WHERE id = ? AND owner_id = ?").bind(score, now, candidateId, account.id),
    ]);
  } else {
    return invalid('不支持的数据类型。');
  }

  return NextResponse.json({ ok: true, id }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const resource = text(body?.resource, 40);
  if (account.role === 'hr' && !['candidateStage', 'interview', 'interviewStatus'].includes(resource)) return forbidden();
  const id = text(body?.id, 80);
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {};
  const value = text(body?.value, 80);
  if (!id) return invalid('缺少更新内容。');
  const now = new Date().toISOString();
  const db = getDb();

  if (resource === 'candidateEmail') {
    const email = text(payload.email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('请补充有效邮箱');
    const candidate = await db.prepare('SELECT id FROM candidates WHERE id = ? AND owner_id = ? LIMIT 1').bind(id, account.id).first<{id:string}>();
    if (!candidate) return invalid('候选人不存在或无权修改。');
    await db.prepare('UPDATE candidates SET email = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(email, now, id, account.id).run();
    return NextResponse.json({ ok: true });
  }

  if (resource === 'aiQuestion') {
    const owned = await db.prepare('SELECT id FROM ai_questions WHERE id = ? AND owner_id = ?').bind(id, account.id).first<{id:string}>();
    if (!owned) return invalid('面试题不存在。');
    const title = text(payload.title, 500);
    if (!title) return invalid('请输入面试问题。');
    const jobId = text(payload.jobId, 80) || null;
    if (jobId && !(await ownedRecord('jobs', jobId, account.id))) return invalid('所选适用岗位不存在。');
    const category = text(payload.category, 80) || '通用素质';
    const questionType = text(payload.questionType, 40) || '语音提问';
    const duration = integer(payload.duration, 30, 900, 120);
    const competency = text(payload.competency, 80) || '综合能力';
    const keywords = text(payload.keywords, 500) || competency;
    const referenceAnswer = text(payload.referenceAnswer, 3000);
    const followUp = payload.followUp ? 1 : 0;
    const duplicate = await db.prepare(`SELECT id FROM ai_questions WHERE owner_id = ? AND id <> ? AND COALESCE(job_id, '') = ?
      AND title = ? COLLATE NOCASE AND category = ? COLLATE NOCASE AND question_type = ? COLLATE NOCASE
      AND duration = ? AND competency = ? COLLATE NOCASE AND keywords = ? COLLATE NOCASE
      AND reference_answer = ? COLLATE NOCASE AND follow_up = ? LIMIT 1`
    ).bind(account.id, id, jobId || '', title, category, questionType, duration, competency, keywords, referenceAnswer, followUp).first<{id:string}>();
    if (duplicate) return NextResponse.json({ ok:false, message:'相同面试题已存在，请直接使用现有题目。' }, { status:409 });
    await db.prepare(`UPDATE ai_questions SET job_id = ?, title = ?, category = ?, question_type = ?, duration = ?, competency = ?, keywords = ?, reference_answer = ?, follow_up = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?`).bind(jobId, title, category, questionType, duration, competency, keywords, referenceAnswer, followUp, now, id, account.id).run();
    return NextResponse.json({ ok: true });
  }

  if (resource === 'job') {
    const owned = await db.prepare('SELECT id FROM jobs WHERE id = ? AND owner_id = ?').bind(id, account.id).first<{id:string}>();
    if (!owned) return invalid('职位不存在。');
    const title = text(payload.title, 100);
    const department = text(payload.department, 80);
    const city = text(payload.city, 80) || '待设置';
    if (!title || !department) return invalid('请填写职位名称和所属部门。');
    const duplicate = await db.prepare(`SELECT id FROM jobs WHERE owner_id = ? AND id <> ?
      AND title = ? COLLATE NOCASE AND department = ? COLLATE NOCASE AND city = ? COLLATE NOCASE LIMIT 1`
    ).bind(account.id, id, title, department, city).first<{id:string}>();
    if (duplicate) return NextResponse.json({ ok:false, message:'相同职位已存在，不能重复保存。' }, { status:409 });
    try {
      await db.prepare(`UPDATE jobs SET title = ?, department = ?, city = ?, headcount = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?`).bind(title, department, city, integer(payload.headcount, 1, 999, 1), now, id, account.id).run();
    } catch (error) {
      if (String(error).includes('UNIQUE constraint')) return NextResponse.json({ ok:false, message:'相同职位已存在，不能重复保存。' }, { status:409 });
      throw error;
    }
    return NextResponse.json({ ok: true });
  }

  if (resource === 'interview') {
    const accessible = await db.prepare(`SELECT i.id FROM interviews i WHERE i.id = ? AND (
      i.owner_id = ? OR i.candidate_id IN (SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?)
    )`).bind(id, account.id, account.id).first<{id:string}>();
    if (!accessible) return invalid('面试安排不存在。');
    const candidateId = text(payload.candidateId, 80);
    if (!candidateId || !(await accessibleCandidate(candidateId, account.id))) return invalid('请选择有效候选人。');
    const scheduledAt = text(payload.scheduledAt, 80);
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return invalid('请选择有效的面试日期和时间。');
    await db.prepare(`UPDATE interviews SET candidate_id = ?, scheduled_at = ?, round = ?, mode = ?, updated_at = ?
      WHERE id = ?`).bind(candidateId, new Date(scheduledAt).toISOString(), text(payload.round, 80) || '业务一面', text(payload.mode, 100) || '待确认', now, id).run();
    return NextResponse.json({ ok: true });
  }

  if (resource === 'offer') {
    const owned = await db.prepare('SELECT id FROM offers WHERE id = ? AND owner_id = ?').bind(id, account.id).first<{id:string}>();
    if (!owned) return invalid('Offer 不存在。');
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await db.prepare('SELECT name, role, email FROM candidates WHERE id = ? AND owner_id = ?').bind(candidateId, account.id).first<{ name:string; role:string; email:string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    const salary = text(payload.salary, 80);
    const deadline = text(payload.deadline, 40);
    if (!salary || !deadline || Number.isNaN(Date.parse(deadline))) return invalid('请填写薪资方案和有效截止日期。');
    const jobTitle = text(payload.jobTitle, 100) || candidate.role;
    const recipientEmail = text(payload.recipientEmail, 120) || candidate.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return invalid('该候选人尚未填写有效邮箱，请补充收件邮箱。');
    const content = text(payload.content, 6000) || createOfferContent(candidate.name, jobTitle, salary, deadline);
    await db.prepare(`UPDATE offers SET candidate_id = ?, job_title = ?, salary = ?, recipient_email = ?, content = ?, deadline = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?`).bind(candidateId, jobTitle, salary, recipientEmail, content, deadline, now, id, account.id).run();
    return NextResponse.json({ ok: true });
  }

  if (!value) return invalid('缺少更新内容。');
  if (resource === 'interviewStatus') {
    const allowed = ['待确认', '已确认', '已完成', '已取消'];
    if (!allowed.includes(value)) return invalid('更新状态无效。');
    const accessible = await db.prepare(`SELECT i.id FROM interviews i WHERE i.id = ? AND (
      i.owner_id = ? OR i.candidate_id IN (SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?)
    ) LIMIT 1`).bind(id, account.id, account.id).first<{id:string}>();
    if (!accessible) return invalid('面试安排不存在或无权操作。');
    await db.prepare('UPDATE interviews SET status = ?, updated_at = ? WHERE id = ?').bind(value, now, id).run();
    return NextResponse.json({ ok: true });
  }
  if (resource === 'candidateStage') {
    const allowed: string[] = [...CANDIDATE_STAGES, '待定', '已淘汰'];
    if (!allowed.includes(value)) return invalid('更新状态无效。');
    const candidate = await accessibleCandidate(id, account.id);
    if (!candidate) return invalid('候选人不存在或无权操作。');
    const currentStage = normalizeCandidateStage(candidate.stage);
    if (currentStage === value) return NextResponse.json({ ok: true });
    if (value === 'AI面试' && currentStage !== '简历筛选') return invalid('请按候选人流程顺序推进。');
    if (value === '用人部门筛选') {
      if (currentStage !== 'AI面试') return invalid('请先进入 AI 面试阶段。');
      const completedAiInterview = await db.prepare("SELECT id FROM ai_interviews WHERE candidate_id = ? AND status = '已完成' LIMIT 1").bind(id).first<{id:string}>();
      if (!completedAiInterview) return invalid('候选人完成 AI 面试后，才能进入用人部门筛选。');
    }
    if (value === '安排面试') {
      if (!['用人部门筛选', '待定'].includes(currentStage)) return invalid('请先完成用人部门筛选。');
      const assignedRecipient = await db.prepare('SELECT candidate_id FROM candidate_assignments WHERE candidate_id = ? AND hr_account_id = ? LIMIT 1').bind(id, account.id).first<{candidate_id:string}>();
      if (!assignedRecipient) return invalid('仅接收该简历的用人部门账号可以确认通过。');
    }
    if (value === '录用') {
      if (currentStage !== '安排面试') return invalid('请先进入安排面试阶段。');
      const completedInterview = await db.prepare(`SELECT id FROM interviews WHERE candidate_id = ? AND status = '已完成'
        AND COALESCE(round, '') <> 'AI 初面' LIMIT 1`).bind(id).first<{id:string}>();
      if (!completedInterview) return invalid('完成人工面试后，才能进入录用阶段。');
    }
    if (value === '待入职') {
      if (currentStage !== '录用') return invalid('请先进入录用阶段。');
      const acceptedOffer = await db.prepare("SELECT id FROM offers WHERE candidate_id = ? AND status = '已接受' LIMIT 1").bind(id).first<{id:string}>();
      if (!acceptedOffer) return invalid('候选人接受 Offer 后，才能进入待入职阶段。');
    }
    if (value === '已入职' && currentStage !== '待入职') return invalid('请先进入待入职阶段。');
    if (value === '待定' || value === '已淘汰') {
      const assignedRecipient = await db.prepare('SELECT candidate_id FROM candidate_assignments WHERE candidate_id = ? AND hr_account_id = ? LIMIT 1').bind(id, account.id).first<{candidate_id:string}>();
      if (account.role === 'hr' && (!['用人部门筛选', '待定'].includes(currentStage) || !assignedRecipient)) return invalid('仅接收该简历的 HR 可以提交筛选结果。');
    }
    await db.batch([
      db.prepare('UPDATE candidates SET stage = ?, updated_at = ? WHERE id = ?').bind(value, now, id),
      db.prepare('UPDATE resume_applications SET status = ? WHERE candidate_id = ? AND owner_id = ?').bind(value, id, candidate.owner_id),
      db.prepare(`INSERT INTO screening_logs (id, owner_id, candidate_id, job_id, operator_name, action, detail, created_at)
        VALUES (?, ?, ?, ?, ?, '用人部门反馈', ?, ?)`).bind(crypto.randomUUID(), candidate.owner_id, id, candidate.job_id, account.contact, `候选人状态更新为${value}`, now),
    ]);
    return NextResponse.json({ ok: true });
  }
  if (resource === 'offerStatus') {
    const allowed = ['待审批', '已发放', '已接受', '已拒绝', '已撤回'];
    if (!allowed.includes(value)) return invalid('更新状态无效。');
    const offer = await db.prepare('SELECT candidate_id FROM offers WHERE id = ? AND owner_id = ? LIMIT 1').bind(id, account.id).first<{candidate_id:string}>();
    if (!offer) return invalid('Offer 不存在或无权操作。');
    const nextStage = value === '已接受' ? '待入职' : ['待审批', '已发放'].includes(value) ? '录用' : '';
    const statements: D1PreparedStatement[] = [db.prepare('UPDATE offers SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(value, now, id, account.id)];
    if (nextStage) {
      statements.push(db.prepare('UPDATE candidates SET stage = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(nextStage, now, offer.candidate_id, account.id));
      statements.push(db.prepare('UPDATE resume_applications SET status = ? WHERE candidate_id = ? AND owner_id = ?').bind(nextStage, offer.candidate_id, account.id));
    }
    await db.batch(statements);
    return NextResponse.json({ ok: true });
  }
  const configs: Record<string, { table: string; field: string; allowed: string[] }> = {
    jobStatus: { table: 'jobs', field: 'status', allowed: ['草稿', '招聘中', '急聘', '已暂停', '已关闭'] },
  };
  const config = configs[resource];
  if (!config || !config.allowed.includes(value)) return invalid('更新状态无效。');
  await db.prepare(`UPDATE ${config.table} SET ${config.field} = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(value, now, id, account.id).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  if (account.role !== 'super_admin') return forbidden();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const resource = text(body?.resource, 40);
  const id = text(body?.id, 80);
  if (!id) return invalid('缺少需要删除的记录。');
  const db = getDb();
  if (resource === 'aiQuestion') {
    const question = await db.prepare('SELECT id FROM ai_questions WHERE id = ? AND owner_id = ?').bind(id, account.id).first<{id:string}>();
    if (!question) return invalid('面试题不存在或已被删除。');
    await db.prepare('DELETE FROM ai_questions WHERE id = ? AND owner_id = ?').bind(id, account.id).run();
    return NextResponse.json({ ok: true });
  }
  if (resource === 'offer') {
    const offer = await db.prepare('SELECT id FROM offers WHERE id = ? AND owner_id = ?').bind(id, account.id).first<{id:string}>();
    if (!offer) return invalid('Offer 不存在或已被删除。');
    await db.prepare('DELETE FROM offers WHERE id = ? AND owner_id = ?').bind(id, account.id).run();
    return NextResponse.json({ ok: true });
  }
  return invalid('不支持删除该记录。');
}

async function ownedRecord(table: 'jobs' | 'candidates', id: string, ownerId: string) {
  return Boolean(await getDb().prepare(`SELECT id FROM ${table} WHERE id = ? AND owner_id = ?`).bind(id, ownerId).first());
}

async function accessibleCandidate(id: string, accountId: string) {
  return getDb().prepare(`SELECT id, owner_id, job_id, stage FROM candidates WHERE id = ? AND (
    owner_id = ? OR id IN (SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?)
  ) LIMIT 1`).bind(id, accountId, accountId).first<{id:string;owner_id:string;job_id:string|null;stage:string}>();
}

function mapJob(row: DataRow) {
  return { id: row.id, title: row.title, department: row.department, city: row.city, status: row.status, headcount: row.headcount, ownerName: row.owner_name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapCandidate(row: DataRow) {
  let skills: string[] = [];
  try { skills = JSON.parse(String(row.skills_json || '[]')); } catch {}
  return { id: row.id, jobId: row.job_id, name: row.name, role: row.role, company: row.company, years: row.years, stage: normalizeCandidateStage(String(row.stage || '')), source: row.source, skills, score: row.score, phone: row.phone, email: row.email, city: row.city, gender: row.resume_gender, age: row.resume_age, education: row.resume_education, workYears: row.resume_work_years, resumeFileName: row.resume_file_name, assignedHrId: row.hr_account_id, assignedHrName: row.assigned_hr_name, assignedAt: row.assigned_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapInterview(row: DataRow) {
  return { id: row.id, candidateId: row.candidate_id, scheduledAt: row.scheduled_at, round: row.round, mode: row.mode, interviewer: row.interviewer, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapOffer(row: DataRow) {
  return { id: row.id, candidateId: row.candidate_id, jobTitle: row.job_title, salary: row.salary, recipientEmail: row.recipient_email, content: row.content, ownerName: row.owner_name, status: row.status, deadline: row.deadline, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapManualAssessment(row: DataRow) {
  return {
    candidateId: row.candidate_id,
    total: row.total,
    professional: row.professional,
    communication: row.communication,
    culture: row.culture,
    comment: row.comment,
    reviewer: row.reviewer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAiQuestion(row: DataRow) {
  return { id: row.id, jobId: row.job_id, title: row.title, category: row.category, questionType: row.question_type, duration: row.duration, competency: row.competency, keywords: row.keywords || row.competency, referenceAnswer: row.reference_answer || '', followUp: Boolean(row.follow_up), createdAt: row.created_at, updatedAt: row.updated_at };
}

function deduplicateAiQuestions(rows: DataRow[]) {
  const seen = new Set<string>();
  const unique: DataRow[] = [];
  const duplicateIds: string[] = [];
  for (const row of rows) {
    const key = [row.job_id, row.title, row.category, row.question_type, row.duration, row.competency, row.keywords, row.reference_answer, row.follow_up]
      .map(value => String(value ?? '').trim().toLowerCase()).join('\u0000');
    if (seen.has(key)) duplicateIds.push(String(row.id));
    else { seen.add(key); unique.push(row); }
  }
  return { unique, duplicateIds };
}

function mapAiInterview(row: DataRow) {
  return { id: row.id, candidateId: row.candidate_id, jobTitle: row.job_title, status: row.status, score: row.score, durationSeconds: row.duration_seconds, summary: row.summary, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function mapAiInvitation(row: DataRow, origin:string) {
  const token = await createInvitationShareToken(String(row.id || ''));
  const interviewUrl = token && origin ? `${origin}/interview/${encodeURIComponent(token)}` : '';
  return { id:row.id, candidateId:row.candidate_id, recipientEmail:row.recipient_email, jobTitle:row.job_title, status:row.status, sentAt:row.sent_at, openedAt:row.opened_at, completedAt:row.completed_at, expiresAt:row.expires_at, interviewUrl, createdAt:row.created_at, updatedAt:row.updated_at };
}

function generateInterviewQuestions(jobTitle:string,department:string){
  const role=`${jobTitle} ${department}`;
  const common=[
    {category:'岗位认知',title:`请结合过往经历，说明你对${jobTitle}岗位核心职责的理解。`,competency:'岗位理解',keywords:'核心职责，业务目标，协作对象，结果',referenceAnswer:`能够结合真实经历说明${jobTitle}的核心职责、主要协作对象、目标和衡量结果。`},
    {category:'项目经历',title:`请介绍一个最能体现你胜任${jobTitle}岗位的项目。`,competency:'项目能力',keywords:'背景，职责，行动，结果，复盘',referenceAnswer:'使用结构化方式说明项目背景、个人职责、关键行动、量化结果及复盘改进。'},
    {category:'问题解决',title:'遇到目标紧迫、资源不足或跨团队分歧时，你会如何推进？',competency:'问题解决',keywords:'优先级，沟通协作，风险，行动，结果',referenceAnswer:'先明确目标和优先级，识别风险与依赖，推动相关方达成共识，并持续跟踪结果。'},
    {category:'数据意识',title:`你会使用哪些指标判断${jobTitle}工作的质量和成效？`,competency:'数据分析',keywords:'指标，数据分析，目标，复盘，优化',referenceAnswer:'给出与岗位相关的核心指标、数据来源、分析方法，并说明如何据此优化工作。'},
    {category:'成长潜力',title:'请介绍一次工作失误或未达预期的经历，你如何复盘并改进？',competency:'复盘成长',keywords:'问题，原因，行动，结果，复盘',referenceAnswer:'坦诚说明问题和个人责任，分析根因，采取改进动作，并体现后续结果。'},
  ];
  const specialized = /产品|运营/.test(role) ? [
    {category:'专业能力',title:'你如何判断一个需求是否值得做，并确定需求优先级？',competency:'需求分析',keywords:'用户价值，业务价值，紧急程度，成本，风险，优先级',referenceAnswer:'综合用户价值、业务价值、紧急程度、实现成本与风险判断，并说明清晰的优先级框架。'},
    {category:'专业能力',title:'请介绍一次你通过数据或用户反馈推动产品迭代的经历。',competency:'产品迭代',keywords:'用户反馈，数据分析，假设，验证，迭代结果',referenceAnswer:'说明问题来源、数据与反馈证据、方案假设、验证过程及量化结果。'},
  ] : /开发|工程师|技术|测试/.test(role) ? [
    {category:'专业能力',title:`请设计一个与你应聘${jobTitle}相关的核心系统，并说明关键技术取舍。`,competency:'系统设计',keywords:'架构，性能，稳定性，可扩展性，取舍',referenceAnswer:'从业务约束出发说明架构设计、数据流、性能和稳定性方案，并解释关键取舍。'},
    {category:'专业能力',title:'请介绍一次复杂故障或技术难题的定位与解决过程。',competency:'技术攻坚',keywords:'现象，定位，根因，解决方案，复盘',referenceAnswer:'说明问题现象、排查路径、根因、解决方案、验证结果和预防措施。'},
  ] : /会计|财务|审计|出纳/.test(role) ? [
    {category:'专业能力',title:'请介绍你负责月结、对账或财务报表的完整流程。',competency:'财务专业',keywords:'月结，对账，凭证，报表，准确性，时效',referenceAnswer:'完整说明月结或对账流程、关键控制点、异常处理方式以及准确性和时效保障。'},
    {category:'风险控制',title:'发现账实不符、凭证异常或税务风险时，你会如何处理？',competency:'风险控制',keywords:'核查，证据，合规，沟通，整改，留痕',referenceAnswer:'先核查事实和证据，评估影响与合规风险，及时沟通升级，完成整改并保留记录。'},
  ] : /设计/.test(role) ? [
    {category:'专业能力',title:'请介绍一个代表性设计项目，以及你如何平衡用户体验与业务目标。',competency:'设计能力',keywords:'用户需求，业务目标，方案，验证，结果',referenceAnswer:'说明需求洞察、设计目标、方案推导、验证方法和最终业务或体验结果。'},
    {category:'协作能力',title:'面对需求频繁变化或多方审美分歧时，你如何推动设计决策？',competency:'设计协作',keywords:'目标，证据，沟通，取舍，推进',referenceAnswer:'围绕共同目标，使用用户证据和设计原则沟通取舍，形成可执行决策。'},
  ] : [];
  return [...specialized,...common];
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function integer(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function createOfferContent(name: string, jobTitle: string, salary: string, deadline: string) {
  const date = new Date(`${deadline}T00:00:00`);
  const confirmBy = Number.isNaN(date.getTime()) ? deadline : new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'long', day:'numeric' }).format(date);
  return `尊敬的${name}：\n\n您好！我们诚挚邀请您加入星鉴人才，担任${jobTitle}一职，薪资方案为${salary}。请您于${confirmBy}前确认是否接受本次录用邀请。\n\n期待您的加入！`;
}

function createInterviewInvitation(name:string, jobTitle:string, interviewUrl:string, expiresAt:string) {
  const deadline = new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(expiresAt));
  return `尊敬的${name}：\n\n您好！诚邀您参加“${jobTitle}”岗位的 AI 面试。请使用电脑或手机浏览器打开以下专属面试地址：\n\n${interviewUrl}\n\n链接有效期至：${deadline}\n\n进入后请允许浏览器使用摄像头和麦克风，并按页面提示完成全部问题。该链接仅限本人使用，请勿转发。\n\n星鉴人才`;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function validHttpOrigin(value:unknown) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}

async function deliverInterviewEmail(to:string, subject:string, content:string) {
  const bindings = env as unknown as { RESEND_API_KEY?:string; INTERVIEW_EMAIL_FROM?:string };
  if (!bindings.RESEND_API_KEY || !bindings.INTERVIEW_EMAIL_FROM) return { sent:false };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ Authorization:`Bearer ${bindings.RESEND_API_KEY}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ from:bindings.INTERVIEW_EMAIL_FROM, to:[to], subject, text:content }),
    });
    return { sent:response.ok };
  } catch {
    return { sent:false };
  }
}

function list(value: unknown) {
  if (Array.isArray(value)) return value.map(item => text(item, 40)).filter(Boolean);
  return String(value ?? '').split(/[,，]/).map(item => item.trim().slice(0, 40)).filter(Boolean);
}

function unauthorized() {
  return NextResponse.json({ ok: false, message: '请先登录。' }, { status: 401 });
}

function invalid(message: string) {
  return NextResponse.json({ ok: false, message }, { status: 400 });
}

function forbidden() {
  return NextResponse.json({ ok: false, message: '当前 HR 账号没有管理员操作权限。' }, { status: 403 });
}
