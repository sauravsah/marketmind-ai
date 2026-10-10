const MAX_MESSAGE_LENGTH = 1200;
const MAX_ROUTE_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 40;
const CATEGORIES = new Set(['bug', 'confusing', 'idea', 'praise', 'other']);

function clean(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export const FEEDBACK_CATEGORIES = [...CATEGORIES];

export function normalizeFeedbackPayload(payload = {}) {
  const category = clean(payload.category, MAX_CATEGORY_LENGTH).toLowerCase();
  const message = clean(payload.message, MAX_MESSAGE_LENGTH);
  const route = clean(payload.route, MAX_ROUTE_LENGTH).replace(/[^a-z0-9/_#?-]/gi, '');
  const clientTimestamp = clean(payload.clientTimestamp, 40);
  if (!CATEGORIES.has(category)) return { ok: false, error: 'Choose a feedback category.' };
  if (message.length < 3) return { ok: false, error: 'Tell us a little more so we can act on the feedback.' };
  return { ok: true, value: { category, message, route, clientTimestamp } };
}

export function feedbackId(randomUUID = globalThis.crypto?.randomUUID) {
  return typeof randomUUID === 'function' ? randomUUID() : `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
