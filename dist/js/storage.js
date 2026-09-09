const KEYS = {
  brand: 'marketmind.brand-profile',
  strategies: 'marketmind.strategies',
  workspace: 'marketmind.workspace-settings',
  legacyProviderSettings: 'marketmind.api-settings',
};

const DEFAULT_WORKSPACE = {
  workspaceName: '',
  defaultMarket: '',
  defaultAudience: '',
  defaultPlatform: '',
  defaultObjective: '',
};

function read(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The product remains usable if browser storage is unavailable.
  }
}

function migrationKey(userId) {
  return `marketmind.migration.${String(userId || 'unknown')}`;
}

function removeLegacyProviderSettings() {
  try {
    window.localStorage.removeItem(KEYS.legacyProviderSettings);
  } catch {
    // The product remains usable if browser storage is unavailable.
  }
}

export const storage = {
  getBrand(fallback) {
    return read(KEYS.brand, fallback);
  },
  saveBrand(value) {
    write(KEYS.brand, value);
  },
  getStrategies() {
    return read(KEYS.strategies, []);
  },
  saveStrategy(value) {
    const existing = read(KEYS.strategies, []);
    write(KEYS.strategies, [value, ...existing.filter((item) => item.id !== value.id)].slice(0, 12));
  },
  getWorkspace(fallback = DEFAULT_WORKSPACE) {
    removeLegacyProviderSettings();
    return { ...fallback, ...DEFAULT_WORKSPACE, ...read(KEYS.workspace, {}) };
  },
  saveWorkspace(value) {
    removeLegacyProviderSettings();
    write(KEYS.workspace, { ...DEFAULT_WORKSPACE, ...value });
  },
  getLocalSnapshot() {
    return {
      brand: this.getBrand(null),
      workspace: this.getWorkspace({ ...DEFAULT_WORKSPACE }),
      strategies: this.getStrategies(),
    };
  },
  hasLocalData() {
    const snapshot = this.getLocalSnapshot();
    return Boolean(
      snapshot.brand?.name || snapshot.brand?.description || snapshot.brand?.industry || snapshot.brand?.audience ||
      Object.values(snapshot.workspace || {}).some((value) => String(value || '').trim()) ||
      snapshot.strategies.length,
    );
  },
  getMigrationMarker(userId) {
    return read(migrationKey(userId), null);
  },
  setMigrationMarker(userId, value = { completedAt: new Date().toISOString() }) {
    write(migrationKey(userId), value);
  },
};
