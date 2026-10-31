import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/auth.js', import.meta.url), 'utf8');
// Test-only module copy supplies Firebase client without a live account.
const auth = await import(`data:text/javascript;base64,${Buffer.from(source + '\nexport function inject(value) { client = value; }').toString('base64')}`);
test('old-account requests cannot retry or send after account switches during token retrieval', async () => {
 const original = globalThis.fetch; let sends = 0; let release;
 const A = { getIdToken: () => new Promise(ok => { release = ok; }) };
 const firebase = { auth: { currentUser: A } }; auth.inject(firebase);
 globalThis.fetch = async () => { sends++; return new Response('', { status: 401 }); };
 try {
  const pending = auth.authenticatedFetch('/api/feedback', { method: 'POST', body: 'private A' });
  await new Promise(ok => setImmediate(ok)); firebase.auth.currentUser = { getIdToken: async () => 'B' }; release('A');
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(sends, 0);
  firebase.auth.currentUser = { getIdToken: async () => 'A' };
  globalThis.fetch = async () => { sends++; firebase.auth.currentUser = { getIdToken: async () => 'B' }; return new Response('', { status: 401 }); };
  await assert.rejects(auth.authenticatedFetch('/api/feedback'), { name: 'AbortError' }); assert.equal(sends, 1);
 } finally { globalThis.fetch = original; }
});
test('aborted request cannot send after token retrieval', async () => {
 const original = globalThis.fetch; let sends = 0; let release;
 auth.inject({ auth: { currentUser: { getIdToken: () => new Promise(ok => { release = ok; }) } } });
 globalThis.fetch = async () => { sends++; return new Response(); };
 try {
  const controller = new AbortController(); const pending = auth.authenticatedFetch('/api/research/stream', { signal: controller.signal });
  await new Promise(ok => setImmediate(ok)); controller.abort(); release('A');
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(sends, 0);
 } finally { globalThis.fetch = original; }
});

test('account switch before client-await resolution cannot choose the replacement user', async () => {
 const original = globalThis.fetch; let sends = 0;
 const firebase = { auth: { currentUser: { getIdToken: async () => 'A' } } }; auth.inject(firebase);
 globalThis.fetch = async () => { sends++; return new Response(); };
 try {
  const pending = auth.authenticatedFetch('/api/feedback', { body: 'private A' });
  firebase.auth.currentUser = { getIdToken: async () => 'B' };
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(sends, 0);
 } finally { globalThis.fetch = original; }
});

test('403 with stale unverified token claim retries once with a forced refresh (freshly verified email)', async () => {
 const original = globalThis.fetch; let sends = 0; const seen = [];
 const user = { getIdToken: async (force) => (force ? 'fresh' : 'stale'), getIdTokenResult: async () => ({ claims: { email_verified: false } }) };
 auth.inject({ auth: { currentUser: user } });
 globalThis.fetch = async (input, init) => {
  sends++; seen.push(init.headers.get('Authorization'));
  const fresh = init.headers.get('Authorization') === 'Bearer fresh';
  return new Response(fresh ? '{"ok":true}' : '{"error":"Verify your email before using the MarketMind workspace."}', { status: fresh ? 200 : 403 });
 };
 try {
  const response = await auth.authenticatedFetch('/api/research/stream', { method: 'POST' });
  assert.equal(response.status, 200); assert.equal(sends, 2);
  assert.deepEqual(seen, ['Bearer stale', 'Bearer fresh']);
 } finally { globalThis.fetch = original; }
});

test('403 with a verified token claim (invite-only gate) is returned without any retry or re-send', async () => {
 const original = globalThis.fetch; let sends = 0; let refreshes = 0;
 const user = { getIdToken: async (force) => { if (force) refreshes++; return 'tok'; }, getIdTokenResult: async () => ({ claims: { email_verified: true } }) };
 auth.inject({ auth: { currentUser: user } });
 globalThis.fetch = async () => { sends++; return new Response('{"error":"MarketMind is in an invite-only pilot."}', { status: 403 }); };
 try {
  const response = await auth.authenticatedFetch('/api/research/stream', { method: 'POST' });
  assert.equal(response.status, 403); assert.equal(sends, 1); assert.equal(refreshes, 0);
 } finally { globalThis.fetch = original; }
});

test('403 retry on a still-unverified account returns the 403 after a single forced refresh', async () => {
 const original = globalThis.fetch; let sends = 0;
 const user = { getIdToken: async (force) => (force ? 'fresh' : 'stale'), getIdTokenResult: async () => ({ claims: { email_verified: false } }) };
 auth.inject({ auth: { currentUser: user } });
 globalThis.fetch = async () => { sends++; return new Response('{"error":"Verify your email before using the MarketMind workspace."}', { status: 403 }); };
 try {
  const response = await auth.authenticatedFetch('/api/research/stream', { method: 'POST' });
  assert.equal(response.status, 403); assert.equal(sends, 2);
 } finally { globalThis.fetch = original; }
});
