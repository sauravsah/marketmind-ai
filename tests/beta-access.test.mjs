import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBetaAccess, normalizeEmail, parseAllowedEmails } from '../functions/access.mjs';

test('beta email normalization and parsing are deterministic', () => {
  assert.equal(normalizeEmail('  TEAM@Example.COM '), 'team@example.com');
  assert.deepEqual(parseAllowedEmails('TEAM@example.com, bad, other@example.com\n'), ['team@example.com', 'other@example.com']);
});

test('invite-only access accepts only an allowlisted email', () => {
  assert.equal(decideBetaAccess({ email: ' Team@Example.com ', allowlist: 'team@example.com' }).allowed, true);
  assert.equal(decideBetaAccess({ email: 'other@example.com', allowlist: 'team@example.com' }).allowed, false);
});

test('public mode allows valid and invalid email values to reach Firebase validation', () => {
  assert.deepEqual(decideBetaAccess({ email: 'someone@example.com', mode: 'public' }), { allowed: true, email: 'someone@example.com', reason: 'public' });
});

test('empty or malformed invite lists fail closed', () => {
  assert.equal(decideBetaAccess({ email: 'team@example.com', allowlist: '' }).allowed, false);
  assert.equal(decideBetaAccess({ email: 'team@example.com', allowlist: 'not-an-email' }).reason, 'empty-allowlist');
});
