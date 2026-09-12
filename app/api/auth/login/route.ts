import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
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

type LoginRow = { id: string; password_hash: string; role:'super_admin'|'hr'|'none' };

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const identifier = normalizeIdentifier(String(body?.identifier ?? ''));
  const password = String(body?.password ?? '');
  const remember = body?.remember === true;
  const requestedRole = body?.loginRole === 'hr' ? 'hr' : 'super_admin';
  const requestUrl = new URL(request.url);
  const runtime = env as unknown as { APP_ENV?: string };
  const testEnvironment = ['localhost', '127.0.0.1', '::1'].includes(requestUrl.hostname) || ['test', 'development'].includes(runtime.APP_ENV || '');
  const validIdentifier = testEnvironment ? /^\d{11}$/.test(identifier) : isValidIdentifier(identifier);
  if (!validIdentifier || (!testEnvironment && !password)) return failure();

  await ensureSchema();
  const account = await getDb().prepare('SELECT id, password_hash, role FROM accounts WHERE phone = ? OR email = ? LIMIT 1').bind(identifier, identifier).first<LoginRow>();
  if (!account || !(await verifyPassword(password, account.password_hash))) return failure();
  if (account.role === 'none') return failure('账号尚未分配系统角色，请联系超级管理员。', 403);
  if (requestedRole === 'super_admin' && account.role !== 'super_admin') {
    return failure('该账号没有超级管理员权限，请切换至 HR 入口登录。', 403);
  }

  const token = createSessionToken();
  const now = new Date().toISOString();
  await getDb().batch([
    getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    getDb().prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await hashToken(token), account.id, sessionExpiry(), now),
  ]);
  const response = NextResponse.json({ ok: true, role:account.role, entryRole:requestedRole });
  response.cookies.set(sessionCookie(), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    ...(remember ? { maxAge: sessionMaxAge() } : {}),
    path: '/',
  });
  return response;
}

function failure(message = '账号或密码错误，请检查后重新输入。', status = 401) {
  return NextResponse.json({ ok: false, message }, { status });
}
