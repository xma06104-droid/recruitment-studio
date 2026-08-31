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
  return isTestAccountIdentifier(value) || isMainlandMobile(value) || isValidEmail(value);
}

export function isTestAccountIdentifier(value: string) {
  return /^1000000000[1-5]$/.test(value.trim());
}

export function isStrongPassword(value: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)[^\s]{8,20}$/.test(value);
}
