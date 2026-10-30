import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { handleWorkerRequest } from '../server/worker.mjs';
import { handleVercelRequest } from '../server/vercel-adapter.mjs';
import { resetFirebaseCertificateCache } from '../server/firebase-auth.mjs';

const projectId = 'request-auth-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'request-key', alg: 'RS256', use: 'sig' }] };
function token(verified = true) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'request-key' })}.${encode({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: 'test-user', email: 'test-user@test.dev', email_verified: verified, iat: now, exp: now + 3600 })}`;
  const signer = createSign('RSA-SHA256'); signer.update(input); signer.end();
  return `${input}.${signer.sign(privateKey).toString('base64url')}`;
}
const routes = ['/api/research/stream', '/api/audience/stream', '/api/opportunities/stream', '/api/campaign/stream', '/api/feedback'];
async function checkBoundary(send) {
  for (const path of routes) {
    assert.equal((await send(path)).status, 401, `${path}: missing token`);
    assert.equal((await send(path, 'invalid')).status, 401, `${path}: invalid token`);
    assert.equal((await send(path, token(false))).status, 403, `${path}: unverified token`);
    // Invalid JSON deliberately stops execution after auth, before any provider.
    const accepted = await send(path, token());
    assert.equal(accepted.status, 400, `${path}: verified token reaches body validation`);
    assert.match(await accepted.text(), /not valid JSON/);
  }
}

test('worker and Vercel adapter accept verified Web Request headers without bypassing auth', async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.FIREBASE_PROJECT_ID;
  const previousAllowlist = process.env.BETA_ALLOWED_EMAILS;
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.BETA_ALLOWED_EMAILS = 'test-user@test.dev';
  resetFirebaseCertificateCache();
  let certificateFetches = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://www.googleapis.com/service_accounts/')) {
      certificateFetches += 1;
      return Response.json(jwks);
    }
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    throw new Error('Unexpected network request, including providers');
  };
  const server = createServer((req, res) => handleVercelRequest(req, res));
  try {
    await checkBoundary((path, bearer) => handleWorkerRequest(new Request(`https://test.invalid${path}`, { method: 'POST', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, body: '{' }), { FIREBASE_PROJECT_ID: projectId, BETA_ALLOWED_EMAILS: 'test-user@test.dev' }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    await checkBoundary((path, bearer) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, body: '{' }));
    assert.equal(certificateFetches, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = previous;
    if (previousAllowlist === undefined) delete process.env.BETA_ALLOWED_EMAILS; else process.env.BETA_ALLOWED_EMAILS = previousAllowlist;
    resetFirebaseCertificateCache();
  }
});

test('Node server adapter passes real Authorization headers through the same boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marketmind-auth-test-'));
  const preload = join(dir, 'certificates.mjs');
  await writeFile(preload, `globalThis.fetch = async (url) => { if (!String(url).startsWith('https://www.googleapis.com/service_accounts/')) throw new Error('Unexpected network call'); return Response.json(${JSON.stringify(jwks)}); };`);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['--import', preload, 'server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), FIREBASE_PROJECT_ID: projectId, BETA_ACCESS_MODE: 'invite-only', BETA_ALLOWED_EMAILS: 'test-user@test.dev' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Server exited before startup'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('Startup timeout')), 10000).unref())]);
    await checkBoundary((path, bearer) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, body: '{' }));
  } finally {
    child.kill(); await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});
