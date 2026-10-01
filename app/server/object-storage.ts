import { env } from 'cloudflare:workers';

const DEFAULT_BUCKET = 'recruitment-files';

type StorageEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_STORAGE_BUCKET?: string;
};

export async function putStoredObject(key: string, body: BodyInit, contentType = 'application/octet-stream') {
  const response = await storageRequest(`/object/${bucketName()}/${objectPath(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
    body,
  });
  if (!response.ok) throw await storageError('上传文件失败', response);
}

export async function getStoredObject(key: string, range?: { start: number; end: number }) {
  const headers = new Headers();
  if (range) headers.set('Range', `bytes=${range.start}-${range.end}`);
  const response = await storageRequest(`/object/authenticated/${bucketName()}/${objectPath(key)}`, {
    method: 'GET',
    headers,
  });
  if (response.status === 404) return null;
  if (!response.ok && response.status !== 206) throw await storageError('读取文件失败', response);
  return response;
}

export async function deleteStoredObject(key: string) {
  await deleteStoredObjects([key]);
}

export async function deleteStoredObjects(keys: string[]) {
  const prefixes = [...new Set(keys.map(key => key.trim()).filter(Boolean))];
  if (!prefixes.length) return;
  for (let index = 0; index < prefixes.length; index += 1000) {
    const response = await storageRequest(`/object/${bucketName()}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: prefixes.slice(index, index + 1000) }),
    });
    if (!response.ok) throw await storageError('删除文件失败', response);
  }
}

function storageRequest(path: string, init: RequestInit) {
  const { url, apiKey, authorizationKey } = storageConfig();
  const headers = new Headers(init.headers);
  headers.set('apikey', apiKey);
  headers.set('Authorization', `Bearer ${authorizationKey}`);
  return fetch(`${url}/storage/v1${path}`, { ...init, headers });
}

function storageConfig() {
  const values = env as unknown as StorageEnvironment;
  const url = String(values.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const secretKey = String(values.SUPABASE_SECRET_KEY || '').trim();
  const serviceRoleKey = String(values.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !secretKey) {
    throw new Error('Supabase Storage 尚未配置，请设置 SUPABASE_URL 和 SUPABASE_SECRET_KEY。');
  }
  const authorizationKey = serviceRoleKey || (!secretKey.startsWith('sb_') ? secretKey : '');
  if (!authorizationKey) {
    throw new Error('Supabase Storage 还需要 JWT 格式的 SUPABASE_SERVICE_ROLE_KEY。');
  }
  // Storage derives its Postgres role from the API key as well as the bearer
  // token. Use the same legacy service_role JWT for both headers so requests
  // consistently receive the service_role identity and bypass Storage RLS.
  return { url, apiKey: authorizationKey, authorizationKey };
}

function bucketName() {
  const values = env as unknown as StorageEnvironment;
  return encodeURIComponent(String(values.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET);
}

function objectPath(key: string) {
  return key.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

async function storageError(action: string, response: Response) {
  const detail = await response.text().catch(() => '');
  return new Error(`${action}（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`);
}
