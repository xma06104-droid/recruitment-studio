import { NextRequest, NextResponse } from 'next/server';
import { isStrongPassword } from '@/app/auth-rules';
import { accountFromRequest, createPasswordHash, getDb, verifyPassword } from '@/app/server/db';

type AccountAction = {
  action?: 'profile' | 'password';
  contact?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

export async function PATCH(request: NextRequest) {
  const account = await accountFromRequest(request);
  if (!account) return NextResponse.json({ message: '登录状态已失效，请重新登录。' }, { status: 401 });

  const body = await request.json().catch(() => ({})) as AccountAction;
  const db = getDb();

  if (body.action === 'profile') {
    const contact = body.contact?.trim() ?? '';
    if (!contact) return NextResponse.json({ message: '请输入姓名。' }, { status: 400 });
    if (contact.length > 40) return NextResponse.json({ message: '姓名不能超过 40 个字符。' }, { status: 400 });

    await db.batch([
      db.prepare('UPDATE accounts SET contact = ? WHERE id = ?').bind(contact, account.id),
      db.prepare('UPDATE jobs SET owner_name = ?, updated_at = ? WHERE owner_id = ?').bind(contact, new Date().toISOString(), account.id),
      db.prepare('UPDATE interviews SET interviewer = ?, updated_at = ? WHERE owner_id = ?').bind(contact, new Date().toISOString(), account.id),
      db.prepare('UPDATE offers SET owner_name = ?, updated_at = ? WHERE owner_id = ?').bind(contact, new Date().toISOString(), account.id),
      db.prepare('UPDATE manual_assessments SET reviewer = ?, updated_at = ? WHERE owner_id = ?').bind(contact, new Date().toISOString(), account.id),
    ]);

    return NextResponse.json({
      ok: true,
      account: { ...account, contact },
    });
  }

  if (body.action === 'password') {
    const currentPassword = body.currentPassword ?? '';
    const newPassword = body.newPassword ?? '';
    const confirmPassword = body.confirmPassword ?? '';
    if (!currentPassword) return NextResponse.json({ message: '请输入当前密码。' }, { status: 400 });
    if (!isStrongPassword(newPassword)) return NextResponse.json({ message: '新密码需为 8-20 位，并同时包含字母和数字。' }, { status: 400 });
    if (newPassword !== confirmPassword) return NextResponse.json({ message: '两次输入的新密码不一致。' }, { status: 400 });
    if (newPassword === currentPassword) return NextResponse.json({ message: '新密码不能与当前密码相同。' }, { status: 400 });

    const row = await db.prepare('SELECT password_hash FROM accounts WHERE id = ?').bind(account.id).first<{ password_hash: string }>();
    if (!row || !await verifyPassword(currentPassword, row.password_hash)) {
      return NextResponse.json({ message: '当前密码不正确。' }, { status: 400 });
    }

    await db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').bind(await createPasswordHash(newPassword), account.id).run();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ message: '不支持的账号操作。' }, { status: 400 });
}
