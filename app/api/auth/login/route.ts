import { NextRequest, NextResponse } from 'next/server';
import { isValidIdentifier, normalizeIdentifier } from '@/app/auth-rules';
import {
  createSessionToken,
  ensureSchema,
  getDb,
  hashToken,
  sessionCookie,
  sessionExpiry,
  sessionMaxAge,
  verifyPassword,
} from '@/app/server/db';

type LoginRow = { id: string; password_hash: string };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const identifier = normalizeIdentifier(String(body?.identifier ?? ''));
  const password = String(body?.password ?? '');
  const remember = body?.remember === true;
  if (!isValidIdentifier(identifier) || !password) return failure();

  await ensureSchema();
  const account = await getDb().prepare('SELECT id, password_hash FROM accounts WHERE phone = ? OR email = ? LIMIT 1').bind(identifier, identifier).first<LoginRow>();
  if (!account || !(await verifyPassword(password, account.password_hash))) return failure();

  const token = createSessionToken();
  const now = new Date().toISOString();
  await getDb().batch([
    getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    getDb().prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await hashToken(token), account.id, sessionExpiry(), now),
  ]);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    ...(remember ? { maxAge: sessionMaxAge() } : {}),
    path: '/',
  });
  return response;
}

function failure() {
  return NextResponse.json({ ok: false, message: '账号或密码错误，请检查后重新输入。' }, { status: 401 });
}
