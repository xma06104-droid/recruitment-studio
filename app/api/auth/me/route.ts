import { NextRequest, NextResponse } from 'next/server';
import { accountFromRequest } from '@/app/server/db';

export async function GET(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, account });
}
