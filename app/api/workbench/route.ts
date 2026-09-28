import { NextRequest, NextResponse } from 'next/server';
import { CANDIDATE_STAGES, normalizeCandidateStage } from '@/app/candidate-stages';
import { env } from 'cloudflare:workers';
import { accountFromRequest, createInvitationShareToken, ensureSchema, getDb, getResumeBucket, hashToken } from '@/app/server/db';
import { repairResumeProfiles } from '@/app/server/resume-repair';
import { questionMaxScores } from '@/app/interview-score-weights';
import { deriveInterviewKeywords, isGenericInterviewKeywords } from '@/app/interview-keywords';

type DataRow = Record<string, string | number | null>;

export async function GET(request: NextRequest) {
  const departmentReviewScope = new URL(request.url).searchParams.get('scope') === 'department-review';
  const resetOnLoad=(env as unknown as {RESET_TEST_ACCOUNT_ON_NEXT_LOAD?:string}).RESET_TEST_ACCOUNT_ON_NEXT_LOAD||'';
  if(resetOnLoad.startsWith('test-account-')){
    await ensureSchema();
    await clearBusinessData(resetOnLoad);
  }
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
    db.prepare(`SELECT c.*,
          COALESCE(
            (SELECT ca.hr_account_id FROM candidate_assignments ca WHERE ca.candidate_id = c.id AND ca.hr_account_id = ? LIMIT 1),
            (SELECT ca.hr_account_id FROM candidate_assignments ca WHERE ca.candidate_id = c.id ORDER BY ca.assigned_at DESC LIMIT 1)
          ) AS hr_account_id,
          (SELECT MAX(ca.assigned_at) FROM candidate_assignments ca WHERE ca.candidate_id = c.id) AS assigned_at,
          (SELECT GROUP_CONCAT(a.contact, '、') FROM candidate_assignments ca JOIN accounts a ON a.id = ca.hr_account_id WHERE ca.candidate_id = c.id) AS assigned_hr_name,
          rp.gender AS resume_gender, rp.age AS resume_age, rp.education AS resume_education, rp.work_years AS resume_work_years,
          rp.file_name AS resume_file_name
        FROM candidates c LEFT JOIN resume_profiles rp ON rp.candidate_id = c.id
        WHERE c.owner_id = ? OR c.id IN (${assignedCandidateSql})
        ORDER BY COALESCE((SELECT MAX(ca.assigned_at) FROM candidate_assignments ca WHERE ca.candidate_id = c.id), c.created_at) DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM interviews WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY scheduled_at ASC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM offers WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY created_at DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM ai_questions WHERE owner_id = ? OR job_id IN (${assignedJobSql}) ORDER BY created_at DESC`).bind(account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM ai_interviews WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY COALESCE(completed_at, created_at) DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM ai_interview_invitations WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY created_at DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    db.prepare(`SELECT * FROM manual_assessments WHERE owner_id = ? OR ${relatedCandidateSql} ORDER BY updated_at DESC`).bind(account.id, account.id, account.id).all<DataRow>(),
    account.role === 'super_admin'
      ? db.prepare("SELECT id, contact, phone, email, role FROM accounts ORDER BY contact ASC, created_at ASC").all<DataRow>()
      : Promise.resolve({ results: [] as DataRow[] }),
  ]);
  const { unique: uniqueQuestions, duplicateIds } = deduplicateAiQuestions(aiQuestions.results);
  if (duplicateIds.length) {
    await db.batch(duplicateIds.map(id => db.prepare('DELETE FROM ai_questions WHERE id = ? AND owner_id = ?').bind(id, account.id)));
  }
  const repairedQuestions = uniqueQuestions.map(row => {
    const current=String(row.keywords||'');
    const keywords=deriveInterviewKeywords(String(row.title||''),String(row.reference_answer||''),String(row.competency||''),current);
    return isGenericInterviewKeywords(current)&&keywords!==current?{...row,keywords}:row;
  });
  const keywordRepairs=repairedQuestions.filter((row,index)=>row.keywords!==uniqueQuestions[index]?.keywords&&row.owner_id===account.id);
  if(keywordRepairs.length)await db.batch(keywordRepairs.map(row=>db.prepare('UPDATE ai_questions SET keywords = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(row.keywords,now,row.id,account.id)));
  const requestOrigin = validHttpOrigin(new URL(request.url).origin);
  const configuredOrigin = validHttpOrigin((env as unknown as { INTERVIEW_PUBLIC_ORIGIN?:string }).INTERVIEW_PUBLIC_ORIGIN);
  const mappedInvitations = await Promise.all(aiInvitations.results.map(row => mapAiInvitation(row, configuredOrigin || requestOrigin)));
  const scopedCandidates = departmentReviewScope
    ? candidates.results.filter(row => normalizeCandidateStage(String(row.stage || '')) === '用人部门筛选' && String(row.hr_account_id || '') === account.id)
    : candidates.results;
  const scopedCandidateIds = new Set(scopedCandidates.map(row => String(row.id)));
  const scopedJobIds = new Set(scopedCandidates.map(row => String(row.job_id || '')).filter(Boolean));
  const scopedRows = <T extends DataRow>(rows:T[], candidateField='candidate_id') => departmentReviewScope
    ? rows.filter(row => scopedCandidateIds.has(String(row[candidateField] || '')))
    : rows;
  return NextResponse.json({
    account,
    jobs: (departmentReviewScope ? jobs.results.filter(row => scopedJobIds.has(String(row.id))) : jobs.results).map(mapJob),
    candidates: scopedCandidates.map(mapCandidate),
    interviews: scopedRows(interviews.results).map(mapInterview),
    offers: scopedRows(offers.results).map(mapOffer),
    aiQuestions: (departmentReviewScope ? repairedQuestions.filter(row => !row.job_id || scopedJobIds.has(String(row.job_id))) : repairedQuestions).map(mapAiQuestion),
    aiInterviews: scopedRows(aiInterviews.results).map(mapAiInterview),
    aiInvitations: departmentReviewScope ? mappedInvitations.filter(row => scopedCandidateIds.has(row.candidateId)) : mappedInvitations,
    manualAssessments: scopedRows(manualAssessments.results).map(mapManualAssessment),
    recipientAccounts: departmentReviewScope ? [] : recipientAccounts.results.map(row => ({ id: row.id, contact: row.contact, phone: row.phone, email: row.email, role: row.role })),
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
    const endAt = text(payload.endAt, 80);
    if (!endAt || Number.isNaN(Date.parse(endAt)) || Date.parse(endAt) <= Date.parse(scheduledAt)) return invalid('面试结束时间必须晚于开始时间。');
    const mode = text(payload.mode, 40) || '线下面试';
    const round = text(payload.round, 80) || '初试';
    const interviewer = text(payload.interviewer, 80) || account.contact;
    const location = text(payload.location, 300);
    if (!interviewer || !location) return invalid('请选择面试人员并填写面试场地或会议地址。');
    const assistant = text(payload.assistant, 500);
    const contactName = text(payload.contactName, 80) || account.contact;
    const contactMethod = text(payload.contactMethod, 120) || account.phone || account.email;
    const feedbackEmail = text(payload.feedbackEmail, 120) || account.email;
    if (feedbackEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(feedbackEmail)) return invalid('请输入有效的反馈邮箱。');
    const notifyCandidate = truthy(payload.notifyCandidate);
    if (notifyCandidate && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) return invalid('该候选人尚未填写有效邮箱，请先补充候选人邮箱。');
    const emailSubject = text(payload.emailSubject, 240) || `星鉴人才｜${candidate.role}面试邀请`;
    const emailContent = text(payload.emailContent, 10000) || createScheduledInterviewEmail(candidate.name, candidate.role, scheduledAt, endAt, round, mode, location, contactName, contactMethod);
    await db.batch([
      db.prepare(`INSERT INTO interviews (
        id, owner_id, candidate_id, scheduled_at, end_at, round, mode, interviewer, assistant, location,
        contact_name, contact_method, feedback_email, notify_candidate, email_subject, email_content,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待确认', ?, ?)`).bind(
        id, candidate.owner_id, candidateId, new Date(scheduledAt).toISOString(), new Date(endAt).toISOString(), round, mode,
        interviewer, assistant, location, contactName, contactMethod, feedbackEmail, notifyCandidate ? 1 : 0,
        emailSubject, emailContent, now, now,
      ),
      db.prepare("UPDATE candidates SET stage = '安排面试', updated_at = ? WHERE id = ?").bind(now, candidateId),
      db.prepare("UPDATE resume_applications SET status = '安排面试' WHERE candidate_id = ? AND owner_id = ?").bind(candidateId, candidate.owner_id),
    ]);
    if (notifyCandidate) {
      const delivery = await deliverInterviewEmail(candidate.email, emailSubject, emailContent);
      return NextResponse.json({
        ok:true, id, emailSent:delivery.sent, recipientEmail:candidate.email,
        mailtoUrl:delivery.sent ? '' : `mailto:${encodeURIComponent(candidate.email)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailContent)}`,
      }, { status:201 });
    }
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
    const selectedJobId = text(payload.jobId, 80);
    const isGeneral = selectedJobId === '__general__';
    const job = !isGeneral && selectedJobId ? await db.prepare('SELECT id, title, department FROM jobs WHERE id = ? AND owner_id = ?').bind(selectedJobId, account.id).first<{id:string;title:string;department:string}>() : null;
    if (!isGeneral && !job) return invalid('请选择需要生成面试题的岗位或通用面试。');
    const libraryJobId = job?.id || null;
    const requestedCount = integer(payload.count, 3, 8, 5);
    const generated = (isGeneral ? generateGeneralInterviewQuestions() : generateInterviewQuestions(job!.title, job!.department)).slice(0, requestedCount);
    const existing = await db.prepare(`SELECT title, max_score FROM ai_questions WHERE owner_id = ?
      AND COALESCE(job_id, '') = ?`).bind(account.id, libraryJobId || '').all<{title:string;max_score:number}>();
    const existingTitles = new Set(existing.results.map(item => item.title.trim().toLowerCase()));
    const questions = generated.filter(item => !existingTitles.has(item.title.trim().toLowerCase()));
    const allocated = existing.results.reduce((sum, item) => sum + Math.max(0, Number(item.max_score) || 0), 0);
    const remaining = 100 - allocated;
    if (questions.length && remaining < questions.length) return invalid(`该岗位题库只剩 ${Math.max(0, remaining)} 分可分配，无法再生成 ${questions.length} 道题。请先调整或删除现有题目。`);
    const generatedMaxScores = questionMaxScores(questions.length, remaining);
    if (questions.length) {
      await db.batch(questions.map((question, index) => {
        const createdAt = new Date(Date.parse(now) + index).toISOString();
        return db.prepare(`INSERT INTO ai_questions (id, owner_id, job_id, title, category, question_type, duration, competency, keywords, reference_answer, follow_up, max_score, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, '语音提问', 120, ?, ?, ?, 1, ?, ?, ?)`
        ).bind(crypto.randomUUID(), account.id, libraryJobId, question.title, question.category, question.competency, question.keywords, question.referenceAnswer, generatedMaxScores[index], createdAt, createdAt);
      }));
    }
    return NextResponse.json({ ok:true, count:questions.length, jobTitle:job?.title || '通用面试' }, { status:201 });
  } else if (resource === 'aiQuestion') {
    const title = text(payload.title, 500);
    if (!title) return invalid('请输入面试问题。');
    const jobId = text(payload.jobId, 80) || null;
    if (jobId && !(await ownedRecord('jobs', jobId, account.id))) return invalid('所选适用岗位不存在。');
    const category = text(payload.category, 80) || '通用素质';
    const questionType = text(payload.questionType, 40) || '语音提问';
    const duration = integer(payload.duration, 30, 900, 120);
    const competency = text(payload.competency, 80) || '综合能力';
    const referenceAnswer = text(payload.referenceAnswer, 3000);
    const keywords = deriveInterviewKeywords(title, referenceAnswer, competency, text(payload.keywords, 500));
    const followUp = payload.followUp ? 1 : 0;
    const maxScore = integer(payload.maxScore, 1, 100, -1);
    if (maxScore < 1) return invalid('请设置 1–100 分的题目最高分。');
    const scoreTotal = await db.prepare(`SELECT COALESCE(SUM(max_score), 0) AS total FROM ai_questions
      WHERE owner_id = ? AND COALESCE(job_id, '') = ?`).bind(account.id, jobId || '').first<{total:number}>();
    const nextTotal = Number(scoreTotal?.total || 0) + maxScore;
    if (nextTotal > 100) return invalid(`该题库最高分合计将达到 ${nextTotal} 分，不能超过 100 分。`);
    const duplicate = await db.prepare(`SELECT id FROM ai_questions WHERE owner_id = ? AND COALESCE(job_id, '') = ?
      AND title = ? COLLATE NOCASE AND category = ? COLLATE NOCASE AND question_type = ? COLLATE NOCASE
      AND duration = ? AND competency = ? COLLATE NOCASE AND keywords = ? COLLATE NOCASE
      AND reference_answer = ? COLLATE NOCASE AND follow_up = ? AND max_score = ? LIMIT 1`
    ).bind(account.id, jobId || '', title, category, questionType, duration, competency, keywords, referenceAnswer, followUp, maxScore).first<{id:string}>();
    if (duplicate) return NextResponse.json({ ok:false, message:'相同面试题已存在，无需重复保存。' }, { status:409 });
    await db.prepare(`INSERT INTO ai_questions (id, owner_id, job_id, title, category, question_type, duration, competency, keywords, reference_answer, follow_up, max_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, account.id, jobId, title, category, questionType, duration, competency, keywords, referenceAnswer, followUp, maxScore, now, now).run();
  } else if (resource === 'aiInterviewInvite') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await db.prepare(`SELECT id, job_id, name, role, email, stage FROM candidates
      WHERE id = ? AND owner_id = ?`).bind(candidateId, account.id).first<{ id:string; job_id:string|null; name:string; role:string; email:string; stage:string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    if (normalizeCandidateStage(String(candidate.stage)) !== 'AI面试') return invalid('用人部门筛选通过后，才能发送 AI 面试邀请。');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) return invalid('该候选人尚未填写有效邮箱，请先补充邮箱。');
    const questionRows = await db.prepare(`SELECT * FROM ai_questions WHERE owner_id = ?
      AND (job_id = ? OR job_id IS NULL)
      ORDER BY CASE WHEN job_id IS NULL THEN 0 ELSE 1 END, created_at ASC`).bind(account.id, candidate.job_id || '').all<DataRow>();
    const specific = questionRows.results.filter(row => candidate.job_id && row.job_id === candidate.job_id);
    const general = questionRows.results.filter(row => !row.job_id);
    const selectedQuestions = [...general, ...specific];
    if (!selectedQuestions.length) return invalid('尚未配置通用面试题或该岗位面试题，请先生成或新建面试题。');
    const generalScoreTotal = general.reduce((sum, row) => sum + Math.max(0, Number(row.max_score) || 0), 0);
    const specificScoreTotal = specific.reduce((sum, row) => sum + Math.max(0, Number(row.max_score) || 0), 0);
    if (general.length && generalScoreTotal !== 100) return invalid(`通用面试题最高分合计为 ${generalScoreTotal} 分，请调整为 100 分后再发送邀请。`);
    if (specific.length && specificScoreTotal !== 100) return invalid(`岗位面试题最高分合计为 ${specificScoreTotal} 分，请调整为 100 分后再发送邀请。`);
    const invitationScores = combinedQuestionScores(general, specific);
    const token = randomToken();
    const invitationId = crypto.randomUUID();
    const requestedHours = Number(payload.validityHours);
    const validityHours = [12, 24, 72].includes(requestedHours) ? requestedHours : 24;
    const expiresAt = new Date(Date.parse(now) + validityHours * 60 * 60 * 1000).toISOString();
    const questions = selectedQuestions.map((row, index) => ({
      id:String(row.id), title:String(row.title), duration:Number(row.duration) || 120,
      questionType:String(row.question_type || '语音提问'), competency:String(row.competency || ''),
      keywords:deriveInterviewKeywords(String(row.title||''),String(row.reference_answer||''),String(row.competency||''),String(row.keywords||'')), referenceAnswer:String(row.reference_answer || ''),
      maxScore:invitationScores[index] || 0,
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
    const candidate = candidateId ? await db.prepare('SELECT role, stage FROM candidates WHERE id = ? AND owner_id = ?').bind(candidateId, account.id).first<{ role:string; stage:string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    if (normalizeCandidateStage(candidate.stage) !== 'AI面试') return invalid('用人部门筛选通过后，才能录入 AI 面试结果。');
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

  if (resource === 'candidateFact') {
    const field = text(payload.field, 30);
    const candidate = await db.prepare('SELECT id FROM candidates WHERE id = ? AND owner_id = ? LIMIT 1').bind(id, account.id).first<{id:string}>();
    if (!candidate) return invalid('候选人不存在或无权修改。');
    if (field === 'email') {
      const email = text(payload.value, 120).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('请补充有效邮箱');
      await db.prepare('UPDATE candidates SET email = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(email, now, id, account.id).run();
      return NextResponse.json({ ok: true });
    }
    if (field === 'phone') {
      const phone = text(payload.value, 30);
      if (phone && !/^[+\d][\d\s-]{5,29}$/.test(phone)) return invalid('请输入有效手机号');
      await db.prepare('UPDATE candidates SET phone = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(phone, now, id, account.id).run();
      return NextResponse.json({ ok: true });
    }
    const resumeFields:Record<string,'gender'|'age'|'work_years'|'education'>={gender:'gender',age:'age',work:'work_years',education:'education'};
    const resumeField=resumeFields[field];
    if (!resumeField) return invalid('不支持修改该候选人信息。');
    const rawValue=text(payload.value, 80);
    let normalized:string|number|null=rawValue;
    if (field === 'gender' && rawValue && !['男','女','其他'].includes(rawValue)) return invalid('请选择有效性别。');
    if (field === 'education' && rawValue && !['高中','中专','大专','本科','硕士','博士','其他'].includes(rawValue)) return invalid('请选择有效学历。');
    if (field === 'age') {
      normalized=rawValue?Number(rawValue):null;
      if (normalized!==null&&(!Number.isInteger(normalized)||normalized<16||normalized>100)) return invalid('年龄应为 16–100 岁');
    }
    if (field === 'work') {
      normalized=rawValue?Number(rawValue):null;
      if (normalized!==null&&(!Number.isFinite(normalized)||normalized<0||normalized>70)) return invalid('工作年限应为 0–70 年');
    }
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO resume_profiles (candidate_id, owner_id, parsing_status, created_at, updated_at) VALUES (?, ?, '结构化完成', ?, ?)`).bind(id, account.id, now, now),
      db.prepare(`UPDATE resume_profiles SET ${resumeField} = ?, updated_at = ? WHERE candidate_id = ? AND owner_id = ?`).bind(normalized, now, id, account.id),
      ...(field==='work'?[db.prepare('UPDATE candidates SET years = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(normalized===null?'':`${normalized} 年`, now, id, account.id)]:[]),
    ]);
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
    const referenceAnswer = text(payload.referenceAnswer, 3000);
    const keywords = deriveInterviewKeywords(title, referenceAnswer, competency, text(payload.keywords, 500));
    const followUp = payload.followUp ? 1 : 0;
    const maxScore = integer(payload.maxScore, 1, 100, -1);
    if (maxScore < 1) return invalid('请设置 1–100 分的题目最高分。');
    const scoreTotal = await db.prepare(`SELECT COALESCE(SUM(max_score), 0) AS total FROM ai_questions
      WHERE owner_id = ? AND id <> ? AND COALESCE(job_id, '') = ?`).bind(account.id, id, jobId || '').first<{total:number}>();
    const nextTotal = Number(scoreTotal?.total || 0) + maxScore;
    if (nextTotal > 100) return invalid(`该题库最高分合计将达到 ${nextTotal} 分，不能超过 100 分。`);
    const duplicate = await db.prepare(`SELECT id FROM ai_questions WHERE owner_id = ? AND id <> ? AND COALESCE(job_id, '') = ?
      AND title = ? COLLATE NOCASE AND category = ? COLLATE NOCASE AND question_type = ? COLLATE NOCASE
      AND duration = ? AND competency = ? COLLATE NOCASE AND keywords = ? COLLATE NOCASE
      AND reference_answer = ? COLLATE NOCASE AND follow_up = ? AND max_score = ? LIMIT 1`
    ).bind(account.id, id, jobId || '', title, category, questionType, duration, competency, keywords, referenceAnswer, followUp, maxScore).first<{id:string}>();
    if (duplicate) return NextResponse.json({ ok:false, message:'相同面试题已存在，请直接使用现有题目。' }, { status:409 });
    await db.prepare(`UPDATE ai_questions SET job_id = ?, title = ?, category = ?, question_type = ?, duration = ?, competency = ?, keywords = ?, reference_answer = ?, follow_up = ?, max_score = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?`).bind(jobId, title, category, questionType, duration, competency, keywords, referenceAnswer, followUp, maxScore, now, id, account.id).run();
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
    const endAt = text(payload.endAt, 80);
    if (!endAt || Number.isNaN(Date.parse(endAt)) || Date.parse(endAt) <= Date.parse(scheduledAt)) return invalid('面试结束时间必须晚于开始时间。');
    const candidate = await accessibleCandidate(candidateId, account.id);
    if (!candidate) return invalid('请选择有效候选人。');
    const mode = text(payload.mode, 40) || '线下面试';
    const round = text(payload.round, 80) || '初试';
    const interviewer = text(payload.interviewer, 80) || account.contact;
    const location = text(payload.location, 300);
    if (!interviewer || !location) return invalid('请选择面试人员并填写面试场地或会议地址。');
    const assistant = text(payload.assistant, 500);
    const contactName = text(payload.contactName, 80) || account.contact;
    const contactMethod = text(payload.contactMethod, 120) || account.phone || account.email;
    const feedbackEmail = text(payload.feedbackEmail, 120) || account.email;
    if (feedbackEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(feedbackEmail)) return invalid('请输入有效的反馈邮箱。');
    const notifyCandidate = truthy(payload.notifyCandidate);
    if (notifyCandidate && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) return invalid('该候选人尚未填写有效邮箱，请先补充候选人邮箱。');
    const emailSubject = text(payload.emailSubject, 240) || `星鉴人才｜${candidate.role}面试邀请`;
    const emailContent = text(payload.emailContent, 10000) || createScheduledInterviewEmail(candidate.name, candidate.role, scheduledAt, endAt, round, mode, location, contactName, contactMethod);
    await db.prepare(`UPDATE interviews SET candidate_id = ?, scheduled_at = ?, end_at = ?, round = ?, mode = ?, interviewer = ?,
      assistant = ?, location = ?, contact_name = ?, contact_method = ?, feedback_email = ?, notify_candidate = ?,
      email_subject = ?, email_content = ?, updated_at = ? WHERE id = ?`).bind(
      candidateId, new Date(scheduledAt).toISOString(), new Date(endAt).toISOString(), round, mode, interviewer,
      assistant, location, contactName, contactMethod, feedbackEmail, notifyCandidate ? 1 : 0,
      emailSubject, emailContent, now, id,
    ).run();
    if (notifyCandidate) {
      const delivery = await deliverInterviewEmail(candidate.email, emailSubject, emailContent);
      return NextResponse.json({
        ok:true, emailSent:delivery.sent, recipientEmail:candidate.email,
        mailtoUrl:delivery.sent ? '' : `mailto:${encodeURIComponent(candidate.email)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailContent)}`,
      });
    }
    return NextResponse.json({ ok: true, emailSent:false });
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
    if (value === 'AI面试') {
      if (!['用人部门筛选', '待定'].includes(currentStage)) return invalid('请先推送给用人部门筛选。');
      const assignedRecipient = await db.prepare('SELECT candidate_id FROM candidate_assignments WHERE candidate_id = ? AND hr_account_id = ? LIMIT 1').bind(id, account.id).first<{candidate_id:string}>();
      if (!assignedRecipient) return invalid('仅接收该简历的用人部门账号可以确认通过。');
    }
    if (value === '用人部门筛选') {
      return invalid('请从简历筛选页选择接收人并推送给用人部门。');
    }
    if (value === '安排面试') {
      if (currentStage !== 'AI面试') return invalid('请先进入 AI 面试阶段。');
      const completedAiInterview = await db.prepare("SELECT id FROM ai_interviews WHERE candidate_id = ? AND status = '已完成' LIMIT 1").bind(id).first<{id:string}>();
      if (!completedAiInterview) return invalid('候选人完成 AI 面试后，才能安排人工面试。');
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
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const resource = text(body?.resource, 40);
  let account = await accountFromRequest(request);
  const resetKey=(env as unknown as {RESET_DATA_KEY?:string}).RESET_DATA_KEY||'';
  const maintenanceAuthorized=resource==='businessDataReset'&&Boolean(resetKey)&&request.headers.get('x-reset-data-key')===resetKey;
  if(!account&&maintenanceAuthorized){
    const targetId=text(body?.targetAccountId,80);
    if(!targetId.startsWith('test-account-'))return forbidden();
    await ensureSchema();
    const row=await getDb().prepare("SELECT id, contact, phone, email, role, created_at FROM accounts WHERE id = ? AND role = 'super_admin' LIMIT 1").bind(targetId).first<{id:string;contact:string;phone:string;email:string;role:'super_admin';created_at:string}>();
    if(row)account={id:row.id,contact:row.contact,phone:row.phone,email:row.email,role:row.role,createdAt:row.created_at};
  }
  if (!account) return unauthorized();
  if (account.role !== 'super_admin') return forbidden();
  if(resource==='businessDataReset'){
    if(!account.id.startsWith('test-account-'))return forbidden();
    if(text(body?.confirmation,80)!=='CLEAR_TEST_ACCOUNT_DATA')return invalid('清空确认信息无效。');
    await clearBusinessData(account.id);
    return NextResponse.json({ok:true,cleared:true});
  }
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
  return getDb().prepare(`SELECT id, owner_id, job_id, stage, name, role, email FROM candidates WHERE id = ? AND (
    owner_id = ? OR id IN (SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?)
  ) LIMIT 1`).bind(id, accountId, accountId).first<{id:string;owner_id:string;job_id:string|null;stage:string;name:string;role:string;email:string}>();
}

async function clearBusinessData(ownerId:string){
  const db=getDb();
  const [resumeFiles,recordingFiles]=await Promise.all([
    db.prepare('SELECT file_key FROM resume_profiles WHERE owner_id = ? AND file_key IS NOT NULL').bind(ownerId).all<{file_key:string}>(),
    db.prepare('SELECT object_key FROM ai_interview_recordings WHERE owner_id = ?').bind(ownerId).all<{object_key:string}>(),
  ]);
  await db.batch([
    db.prepare('DELETE FROM ai_interview_recordings WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM ai_interviews WHERE owner_id = ?').bind(ownerId),
    db.prepare('DELETE FROM ai_interview_invitations WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM manual_assessments WHERE owner_id = ?').bind(ownerId),
    db.prepare('DELETE FROM interviews WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM offers WHERE owner_id = ?').bind(ownerId),
    db.prepare('DELETE FROM screening_reviews WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM screening_logs WHERE owner_id = ?').bind(ownerId),
    db.prepare('DELETE FROM resume_applications WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM resume_profiles WHERE owner_id = ?').bind(ownerId),
    db.prepare('DELETE FROM candidate_assignments WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM candidates WHERE owner_id = ?').bind(ownerId),
    db.prepare('DELETE FROM ai_questions WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM screening_rules WHERE owner_id = ?').bind(ownerId),
    db.prepare('DELETE FROM screening_templates WHERE owner_id = ?').bind(ownerId),db.prepare('DELETE FROM jobs WHERE owner_id = ?').bind(ownerId),
  ]);
  const keys=[...resumeFiles.results.map(row=>row.file_key),...recordingFiles.results.map(row=>row.object_key)].filter(Boolean);
  if(keys.length)await getResumeBucket().delete(keys);
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
  return {
    id: row.id, candidateId: row.candidate_id, scheduledAt: row.scheduled_at, endAt: row.end_at || '',
    round: row.round, mode: row.mode, interviewer: row.interviewer, assistant: row.assistant || '', location: row.location || '',
    contactName: row.contact_name || '', contactMethod: row.contact_method || '', feedbackEmail: row.feedback_email || '',
    notifyCandidate: Boolean(row.notify_candidate), emailSubject: row.email_subject || '', emailContent: row.email_content || '',
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  };
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
  return { id: row.id, jobId: row.job_id, title: row.title, category: row.category, questionType: row.question_type, duration: row.duration, competency: row.competency, keywords: row.keywords || row.competency, referenceAnswer: row.reference_answer || '', followUp: Boolean(row.follow_up), maxScore: Number(row.max_score) || 0, createdAt: row.created_at, updatedAt: row.updated_at };
}

function deduplicateAiQuestions(rows: DataRow[]) {
  const seen = new Set<string>();
  const unique: DataRow[] = [];
  const duplicateIds: string[] = [];
  for (const row of rows) {
    const key = [row.job_id, row.title, row.category, row.question_type, row.duration, row.competency, row.keywords, row.reference_answer, row.follow_up, row.max_score]
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
    {category:'岗位认知',title:`请结合过往经历，说明你对${jobTitle}岗位核心职责的理解。`,competency:'岗位理解',keywords:'核心职责，业务目标，协作对象，结果',referenceAnswer:`建议回答包含：1. 结合具体业务场景说明${jobTitle}的核心职责和工作边界；2. 说明主要服务对象、上下游协作方及沟通机制；3. 列出关键业务目标、日常任务和风险控制点；4. 给出质量、效率或业务结果的衡量指标；5. 用一段真实经历证明自己的理解和胜任能力。`},
    {category:'项目经历',title:`请介绍一个最能体现你胜任${jobTitle}岗位的项目。`,competency:'项目能力',keywords:'背景，职责，行动，结果，复盘',referenceAnswer:'建议使用 STAR 结构回答：1. 交代项目背景、业务目标、周期与约束；2. 明确个人职责、决策权限和协作对象；3. 说明关键行动、难点、资源协调与风险处理；4. 提供可核验的量化结果及个人贡献；5. 总结复盘、经验沉淀和后续改进。'},
    {category:'问题解决',title:'遇到目标紧迫、资源不足或跨团队分歧时，你会如何推进？',competency:'问题解决',keywords:'优先级，沟通协作，风险，行动，结果',referenceAnswer:'建议回答包含：1. 澄清业务目标、交付标准和时间边界；2. 按价值、紧急度与依赖关系确定优先级；3. 识别资源缺口、关键风险和备选方案；4. 与相关方对齐分工、里程碑和升级机制；5. 持续跟踪数据与结果，出现偏差及时调整并复盘。'},
    {category:'数据意识',title:`你会使用哪些指标判断${jobTitle}工作的质量和成效？`,competency:'数据分析',keywords:'指标，数据分析，目标，复盘，优化',referenceAnswer:`建议回答包含：1. 从业务目标拆解${jobTitle}的结果指标、过程指标和质量指标；2. 说明指标口径、数据来源、统计周期和基准值；3. 结合趋势、分层或对比分析定位问题；4. 给出预警阈值与改进动作；5. 说明如何验证优化效果并形成持续复盘机制。`},
    {category:'成长潜力',title:'请介绍一次工作失误或未达预期的经历，你如何复盘并改进？',competency:'复盘成长',keywords:'问题，原因，行动，结果，复盘',referenceAnswer:'建议回答包含：1. 如实说明事件背景、预期目标和实际偏差；2. 明确个人责任，不回避关键失误；3. 从流程、判断、沟通和资源等方面分析根因；4. 说明补救动作、风险控制及最终结果；5. 给出制度、工具或工作习惯上的长期改进，并说明后续验证效果。'},
  ];
  const specialized = /产品|运营/.test(role) ? [
    {category:'专业能力',title:'你如何判断一个需求是否值得做，并确定需求优先级？',competency:'需求分析',keywords:'用户价值，业务价值，紧急程度，成本，风险，优先级',referenceAnswer:'建议回答包含：1. 明确目标用户、使用场景和核心痛点；2. 用数据、访谈或反馈验证需求真实性；3. 评估用户价值、业务价值、战略匹配度和紧急程度；4. 估算研发成本、机会成本、依赖和风险；5. 使用可解释的优先级框架排序，并说明上线后的验证指标。'},
    {category:'专业能力',title:'请介绍一次你通过数据或用户反馈推动产品迭代的经历。',competency:'产品迭代',keywords:'用户反馈，数据分析，假设，验证，迭代结果',referenceAnswer:'建议回答包含：1. 说明问题来源及目标用户；2. 展示用户反馈、行为数据和业务数据证据；3. 提出可验证的产品假设与成功标准；4. 说明方案取舍、协作推进、灰度或实验过程；5. 提供迭代前后数据、业务结果和复盘结论。'},
  ] : /开发|工程师|技术|测试/.test(role) ? [
    {category:'专业能力',title:`请设计一个与你应聘${jobTitle}相关的核心系统，并说明关键技术取舍。`,competency:'系统设计',keywords:'架构，性能，稳定性，可扩展性，取舍',referenceAnswer:'建议回答包含：1. 明确业务目标、用户规模、数据量和一致性要求；2. 划分核心模块、接口、数据模型和完整数据流；3. 说明性能、容量、缓存、并发与扩展方案；4. 设计容错、监控、安全、降级和灾备机制；5. 比较备选架构并解释成本、复杂度与交付周期之间的取舍。'},
    {category:'专业能力',title:'请介绍一次复杂故障或技术难题的定位与解决过程。',competency:'技术攻坚',keywords:'现象，定位，根因，解决方案，复盘',referenceAnswer:'建议回答包含：1. 描述故障现象、影响范围和时间线；2. 说明止损、隔离与信息同步措施；3. 展示日志、指标、链路和实验验证的排查过程；4. 定位根因并说明修复方案、验证结果和回滚预案；5. 总结监控、测试、流程或架构层面的预防措施。'},
  ] : /会计|财务|审计|出纳/.test(role) ? [
    {category:'专业能力',title:'请介绍你负责月结、对账或财务报表的完整流程。',competency:'财务专业',keywords:'月结，对账，凭证，报表，准确性，时效',referenceAnswer:'建议回答包含：1. 制定月结时间表、责任分工和资料清单；2. 完成收入、成本、费用、税金、资产及往来核对；3. 审核原始凭证、会计科目、期间归属和审批链；4. 处理差异、暂估、计提、摊销与内部交易抵销；5. 试算平衡并编制资产负债表、利润表和现金流量表；6. 执行勾稽校验、异常复核和管理层审批；7. 按时归档底稿，并复盘关账效率与准确性。'},
    {category:'风险控制',title:'发现账实不符、凭证异常或税务风险时，你会如何处理？',competency:'风险控制',keywords:'核查，证据，合规，沟通，整改，留痕',referenceAnswer:'建议回答包含：1. 暂停相关入账或付款并保护原始资料；2. 核对合同、发票、审批、银行流水和业务证据；3. 判断差异原因、影响金额、涉及期间及税务合规风险；4. 与业务、财务负责人和必要的法务或税务人员沟通升级；5. 按权限完成更正、补充审批、纳税调整或追责；6. 保留完整处理记录和审计轨迹；7. 修订控制点并跟踪整改效果。'},
  ] : /设计/.test(role) ? [
    {category:'专业能力',title:'请介绍一个代表性设计项目，以及你如何平衡用户体验与业务目标。',competency:'设计能力',keywords:'用户需求，业务目标，方案，验证，结果',referenceAnswer:'建议回答包含：1. 说明目标用户、业务背景、核心问题和成功指标；2. 展示调研洞察、信息架构和关键设计原则；3. 说明方案探索、原型迭代及重要取舍；4. 描述与产品、研发和业务方的协作方式；5. 提供可用性验证、上线数据及业务或体验结果；6. 总结复盘和后续优化。'},
    {category:'协作能力',title:'面对需求频繁变化或多方审美分歧时，你如何推动设计决策？',competency:'设计协作',keywords:'目标，证据，沟通，取舍，推进',referenceAnswer:'建议回答包含：1. 重新对齐用户问题、业务目标和决策边界；2. 区分事实、偏好与约束，整理争议点；3. 使用用户研究、数据、设计原则和原型验证提供证据；4. 明确方案取舍、影响范围和优先级；5. 形成可追踪的决策记录、交付标准和后续验证计划。'},
  ] : [];
  return [...specialized,...common];
}

function generateGeneralInterviewQuestions(){
  return [
    {category:'自我认知',title:'请做一个简要的自我介绍，并重点说明与你应聘机会最相关的经历和优势。',competency:'自我认知',keywords:'经历概览，核心优势，岗位关联，表达重点',referenceAnswer:'建议回答包含：1. 用简洁结构概括教育与职业经历；2. 提炼两至三项与目标机会相关的核心能力；3. 用具体项目、职责或结果证明优势；4. 说明个人定位与下一阶段职业目标；5. 控制信息重点，避免简单复述简历。'},
    {category:'经历核验',title:'请介绍一段最能代表你工作能力的经历，并说明你个人承担了什么。',competency:'经历真实性',keywords:'背景，个人职责，关键行动，量化结果，复盘',referenceAnswer:'建议使用 STAR 结构回答：说明背景和目标，明确个人职责与决策边界，描述关键行动、协作和难点处理，提供可核验的结果，最后总结经验与改进。'},
    {category:'问题解决',title:'请介绍一次你遇到复杂问题或突发情况的经历，你是如何分析并解决的？',competency:'问题解决',keywords:'问题拆解，信息收集，判断依据，解决方案，结果',referenceAnswer:'建议回答包含：1. 描述问题现象、影响和约束；2. 说明信息收集与问题拆解方法；3. 展示关键判断依据和备选方案；4. 说明执行、风险控制与沟通过程；5. 提供结果及后续预防措施。'},
    {category:'协作沟通',title:'当你与同事或跨部门伙伴意见不一致时，通常如何推动事情继续向前？',competency:'协作沟通',keywords:'共同目标，倾听，证据，方案取舍，达成共识',referenceAnswer:'建议回答包含：1. 先对齐共同目标和决策边界；2. 主动理解各方诉求与约束；3. 用事实、数据或验证结果讨论分歧；4. 给出可执行的折中或分阶段方案；5. 明确责任、时间和后续复盘。'},
    {category:'执行能力',title:'面对多项并行任务和紧迫期限时，你如何安排优先级并保证交付？',competency:'计划执行',keywords:'目标，优先级，计划，风险，交付质量',referenceAnswer:'建议回答包含：1. 澄清目标、截止时间和质量标准；2. 按价值、紧急度、依赖关系和风险排序；3. 拆解里程碑并配置资源；4. 持续同步进度和风险；5. 通过检查、复盘和调整保证最终交付。'},
    {category:'学习成长',title:'请介绍一次你快速学习新知识或新技能，并将其应用到工作中的经历。',competency:'学习能力',keywords:'学习目标，学习方法，实践应用，成果，沉淀',referenceAnswer:'建议回答包含：1. 说明学习背景和实际目标；2. 展示资料选择、练习和反馈方法；3. 说明如何在真实任务中验证与应用；4. 提供效率、质量或业务结果；5. 总结形成的方法、工具或知识沉淀。'},
    {category:'复盘成长',title:'请介绍一次未达预期或犯错的经历，你如何处理并避免再次发生？',competency:'责任与复盘',keywords:'责任意识，原因分析，补救行动，机制改进，验证结果',referenceAnswer:'建议回答包含：1. 如实说明预期和偏差；2. 明确个人责任；3. 分析直接原因和系统性根因；4. 描述补救、沟通与风险控制；5. 给出流程、工具或习惯上的长期改进及验证结果。'},
    {category:'职业动机',title:'你选择下一份工作的主要考虑是什么？你希望在新的环境中取得怎样的成长？',competency:'职业动机',keywords:'选择标准，职业目标，成长方向，现实预期，稳定性',referenceAnswer:'建议回答包含：1. 说明真实、清晰的职业选择标准；2. 将个人能力和发展方向与机会联系起来；3. 描述希望承担的责任和取得的成果；4. 体现对工作环境、协作方式和成长节奏的合理预期；5. 避免空泛表态。'},
  ];
}

function combinedQuestionScores(general:DataRow[],specific:DataRow[]){
  if (!general.length) return normalizeQuestionScores(specific, 100);
  if (!specific.length) return normalizeQuestionScores(general, 100);
  return [...normalizeQuestionScores(general, 50), ...normalizeQuestionScores(specific, 50)];
}

function normalizeQuestionScores(rows:DataRow[],target:number){
  if (!rows.length) return [];
  const weights = rows.map(row => Math.max(1, Number(row.max_score) || 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const distributable = Math.max(0, target - rows.length);
  const raw = weights.map(value => value / total * distributable);
  const scores = raw.map(value => 1 + Math.floor(value));
  let remainder = target - scores.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({index, fraction:value - Math.floor(value)})).sort((a,b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) scores[order[index % order.length].index] += 1;
  return scores;
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function integer(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function truthy(value:unknown) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value ?? '').toLowerCase());
}

function createOfferContent(name: string, jobTitle: string, salary: string, deadline: string) {
  const date = new Date(`${deadline}T00:00:00`);
  const confirmBy = Number.isNaN(date.getTime()) ? deadline : new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'long', day:'numeric' }).format(date);
  return `尊敬的${name}：\n\n您好！我们诚挚邀请您加入星鉴人才，担任${jobTitle}一职，薪资方案为${salary}。请您于${confirmBy}前确认是否接受本次录用邀请。\n\n期待您的加入！`;
}

function createScheduledInterviewEmail(name:string, jobTitle:string, scheduledAt:string, endAt:string, round:string, mode:string, location:string, contactName:string, contactMethod:string) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone:'Asia/Shanghai', year:'numeric', month:'long', day:'numeric', weekday:'long', hour:'2-digit', minute:'2-digit', hour12:false,
  });
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit', hour12:false });
  const start = formatter.format(new Date(scheduledAt));
  const end = timeFormatter.format(new Date(endAt));
  return `尊敬的${name}：\n\n您好！感谢您对“${jobTitle}”岗位的关注。现诚挚邀请您参加${round}。\n\n面试时间：${start}—${end}\n面试方式：${mode}\n面试地点/会议地址：${location}\n联系人：${contactName || '招聘负责人'}${contactMethod ? `（${contactMethod}）` : ''}\n\n请您提前做好准备并准时参加。如时间安排有冲突，请及时与我们联系。\n\n星鉴人才`;
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
