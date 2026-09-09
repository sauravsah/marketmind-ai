import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceRepository, mergeRemoteWorkspace, serializeStrategyRow, serializeWorkspaceRow, summarizeMigration } from '../js/repository.js';

test('workspace serialization keeps defaults and brand profile in a Firebase-safe document', () => {
  const row = serializeWorkspaceRow({ workspaceName: 'North Star', defaultMarket: 'India', brandProfile: { name: 'Acme', voice: { tone: 'Direct' } } }, 'user-1');
  assert.deepEqual(row, {
    ownerId: 'user-1', name: 'North Star', defaultMarket: 'India', defaultAudience: '', defaultPlatform: '', defaultObjective: '', brandProfile: { name: 'Acme', voice: { tone: 'Direct' } }, metadata: {},
  });
});

test('strategy serialization preserves the nested strategy model and stable legacy id', () => {
  const strategy = { id: 'strategy-1', idea: 'Launch', research: { sources: [{ id: 'source-1' }] }, audienceInsights: { items: [] } };
  const row = serializeStrategyRow(strategy, 'user-1');
  assert.equal(row.ownerId, 'user-1');
  assert.equal(row.legacyId, 'strategy-1');
  assert.deepEqual(row.payload, strategy);
});

test('migration fills empty remote workspace fields while remote values win', () => {
  const merged = mergeRemoteWorkspace({ workspaceName: 'Remote', defaultMarket: '', brandProfile: { name: 'Remote brand', industry: '' } }, { workspaceName: 'Local', defaultMarket: 'India', defaultAudience: 'Founders', brandProfile: { name: 'Local brand', industry: 'SaaS' } });
  assert.equal(merged.workspaceName, 'Remote');
  assert.equal(merged.defaultMarket, 'India');
  assert.equal(merged.defaultAudience, 'Founders');
  assert.equal(merged.brandProfile.name, 'Remote brand');
  assert.equal(merged.brandProfile.industry, 'SaaS');
});

test('migration summary does not import conflicting local strategy ids', () => {
  const summary = summarizeMigration({ workspace: {}, brand: { name: 'Acme' }, strategies: [{ id: 'same' }, { id: 'new' }] }, { brandProfile: {} }, [{ id: 'same' }]);
  assert.equal(summary.importableStrategyCount, 1);
  assert.equal(summary.conflictingStrategyCount, 1);
  assert.equal(summary.hasLocalBrand, true);
});

test('Firestore repository persists one user workspace and nested strategies', async () => {
  const documents = new Map();
  const pathFor = (parent, segments) => `${parent?.path ? parent.path : 'firestore'}/${segments.join('/')}`;
  const api = {
    doc: (parent, ...segments) => ({ path: pathFor(parent, segments) }),
    collection: (parent, ...segments) => ({ path: pathFor(parent, segments) }),
    async getDoc(reference) {
      const data = documents.get(reference.path);
      return { exists: () => Boolean(data), data: () => data };
    },
    async setDoc(reference, data, options = {}) {
      documents.set(reference.path, options.merge ? { ...(documents.get(reference.path) || {}), ...data } : data);
    },
    async getDocs(reference) {
      const prefix = `${reference.path}/`;
      const docs = [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([, data]) => ({ data: () => data }));
      return { docs };
    },
  };
  const repository = createWorkspaceRepository({ client: { db: {}, firestoreApi: api }, userId: 'firebase-user' });
  await repository.saveWorkspace({ workspaceName: 'North Star', defaultMarket: 'India', brandProfile: { name: 'Acme' } });
  await repository.saveStrategy({ id: 'strategy/one', idea: 'Launch' });
  assert.equal((await repository.getWorkspace()).workspaceName, 'North Star');
  assert.deepEqual(await repository.getStrategies(), [{ id: 'strategy/one', idea: 'Launch' }]);
});
