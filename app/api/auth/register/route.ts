import { NextRequest, NextResponse } from 'next/server';
import { isMainlandMobile, isStrongPassword, isValidEmail, normalizeIdentifier } from '@/app/auth-rules';
import { createPasswordHash, ensureSchema, getDb } from '@/app/server/db';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const contact = String(body?.contact ?? '').trim();
  const phone = String(body?.phone ?? '').trim();
  const email = normalizeIdentifier(String(body?.email ?? ''));
  const password = String(body?.password ?? '');

  if (!contact || contact.length > 40) return failure('请输入正确的姓名。');
  if (!isMainlandMobile(phone)) return failure('手机号格式不正确，请输入 1 开头的 11 位中国大陆手机号。');
  if (!isValidEmail(email)) return failure('邮箱格式不正确，请检查邮箱名称和域名。');
  if (!isStrongPassword(password)) return failure('密码需为 8–20 位，且同时包含字母和数字，不能包含空格。');

  await ensureSchema();
  const existing = await getDb().prepare('SELECT id FROM accounts WHERE phone = ? OR email = ? LIMIT 1').bind(phone, email).first();
  if (existing) return failure('该手机号或邮箱已注册，请直接登录。', 409);

  const now = new Date().toISOString();
  await getDb().prepare(`INSERT INTO accounts (id, contact, phone, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?, 'none', ?)`).bind(crypto.randomUUID(), contact, phone, email, await createPasswordHash(password), now).run();
  return NextResponse.json({ ok: true, email }, { status: 201 });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}
