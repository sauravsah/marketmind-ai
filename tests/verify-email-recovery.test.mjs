import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEmailActionError } from '../js/auth.js';

test('an expired verification link gets a fresh-link recovery', () => {
  const copy = describeEmailActionError('auth/expired-action-code');
  assert.match(copy.title, /expired/i);
  assert.match(copy.body, /fresh/i);
});

test('a consumed verification link explains the account may already be verified', () => {
  const copy = describeEmailActionError('auth/invalid-action-code');
  assert.match(copy.title, /already used/i);
  assert.match(copy.body, /already be verified/i);
  assert.match(copy.body, /fresh link/i);
});

test('unknown link failures get a generic recovery', () => {
  const copy = describeEmailActionError('auth/unknown');
  assert.match(copy.title, /did not work/i);
  const fallback = describeEmailActionError(undefined);
  assert.equal(fallback.title, copy.title);
});
