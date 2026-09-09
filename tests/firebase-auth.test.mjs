import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { authenticateFirebaseRequest, resetFirebaseCertificateCache, verifyFirebaseIdToken } from '../server/firebase-auth.mjs';

const projectId = 'marketmind-test';
const now = 1_700_000_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certificates = { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) };

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(overrides = {}) {
  const header = encode({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = encode({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: 'firebase-user',
    email: 'team@example.com',
    email_verified: true,
    iat: now - 30,
    exp: now + 3600,
    ...overrides,
  });
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`;
}

test('Firebase ID tokens are signature- and claim-validated', async () => {
  const user = await verifyFirebaseIdToken(token(), { projectId, certificates, now });
  assert.deepEqual({ uid: user.uid, email: user.email, emailVerified: user.emailVerified }, { uid: 'firebase-user', email: 'team@example.com', emailVerified: true });
  await assert.rejects(() => verifyFirebaseIdToken(token({ aud: 'another-project' }), { projectId, certificates, now }), /audience or issuer/);
  await assert.rejects(() => verifyFirebaseIdToken(token({ exp: now - 600 }), { projectId, certificates, now }), /expired/);
});

test('API authentication distinguishes missing, unverified, and valid sessions', async () => {
  resetFirebaseCertificateCache();
  assert.deepEqual(await authenticateFirebaseRequest({ headers: {} }, { projectId }), { ok: false, status: 401, message: 'Authentication is required.' });
  const unverified = await authenticateFirebaseRequest({ headers: { authorization: `Bearer ${token({ email_verified: false })}` } }, { projectId, certificates, now });
  assert.deepEqual(unverified, { ok: false, status: 403, message: 'Verify your email before using the MarketMind workspace.' });
  const valid = await authenticateFirebaseRequest({ headers: { authorization: `Bearer ${token()}` } }, { projectId, certificates, now });
  assert.equal(valid.ok, true);
  assert.equal(valid.user.uid, 'firebase-user');
});

test('missing Firebase server configuration is explicit', async () => {
  const result = await authenticateFirebaseRequest({ headers: { authorization: `Bearer ${token()}` } }, { projectId: '' });
  assert.deepEqual(result, { ok: false, status: 503, message: 'Firebase authentication is not configured.' });
});
