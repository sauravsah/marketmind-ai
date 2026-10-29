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
