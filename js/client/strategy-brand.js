// Per-strategy brand context. A strategy can pin the Brand Voice it was
// created against so later AI runs for that brief keep using it even after
// the workspace Brand Voice changes. Strategies saved before pinning keep
// their ambiguity: they fall back to the live workspace brand until the
// owner explicitly pins one.

function copy(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export function brandHasContent(brand) {
  return Boolean(brand?.name || brand?.description || brand?.industry || brand?.audience);
}

// The brand a strategy's future AI runs should use. A pinned snapshot always
// wins; unpinned strategies fall back to the current workspace brand.
export function resolveStrategyBrand({ strategy, workspaceBrand } = {}) {
  return strategy?.brandSnapshot || workspaceBrand || null;
}

// 'pinned' when the strategy carries its own snapshot, 'unpinned-saved' when
// it is already persisted without one (legacy work to review explicitly),
// 'unsaved' for a brief that only exists in memory.
export function brandPinStatus({ strategy, savedStrategies = [] } = {}) {
  if (!strategy?.id) return 'unsaved';
  if (strategy.brandSnapshot) return 'pinned';
  return savedStrategies.some((item) => item?.id === strategy.id) ? 'unpinned-saved' : 'unsaved';
}

// Returns a new strategy with a deep-copied snapshot of the given brand.
// Never overwrites an existing pin and never pins an empty brand, so a
// snapshot always records a real choice.
export function pinBrandToStrategy(strategy, workspaceBrand, now = new Date().toISOString()) {
  if (!strategy || strategy.brandSnapshot || !brandHasContent(workspaceBrand)) return strategy;
  return { ...strategy, brandSnapshot: copy(workspaceBrand), brandPinnedAt: now };
}

// Future AI runs for a saved-but-unpinned brief would silently use whatever
// the workspace brand is today. Require an explicit pin first; unsaved and
// pinned briefs run freely, and an empty workspace brand has nothing to leak.
export function brandRunGate({ strategy, savedStrategies = [], workspaceBrand } = {}) {
  if (brandPinStatus({ strategy, savedStrategies }) === 'unpinned-saved' && brandHasContent(workspaceBrand)) return 'needs-pin';
  return 'ok';
}

export function strategyBrandLabel(strategy) {
  return String(strategy?.brandSnapshot?.name || '').trim();
}

export function strategyStageLabel(strategy, researchStatus = null) {
  if (strategy?.campaignStrategy) return 'Campaign strategy';
  if (strategy?.opportunityRadar) return 'Opportunity radar';
  if (strategy?.audienceInsights) return 'Audience intelligence';
  if (strategy?.research) return researchStatus === 'partial' ? 'Market research (partial)' : 'Market research';
  return strategy?.objective || 'Strategy brief';
}

export function strategyStageIcon(strategy) {
  if (strategy?.campaignStrategy) return 'layers';
  if (strategy?.opportunityRadar) return 'radar';
  if (strategy?.audienceInsights) return 'message';
  if (strategy?.research) return 'radar';
  return 'sparkles';
}

export function strategyUpdatedAt(strategy) {
  return strategy?.campaignStrategy?.updatedAt
    || strategy?.opportunityRadar?.createdAt
    || strategy?.audienceInsights?.createdAt
    || strategy?.research?.meta?.researchedAt
    || strategy?.updatedAt
    || strategy?.createdAt
    || '';
}

export function sortStrategiesForHistory(strategies = []) {
  return [...strategies].sort((left, right) => String(strategyUpdatedAt(right)).localeCompare(String(strategyUpdatedAt(left))));
}
