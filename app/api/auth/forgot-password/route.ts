import { NextRequest, NextResponse } from 'next/server';
import { isMainlandMobile, isStrongPassword, isValidEmail, normalizeIdentifier } from '@/app/auth-rules';
import { createPasswordHash, ensureSchema, getDb, verifyPassword } from '@/app/server/db';

type ResetAccount = { id: string; password_hash: string };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const phone = String(body?.phone ?? '').trim();
  const email = normalizeIdentifier(String(body?.email ?? ''));
  const password = String(body?.password ?? '');
  const confirmPassword = String(body?.confirmPassword ?? '');

  if (!isMainlandMobile(phone)) return failure('请输入正确的手机号');
  if (!isValidEmail(email)) return failure('请输入正确的邮箱地址。');
  if (!isStrongPassword(password)) return failure('新密码需为 8–20 位，且同时包含字母和数字，不能包含空格。');
  if (password !== confirmPassword) return failure('两次输入的新密码不一致。');

  await ensureSchema();
  const db = getDb();
  const account = await db.prepare('SELECT id, password_hash FROM accounts WHERE phone = ? AND email = ? LIMIT 1')
    .bind(phone, email).first<ResetAccount>();
  if (!account) return failure('账号信息核验失败，请确认手机号和邮箱均为注册时填写的信息。', 404);
  if (await verifyPassword(password, account.password_hash)) return failure('新密码不能与原登录密码相同。');

  await db.batch([
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').bind(await createPasswordHash(password), account.id),
    db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id),
  ]);

  return NextResponse.json({ ok: true, message: '密码已重置，请使用新密码登录。' });
}

function failure(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}
