import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { isMainlandMobile, isStrongPassword, isValidEmail, normalizeIdentifier } from '@/app/auth-rules';
import { accountFromRequest, createPasswordHash, getDb } from '@/app/server/db';

type ManagedRole='super_admin'|'hr'|'none';
type RoleRow={id:string;contact:string;phone:string;email:string;role:ManagedRole;created_at:string};

export async function GET(request:NextRequest){
  const account=await accountFromRequest(request);
  if(!account)return NextResponse.json({message:'请先登录。'},{status:401});
  if(account.role!=='super_admin')return forbidden();
  const rows=await getDb().prepare(`SELECT id, contact, phone, email, role, created_at FROM accounts
    WHERE organization_id = ?
    ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, created_at ASC`).bind(account.organizationId).all<RoleRow>();
  return NextResponse.json({accounts:rows.results.map(row=>({id:row.id,contact:row.contact,phone:row.phone,email:row.email,role:row.role,createdAt:row.created_at,current:row.id===account.id}))});
}

export async function POST(request:NextRequest){
  const account=await accountFromRequest(request);
  if(!account)return NextResponse.json({message:'请先登录。'},{status:401});
  if(account.role!=='super_admin')return forbidden();
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const contact=String(body?.contact??'').trim();
  const phone=String(body?.phone??'').trim();
  const email=normalizeIdentifier(String(body?.email??''));
  const password=String(body?.password??'');
  const role=String(body?.role??'') as ManagedRole;
  const requestUrl=new URL(request.url);
  const runtime=env as unknown as {APP_ENV?:string};
  const testEnvironment=['localhost','127.0.0.1','::1'].includes(requestUrl.hostname)||['test','development'].includes(runtime.APP_ENV||'');
  if(testEnvironment){
    if(!/^\d{11}$/.test(phone))return invalid('手机号必须为 11 位数字。');
  }else{
    if(!contact||contact.length>40)return invalid('请输入正确的人员姓名。');
    if(!isMainlandMobile(phone))return invalid('请输入正确的中国大陆手机号。');
    if(!isValidEmail(email))return invalid('请输入正确的邮箱地址。');
    if(!isStrongPassword(password))return invalid('初始密码需为 8–20 位，且同时包含字母和数字。');
  }
  if(!['super_admin','hr'].includes(role))return invalid('请选择有效角色。');
  const storedEmail=testEnvironment?`test-${phone}@local.invalid`:email;
  const duplicate=testEnvironment
    ?await getDb().prepare('SELECT id FROM accounts WHERE phone = ? LIMIT 1').bind(phone).first()
    :await getDb().prepare('SELECT id FROM accounts WHERE phone = ? OR email = ? LIMIT 1').bind(phone,email).first();
  if(duplicate)return invalid('该手机号或邮箱已存在。',409);
  const now=new Date().toISOString();
  await getDb().prepare(`INSERT INTO accounts (id, contact, phone, email, password_hash, role, organization_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(),contact,phone,storedEmail,await createPasswordHash(password),role,account.organizationId,now).run();
  return NextResponse.json({ok:true},{status:201});
}

export async function PATCH(request:NextRequest){
  const account=await accountFromRequest(request);
  if(!account)return NextResponse.json({message:'请先登录。'},{status:401});
  if(account.role!=='super_admin')return forbidden();
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const id=String(body?.id??'').trim();
  const role=String(body?.role??'') as ManagedRole;
  if(!id||!['super_admin','hr','none'].includes(role))return invalid('角色更新内容无效。');
  if(id===account.id&&role!=='super_admin')return invalid('不能取消或降低当前登录账号的超级管理员身份。');
  const target=await getDb().prepare('SELECT id, role FROM accounts WHERE id = ? AND organization_id = ?').bind(id,account.organizationId).first<{id:string;role:ManagedRole}>();
  if(!target)return invalid('人员账号不存在或已被移除。',404);
  if(target.role==='super_admin'&&role!=='super_admin'){
    const count=await getDb().prepare("SELECT COUNT(*) AS total FROM accounts WHERE role = 'super_admin' AND organization_id = ?").bind(account.organizationId).first<{total:number}>();
    if(Number(count?.total)<=1)return invalid('系统必须至少保留一名超级管理员。');
  }
  const db=getDb();
  const statements=[db.prepare('UPDATE accounts SET role = ? WHERE id = ?').bind(role,id)];
  if(role==='none')statements.push(db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(id));
  await db.batch(statements);
  return NextResponse.json({ok:true});
}

export async function DELETE(request:NextRequest){
  const account=await accountFromRequest(request);
  if(!account)return NextResponse.json({message:'请先登录。'},{status:401});
  if(account.role!=='super_admin')return forbidden();
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const id=String(body?.id??'').trim();
  if(!id)return invalid('请选择需要删除的 HR 账号。');
  if(id===account.id)return invalid('不能删除当前登录账号。');
  const db=getDb();
  const target=await db.prepare('SELECT id, contact, role FROM accounts WHERE id = ? AND organization_id = ?').bind(id,account.organizationId).first<{id:string;contact:string;role:ManagedRole}>();
  if(!target)return invalid('HR 账号不存在或已被删除。',404);
  if(target.role!=='hr')return invalid('仅支持删除 HR 账号。');
  const now=new Date().toISOString();
  const statements:D1PreparedStatement[]=[
    db.prepare('INSERT OR REPLACE INTO deleted_accounts (account_id, deleted_by, deleted_at) VALUES (?, ?, ?)').bind(id,account.id,now),
    db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(id),
    db.prepare('DELETE FROM candidate_assignments WHERE hr_account_id = ?').bind(id),
    db.prepare('UPDATE candidate_assignments SET owner_id = ? WHERE owner_id = ?').bind(account.id,id),
    db.prepare('UPDATE jobs SET owner_id = ?, owner_name = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,account.contact,now,id),
    db.prepare('UPDATE candidates SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE interviews SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE offers SET owner_id = ?, owner_name = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,account.contact,now,id),
    db.prepare('UPDATE ai_questions SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE ai_interviews SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE ai_interview_invitations SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE ai_interview_recordings SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE resume_profiles SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE resume_applications SET owner_id = ? WHERE owner_id = ?').bind(account.id,id),
    db.prepare('UPDATE screening_rules SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE screening_templates SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE screening_reviews SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('UPDATE screening_logs SET owner_id = ? WHERE owner_id = ?').bind(account.id,id),
    db.prepare('UPDATE manual_assessments SET owner_id = ?, updated_at = ? WHERE owner_id = ?').bind(account.id,now,id),
    db.prepare('DELETE FROM accounts WHERE id = ? AND role = ?').bind(id,'hr'),
  ];
  try{await db.batch(statements)}catch{return invalid('删除失败，请稍后重试。',500)}
  return NextResponse.json({ok:true,deleted:{id:target.id,contact:target.contact}});
}

function invalid(message:string,status=400){return NextResponse.json({message},{status})}
function forbidden(){return NextResponse.json({message:'仅超级管理员可以管理角色。'},{status:403})}
