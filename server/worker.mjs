import { researchMarket } from '../js/services/research.js';
import { analyzeAudience } from '../js/services/audience.js';
import { identifyOpportunities } from '../js/services/opportunity.js';
import { generateCampaignStrategy } from '../js/services/campaign.js';
import { getInternalProviderConfig, getPublicRuntimeConfig } from './config.mjs';
import { authenticateFirebaseRequest } from './firebase-auth.mjs';
import { decideBetaAccess } from '../functions/access.mjs';
import { feedbackId, normalizeFeedbackPayload } from './feedback.mjs';

const MAX_BODY_BYTES = 1_000_000;
const STREAM_ROUTES = {
  '/api/research/stream': {
    run: (payload, config, onStage) => researchMarket(payload.context, config, { onStage }),
    message: 'Live market research is temporarily unavailable. Try again shortly.',
  },
  '/api/audience/stream': {
    run: (payload, config, onStage) => analyzeAudience(payload.context, config, { onStage }),
    message: 'MarketMind is temporarily unable to complete this analysis. Please try again.',
  },
  '/api/opportunities/stream': {
    run: (payload, config, onStage) => identifyOpportunities(payload.context, config, { lens: payload.lens || 'balanced', variation: payload.variation || 0, onStage }),
    message: 'MarketMind is temporarily unable to complete this analysis. Please try again.',
  },
  '/api/campaign/stream': {
    run: (payload, config, onStage) => generateCampaignStrategy(payload.context, config, { section: payload.section || 'all', existing: payload.existing || null, onStage }),
    message: 'MarketMind is temporarily unable to complete this analysis. Please try again.',
  },
};

function requestIdFor(request) {
  const supplied = String(request.headers.get('x-request-id') || '').trim();
  if (/^[a-z0-9._:-]{8,96}$/i.test(supplied)) return supplied;
  return globalThis.crypto?.randomUUID?.() || `mm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function anonymizeUserId(uid = '') {
  const value = String(uid || '');
  if (!value) return 'anonymous';
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `u-${(hash >>> 0).toString(16)}`;
}

function jsonResponse(value, status = 200, requestId = '') {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(requestId ? { 'X-Request-Id': requestId } : {}),
    },
  });
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new Error('Request is too large.');
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error('Request is too large.');
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('Request body was not valid JSON.');
  }
}

function sseResponse(run, fallbackMessage, trace) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      Promise.resolve()
        .then(() => run(send))
        .then((result) => {
          console.log(JSON.stringify({ event: 'api_request', requestId: trace.requestId, route: trace.route, status: 200, durationMs: Date.now() - trace.startedAt, providerState: result?.meta?.providerStatus || result?.meta?.status || 'completed', failureReason: result?.meta?.failureReason, user: trace.user }));
          send('result', result);
        })
        .catch((error) => {
          console.error(JSON.stringify({ event: 'api_request', requestId: trace.requestId, route: trace.route, status: 502, durationMs: Date.now() - trace.startedAt, providerState: 'failed', errorCode: error?.code || error?.name || 'unknown', user: trace.user }));
          send('error', { message: fallbackMessage, requestId: trace.requestId });
        })
        .finally(() => controller.close());
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Request-Id': trace.requestId,
    },
  });
}

// Per-user stream throttling. Generation routes spend shared provider quota, so
// a runaway client or scripted abuse must not drain it. This is an in-memory,
// per-instance limit: serverless instances each hold their own counters, so it
// is a floor on abuse, not a globally exact cap.
const STREAM_RATE_LIMIT = { burstWindowMs: 60000, burstMax: 10, dailyMax: 50 };
const streamRateLog = new Map();

function streamRateLimit(key, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (streamRateLog.size > 5000) {
    for (const [entryKey, entry] of streamRateLog) {
      if (entry.day !== day && now - entry.windowStart > 86400000) streamRateLog.delete(entryKey);
    }
  }
  let entry = streamRateLog.get(key);
  if (!entry) {
    entry = { windowStart: now, burst: 0, day, daily: 0 };
    streamRateLog.set(key, entry);
  }
  if (now - entry.windowStart >= STREAM_RATE_LIMIT.burstWindowMs) {
    entry.windowStart = now;
    entry.burst = 0;
  }
  if (entry.day !== day) {
    entry.day = day;
    entry.daily = 0;
  }
  entry.burst += 1;
  entry.daily += 1;
  if (entry.burst > STREAM_RATE_LIMIT.burstMax) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + STREAM_RATE_LIMIT.burstWindowMs - now) / 1000)) };
  }
  if (entry.daily > STREAM_RATE_LIMIT.dailyMax) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00.000Z`) + 86400000 - now) / 1000)) };
  }
  return { ok: true };
}

export function resetStreamRateLimitsForTests() {
  streamRateLog.clear();
}

async function handleStream(request, path, env) {
  const requestId = requestIdFor(request);
  const startedAt = Date.now();
  const auth = await authenticateFirebaseRequest(request, {
    projectId: getPublicRuntimeConfig(env).firebase.projectId,
  });
  const user = await anonymizeUserId(auth.user?.uid);
  if (!auth.ok) {
    console.warn(JSON.stringify({ event: 'api_request', requestId, route: path, status: auth.status, durationMs: Date.now() - startedAt, providerState: 'not-started', errorCode: auth.status === 403 ? 'unverified' : 'unauthorized', user }));
    return jsonResponse({ error: auth.message, requestId }, auth.status, requestId);
  }

  // Invite-only gate for provider-spending routes. The Firebase Auth blocking
  // function that was meant to enforce this cannot run on the project's Spark
  // plan, so the allowlist is enforced here, after the token's verified email
  // is known and before any provider quota is spent or rate budget consumed.
  const access = decideBetaAccess({
    email: auth.user?.email,
    mode: env?.BETA_ACCESS_MODE,
    allowlist: env?.BETA_ALLOWED_EMAILS,
  });
  if (!access.allowed) {
    console.warn(JSON.stringify({ event: 'api_request', requestId, route: path, status: 403, durationMs: Date.now() - startedAt, providerState: 'not-started', errorCode: 'not-allowlisted', user }));
    return jsonResponse({ error: 'MarketMind is in an invite-only pilot. Your account is registered, but research and generation access is not turned on for it yet. Access is added by hand in small waves as seats open.', requestId }, 403, requestId);
  }

  const limit = streamRateLimit(user);
  if (!limit.ok) {
    console.warn(JSON.stringify({ event: 'api_rate_limited', requestId, route: path, status: 429, retryAfterSeconds: limit.retryAfterSeconds, user }));
    return jsonResponse({ error: 'You have reached the analysis rate limit. Please wait before starting another run.', requestId, retryAfterSeconds: limit.retryAfterSeconds }, 429, requestId);
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Request body was not valid JSON.', requestId }, 400, requestId);
  }
  const route = STREAM_ROUTES[path];
  const config = getInternalProviderConfig(env);
  return sseResponse(
    (send) => route.run(payload, config, (stage) => send('stage', stage)),
    route.message,
    { requestId, route: path, startedAt, user },
  );
}

async function handleFeedback(request, env) {
  const requestId = requestIdFor(request);
  const startedAt = Date.now();
  const auth = await authenticateFirebaseRequest(request, { projectId: getPublicRuntimeConfig(env).firebase.projectId });
  const user = await anonymizeUserId(auth.user?.uid);
  if (!auth.ok) return jsonResponse({ error: auth.message, requestId }, auth.status, requestId);
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Feedback was not valid JSON.', requestId }, 400, requestId);
  }
  const normalized = normalizeFeedbackPayload(payload);
  if (!normalized.ok) return jsonResponse({ error: normalized.error, requestId }, 400, requestId);
  const id = feedbackId();
  console.log(JSON.stringify({ event: 'beta_feedback', feedbackId: id, requestId, user, ...normalized.value, submittedAt: new Date().toISOString(), durationMs: Date.now() - startedAt }));
  return jsonResponse({ ok: true, feedbackId: id, requestId }, 201, requestId);
}

async function handleAccessRequest(request, env) {
  const requestId = requestIdFor(request);
  const startedAt = Date.now();
  const auth = await authenticateFirebaseRequest(request, { projectId: getPublicRuntimeConfig(env).firebase.projectId });
  const user = await anonymizeUserId(auth.user?.uid);
  if (!auth.ok) return jsonResponse({ error: auth.message, requestId }, auth.status, requestId);
  // The token's verified email is the only address we record - the client
  // cannot ask for a seat on behalf of a different address. This route stays
  // outside the allowlist gate on purpose: it spends no provider quota, and
  // the people who need it are exactly the ones the gate turns away.
  const email = String(auth.user?.email || '').trim().toLowerCase();
  if (!email) return jsonResponse({ error: 'Your account does not have an email address to request access with.', requestId }, 400, requestId);
  console.log(JSON.stringify({ event: 'beta_access_request', requestId, user, email, submittedAt: new Date().toISOString(), durationMs: Date.now() - startedAt }));
  return jsonResponse({ ok: true, requestId }, 201, requestId);
}

export async function handleWorkerRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);
  if (request.method === 'GET' && ['/api/public-config', '/api/public-runtime-config'].includes(url.pathname)) {
    return jsonResponse(getPublicRuntimeConfig(env), 200, requestIdFor(request));
  }
  if (request.method === 'POST' && url.pathname === '/api/feedback') return handleFeedback(request, env);
  if (request.method === 'POST' && url.pathname === '/api/access-request') return handleAccessRequest(request, env);
  if (request.method === 'POST' && STREAM_ROUTES[url.pathname]) return handleStream(request, url.pathname, env);
  if (url.pathname.startsWith('/api/')) return jsonResponse({ error: 'Not found' }, 404);
  if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request, env, ctx);
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export default { fetch: handleWorkerRequest };
