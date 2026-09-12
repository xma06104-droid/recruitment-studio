import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, ensureSchema, getDb } from '@/app/server/db';

type RecordingRow = {
  id:string; question_id:string; question_title:string; content_type:string; size_bytes:number;
  duration_seconds:number; created_at:string;
};

export async function GET(request:NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return NextResponse.json({ ok:false, message:'请先登录。' }, { status:401 });
  await ensureSchema();
  const candidateId = String(new URL(request.url).searchParams.get('candidateId') || '').trim().slice(0, 120);
  if (!candidateId) return NextResponse.json({ ok:false, message:'请选择候选人。' }, { status:400 });
  const accessible = await getDb().prepare(`SELECT c.id FROM candidates c
    LEFT JOIN candidate_assignments ca ON ca.candidate_id = c.id
    WHERE c.id = ? AND (c.owner_id = ? OR ca.hr_account_id = ?) LIMIT 1`).bind(candidateId, account.id, account.id).first<{id:string}>();
  if (!accessible) return NextResponse.json({ ok:false, message:'没有权限查看该候选人的面试录像。' }, { status:403 });
  const rows = await getDb().prepare(`SELECT id, question_id, question_title, content_type, size_bytes, duration_seconds, created_at
    FROM ai_interview_recordings WHERE candidate_id = ? ORDER BY created_at ASC`).bind(candidateId).all<RecordingRow>();
  return NextResponse.json({ ok:true, recordings:rows.results.map(row => ({
    id:row.id, questionId:row.question_id, questionTitle:row.question_title, contentType:row.content_type,
    sizeBytes:Number(row.size_bytes || 0), durationSeconds:Number(row.duration_seconds || 0), createdAt:row.created_at,
    playbackUrl:`/api/interview-recordings/${encodeURIComponent(row.id)}`,
  })) }, { headers:{ 'Cache-Control':'private, no-store' } });
}
