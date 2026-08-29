export type StoredAccount = {
  company: string;
  contact: string;
  phone: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

export const ACCOUNT_STORAGE_KEY = 'xingjian-accounts-v1';
export const LAST_REGISTERED_KEY = 'xingjian-last-registered';
export const DEMO_ACCOUNT = {
  phone: '13800138000',
  email: 'demo@xingjian.ai',
  password: 'Xj2026demo',
};

export function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export function isMainlandMobile(value: string) {
  return /^1[3-9]\d{9}$/.test(value.trim());
}

export function isValidEmail(value: string) {
  const email = normalizeIdentifier(value);
  if (email.length > 254 || email.includes('..')) return false;
  return /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+$/.test(email);
}

export function isValidIdentifier(value: string) {
  return isMainlandMobile(value) || isValidEmail(value);
}

export function isStrongPassword(value: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)[^\s]{8,20}$/.test(value);
}

export function readAccounts(): StoredAccount[] {
  try {
    const stored = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function writeAccounts(accounts: StoredAccount[]) {
  window.localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
}

export async function hashPassword(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
