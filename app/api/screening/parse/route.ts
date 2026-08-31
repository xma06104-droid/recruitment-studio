import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest, getDb } from '@/app/server/db';
import { extractResumeFileText } from '@/app/server/resume-file-text';
import { matchResumeJob, parseResumeText, ResumeJob } from '@/app/server/resume-parser';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedExtensions = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp', 'txt', 'html', 'htm'];

export async function POST(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return NextResponse.json({ ok: false, message: '登录状态已失效，请重新登录。' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return invalid('简历内容无法读取，请重新选择文件。');

  const fileValue = form.get('resume');
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  if (file && file.size > MAX_FILE_SIZE) return invalid('简历附件不能超过 10MB。');
  if (file && !allowedExtensions.includes(extension(file.name))) return invalid('仅支持 PDF、Word、图片、TXT 和 HTML 简历。');

  let rawText = field(form, 'rawText', 50_000);
  if (file) {
    const extraction = await extractResumeFileText(file);
    if (extraction.text) rawText = extraction.text;
    else if (!rawText) return NextResponse.json({ ok: false, message: extraction.message, recoverable: true }, { status: 422 });
  }
  if (!rawText) return invalid('请选择简历文件，或粘贴需要解析的简历原文。');

  const parsed = parseResumeText(rawText);
  const recognized = Object.entries(parsed).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value !== '' && value !== null).length;
  if (!recognized) return invalid('未能从简历中识别有效信息，请检查文本内容后重试。');
  const jobRows = await getDb().prepare('SELECT id, title FROM jobs WHERE owner_id = ? ORDER BY updated_at DESC').bind(account.id).all<ResumeJob>();
  const suggestedJob = matchResumeJob(parsed.role, rawText, jobRows.results || []);
  return NextResponse.json({ ok: true, parsed, recognized, suggestedJob });
}

function field(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function extension(name: string) { return name.split('.').pop()?.toLowerCase() || ''; }
function invalid(message: string) { return NextResponse.json({ ok: false, message }, { status: 400 }); }
