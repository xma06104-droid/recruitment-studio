import { env } from 'cloudflare:workers';
import type { NextRequest } from 'next/server';
import { SCHEMA_STATEMENTS } from '@/db/schema';
import { questionMaxScores } from '@/app/interview-score-weights';

export type AppAccount = {
  id: string;
  contact: string;
  phone: string;
  email: string;
  role: 'super_admin' | 'hr';
  organizationId: string;
  createdAt: string;
};

type AccountRow = {
  id: string;
  contact: string;
  phone: string;
  email: string;
  password_hash: string;
  role: 'super_admin' | 'hr' | 'none';
  organization_id: string;
  created_at: string;
};

const SESSION_COOKIE = 'xingjian_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 100_000;
let schemaReady: Promise<void> | null = null;

export function getDb(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const db = getDb();
    schemaReady = (async()=>{
      const [columns,accountColumns]=await Promise.all([
        db.prepare('PRAGMA table_info(ai_questions)').all<{name:string}>(),
        db.prepare('PRAGMA table_info(accounts)').all<{name:string}>(),
      ]);
      if(columns.results.some(column=>column.name==='max_score')&&accountColumns.results.some(column=>column.name==='organization_id'))return;
      if(columns.results.length&&!columns.results.some(column=>column.name==='job_id')){
        await db.prepare('ALTER TABLE ai_questions ADD COLUMN job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL').run();
      }
      if(columns.results.length&&!columns.results.some(column=>column.name==='keywords')){
        await db.prepare("ALTER TABLE ai_questions ADD COLUMN keywords TEXT NOT NULL DEFAULT ''").run();
      }
      if(columns.results.length&&!columns.results.some(column=>column.name==='reference_answer')){
        await db.prepare("ALTER TABLE ai_questions ADD COLUMN reference_answer TEXT NOT NULL DEFAULT ''").run();
      }
      const ruleColumns=await db.prepare('PRAGMA table_info(screening_rules)').all<{name:string}>();
      if(ruleColumns.results.length&&!ruleColumns.results.some(column=>column.name==='custom_conditions_json')){
        await db.prepare("ALTER TABLE screening_rules ADD COLUMN custom_conditions_json TEXT NOT NULL DEFAULT '[]'").run();
      }
      const offerColumns=await db.prepare('PRAGMA table_info(offers)').all<{name:string}>();
      if(offerColumns.results.length&&!offerColumns.results.some(column=>column.name==='recipient_email')){
        await db.prepare("ALTER TABLE offers ADD COLUMN recipient_email TEXT NOT NULL DEFAULT ''").run();
      }
      if(offerColumns.results.length&&!offerColumns.results.some(column=>column.name==='content')){
        await db.prepare("ALTER TABLE offers ADD COLUMN content TEXT NOT NULL DEFAULT ''").run();
      }
      const assignmentColumns=await db.prepare('PRAGMA table_info(candidate_assignments)').all<{name:string;pk:number}>();
      const assignmentPrimaryKey=assignmentColumns.results
        .filter(column=>Number(column.pk)>0)
        .sort((a,b)=>Number(a.pk)-Number(b.pk))
        .map(column=>column.name);
      if(assignmentColumns.results.length&&assignmentPrimaryKey.join(',')!=='candidate_id,hr_account_id'){
        await db.batch([
          db.prepare(`CREATE TABLE candidate_assignments_multi (
            candidate_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            hr_account_id TEXT NOT NULL,
            assigned_by TEXT NOT NULL,
            assigned_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (candidate_id, hr_account_id),
            FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE,
            FOREIGN KEY (hr_account_id) REFERENCES accounts(id) ON DELETE CASCADE
          )`),
          db.prepare(`INSERT OR IGNORE INTO candidate_assignments_multi
            (candidate_id, owner_id, hr_account_id, assigned_by, assigned_at, updated_at)
            SELECT candidate_id, owner_id, hr_account_id, assigned_by, assigned_at, updated_at FROM candidate_assignments`),
          db.prepare('DROP TABLE candidate_assignments'),
          db.prepare('ALTER TABLE candidate_assignments_multi RENAME TO candidate_assignments'),
        ]);
      }
      await db.batch(SCHEMA_STATEMENTS.map(statement => db.prepare(statement)));
      await migrateOrganizations(db);
      const currentQuestionColumns=await db.prepare('PRAGMA table_info(ai_questions)').all<{name:string}>();
      if(currentQuestionColumns.results.some(column=>column.name==='max_score'))await backfillLegacyQuestionScores(db);
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function migrateOrganizations(db:D1Database){
  const accountColumns=await db.prepare('PRAGMA table_info(accounts)').all<{name:string}>();
  if(accountColumns.results.length&&!accountColumns.results.some(column=>column.name==='organization_id')){
    await db.prepare("ALTER TABLE accounts ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''").run();
  }
  // These accounts were development fixtures. Removing the account cascades all
  // of its sessions and demo business records, and the seed is no longer present.
  await db.prepare("DELETE FROM accounts WHERE id LIKE 'test-account-%' OR email LIKE 'test%@xingjian.ai'").run();
  const now=new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, owner_account_id, created_at, updated_at)
      SELECT id, contact || '的企业', id, created_at, ? FROM accounts
      WHERE role = 'super_admin' AND COALESCE(organization_id, '') = ''`).bind(now),
    db.prepare(`UPDATE accounts SET organization_id = id
      WHERE role = 'super_admin' AND COALESCE(organization_id, '') = ''`),
  ]);
  await db.prepare(`UPDATE accounts SET organization_id = COALESCE(
      (SELECT owner.organization_id FROM candidate_assignments assignment
        JOIN accounts owner ON owner.id = assignment.owner_id
        WHERE assignment.hr_account_id = accounts.id AND owner.organization_id <> ''
        ORDER BY assignment.assigned_at DESC LIMIT 1),
      (SELECT organization_id FROM accounts administrator
        WHERE administrator.role = 'super_admin' AND administrator.organization_id <> ''
        ORDER BY administrator.created_at ASC LIMIT 1),
      id
    ) WHERE COALESCE(organization_id, '') = ''`).run();
  await db.prepare(`INSERT OR IGNORE INTO organizations (id, name, owner_account_id, created_at, updated_at)
    SELECT organization_id, contact || '的企业', id, created_at, ? FROM accounts
    WHERE organization_id <> '' GROUP BY organization_id`).bind(now).run();
  await db.prepare(`DELETE FROM candidate_assignments
    WHERE NOT EXISTS (
      SELECT 1 FROM accounts owner JOIN accounts recipient
        ON owner.organization_id = recipient.organization_id
      WHERE owner.id = candidate_assignments.owner_id
        AND recipient.id = candidate_assignments.hr_account_id
    )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_accounts_organization_role ON accounts(organization_id, role, created_at)').run();
}

async function backfillLegacyQuestionScores(db:D1Database){
  const legacy=await db.prepare(`SELECT id, owner_id, job_id FROM ai_questions
    WHERE max_score = -1 ORDER BY owner_id, COALESCE(job_id, ''), created_at ASC`).all<{id:string;owner_id:string;job_id:string|null}>();
  if(!legacy.results.length)return;
  const groups=new Map<string,{id:string}[]>();
  for(const row of legacy.results){
    const key=`${row.owner_id}\u0000${row.job_id||''}`;
    const group=groups.get(key)||[];
    group.push({id:row.id});groups.set(key,group);
  }
  const updates:D1PreparedStatement[]=[];
  for(const group of groups.values()){
    const scores=questionMaxScores(group.length);
    group.forEach((row,index)=>updates.push(db.prepare('UPDATE ai_questions SET max_score = ? WHERE id = ? AND max_score = -1').bind(scores[index],row.id)));
  }
  if(updates.length)await db.batch(updates);
}

export async function createPasswordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterations, saltText, expectedText] = encoded.split('$');
  if (algorithm !== 'pbkdf2' || Number(iterations) !== PASSWORD_ITERATIONS || !saltText || !expectedText) return false;
  const actual = await derivePassword(password, fromBase64(saltText));
  const expected = fromBase64(expectedText);
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  actual.forEach((byte, index) => { mismatch |= byte ^ expected[index]; });
  return mismatch === 0;
}

export function createSessionToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createInvitationShareToken(invitationId:string) {
  const key = await invitationLinkKey(['sign']);
  if (!key || !invitationId) return '';
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(invitationId));
  return `${invitationId}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function invitationIdFromShareToken(value:string) {
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const invitationId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!invitationId || !signature) return null;
  const key = await invitationLinkKey(['verify']);
  if (!key) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), new TextEncoder().encode(invitationId));
    return valid ? invitationId : null;
  } catch { return null; }
}

export async function accountFromRequest(request: NextRequest): Promise<AppAccount | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureSchema();
  const tokenHash = await hashToken(token);
  const row = await getDb().prepare(`SELECT a.id, a.contact, a.phone, a.email, a.role, a.organization_id, a.created_at
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(tokenHash, new Date().toISOString()).first<AccountRow>();
  return row && row.role !== 'none' ? publicAccount(row) : null;
}

export async function removeSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await ensureSchema();
  await getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
}

export function sessionCookie() {
  return SESSION_COOKIE;
}

export function sessionMaxAge() {
  return SESSION_SECONDS;
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
}

export function publicAccount(row: Pick<AccountRow, 'id' | 'contact' | 'phone' | 'email' | 'role' | 'organization_id' | 'created_at'>): AppAccount {
  return { id: row.id, contact: row.contact, phone: row.phone, email: row.email, role:row.role as AppAccount['role'], organizationId:row.organization_id, createdAt: row.created_at };
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PASSWORD_ITERATIONS }, key, 256);
  return new Uint8Array(bits);
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value:string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function invitationLinkKey(usages:KeyUsage[]) {
  const value = String((env as unknown as { INTERVIEW_LINK_KEY?:string }).INTERVIEW_LINK_KEY || '');
  if (!value) return null;
  try { return await crypto.subtle.importKey('raw', fromBase64Url(value), { name:'HMAC', hash:'SHA-256' }, false, usages); }
  catch { return null; }
}
