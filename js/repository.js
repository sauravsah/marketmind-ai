import { storage } from './storage.js';

const WORKSPACE_FIELDS = ['workspaceName', 'defaultMarket', 'defaultAudience', 'defaultPlatform', 'defaultObjective'];

function meaningful(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function copy(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export function mergeRemoteWorkspace(remote = {}, local = {}) {
  const merged = {};
  for (const field of WORKSPACE_FIELDS) merged[field] = meaningful(remote[field]) ? remote[field] : (local[field] || '');
  const remoteBrand = remote.brandProfile || remote.brand || {};
  const localBrand = local.brandProfile || local.brand || {};
  merged.brandProfile = mergeRemoteBrand(remoteBrand, localBrand);
  return merged;
}

export function mergeRemoteBrand(remote = {}, local = {}) {
  const merged = { ...copy(local), ...copy(remote) };
  for (const [key, value] of Object.entries(local || {})) {
    if (!meaningful(remote?.[key]) && value !== null && value !== undefined) merged[key] = copy(value);
  }
  if (remote.voice || local.voice) merged.voice = mergeRemoteBrand(remote.voice || {}, local.voice || {});
  return merged;
}

export function summarizeMigration(localSnapshot = {}, remoteWorkspace = {}, remoteStrategies = []) {
  const localWorkspace = localSnapshot.workspace || {};
  const localBrand = localSnapshot.brand || {};
  const localStrategies = Array.isArray(localSnapshot.strategies) ? localSnapshot.strategies : [];
  const remoteIds = new Set(remoteStrategies.map((strategy) => strategy.id).filter(Boolean));
  const workspaceFields = WORKSPACE_FIELDS.filter((field) => meaningful(localWorkspace[field]) && !meaningful(remoteWorkspace[field]));
  const brandFields = Object.keys(localBrand).filter((field) => meaningful(localBrand[field]) && !meaningful((remoteWorkspace.brandProfile || {})[field]));
  const importableStrategies = localStrategies.filter((strategy) => strategy?.id && !remoteIds.has(strategy.id));
  return {
    localStrategyCount: localStrategies.length,
    importableStrategyCount: importableStrategies.length,
    conflictingStrategyCount: localStrategies.length - importableStrategies.length,
    workspaceFieldCount: workspaceFields.length,
    brandFieldCount: brandFields.length,
    hasLocalBrand: Boolean(localBrand.name || localBrand.description || localBrand.industry || localBrand.audience),
    hasLocalData: Boolean(localStrategies.length || workspaceFields.length || brandFields.length),
  };
}

export function serializeWorkspaceDocument(workspace = {}, userId) {
  return {
    ownerId: userId,
    name: workspace.workspaceName || '',
    defaultMarket: workspace.defaultMarket || '',
    defaultAudience: workspace.defaultAudience || '',
    defaultPlatform: workspace.defaultPlatform || '',
    defaultObjective: workspace.defaultObjective || '',
    brandProfile: copy(workspace.brandProfile || workspace.brand || {}),
    metadata: copy(workspace.metadata || {}),
  };
}

export function serializeStrategyDocument(strategy = {}, userId) {
  return { ownerId: userId, legacyId: String(strategy.id || ''), payload: copy(strategy) };
}

// Retain the old export names for integrations that used the pure serializers.
export const serializeWorkspaceRow = serializeWorkspaceDocument;
export const serializeStrategyRow = serializeStrategyDocument;

function getFirestoreClient(client) {
  const db = client?.db || client?.firestore?.db || client;
  const api = client?.firestoreApi || client?.firestore || {};
  if (!db || typeof api.doc !== 'function' || typeof api.getDoc !== 'function') throw new Error('A signed-in Firebase Firestore client is required.');
  return { db, api };
}

function strategyDocumentId(strategyId) {
  return encodeURIComponent(String(strategyId || ''));
}

export function createWorkspaceRepository({ client, userId, local = storage, isCurrent = () => true }) {
  if (!client || !userId) throw new Error('A signed-in Firebase client is required.');
  const { db, api } = getFirestoreClient(client);
  let workspaceId = userId;
  let deleting = false;

  // While account deletion runs, no save from an autosave, listener, or stale
  // UI path may recreate documents that were just removed.
  function assertWritable() {
    if (deleting) throw new Error('Account deletion is in progress. Saving is paused until it completes.');
  }

  function assertCurrent() {
    if (!isCurrent()) throw new Error('The workspace account changed. Reopen the current workspace before saving.');
  }

  function workspaceRef() {
    return api.doc(db, 'users', userId);
  }

  function tombstoneRef() {
    return api.doc(db, 'accountTombstones', userId);
  }

  function strategyCollectionRef() {
    return api.collection(workspaceRef(), 'strategies');
  }

  function workspaceFromSnapshot(snapshot) {
    if (!snapshot?.exists()) return null;
    const row = snapshot.data() || {};
    workspaceId = userId;
    return {
      id: userId,
      workspaceName: row.name || '',
      defaultMarket: row.defaultMarket || '',
      defaultAudience: row.defaultAudience || '',
      defaultPlatform: row.defaultPlatform || '',
      defaultObjective: row.defaultObjective || '',
      brandProfile: copy(row.brandProfile || {}),
      metadata: copy(row.metadata || {}),
    };
  }

  async function getWorkspace() {
    assertCurrent();
    const snapshot = await api.getDoc(workspaceRef());
    assertCurrent();
    return workspaceFromSnapshot(snapshot);
  }

  async function requestBetaAccess(email) {
    assertWritable();
    assertCurrent();
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) throw new Error('Your account email is not available yet. Try again in a moment.');
    // Self-service record on the user's own document. This never grants
    // access: the server-side allowlist remains the only authority, and the
    // administrator reviews requests from the Firebase console / Vercel logs.
    await api.setDoc(workspaceRef(), { accessRequest: { email: normalized, status: 'pending', requestedAt: new Date().toISOString() } }, { merge: true });
    return { email: normalized, status: 'pending' };
  }

  async function saveWorkspace(workspace) {
    assertWritable();
    assertCurrent();
    const payload = serializeWorkspaceDocument(workspace, userId);
    await api.setDoc(workspaceRef(), { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
    return getWorkspace();
  }

  async function getStrategies() {
    assertCurrent();
    const snapshot = await api.getDocs(strategyCollectionRef());
    assertCurrent();
    return (snapshot?.docs || [])
      .map((document) => copy(document.data()?.payload))
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async function saveStrategy(strategy) {
    assertWritable();
    assertCurrent();
    if (!strategy?.id) throw new Error('A strategy id is required.');
    const reference = api.doc(strategyCollectionRef(), strategyDocumentId(strategy.id));
    await api.setDoc(reference, { ...serializeStrategyDocument(strategy, userId), updatedAt: new Date().toISOString() }, { merge: true });
    return copy(strategy);
  }

  async function migrateLocalData() {
    assertWritable();
    assertCurrent();
    const snapshot = local.getLocalSnapshot();
    const remoteWorkspace = (await getWorkspace()) || {};
    const remoteStrategies = await getStrategies();
    assertCurrent();
    const summary = summarizeMigration(snapshot, remoteWorkspace, remoteStrategies);
    const merged = mergeRemoteWorkspace(remoteWorkspace, { ...snapshot.workspace, brandProfile: snapshot.brand });
    const savedWorkspace = await saveWorkspace(merged);
    const remoteIds = new Set(remoteStrategies.map((strategy) => strategy.id).filter(Boolean));
    const imported = [];
    for (const strategy of snapshot.strategies) {
      if (!strategy?.id || remoteIds.has(strategy.id)) continue;
      imported.push(await saveStrategy(strategy));
    }
    assertCurrent();
    local.setMigrationMarker(userId, { completedAt: new Date().toISOString(), importedStrategyCount: imported.length, conflictCount: summary.conflictingStrategyCount });
    return { summary, workspace: savedWorkspace, strategies: [...remoteStrategies, ...imported], imported };
  }

  function isPermissionDenied(error) {
    const text = `${error?.code || ''} ${error?.message || ''}`;
    return /permission[-_]denied|insufficient permissions/i.test(text);
  }

  // Permanently deletes every cloud record owned by this account. The first
  // step writes a durable tombstone (accountTombstones/{uid}) that the
  // Firestore rules use to reject every further create/update for this
  // account from ANY client - other tabs, other devices, stale offline
  // writes, or an ID token issued before the auth record is removed (ID
  // tokens can stay valid for up to an hour after deletion). No client can
  // update or remove the tombstone, so the lockout cannot expire. Deletes
  // stay permitted so the cleanup below - and any retry - can finish.
  // Every step is idempotent, and the caller learns how far it got from the
  // thrown step marker.
  async function deleteAccountData() {
    deleting = true;
    assertCurrent();
    try {
      // Firestore converts the Date to a Timestamp; the rules require one.
      await api.setDoc(tombstoneRef(), { schema: 1, deletedAt: new Date() });
    } catch (error) {
      // permission-denied on the tombstone means a previous deletion attempt
      // already wrote it: clients may create it once and can never update or
      // delete it, so the lockout is already active and cleanup can continue.
      if (!isPermissionDenied(error)) {
        error.deletionStage = 'tombstone';
        error.strategiesDeleted = 0;
        throw error;
      }
    }
    const snapshot = await api.getDocs(strategyCollectionRef());
    assertCurrent();
    let strategiesDeleted = 0;
    try {
      for (const document of snapshot?.docs || []) {
        await api.deleteDoc(document.ref);
        strategiesDeleted += 1;
      }
    } catch (error) {
      error.deletionStage = 'strategies';
      error.strategiesDeleted = strategiesDeleted;
      throw error;
    }
    assertCurrent();
    try {
      await api.deleteDoc(workspaceRef());
    } catch (error) {
      error.deletionStage = 'workspace';
      error.strategiesDeleted = strategiesDeleted;
      throw error;
    }
    return { strategiesDeleted };
  }

  return { getWorkspace, saveWorkspace, requestBetaAccess, getStrategies, saveStrategy, migrateLocalData, deleteAccountData, workspaceId };
}
