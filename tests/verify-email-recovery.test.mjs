import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEmailActionError } from '../js/auth.js';

// Firebase cannot reliably distinguish an expired link from a consumed one
// (used, malformed and expired links share codes across SDK versions), so the
// recovery copy keeps both possibilities open instead of claiming one cause.
test('an expired verification link gets ambiguous, fresh-link recovery copy', () => {
  const copy = describeEmailActionError('auth/expired-action-code');
  assert.match(copy.title, /did not work/i);
  assert.match(copy.body, /expired/i);
  assert.match(copy.body, /already used/i);
  assert.match(copy.body, /fresh link/i);
});

test('a consumed verification link gets the same ambiguity, and notes the account may already be verified', () => {
  const copy = describeEmailActionError('auth/invalid-action-code');
  assert.equal(copy.title, describeEmailActionError('auth/expired-action-code').title);
  assert.match(copy.body, /already be verified/i);
  assert.match(copy.body, /fresh link/i);
});

test('unknown link failures get a generic recovery', () => {
  const copy = describeEmailActionError('auth/unknown');
  assert.match(copy.title, /did not work/i);
  const fallback = describeEmailActionError(undefined);
  assert.equal(fallback.title, copy.title);
});
