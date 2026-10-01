import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, ensureSchema, getDb } from '@/app/server/db';
import { getStoredObject } from '@/app/server/object-storage';

export async function GET(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return NextResponse.json({ message: '请先登录。' }, { status: 401 });
  await ensureSchema();
  const candidateId = request.nextUrl.searchParams.get('candidateId')?.trim() || '';
  const row = await getDb().prepare(`SELECT p.file_key, p.file_name, p.file_type FROM resume_profiles p
    WHERE p.candidate_id = ? AND (
      p.owner_id = ? OR p.candidate_id IN (SELECT candidate_id FROM candidate_assignments WHERE hr_account_id = ?)
    )`).bind(candidateId, account.id, account.id).first<{ file_key: string | null; file_name: string; file_type: string }>();
  if (!row?.file_key) return NextResponse.json({ message: '该候选人没有原始简历附件。' }, { status: 404 });
  const object = await getStoredObject(row.file_key);
  if (!object) return NextResponse.json({ message: '原始简历附件不存在。' }, { status: 404 });
  const headers = new Headers(object.headers);
  headers.set('Content-Type', row.file_type || headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || 'resume')}`);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(object.body, { status: object.status, headers });
}
