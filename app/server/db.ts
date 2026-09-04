import { env } from 'cloudflare:workers';
import type { NextRequest } from 'next/server';
import { SCHEMA_STATEMENTS } from '@/db/schema';

export type AppAccount = {
  id: string;
  contact: string;
  phone: string;
  email: string;
  createdAt: string;
};

type AccountRow = {
  id: string;
  contact: string;
  phone: string;
  email: string;
  password_hash: string;
  created_at: string;
};

const SESSION_COOKIE = 'xingjian_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 100_000;
let schemaReady: Promise<void> | null = null;

export function getDb(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

export function getResumeBucket(): R2Bucket {
  return (env as unknown as { RESUMES: R2Bucket }).RESUMES;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const db = getDb();
    schemaReady = (async()=>{
      const columns=await db.prepare('PRAGMA table_info(ai_questions)').all<{name:string}>();
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
      await db.batch(SCHEMA_STATEMENTS.map(statement => db.prepare(statement)));
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
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

export async function accountFromRequest(request: NextRequest): Promise<AppAccount | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureSchema();
  const tokenHash = await hashToken(token);
  const row = await getDb().prepare(`SELECT a.id, a.contact, a.phone, a.email, a.created_at
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(tokenHash, new Date().toISOString()).first<AccountRow>();
  return row ? publicAccount(row) : null;
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

export function publicAccount(row: Pick<AccountRow, 'id' | 'contact' | 'phone' | 'email' | 'created_at'>): AppAccount {
  return { id: row.id, contact: row.contact, phone: row.phone, email: row.email, createdAt: row.created_at };
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
