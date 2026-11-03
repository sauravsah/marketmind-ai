import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceRepository } from '../js/repository.js';
import { createAccountStorage } from '../js/storage.js';

function makeFirestore({ failOn = null } = {}) {
  const order = [];
  // Paths carry the mock root prefix 'db/' because the client db handle has no path.
  const docs = new Map([
    ['db/users/u1', { name: 'QA Workspace' }],
    ['db/users/u1/strategies/s1', { payload: { id: 's1' } }],
    ['db/users/u1/strategies/s2', { payload: { id: 's2' } }],
  ]);
  const api = {
    doc: (parent, ...segments) => ({ path: `${parent.path || 'db'}/${segments.join('/')}` }),
    collection: (parent, ...segments) => ({ path: `${parent.path}/${segments.join('/')}` }),
    getDoc: async (ref) => ({ exists: () => docs.has(ref.path), data: () => docs.get(ref.path) }),
    getDocs: async (ref) => ({
      docs: [...docs.keys()].filter((key) => key.startsWith(`${ref.path}/`)).map((key) => ({ ref: { path: key }, data: () => docs.get(key) })),
    }),
    setDoc: async (ref, data) => { docs.set(ref.path, data); },
    deleteDoc: async (ref) => {
      if (failOn && ref.path.includes(failOn)) { const e = new Error('firestore unavailable'); throw e; }
      order.push(ref.path);
      docs.delete(ref.path);
    },
  };
  return { api, order, docs };
}

function makeRepository(firestore) {
  return createWorkspaceRepository({ client: { db: {}, firestoreApi: firestore.api }, userId: 'u1' });
}

test('cloud deletion removes strategies first, then the workspace document', async () => {
  const firestore = makeFirestore();
  const repository = makeRepository(firestore);
  const result = await repository.deleteAccountData();
  assert.deepEqual(firestore.order, ['db/users/u1/strategies/s1', 'db/users/u1/strategies/s2', 'db/users/u1']);
  assert.equal(result.strategiesDeleted, 2);
  assert.equal(firestore.docs.size, 0);
});

test('cloud deletion is idempotent: a retry after success is a safe no-op', async () => {
  const firestore = makeFirestore();
  const repository = makeRepository(firestore);
  await repository.deleteAccountData();
  const second = await repository.deleteAccountData();
  assert.equal(second.strategiesDeleted, 0);
  assert.deepEqual(firestore.order.slice(3), ['db/users/u1']);
});

test('a strategies failure reports the stage and partial count, leaving the workspace intact', async () => {
  const firestore = makeFirestore({ failOn: 'strategies/s2' });
  const repository = makeRepository(firestore);
  await assert.rejects(repository.deleteAccountData(), (error) => {
    assert.equal(error.deletionStage, 'strategies');
    assert.equal(error.strategiesDeleted, 1);
    return true;
  });
  assert.ok(firestore.docs.has('db/users/u1'));
  assert.ok(firestore.docs.has('db/users/u1/strategies/s2'));
  // Retry with the failure cleared finishes the job.
  firestore.api.deleteDoc = ((original) => async (ref) => original(ref))(async (ref) => { firestore.order.push(ref.path); firestore.docs.delete(ref.path); });
  const retry = await repository.deleteAccountData();
  assert.equal(retry.strategiesDeleted, 1);
  assert.equal(firestore.docs.size, 0);
});

test('a workspace failure reports the stage after strategies were removed', async () => {
  const firestore = makeFirestore();
  firestore.api.deleteDoc = async (ref) => {
    if (ref.path === 'db/users/u1') { throw new Error('firestore unavailable'); }
    firestore.order.push(ref.path);
    firestore.docs.delete(ref.path);
  };
  const repository = makeRepository(firestore);
  await assert.rejects(repository.deleteAccountData(), (error) => {
    assert.equal(error.deletionStage, 'workspace');
    assert.equal(error.strategiesDeleted, 2);
    return true;
  });
  assert.ok(firestore.docs.has('db/users/u1'));
});

test('local cleanup removes only the deleted account keys', () => {
  // Emulate Web Storage: data lives in enumerable own properties, methods on the prototype.
  const backing = {
    'marketmind.account.u1.brand-profile': '{}',
    'marketmind.account.u1.strategies': '[]',
    'marketmind.account.u1.migration': '{}',
    'marketmind.account.other-user.strategies': '[]',
    'unrelated': '1',
  };
  const fakeStorage = Object.create({
    getItem(k) { return k in this ? this[k] : null; },
    setItem(k, v) { this[k] = v; },
    removeItem(k) { delete this[k]; },
  });
  Object.assign(fakeStorage, backing);
  const store = createAccountStorage(() => fakeStorage);
  const removed = store.clearAccountData('u1');
  assert.equal(removed, 3);
  assert.ok(!('marketmind.account.u1.strategies' in fakeStorage));
  assert.ok('marketmind.account.other-user.strategies' in fakeStorage);
  assert.ok('unrelated' in fakeStorage);
});

test('local cleanup without a user id removes nothing', () => {
  const backing = new Map([['marketmind.account.u1.strategies', '[]']]);
  const store = createAccountStorage(() => ({ getItem: (k) => backing.get(k) ?? null, setItem: () => {}, removeItem: (k) => backing.delete(k) }));
  assert.equal(store.clearAccountData(null), 0);
  assert.equal(store.clearAccountData(''), 0);
});
