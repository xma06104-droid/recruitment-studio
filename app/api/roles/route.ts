import { NextRequest, NextResponse } from 'next/server';
import { isMainlandMobile, isStrongPassword, isValidEmail, normalizeIdentifier } from '@/app/auth-rules';
import { accountFromRequest, createPasswordHash, getDb } from '@/app/server/db';

type ManagedRole='super_admin'|'hr'|'none';
type RoleRow={id:string;contact:string;phone:string;email:string;role:ManagedRole;created_at:string};

export async function GET(request:NextRequest){
  const account=await accountFromRequest(request);
  if(!account)return NextResponse.json({message:'请先登录。'},{status:401});
  if(account.role!=='super_admin')return forbidden();
  const rows=await getDb().prepare(`SELECT id, contact, phone, email, role, created_at FROM accounts
    ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, created_at ASC`).all<RoleRow>();
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
  if(!contact||contact.length>40)return invalid('请输入正确的人员姓名。');
  if(!isMainlandMobile(phone))return invalid('请输入正确的中国大陆手机号。');
  if(!isValidEmail(email))return invalid('请输入正确的邮箱地址。');
  if(!isStrongPassword(password))return invalid('初始密码需为 8–20 位，且同时包含字母和数字。');
  if(!['super_admin','hr'].includes(role))return invalid('请选择有效角色。');
  const duplicate=await getDb().prepare('SELECT id FROM accounts WHERE phone = ? OR email = ? LIMIT 1').bind(phone,email).first();
  if(duplicate)return invalid('该手机号或邮箱已存在。',409);
  const now=new Date().toISOString();
  await getDb().prepare(`INSERT INTO accounts (id, contact, phone, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(),contact,phone,email,await createPasswordHash(password),role,now).run();
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
  const target=await getDb().prepare('SELECT id, role FROM accounts WHERE id = ?').bind(id).first<{id:string;role:ManagedRole}>();
  if(!target)return invalid('人员账号不存在或已被移除。',404);
  if(target.role==='super_admin'&&role!=='super_admin'){
    const count=await getDb().prepare("SELECT COUNT(*) AS total FROM accounts WHERE role = 'super_admin'").first<{total:number}>();
    if(Number(count?.total)<=1)return invalid('系统必须至少保留一名超级管理员。');
  }
  const db=getDb();
  const statements=[db.prepare('UPDATE accounts SET role = ? WHERE id = ?').bind(role,id)];
  if(role==='none')statements.push(db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(id));
  await db.batch(statements);
  return NextResponse.json({ok:true});
}

function invalid(message:string,status=400){return NextResponse.json({message},{status})}
function forbidden(){return NextResponse.json({message:'仅超级管理员可以管理角色。'},{status:403})}
