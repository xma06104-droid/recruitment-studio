import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, getDb, getResumeBucket, hashToken, invitationIdFromShareToken } from '@/app/server/db';

type InvitationRow = {
  id:string; owner_id:string; candidate_id:string; questions_json:string; status:string; expires_at:string;
};

const MAX_RECORDING_BYTES = 80 * 1024 * 1024;

export async function POST(request:NextRequest, context:{ params:Promise<{token:string}> }) {
  await ensureSchema();
  const { token } = await context.params;
  const invitation = await invitationForToken(token);
  if (!invitation) return failure('面试地址无效或已被重新发送。', 404);
  if (Date.parse(invitation.expires_at) < Date.now() || ['已超时','已过期','已失效','已完成'].includes(invitation.status)) {
    return failure('当前面试已结束，无法继续上传音视频。', 410);
  }
  const form = await request.formData().catch(() => null);
  const recording = form?.get('recording');
  const questionId = String(form?.get('questionId') || '').trim().slice(0, 120);
  const durationSeconds = clampNumber(form?.get('durationSeconds'), 1, 900, 1);
  if (!(recording instanceof File) || recording.size < 512) return failure('没有收到有效的面试音视频。', 400);
  if (recording.size > MAX_RECORDING_BYTES) return failure('本题音视频文件过大，请联系招聘负责人。', 413);
  if (!recording.type.startsWith('audio/') && !recording.type.startsWith('video/')) return failure('音视频格式无效。', 415);
  const question = parseQuestions(invitation.questions_json).find(item => item.id === questionId);
  if (!question) return failure('面试题不存在或已更新。', 400);

  const extension = recordingExtension(recording.type);
  const objectKey = `ai-interviews/${invitation.owner_id}/${invitation.id}/${safeSegment(questionId)}.${extension}`;
  const now = new Date().toISOString();
  const db = getDb();
  const existing = await db.prepare('SELECT id, object_key FROM ai_interview_recordings WHERE invitation_id = ? AND question_id = ? LIMIT 1')
    .bind(invitation.id, questionId).first<{id:string;object_key:string}>();
  const recordingId = existing?.id || crypto.randomUUID();
  const bucket = getResumeBucket();
  await bucket.put(objectKey, recording.stream(), {
    httpMetadata:{ contentType:recording.type },
    customMetadata:{ invitationId:invitation.id, candidateId:invitation.candidate_id, questionId },
  });
  await db.prepare(`INSERT INTO ai_interview_recordings (
      id, invitation_id, owner_id, candidate_id, question_id, question_title, object_key,
      content_type, size_bytes, duration_seconds, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(invitation_id, question_id) DO UPDATE SET
      question_title = excluded.question_title,
      object_key = excluded.object_key,
      content_type = excluded.content_type,
      size_bytes = excluded.size_bytes,
      duration_seconds = excluded.duration_seconds,
      updated_at = excluded.updated_at`).bind(
      recordingId, invitation.id, invitation.owner_id, invitation.candidate_id, questionId, question.title,
      objectKey, recording.type, recording.size, durationSeconds, now, now,
    ).run();
  if(existing?.object_key&&existing.object_key!==objectKey)await bucket.delete(existing.object_key).catch(()=>undefined);
  return NextResponse.json({ ok:true, recordingId });
}

async function invitationForToken(token:string) {
  const value = token.trim().slice(0, 200);
  if (!value) return null;
  const invitationId = await invitationIdFromShareToken(value);
  if (invitationId) return getDb().prepare('SELECT id, owner_id, candidate_id, questions_json, status, expires_at FROM ai_interview_invitations WHERE id = ? LIMIT 1')
    .bind(invitationId).first<InvitationRow>();
  return getDb().prepare('SELECT id, owner_id, candidate_id, questions_json, status, expires_at FROM ai_interview_invitations WHERE token_hash = ? LIMIT 1')
    .bind(await hashToken(value)).first<InvitationRow>();
}

function parseQuestions(value:string):{id:string;title:string}[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => ({ id:String(item?.id || ''), title:String(item?.title || '') })).filter(item => item.id && item.title) : [];
  } catch { return []; }
}

function safeSegment(value:string) { return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || crypto.randomUUID(); }
function recordingExtension(type:string) { if(type.startsWith('video/')&&type.includes('mp4'))return 'mp4';if(type.includes('mp4'))return 'm4a';if(type.includes('ogg'))return 'ogg';if(type.includes('wav'))return 'wav';return 'webm'; }
function clampNumber(value:unknown, min:number, max:number, fallback:number) { const parsed=Number(value);return Number.isFinite(parsed)?Math.min(max,Math.max(min,Math.round(parsed))):fallback; }
function failure(message:string,status:number){return NextResponse.json({ok:false,message},{status});}
