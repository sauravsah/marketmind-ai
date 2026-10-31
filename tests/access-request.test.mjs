import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { handleWorkerRequest, resetStreamRateLimitsForTests } from '../server/worker.mjs';
import { resetFirebaseCertificateCache } from '../server/firebase-auth.mjs';

// --- Worker route: request logging stays reachable for non-allowlisted users ---
const projectId = 'access-request-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'ar-key', alg: 'RS256', use: 'sig' }] };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).startsWith('https://www.googleapis.com/service_accounts/')) return Response.json(jwks);
  throw new Error(`Unexpected network request: ${url}`);
};

function token(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'ar-key' })}.${encode({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub, email, email_verified: true, iat: now, exp: now + 3600 })}`;
  const signer = createSign('RSA-SHA256'); signer.update(input); signer.end();
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
}
function callAccessRequest(authHeader) {
  resetStreamRateLimitsForTests();
  resetFirebaseCertificateCache();
  const headers = authHeader ? { Authorization: authHeader } : {};
  return handleWorkerRequest(
    new Request('https://test.invalid/api/access-request', { method: 'POST', headers }),
    { FIREBASE_PROJECT_ID: projectId, BETA_ACCESS_MODE: 'invite-only', BETA_ALLOWED_EMAILS: 'owner@example.com' },
  );
}

test('non-allowlisted signed-in user can log an access request (route is outside the allowlist gate)', async () => {
  const response = await callAccessRequest(`Bearer ${token('user-9', 'stranger@example.com')}`);
  assert.equal(response.status, 201);
  assert.equal(JSON.parse(await response.text()).ok, true);
});

test('access request without a valid token is rejected', async () => {
  const response = await callAccessRequest(null);
  assert.equal(response.status, 401);
});

// --- Client modal + denial detection (extracted from the real js/app.js) ---
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `js/app.js must define ${name} in its own module scope`);
  let depth = 0;
  const braceStart = appSource.indexOf('{', start);
  for (let i = braceStart; i < appSource.length; i += 1) {
    if (appSource[i] === '{') depth += 1;
    if (appSource[i] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const escapeHtml = (value = '') => String(value);
const icon = () => '';

function loadModal() {
  return new Function('escapeHtml', 'icon', `${extractFunction('accessRequestModal')}; return accessRequestModal;`)(escapeHtml, icon);
}
function loadDetector() {
  return new Function(`${extractFunction('isAccessDeniedError')}; return isAccessDeniedError;`)();
}

test('denial detector matches the worker invite-only message only', () => {
  const isAccessDeniedError = loadDetector();
  assert.equal(isAccessDeniedError('MarketMind is in an invite-only pilot. Your account is registered, but research and generation access is not turned on for it yet.'), true);
  assert.equal(isAccessDeniedError('Verify your email before using this intelligence stage.'), false);
  assert.equal(isAccessDeniedError('The intelligence service is temporarily unavailable. Try again shortly.'), false);
  assert.equal(isAccessDeniedError(undefined), false);
});

test('modal renders nothing when closed', () => {
  const modal = loadModal();
  const state = { accessRequest: { open: false, sending: false, sent: false, error: null }, auth: { user: { email: 'pilot@example.com' } } };
  assert.equal(new Function('state', 'escapeHtml', 'icon', `${extractFunction('accessRequestModal')}; return accessRequestModal();`)(state, escapeHtml, icon), '');
});

test('modal pre-send shows account email, truthful queue copy, and the request button', () => {
  const state = { accessRequest: { open: true, sending: false, sent: false, error: null }, auth: { user: { email: 'pilot@example.com' } } };
  const html = new Function('state', 'escapeHtml', 'icon', `${extractFunction('accessRequestModal')}; return accessRequestModal();`)(state, escapeHtml, icon);
  assert.match(html, /Request a pilot seat\./);
  assert.match(html, /pilot@example\.com/);
  assert.match(html, /invite-only pilot/);
  assert.match(html, /data-action="submit-access-request"/);
  assert.match(html, /does not change access by itself/);
  assert.doesNotMatch(html, /within \d+ (hours|days)/i, 'must not promise a wait time');
});

test('modal sent state confirms queue without promising timing', () => {
  const state = { accessRequest: { open: true, sending: false, sent: true, error: null }, auth: { user: { email: 'pilot@example.com' } } };
  const html = new Function('state', 'escapeHtml', 'icon', `${extractFunction('accessRequestModal')}; return accessRequestModal();`)(state, escapeHtml, icon);
  assert.match(html, /Request received/);
  assert.match(html, /pilot@example\.com/);
  assert.match(html, /no fixed wait we can promise/);
  assert.doesNotMatch(html, /data-action="submit-access-request"/);
});

test('modal surfaces a save error and keeps the request button enabled', () => {
  const state = { accessRequest: { open: true, sending: false, sent: false, error: 'The request could not be saved. Try again shortly.' }, auth: { user: { email: 'pilot@example.com' } } };
  const html = new Function('state', 'escapeHtml', 'icon', `${extractFunction('accessRequestModal')}; return accessRequestModal();`)(state, escapeHtml, icon);
  assert.match(html, /role="alert"/);
  assert.match(html, /could not be saved/);
  assert.match(html, /data-action="submit-access-request"/);
});

// --- submitAccessRequest handler integration ---
function extractAsyncFunction(name) {
  const start = appSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `js/app.js must define async function ${name} in module scope`);
  let depth = 0;
  const braceStart = appSource.indexOf('{', start);
  for (let i = braceStart; i < appSource.length; i += 1) {
    if (appSource[i] === '{') depth += 1;
    if (appSource[i] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`unterminated async function ${name}`);
}
function loadSubmit() {
  return new Function(
    'state', 'storage', 'render', 'authenticatedFetch', 'isAbortError',
    `${extractAsyncFunction('submitAccessRequest')}; return submitAccessRequest;`,
  );
}
function makeHarness({ repoBehavior = 'ok', logBehavior = 'ok', switchAccount = false } = {}) {
  const h = { writes: [], logs: 0, renders: 0 };
  h.state = {
    accessRequest: { open: true, sending: false, sent: false, error: null },
    auth: { user: { email: 'new.tester@example.com' } },
    cloud: { repository: repoBehavior === 'missing' ? null : {
      requestBetaAccess: async (email) => {
        if (repoBehavior === 'fail') throw new Error('Missing or insufficient permissions.');
        h.writes.push(email);
      },
    } },
  };
  h.submit = loadSubmit()(
    h.state,
    { capture: () => 'acct-1', isCurrent: () => !switchAccount },
    () => { h.renders += 1; },
    async () => { if (logBehavior === 'fail') throw new Error('404 Not found'); h.logs += 1; },
    () => false,
  );
  return h;
}

test('success path writes own-doc record with account email and logs notification', async () => {
  const h = makeHarness();
  await h.submit();
  assert.deepEqual(h.writes, ['new.tester@example.com']);
  assert.equal(h.logs, 1);
  assert.deepEqual(h.state.accessRequest, { open: true, sending: false, sent: true, error: null });
});

test('saved request + failed notification log still confirms only the durable queue', async () => {
  const h = makeHarness({ logBehavior: 'fail' });
  await h.submit();
  assert.deepEqual(h.writes, ['new.tester@example.com'], 'durable record saved');
  assert.equal(h.state.accessRequest.sent, true);
  assert.equal(h.state.accessRequest.error, null, 'log failure does not surface as request failure');
});

test('repository failure keeps dialog open with the error and no sent state', async () => {
  const h = makeHarness({ repoBehavior: 'fail' });
  await h.submit();
  assert.equal(h.state.accessRequest.sent, false);
  assert.equal(h.state.accessRequest.sending, false);
  assert.match(h.state.accessRequest.error, /insufficient permissions/i);
  assert.equal(h.logs, 0, 'no notification log when the durable record failed');
});

test('missing repository reports a retryable syncing error', async () => {
  const h = makeHarness({ repoBehavior: 'missing' });
  await h.submit();
  assert.match(h.state.accessRequest.error, /still syncing/i);
  assert.equal(h.state.accessRequest.sent, false);
});

test('account switch mid-flight leaves the new account state untouched', async () => {
  const h = makeHarness({ switchAccount: true });
  const before = { ...h.state.accessRequest };
  await h.submit();
  assert.equal(h.state.accessRequest.sending, true, 'stale write did not land');
  assert.equal(h.state.accessRequest.sent, before.sent);
});
