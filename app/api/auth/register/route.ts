import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { isMainlandMobile, isStrongPassword, isValidEmail, normalizeIdentifier } from '@/app/auth-rules';
import { createPasswordHash, ensureSchema, getDb } from '@/app/server/db';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const contact = String(body?.contact ?? '').trim();
  const phone = String(body?.phone ?? '').trim();
  const email = normalizeIdentifier(String(body?.email ?? ''));
  const password = String(body?.password ?? '');
  const role = body?.role === 'super_admin' ? 'super_admin' : body?.role === 'hr' ? 'hr' : '';
  const requestUrl = new URL(request.url);
  const runtime = env as unknown as { APP_ENV?: string };
  const testEnvironment = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname) || ['test', 'development'].includes(runtime.APP_ENV || '');

  if (testEnvironment) {
    if (!/^\d{11}$/.test(phone)) return failure('手机号必须为 11 位数字。');
  } else {
    if (!contact || contact.length > 40) return failure('请输入正确的姓名。');
    if (!isMainlandMobile(phone)) return failure('手机号格式不正确，请输入 1 开头的 11 位中国大陆手机号。');
    if (!isValidEmail(email)) return failure('邮箱格式不正确，请检查邮箱名称和域名。');
    if (!isStrongPassword(password)) return failure('密码需为 8–20 位，且同时包含字母和数字，不能包含空格。');
  }
  if (!role) return failure('请选择注册角色。');

  await ensureSchema();
  const storedEmail = testEnvironment ? `test-${phone}@local.invalid` : email;
  const existing = testEnvironment
    ? await getDb().prepare('SELECT id FROM accounts WHERE phone = ? LIMIT 1').bind(phone).first()
    : await getDb().prepare('SELECT id FROM accounts WHERE phone = ? OR email = ? LIMIT 1').bind(phone, email).first();
  if (existing) return failure('该手机号或邮箱已注册，请直接登录。', 409);

  const now = new Date().toISOString();
  const accountId=crypto.randomUUID();
  const organizationId=accountId;
  const db=getDb();
  await db.batch([
    db.prepare(`INSERT INTO accounts (id, contact, phone, email, password_hash, role, organization_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(accountId, contact, phone, storedEmail, await createPasswordHash(password), role, organizationId, now),
    db.prepare(`INSERT INTO organizations (id, name, owner_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).bind(organizationId, `${contact||'新注册账号'}的企业`, accountId, now, now),
  ]);
  return NextResponse.json({ ok: true, identifier: testEnvironment ? phone : email, role }, { status: 201 });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}
