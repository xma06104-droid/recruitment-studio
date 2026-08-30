import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, ensureSchema, getDb } from '@/app/server/db';

type DataRow = Record<string, string | number | null>;

export async function GET(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  await ensureSchema();
  const db = getDb();
  const [jobs, candidates, interviews, offers, aiQuestions, aiInterviews] = await Promise.all([
    db.prepare('SELECT * FROM jobs WHERE owner_id = ? ORDER BY created_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM candidates WHERE owner_id = ? ORDER BY created_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM interviews WHERE owner_id = ? ORDER BY scheduled_at ASC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM offers WHERE owner_id = ? ORDER BY created_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM ai_questions WHERE owner_id = ? ORDER BY created_at DESC').bind(account.id).all<DataRow>(),
    db.prepare('SELECT * FROM ai_interviews WHERE owner_id = ? ORDER BY COALESCE(completed_at, created_at) DESC').bind(account.id).all<DataRow>(),
  ]);
  return NextResponse.json({
    account,
    jobs: jobs.results.map(mapJob),
    candidates: candidates.results.map(mapCandidate),
    interviews: interviews.results.map(mapInterview),
    offers: offers.results.map(mapOffer),
    aiQuestions: aiQuestions.results.map(mapAiQuestion),
    aiInterviews: aiInterviews.results.map(mapAiInterview),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return unauthorized();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const resource = text(body?.resource, 40);
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {};
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const db = getDb();

  if (resource === 'job') {
    const title = text(payload.title, 100);
    const department = text(payload.department, 80);
    if (!title || !department) return invalid('请填写职位名称和所属部门。');
    await db.prepare(`INSERT INTO jobs (id, owner_id, title, department, city, status, headcount, owner_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '草稿', ?, ?, ?, ?)`).bind(id, account.id, title, department, text(payload.city, 80) || '待设置', integer(payload.headcount, 1, 999, 1), account.contact, now, now).run();
  } else if (resource === 'candidate') {
    const name = text(payload.name, 60);
    const role = text(payload.role, 100);
    if (!name || !role) return invalid('请填写候选人姓名和应聘职位。');
    const jobId = text(payload.jobId, 80) || null;
    if (jobId && !(await ownedRecord('jobs', jobId, account.id))) return invalid('所选职位不存在。');
    const skills = list(payload.skills).slice(0, 12);
    await db.prepare(`INSERT INTO candidates (id, owner_id, job_id, name, role, company, years, stage, source, skills_json, score, phone, email, city, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '待初筛', ?, ?, NULL, ?, ?, ?, ?, ?)`).bind(id, account.id, jobId, name, role, text(payload.company, 100), text(payload.years, 40), text(payload.source, 80), JSON.stringify(skills), text(payload.phone, 30), text(payload.email, 120), text(payload.city, 80), now, now).run();
  } else if (resource === 'interview') {
    const candidateId = text(payload.candidateId, 80);
    if (!candidateId || !(await ownedRecord('candidates', candidateId, account.id))) return invalid('请选择有效候选人。');
    const scheduledAt = text(payload.scheduledAt, 80);
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return invalid('请选择有效的面试日期和时间。');
    await db.prepare(`INSERT INTO interviews (id, owner_id, candidate_id, scheduled_at, round, mode, interviewer, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '待确认', ?, ?)`).bind(id, account.id, candidateId, new Date(scheduledAt).toISOString(), text(payload.round, 80) || '业务一面', text(payload.mode, 100) || '待确认', account.contact, now, now).run();
  } else if (resource === 'offer') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await db.prepare('SELECT role FROM candidates WHERE id = ? AND owner_id = ?').bind(candidateId, account.id).first<{ role: string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    const salary = text(payload.salary, 80);
    const deadline = text(payload.deadline, 40);
    if (!salary || !deadline || Number.isNaN(Date.parse(deadline))) return invalid('请填写薪资方案和有效截止日期。');
    await db.prepare(`INSERT INTO offers (id, owner_id, candidate_id, job_title, salary, owner_name, status, deadline, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '待审批', ?, ?, ?)`).bind(id, account.id, candidateId, text(payload.jobTitle, 100) || candidate.role, salary, account.contact, deadline, now, now).run();
  } else if (resource === 'aiQuestion') {
    const title = text(payload.title, 500);
    if (!title) return invalid('请输入面试问题。');
    await db.prepare(`INSERT INTO ai_questions (id, owner_id, title, category, question_type, duration, competency, follow_up, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, account.id, title, text(payload.category, 80) || '通用素质', text(payload.questionType, 40) || '语音提问', integer(payload.duration, 30, 900, 120), text(payload.competency, 80) || '综合能力', payload.followUp ? 1 : 0, now, now).run();
  } else if (resource === 'aiInterview') {
    const candidateId = text(payload.candidateId, 80);
    const candidate = candidateId ? await db.prepare('SELECT role FROM candidates WHERE id = ? AND owner_id = ?').bind(candidateId, account.id).first<{ role: string }>() : null;
    if (!candidate) return invalid('请选择有效候选人。');
    const score = integer(payload.score, 0, 100, -1);
    const summary = text(payload.summary, 4000);
    if (score < 0 || !summary) return invalid('请填写真实面试得分和总结。');
    await db.batch([
      db.prepare(`INSERT INTO ai_interviews (id, owner_id, candidate_id, job_title, status, score, duration_seconds, summary, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, '已完成', ?, ?, ?, ?, ?, ?)`).bind(id, account.id, candidateId, text(payload.jobTitle, 100) || candidate.role, score, integer(payload.durationMinutes, 1, 600, 1) * 60, summary, now, now, now),
      db.prepare('UPDATE candidates SET score = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(score, now, candidateId, account.id),
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
  const id = text(body?.id, 80);
  const value = text(body?.value, 80);
  if (!id || !value) return invalid('缺少更新内容。');
  const now = new Date().toISOString();
  const db = getDb();
  const configs: Record<string, { table: string; field: string; allowed: string[] }> = {
    candidateStage: { table: 'candidates', field: 'stage', allowed: ['待初筛', '待复核', '面试待安排', 'AI 初面待发起', '初筛淘汰', '淘汰人才库', '待沟通', '一面', '技术面', '二面', 'Offer', '已入职', '已淘汰'] },
    jobStatus: { table: 'jobs', field: 'status', allowed: ['草稿', '招聘中', '急聘', '已暂停', '已关闭'] },
    interviewStatus: { table: 'interviews', field: 'status', allowed: ['待确认', '已确认', '已完成', '已取消'] },
    offerStatus: { table: 'offers', field: 'status', allowed: ['待审批', '已发放', '已接受', '已拒绝', '已撤回'] },
  };
  const config = configs[resource];
  if (!config || !config.allowed.includes(value)) return invalid('更新状态无效。');
  await db.prepare(`UPDATE ${config.table} SET ${config.field} = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(value, now, id, account.id).run();
  return NextResponse.json({ ok: true });
}

async function ownedRecord(table: 'jobs' | 'candidates', id: string, ownerId: string) {
  return Boolean(await getDb().prepare(`SELECT id FROM ${table} WHERE id = ? AND owner_id = ?`).bind(id, ownerId).first());
}

function mapJob(row: DataRow) {
  return { id: row.id, title: row.title, department: row.department, city: row.city, status: row.status, headcount: row.headcount, ownerName: row.owner_name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapCandidate(row: DataRow) {
  let skills: string[] = [];
  try { skills = JSON.parse(String(row.skills_json || '[]')); } catch {}
  return { id: row.id, jobId: row.job_id, name: row.name, role: row.role, company: row.company, years: row.years, stage: row.stage, source: row.source, skills, score: row.score, phone: row.phone, email: row.email, city: row.city, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapInterview(row: DataRow) {
  return { id: row.id, candidateId: row.candidate_id, scheduledAt: row.scheduled_at, round: row.round, mode: row.mode, interviewer: row.interviewer, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapOffer(row: DataRow) {
  return { id: row.id, candidateId: row.candidate_id, jobTitle: row.job_title, salary: row.salary, ownerName: row.owner_name, status: row.status, deadline: row.deadline, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAiQuestion(row: DataRow) {
  return { id: row.id, title: row.title, category: row.category, questionType: row.question_type, duration: row.duration, competency: row.competency, followUp: Boolean(row.follow_up), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAiInterview(row: DataRow) {
  return { id: row.id, candidateId: row.candidate_id, jobTitle: row.job_title, status: row.status, score: row.score, durationSeconds: row.duration_seconds, summary: row.summary, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function integer(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
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
