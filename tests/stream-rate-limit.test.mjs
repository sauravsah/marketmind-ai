import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { handleWorkerRequest, resetStreamRateLimitsForTests } from '../server/worker.mjs';
import { handleVercelRequest } from '../server/vercel-adapter.mjs';
import { resetFirebaseCertificateCache } from '../server/firebase-auth.mjs';

const projectId = 'rate-limit-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'rate-key', alg: 'RS256', use: 'sig' }] };
function token(sub, email = `${sub}@test.dev`) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'rate-key' })}.${encode({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub, email, email_verified: true, iat: now, exp: now + 3600 })}`;
  const signer = createSign('RSA-SHA256'); signer.update(input); signer.end();
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
}
function call(sub) {
  return handleWorkerRequest(new Request('https://test.invalid/api/research/stream', { method: 'POST', headers: { Authorization: `Bearer ${token(sub)}` }, body: '{' }), { FIREBASE_PROJECT_ID: projectId, BETA_ALLOWED_EMAILS: 'burst-user@test.dev, other-user@test.dev, adapter-user@test.dev' });
}

test('stream routes throttle a single user after the burst allowance', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://www.googleapis.com/service_accounts/')) return Response.json(jwks);
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    throw new Error('Unexpected network request, including providers');
  };
  const previousProject = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = projectId; // the Vercel adapter reads process.env
  const previousAllowlist = process.env.BETA_ALLOWED_EMAILS;
  process.env.BETA_ALLOWED_EMAILS = 'burst-user@test.dev, other-user@test.dev, adapter-user@test.dev';
  try {
    resetStreamRateLimitsForTests();
    resetFirebaseCertificateCache();
    // 10 allowed requests reach body validation (invalid JSON stops there); the 11th is throttled.
    for (let index = 0; index < 10; index += 1) {
      assert.equal((await call('burst-user')).status, 400, `request ${index + 1} should pass the limiter`);
    }
    const throttled = await call('burst-user');
    assert.equal(throttled.status, 429);
    const body = JSON.parse(await throttled.text());
    assert.match(body.error, /rate limit/i);
    assert.ok(body.retryAfterSeconds >= 1 && body.retryAfterSeconds <= 60);
    // A different user is unaffected, and a reset restores access.
    assert.equal((await call('other-user')).status, 400);
    // The production Vercel entrypoint (api/**/stream.mjs -> handleVercelRequest) enforces the same cap.
    const server = createServer((req, res) => handleVercelRequest(req, res));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const port = server.address().port;
      const viaAdapter = (sub) => fetch(`http://127.0.0.1:${port}/api/research/stream`, { method: 'POST', headers: { Authorization: `Bearer ${token(sub)}` }, body: '{' });
      for (let index = 0; index < 10; index += 1) {
        assert.equal((await viaAdapter('adapter-user')).status, 400, `adapter request ${index + 1} should pass the limiter`);
      }
      assert.equal((await viaAdapter('adapter-user')).status, 429);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    resetStreamRateLimitsForTests();
    assert.equal((await call('burst-user')).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousProject === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = previousProject;
    if (previousAllowlist === undefined) delete process.env.BETA_ALLOWED_EMAILS; else process.env.BETA_ALLOWED_EMAILS = previousAllowlist;
    resetFirebaseCertificateCache();
    resetStreamRateLimitsForTests();
  }
});
