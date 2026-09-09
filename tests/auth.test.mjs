import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAuthRoute, isProtectedRoute, isVerifiedUser, routeFromHash } from '../js/auth-routes.js';

const verifiedUser = { id: 'user-1', email: 'team@example.com', email_confirmed_at: '2026-08-29T12:00:00.000Z' };
const unverifiedUser = { id: 'user-1', email: 'team@example.com', email_confirmed_at: null };

test('public and legacy routes resolve to the landing or equivalent workspace route', () => {
  assert.equal(routeFromHash(''), 'landing');
  assert.equal(routeFromHash('#settings'), 'workspace');
  assert.equal(routeFromHash('#research'), 'research');
  assert.equal(routeFromHash('#unknown'), 'landing');
  assert.equal(isProtectedRoute('campaigns'), true);
  assert.equal(isProtectedRoute('landing'), false);
});

test('unauthenticated users are redirected to sign in with their intended stage retained', () => {
  assert.deepEqual(decideAuthRoute('radar', null), { route: 'landing', redirectTo: 'radar' });
  assert.deepEqual(decideAuthRoute('landing', null), { route: 'landing' });
});

test('unverified users are sent to email verification before workspace access', () => {
  assert.equal(isVerifiedUser(unverifiedUser), false);
  assert.deepEqual(decideAuthRoute('dashboard', { user: unverifiedUser }, unverifiedUser), { route: 'verify-email', redirectTo: 'dashboard' });
});

test('verified users can return to the requested stage and public auth routes land in dashboard', () => {
  assert.equal(isVerifiedUser(verifiedUser), true);
  assert.deepEqual(decideAuthRoute('audience', { user: verifiedUser }, verifiedUser), { route: 'audience' });
  assert.deepEqual(decideAuthRoute('sign-in', { user: verifiedUser }, verifiedUser), { route: 'dashboard' });
});

test('Firebase-shaped users are treated as verified by the provider-neutral route guard', () => {
  assert.equal(isVerifiedUser({ uid: 'firebase-user', emailVerified: true }), true);
  assert.deepEqual(decideAuthRoute('strategy', { user: { uid: 'firebase-user', emailVerified: true } }, { uid: 'firebase-user', emailVerified: true }), { route: 'strategy' });
});
