import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { handleWorkerRequest, resetStreamRateLimitsForTests } from '../server/worker.mjs';
import { resetFirebaseCertificateCache } from '../server/firebase-auth.mjs';

const projectId = 'beta-access-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'beta-key', alg: 'RS256', use: 'sig' }] };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).startsWith('https://www.googleapis.com/service_accounts/')) return Response.json(jwks);
  throw new Error(`Unexpected network request: ${url}`);
};

function token(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'beta-key' })}.${encode({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub, email, email_verified: true, iat: now, exp: now + 3600 })}`;
  const signer = createSign('RSA-SHA256'); signer.update(input); signer.end();
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
}
function call(email, extraEnv = {}, { reset = true } = {}) {
  if (reset) {
    resetStreamRateLimitsForTests();
    resetFirebaseCertificateCache();
  }
  return handleWorkerRequest(
    new Request('https://test.invalid/api/research/stream', { method: 'POST', headers: { Authorization: `Bearer ${token('user-1', email)}` }, body: '{' }),
    { FIREBASE_PROJECT_ID: projectId, ...extraEnv },
  );
}

test('allowlisted verified email reaches the route (fails later at body validation)', async () => {
  const response = await call('pilot@example.com', { BETA_ALLOWED_EMAILS: 'owner@example.com, pilot@example.com' });
  assert.equal(response.status, 400);
});

test('non-allowlisted verified email is denied before any provider spend', async () => {
  const response = await call('stranger@example.com', { BETA_ALLOWED_EMAILS: 'owner@example.com' });
  assert.equal(response.status, 403);
  assert.match(JSON.parse(await response.text()).error, /invite-only/i);
});

test('allowlist matching is case-insensitive and ignores surrounding whitespace', async () => {
  const response = await call('  Pilot@Example.COM ', { BETA_ALLOWED_EMAILS: 'pilot@example.com' });
  assert.equal(response.status, 400);
});

test('missing or empty allowlist fails closed', async () => {
  for (const env of [{}, { BETA_ALLOWED_EMAILS: '' }, { BETA_ALLOWED_EMAILS: '   ' }]) {
    const response = await call('pilot@example.com', env);
    assert.equal(response.status, 403, JSON.stringify(env));
  }
});

test('explicit public mode disables the gate without an allowlist', async () => {
  const response = await call('anyone@example.com', { BETA_ACCESS_MODE: 'public' });
  assert.equal(response.status, 400);
});

test('denied users do not consume rate-limit budget', async () => {
  resetStreamRateLimitsForTests();
  resetFirebaseCertificateCache();
  const env = { BETA_ALLOWED_EMAILS: 'owner@example.com' };
  for (let index = 0; index < 12; index += 1) {
    const denied = await call('stranger@example.com', env, { reset: false });
    assert.equal(denied.status, 403, `denied request ${index + 1} must never throttle`);
  }
  // The same user's allowed alter ego still has its full burst allowance.
  const allowed = await call('owner@example.com', env, { reset: false });
  assert.equal(allowed.status, 400);
});
