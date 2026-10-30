const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

export function parseAllowedEmails(raw = '') {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter((email) => EMAIL_PATTERN.test(email));
}

export function decideBetaAccess({ email = '', mode = 'invite-only', allowlist = '' } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedMode = String(mode || 'invite-only').trim().toLowerCase();
  if (normalizedMode === 'public') return { allowed: true, email: normalizedEmail, reason: 'public' };
  const allowedEmails = new Set(Array.isArray(allowlist) ? allowlist.map(normalizeEmail) : parseAllowedEmails(allowlist));
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) return { allowed: false, email: normalizedEmail, reason: 'invalid-email' };
  if (!allowedEmails.size) return { allowed: false, email: normalizedEmail, reason: 'empty-allowlist' };
  return allowedEmails.has(normalizedEmail)
    ? { allowed: true, email: normalizedEmail, reason: 'allowlisted' }
    : { allowed: false, email: normalizedEmail, reason: 'not-allowlisted' };
}
