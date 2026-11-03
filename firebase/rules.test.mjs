// Firestore security rules tests, run against the local Firestore emulator:
//   cd firebase && npm install && npm test
// Covers the deletion-tombstone design: a durable accountTombstones/{uid}
// document that no client can modify or remove, blocking all future
// create/update of the account's workspace data while cleanup deletes
// remain allowed.
import test from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, updateDoc, getDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-marketmind',
    firestore: { rules, host: '127.0.0.1', port: 8099 },
  });
});
test.after(async () => { await testEnv.cleanup(); });
test.beforeEach(async () => { await testEnv.clearFirestore(); });

const db = (uid) => testEnv.authenticatedContext(uid).firestore();
const workspace = (uid) => doc(db(uid), 'users', uid);
const strategy = (uid, id) => doc(db(uid), 'users', uid, 'strategies', id);
const tombstone = (uid) => doc(db(uid), 'accountTombstones', uid);
const tombstoneData = () => ({ schema: 1, deletedAt: Timestamp.now() });

test('owner has full access to their workspace and strategies before any tombstone', async () => {
  await assertSucceeds(setDoc(workspace('u1'), { name: 'QA' }));
  await assertSucceeds(updateDoc(workspace('u1'), { name: 'QA 2' }));
  await assertSucceeds(getDoc(workspace('u1')));
  await assertSucceeds(setDoc(strategy('u1', 's1'), { payload: {} }));
  await assertSucceeds(updateDoc(strategy('u1', 's1'), { payload: { id: 's1' } }));
  await assertSucceeds(getDoc(strategy('u1', 's1')));
  await assertSucceeds(deleteDoc(strategy('u1', 's1')));
  await assertSucceeds(deleteDoc(workspace('u1')));
});

test('a user whose workspace document does not exist can create one (absent-doc handling)', async () => {
  // Neither users/u1 nor accountTombstones/u1 exist: creation must still pass.
  await assertSucceeds(setDoc(workspace('u1'), { name: 'first save' }));
  await assertSucceeds(setDoc(strategy('u1', 's1'), { payload: {} }));
});

test('non-owners cannot touch another user\'s data or tombstone', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'u1'), { name: 'QA' });
  });
  const attacker = db('attacker');
  await assertFails(setDoc(doc(attacker, 'users', 'u1'), { name: 'evil' }));
  await assertFails(getDoc(doc(attacker, 'users', 'u1')));
  await assertFails(deleteDoc(doc(attacker, 'users', 'u1')));
  await assertFails(setDoc(doc(attacker, 'accountTombstones', 'u1'), tombstoneData()));
});

test('tombstone accepts only the minimal marker and becomes immutable', async () => {
  await assertSucceeds(setDoc(tombstone('u1'), tombstoneData()));
  await assertFails(setDoc(tombstone('u2'), { schema: 1, deletedAt: Timestamp.now(), extra: 'x' }));
  await assertFails(setDoc(tombstone('u3'), { schema: 2, deletedAt: Timestamp.now() }));
  await assertFails(setDoc(tombstone('u4'), { schema: 1, deletedAt: 'not-a-timestamp' }));
  // No client may read, modify, or remove a tombstone - not even its owner.
  await assertFails(getDoc(tombstone('u1')));
  await assertFails(setDoc(tombstone('u1'), tombstoneData()));
  await assertFails(deleteDoc(tombstone('u1')));
});

test('once tombstoned, no client can create or update workspace data, but cleanup deletes still work', async () => {
  await setDoc(workspace('u1'), { name: 'QA' });
  await setDoc(strategy('u1', 's1'), { payload: { id: 's1' } });
  await setDoc(tombstone('u1'), tombstoneData());
  // Stale tabs, other devices, or a pre-deletion ID token: all writes denied.
  await assertFails(setDoc(workspace('u1'), { name: 'recreated' }));
  await assertFails(updateDoc(workspace('u1'), { name: 'recreated' }));
  await assertFails(setDoc(strategy('u1', 's2'), { payload: {} }));
  await assertFails(updateDoc(strategy('u1', 's1'), { payload: { id: 's1' } }));
  // Reads and deletes (the cleanup path) stay permitted.
  await assertSucceeds(getDoc(workspace('u1')));
  await assertSucceeds(deleteDoc(strategy('u1', 's1')));
  await assertSucceeds(deleteDoc(workspace('u1')));
});

test('a tombstone also blocks recreating the workspace after it was deleted', async () => {
  await setDoc(workspace('u1'), { name: 'QA' });
  await setDoc(tombstone('u1'), tombstoneData());
  await deleteDoc(workspace('u1'));
  // The orphan-recreation path: workspace absent + tombstone present.
  await assertFails(setDoc(workspace('u1'), { name: 'orphan' }));
});
