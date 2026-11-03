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

import { emailActionRoute, defaultActionHandlerUrl } from '../js/auth.js';

// The console action URL is shared across every auth email template, so the
// modes the app completes itself are explicit and everything else is sent,
// untouched, to Firebase's default hosted handler.
test('verifyEmail and resetPassword are completed in-app', () => {
  assert.equal(emailActionRoute('verifyEmail'), 'verify-in-app');
  assert.equal(emailActionRoute('resetPassword'), 'reset-in-app');
});

test('recoverEmail and any other or unknown mode forward to the default handler', () => {
  assert.equal(emailActionRoute('recoverEmail'), 'forward-to-default-handler');
  assert.equal(emailActionRoute('verifyAndChangeEmail'), 'forward-to-default-handler');
  assert.equal(emailActionRoute('revertSecondFactorAddition'), 'forward-to-default-handler');
  assert.equal(emailActionRoute('something-future'), 'forward-to-default-handler');
  assert.equal(emailActionRoute(''), 'forward-to-default-handler');
});

test('the default handler URL keeps the original query and requires an authDomain', () => {
  assert.equal(
    defaultActionHandlerUrl('example.firebaseapp.com', '?mode=recoverEmail&oobCode=ABC'),
    'https://example.firebaseapp.com/__/auth/action?mode=recoverEmail&oobCode=ABC'
  );
  assert.equal(defaultActionHandlerUrl('', '?mode=recoverEmail'), '');
  assert.equal(defaultActionHandlerUrl(undefined, '?mode=recoverEmail'), '');
});

// Signed-out browsers (the mail app's own window) have no session watching,
// so the copy must not promise an automatic check or offer a resend the app
// cannot perform there.
test('signed-out recovery copy routes through sign-in instead of the watcher', () => {
  for (const code of ['auth/expired-action-code', 'auth/invalid-action-code']) {
    const copy = describeEmailActionError(code, { signedIn: false });
    assert.doesNotMatch(copy.body, /keeps checking/i);
    assert.match(copy.body, /sign in/i);
    assert.match(copy.body, /already used/i);
    assert.match(copy.body, /expired/i);
  }
  const generic = describeEmailActionError('auth/unknown', { signedIn: false });
  assert.doesNotMatch(generic.body, /keeps checking/i);
  assert.match(generic.body, /sign in/i);
});

test('signed-in copy keeps the watcher promise and resend guidance', () => {
  const copy = describeEmailActionError('auth/invalid-action-code', { signedIn: true });
  assert.match(copy.body, /keeps checking/i);
  assert.match(copy.body, /fresh link below/i);
});

// The forward destination is always the project's own authDomain handler.
// Nothing in the forwarded query (continueUrl or anything else) can steer
// the browser to a different host.
test('the forward target is pinned to the project authDomain, never to query content', () => {
  const target = defaultActionHandlerUrl(
    'example.firebaseapp.com',
    '?mode=recoverEmail&oobCode=ABC&continueUrl=https%3A%2F%2Fevil.example%2Fsteal'
  );
  assert.ok(target.startsWith('https://example.firebaseapp.com/__/auth/action?'));
  assert.match(target, /continueUrl=/); // passed through for the default handler, as today
  assert.equal(new URL(target).host, 'example.firebaseapp.com');
});
