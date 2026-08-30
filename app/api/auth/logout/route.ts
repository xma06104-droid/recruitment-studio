import { NextRequest, NextResponse } from 'next/server';
import { removeSession, sessionCookie } from '@/app/server/db';

export async function POST(request: NextRequest) {
  await removeSession(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(), '', { httpOnly: true, sameSite: 'lax', maxAge: 0, path: '/' });
  return response;
}
