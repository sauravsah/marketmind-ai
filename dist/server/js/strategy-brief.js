// Use the same collector for draft saves and research submissions. Drafts may
// be incomplete, and saving a brief must not discard existing intelligence.
export function collectStrategyBrief(strategy, data, now = new Date().toISOString()) {
  return {
    ...strategy,
    idea: String(data.get('idea') || '').trim(),
    audience: String(data.get('audience') || '').trim(),
    platforms: data.get('platform') ? [String(data.get('platform'))] : [],
    objective: String(data.get('objective') || ''),
    market: String(data.get('market') || '').trim(),
    researchDepth: String(data.get('researchDepth') || 'balanced'),
    status: strategy.status || 'draft',
    createdAt: strategy.createdAt || now,
    updatedAt: now,
  };
}
