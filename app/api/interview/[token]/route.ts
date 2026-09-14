import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { ensureSchema, getDb, hashToken, invitationIdFromShareToken } from '@/app/server/db';
import { contextualizeSpeechTranscript } from '@/app/speech-context';
import { questionMaxScores, weightedQuestionScore } from '@/app/interview-score-weights';

type Question = {
  id:string; title:string; duration:number; questionType:string; competency:string;
  keywords:string; referenceAnswer:string;
};
type InvitationRow = {
  id:string; owner_id:string; candidate_id:string; recipient_email:string; job_title:string;
  questions_json:string; status:string; expires_at:string; name:string; role:string; skills_json:string;
};

export async function GET(_request:NextRequest, context:{ params:Promise<{ token:string }> }) {
  await ensureSchema();
  const credentials=env as unknown as { TENCENT_SECRET_ID?:string;TENCENT_SECRET_KEY?:string;OPENAI_API_KEY?:string };
  const { token } = await context.params;
  const invitation = await invitationForToken(token);
  if (!invitation) return failure('面试地址无效或已被重新发送。', 404);
  if (Date.parse(invitation.expires_at) < Date.now()) {
    const now = new Date().toISOString();
    await getDb().batch([
      getDb().prepare(`UPDATE ai_interview_invitations SET status = '已超时', updated_at = ? WHERE id = ?`).bind(now, invitation.id),
      getDb().prepare(`UPDATE candidates SET stage = 'AI面试', updated_at = ?
        WHERE id = ? AND owner_id = ? AND stage IN ('AI面试', 'AI 初面待发起', '已发起AI面试邀请')`).bind(now, invitation.candidate_id, invitation.owner_id),
    ]);
    return failure('面试地址已过期，请联系招聘负责人重新发送。', 410);
  }
  if (invitation.status === '已失效') return failure('面试地址已失效，请使用最新邮件中的地址。', 410);
  const now = new Date().toISOString();
  if (!invitation.status.includes('完成')) {
    await getDb().prepare(`UPDATE ai_interview_invitations SET status = '进行中', opened_at = COALESCE(opened_at, ?), updated_at = ? WHERE id = ?`)
      .bind(now, now, invitation.id).run();
  }
  const questions = parseQuestions(invitation.questions_json).map(({ id, title, duration, questionType, competency }) => ({ id, title, duration, questionType, competency }));
  return NextResponse.json({
    ok:true,
    invitation:{ id:invitation.id, candidateName:invitation.name, jobTitle:invitation.job_title, status:invitation.status, expiresAt:invitation.expires_at },
    questions,
    serverTranscription:Boolean((credentials.TENCENT_SECRET_ID&&credentials.TENCENT_SECRET_KEY)||credentials.OPENAI_API_KEY),
  }, { headers:{ 'Cache-Control':'private, no-store' } });
}

export async function POST(request:NextRequest, context:{ params:Promise<{ token:string }> }) {
  await ensureSchema();
  const { token } = await context.params;
  const invitation = await invitationForToken(token);
  if (!invitation) return failure('面试地址无效或已被重新发送。', 404);
  if (Date.parse(invitation.expires_at) < Date.now() || ['已超时', '已过期', '已失效'].includes(invitation.status)) return failure('面试地址已过期或失效。', 410);
  if (invitation.status === '已完成') return failure('本次面试已经提交，请勿重复提交。', 409);
  const body = await request.json().catch(() => null) as { answers?:unknown; durationSeconds?:unknown } | null;
  const questions = parseQuestions(invitation.questions_json);
  const submitted = Array.isArray(body?.answers) ? body.answers : [];
  const answerMap = new Map(submitted.slice(0, questions.length).map(item => {
    const entry = item && typeof item === 'object' ? item as Record<string,unknown> : {};
    return [String(entry.questionId || ''), String(entry.answer || '').trim()];
  }));
  if (!questions.length) return failure('本次面试未配置有效题目。', 400);
  const contextualAnswers = new Map(questions.map(question => [
    question.id,
    contextualizeSpeechTranscript(answerMap.get(question.id) || '', invitation.job_title, question),
  ]));
  const skills = jsonList(invitation.skills_json);
  const results = questions.map(question => scoreAnswer(contextualAnswers.get(question.id) || '', question, skills));
  const maxScores = questionMaxScores(questions.length);
  const weightedScores = results.map((result, index) => weightedQuestionScore(result.score, maxScores[index] || 1));
  const score = weightedScores.reduce((sum, value) => sum + value, 0);
  const details = questions.map((question, index) => {
    const answer = (contextualAnswers.get(question.id) || '未作答').replace(/\s+/g, ' ');
    return `${index + 1}. ${question.title}（得分 ${weightedScores[index]}/${maxScores[index]}）\n命中关键词：${results[index].matched.join('、') || '无'}\n回答：${answer}`;
  });
  const summary = [`AI 题目权重评分：综合 ${score}/100。评分依据各题满分、题目关键词、参考回答、题意与候选人技能综合生成。`, ...details].join('\n\n');
  const now = new Date().toISOString();
  const durationSeconds = clampNumber(body?.durationSeconds, 1, 21600, 60);
  const db = getDb();
  await db.batch([
    db.prepare(`INSERT INTO ai_interviews (id, owner_id, candidate_id, job_title, status, score, duration_seconds, summary, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, '已完成', ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), invitation.owner_id, invitation.candidate_id, invitation.job_title, score, durationSeconds, summary, now, now, now,
    ),
    db.prepare(`UPDATE ai_interview_invitations SET status = '已完成', completed_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, invitation.id),
    db.prepare(`UPDATE candidates SET score = ?, stage = 'AI面试', updated_at = ? WHERE id = ? AND owner_id = ?`).bind(score, now, invitation.candidate_id, invitation.owner_id),
    db.prepare(`UPDATE interviews SET status = '已完成', updated_at = ? WHERE candidate_id = ? AND owner_id = ? AND round = 'AI 初面' AND status NOT IN ('已完成', '已取消')`).bind(now, invitation.candidate_id, invitation.owner_id),
  ]);
  return NextResponse.json({ ok:true, completed:true });
}

async function invitationForToken(token:string) {
  const value = token.trim().slice(0, 200);
  if (!value) return null;
  const invitationId = await invitationIdFromShareToken(value);
  if (invitationId) return getDb().prepare(`SELECT i.*, c.name, c.role, c.skills_json
    FROM ai_interview_invitations i JOIN candidates c ON c.id = i.candidate_id AND c.owner_id = i.owner_id
    WHERE i.id = ? LIMIT 1`).bind(invitationId).first<InvitationRow>();
  return getDb().prepare(`SELECT i.*, c.name, c.role, c.skills_json
    FROM ai_interview_invitations i JOIN candidates c ON c.id = i.candidate_id AND c.owner_id = i.owner_id
    WHERE i.token_hash = ? LIMIT 1`).bind(await hashToken(value)).first<InvitationRow>();
}

function parseQuestions(value:string):Question[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object').map(item => ({
      id:String(item.id || ''), title:String(item.title || ''), duration:clampNumber(item.duration, 30, 900, 120),
      questionType:String(item.questionType || '语音提问'), competency:String(item.competency || ''),
      keywords:String(item.keywords || ''), referenceAnswer:String(item.referenceAnswer || ''),
    })).filter(item => item.id && item.title) : [];
  } catch { return []; }
}

function scoreAnswer(answer:string, question:Question, skills:string[]) {
  const configured = `${question.keywords}，${question.competency}`.split(/[,，、;；/|]/).map(item => item.trim()).filter(item => item.length >= 2);
  const keywords = [...new Set([...configured, ...skills.slice(0, 3)])].slice(0, 10);
  const normalized = answer.toLowerCase().replace(/\s+/g, '');
  const matched = keywords.filter(keyword => normalized.includes(keyword.toLowerCase().replace(/\s+/g, '')));
  if (!answer) return { score:0, matched };
  const coverage = matched.length / Math.max(1, keywords.length);
  const detail = Math.min(15, Math.floor(answer.length / 45) * 3);
  return { score:Math.min(100, Math.round(coverage * 85 + detail)), matched };
}

function jsonList(value:string) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function clampNumber(value:unknown, min:number, max:number, fallback:number) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback; }
function failure(message:string, status:number) { return NextResponse.json({ ok:false, message }, { status }); }
