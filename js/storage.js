const DEFAULT_WORKSPACE = {
  workspaceName: '', defaultMarket: '', defaultAudience: '', defaultPlatform: '', defaultObjective: '',
};
const KEYS = { brand: 'brand-profile', strategies: 'strategies', workspace: 'workspace-settings' };

// Account namespacing is UI isolation, not encryption or protection against
// someone with access to this browser profile. Never assign unowned old keys.
export function createAccountStorage(getLocalStorage = () => window.localStorage) {
  let accountId = null;
  let epoch = 0;
  function key(name, owner = accountId) {
    return owner ? `marketmind.account.${encodeURIComponent(owner)}.${name}` : null;
  }
  function read(name, fallback) {
    const scopedKey = key(name);
    if (!scopedKey) return fallback;
    try { const value = getLocalStorage().getItem(scopedKey); return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  }
  function write(name, value) {
    const scopedKey = key(name);
    if (!scopedKey) return false;
    try { getLocalStorage().setItem(scopedKey, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  return {
    setAccount(userId) {
      const next = userId ? String(userId) : null;
      if (next !== accountId) { accountId = next; epoch += 1; }
      return epoch;
    },
    capture() { return { userId: accountId, epoch }; },
    isCurrent(session) { return Boolean(session?.userId && session.userId === accountId && session.epoch === epoch); },
    getBrand(fallback) { return read(KEYS.brand, fallback); },
    saveBrand(value) { return write(KEYS.brand, value); },
    getStrategies() { const value = read(KEYS.strategies, []); return Array.isArray(value) ? value : []; },
    saveStrategy(value) {
      if (!value?.id) return false;
      const existing = this.getStrategies();
      return write(KEYS.strategies, [value, ...existing.filter(item => item.id !== value.id)].slice(0, 12));
    },
    getWorkspace(fallback = DEFAULT_WORKSPACE) { return { ...fallback, ...DEFAULT_WORKSPACE, ...read(KEYS.workspace, {}) }; },
    saveWorkspace(value) { return write(KEYS.workspace, { ...DEFAULT_WORKSPACE, ...value }); },
    getLocalSnapshot() { return { brand: this.getBrand(null), workspace: this.getWorkspace(), strategies: this.getStrategies() }; },
    hasLocalData() {
      const snapshot = this.getLocalSnapshot();
      return Boolean(snapshot.brand?.name || snapshot.brand?.description || snapshot.brand?.industry || snapshot.brand?.audience ||
        Object.values(snapshot.workspace).some(value => String(value || '').trim()) || snapshot.strategies.length);
    },
    getMigrationMarker(userId) { return userId === accountId ? read('migration', null) : null; },
    setMigrationMarker(userId, value = { completedAt: new Date().toISOString() }) { return userId === accountId && write('migration', value); },
  };
}
export const storage = createAccountStorage();
