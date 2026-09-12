import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, ensureSchema, getDb, getResumeBucket } from '@/app/server/db';

type RecordingRow = { object_key:string; content_type:string; size_bytes:number };

export async function GET(request:NextRequest, context:{ params:Promise<{id:string}> }) {
  const account = await accountFromRequest(request);
  if (!account) return NextResponse.json({ ok:false, message:'请先登录。' }, { status:401 });
  await ensureSchema();
  const { id } = await context.params;
  const row = await getDb().prepare(`SELECT r.object_key, r.content_type, r.size_bytes
    FROM ai_interview_recordings r
    LEFT JOIN candidate_assignments ca ON ca.candidate_id = r.candidate_id
    WHERE r.id = ? AND (r.owner_id = ? OR ca.hr_account_id = ?) LIMIT 1`).bind(id, account.id, account.id).first<RecordingRow>();
  if (!row) return NextResponse.json({ ok:false, message:'录像不存在或没有查看权限。' }, { status:404 });
  const bucket = getResumeBucket();
  const metadata = await bucket.head(row.object_key);
  if (!metadata) return NextResponse.json({ ok:false, message:'录像文件不存在。' }, { status:404 });
  const total = metadata.size || Number(row.size_bytes || 0);
  const range = parseRange(request.headers.get('range'), total);
  const object = await bucket.get(row.object_key, range ? { range:{ offset:range.start, length:range.end-range.start+1 } } : undefined);
  if (!object) return NextResponse.json({ ok:false, message:'录像文件不存在。' }, { status:404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', row.content_type || headers.get('Content-Type') || 'video/webm');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('ETag', object.httpEtag);
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
    headers.set('Content-Length', String(range.end-range.start+1));
    return new Response(object.body, { status:206, headers });
  }
  headers.set('Content-Length', String(total));
  return new Response(object.body, { status:200, headers });
}

function parseRange(value:string|null,total:number){
  if(!value||!total)return null;
  const match=value.match(/^bytes=(\d*)-(\d*)$/);
  if(!match)return null;
  let start=match[1]?Number(match[1]):0;
  let end=match[2]?Number(match[2]):total-1;
  if(!match[1]&&match[2]){const suffix=Math.min(total,Number(match[2]));start=total-suffix;end=total-1;}
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=total||end<start)return null;
  return {start,end:Math.min(end,total-1)};
}
