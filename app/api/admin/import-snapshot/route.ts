import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, getDb, getResumeBucket } from '@/app/server/db';

const ALLOWED_TABLES = new Set([
  'accounts','jobs','candidates','interviews','offers','ai_questions','ai_interviews',
  'ai_interview_invitations','resume_profiles','resume_applications','screening_rules',
  'screening_templates','screening_reviews','screening_logs',
]);

type ImportBody = {
  table?:string;
  rows?:Array<Record<string,unknown>>;
  ownerIdMap?:Record<string,string>;
  object?:{key?:string;contentType?:string;customMetadata?:Record<string,string>;dataBase64?:string};
};

export async function POST(request:NextRequest){
  const expected=(env as unknown as {MIGRATION_TOKEN?:string}).MIGRATION_TOKEN||'';
  const supplied=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
  if(!expected||supplied!==expected)return NextResponse.json({ok:false,message:'未授权'},{status:401});
  const body=await request.json().catch(()=>null) as ImportBody|null;
  if(!body)return NextResponse.json({ok:false,message:'迁移数据格式无效'},{status:400});
  if(body.object)return importObject(body.object);
  if(!body.table||!ALLOWED_TABLES.has(body.table)||!Array.isArray(body.rows)||body.rows.length>100){
    return NextResponse.json({ok:false,message:'迁移表或记录无效'},{status:400});
  }
  await ensureSchema();
  if(body.table==='accounts')return importAccounts(body.rows);
  const ownerIdMap=body.ownerIdMap||{};
  const rows=body.rows.map(row=>row.owner_id&&ownerIdMap[String(row.owner_id)]?{...row,owner_id:ownerIdMap[String(row.owner_id)]}:row);
  const imported=await importRows(body.table,rows);
  return NextResponse.json({ok:true,table:body.table,imported});
}

async function importAccounts(rows:Array<Record<string,unknown>>){
  const db=getDb();const idMap:Record<string,string>={};let imported=0;
  const columns=await tableColumns('accounts');
  for(const row of rows){
    const localId=String(row.id||'');if(!localId)continue;
    const existing=await db.prepare('SELECT id FROM accounts WHERE id = ? OR phone = ? OR email = ? LIMIT 1')
      .bind(localId,String(row.phone||''),String(row.email||'')).first<{id:string}>();
    const targetId=existing?.id||localId;idMap[localId]=targetId;
    const normalized={...row,id:targetId};
    await db.prepare(upsertSql('accounts',columns,['id'])).bind(...columns.map(column=>normalized[column]??null)).run();
    imported+=1;
  }
  return NextResponse.json({ok:true,table:'accounts',imported,idMap});
}

async function importRows(table:string,rows:Array<Record<string,unknown>>){
  if(!rows.length)return 0;
  const db=getDb();const columns=await tableColumns(table);const conflict=table==='resume_profiles'||table==='screening_reviews'?['candidate_id']:table==='screening_rules'?['owner_id','job_id']:table==='ai_interview_invitations'?['token_hash']:['id'];
  const sql=upsertSql(table,columns,conflict);
  for(let offset=0;offset<rows.length;offset+=40){
    const statements=rows.slice(offset,offset+40).map(row=>db.prepare(sql).bind(...columns.map(column=>row[column]??null)));
    await db.batch(statements);
  }
  return rows.length;
}

async function tableColumns(table:string){
  const result=await getDb().prepare(`PRAGMA table_info(${table})`).all<{name:string}>();
  return result.results.map(column=>column.name).filter(Boolean);
}

function upsertSql(table:string,columns:string[],conflict:string[]){
  const quoted=columns.map(column=>`"${column}"`);const updates=columns.filter(column=>!conflict.includes(column)).map(column=>`"${column}"=excluded."${column}"`);
  return `INSERT INTO "${table}" (${quoted.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT (${conflict.map(column=>`"${column}"`).join(',')}) DO UPDATE SET ${updates.join(',')}`;
}

async function importObject(object:NonNullable<ImportBody['object']>){
  const key=String(object.key||''),data=String(object.dataBase64||'');
  if(!key||!data||data.length>2_000_000)return NextResponse.json({ok:false,message:'附件数据无效'},{status:400});
  const bytes=Uint8Array.from(atob(data),character=>character.charCodeAt(0));
  await getResumeBucket().put(key,bytes,{httpMetadata:{contentType:object.contentType||'application/octet-stream'},customMetadata:object.customMetadata||{}});
  return NextResponse.json({ok:true,object:key,size:bytes.byteLength});
}
