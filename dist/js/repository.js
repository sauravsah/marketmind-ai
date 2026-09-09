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

export function createWorkspaceRepository({ client, userId, local = storage }) {
  if (!client || !userId) throw new Error('A signed-in Firebase client is required.');
  const { db, api } = getFirestoreClient(client);
  let workspaceId = userId;

  function workspaceRef() {
    return api.doc(db, 'users', userId);
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
    return workspaceFromSnapshot(await api.getDoc(workspaceRef()));
  }

  async function saveWorkspace(workspace) {
    const payload = serializeWorkspaceDocument(workspace, userId);
    await api.setDoc(workspaceRef(), { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
    return getWorkspace();
  }

  async function getStrategies() {
    const snapshot = await api.getDocs(strategyCollectionRef());
    return (snapshot?.docs || [])
      .map((document) => copy(document.data()?.payload))
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async function saveStrategy(strategy) {
    if (!strategy?.id) throw new Error('A strategy id is required.');
    const reference = api.doc(strategyCollectionRef(), strategyDocumentId(strategy.id));
    await api.setDoc(reference, { ...serializeStrategyDocument(strategy, userId), updatedAt: new Date().toISOString() }, { merge: true });
    return copy(strategy);
  }

  async function migrateLocalData() {
    const snapshot = local.getLocalSnapshot();
    const remoteWorkspace = (await getWorkspace()) || {};
    const remoteStrategies = await getStrategies();
    const summary = summarizeMigration(snapshot, remoteWorkspace, remoteStrategies);
    const merged = mergeRemoteWorkspace(remoteWorkspace, { ...snapshot.workspace, brandProfile: snapshot.brand });
    const savedWorkspace = await saveWorkspace(merged);
    const remoteIds = new Set(remoteStrategies.map((strategy) => strategy.id).filter(Boolean));
    const imported = [];
    for (const strategy of snapshot.strategies) {
      if (!strategy?.id || remoteIds.has(strategy.id)) continue;
      imported.push(await saveStrategy(strategy));
    }
    local.setMigrationMarker(userId, { completedAt: new Date().toISOString(), importedStrategyCount: imported.length, conflictCount: summary.conflictingStrategyCount });
    return { summary, workspace: savedWorkspace, strategies: [...remoteStrategies, ...imported], imported };
  }

  return { getWorkspace, saveWorkspace, getStrategies, saveStrategy, migrateLocalData, workspaceId };
}
