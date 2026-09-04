import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest } from '@/app/server/db';
import { extractResumeFileText } from '@/app/server/resume-file-text';
import { getResumeJobs } from '@/app/server/resume-jobs';
import { buildSystemResumeJob, matchResumeJob, parseResumeFileName, parseResumeText, scoreResumeForJob } from '@/app/server/resume-parser';

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

  let rawText = field(form, 'rawText', 120_000);
  if (file) {
    const extraction = await extractResumeFileText(file);
    if (extraction.text) rawText = extraction.text;
    else if (!rawText) return NextResponse.json({ ok: false, message: extraction.message, recoverable: true }, { status: 422 });
  }
  if (!rawText) return invalid('请选择简历文件，或粘贴需要解析的简历原文。');

  let parsed = parseResumeText(rawText);
  if (file) {
    const fallback = parseResumeFileName(file.name);
    parsed = { ...parsed, name: fallback.name || parsed.name, role: fallback.role || parsed.role };
  }
  const initialRecognized = recognizedCount(parsed);
  if (!initialRecognized) return invalid('未能从简历中识别有效信息，请检查文本内容后重试。');

  const jobs = await getResumeJobs(account.id);
  const selectedJobId = field(form, 'jobId', 80);
  const selectedJob = selectedJobId ? jobs.find(job => job.id === selectedJobId) : null;
  if (selectedJobId && !selectedJob) return invalid('所选关联岗位不存在，请刷新后重试。');
  let suggestedJob = selectedJob
    ? { ...selectedJob, confidence: 100, reason: '已选择关联岗位' }
    : matchResumeJob(parsed.role, rawText, jobs);
  let willCreateJob = false;
  if (!suggestedJob && parsed.role) {
    suggestedJob = { ...buildSystemResumeJob(parsed.role, '', parsed.city), confidence: 100, reason: '未找到现有岗位，提交后将自动新建并配置系统初筛规则' };
    willCreateJob = true;
  }
  if (!parsed.role && suggestedJob) parsed = { ...parsed, role: suggestedJob.title };
  const match = suggestedJob ? scoreResumeForJob(parsed, rawText, suggestedJob) : null;
  return NextResponse.json({ ok: true, parsed, recognized: recognizedCount(parsed), suggestedJob, match, willCreateJob });
}

function field(form: FormData, key: string, max: number) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function extension(name: string) { return name.split('.').pop()?.toLowerCase() || ''; }
function invalid(message: string) { return NextResponse.json({ ok: false, message }, { status: 400 }); }

function recognizedCount(parsed: object) {
  return Object.values(parsed).filter(value => Array.isArray(value) ? value.length > 0 : value !== '' && value !== null).length;
}
