import { CAMPAIGN_OBJECTIVES } from '../models.js';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourceIdsFrom(value, knownIds) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean))].filter((id) => knownIds.has(id));
}

export function applyCampaignOverrides(campaign, overrides = campaign?.userOverrides || {}) {
  const next = { ...campaign, userOverrides: { ...(campaign?.userOverrides || {}), ...overrides } };
  const known = new Set(next.sourceIds || []);
  if (overrides.name !== undefined) next.name = clean(overrides.name);
  if (overrides.objective !== undefined && CAMPAIGN_OBJECTIVES.includes(overrides.objective)) {
    next.objective = overrides.objective;
    next.objectiveRationale = 'User-edited objective.';
  }
  if (overrides.campaignThesis !== undefined) next.campaignThesis = { ...next.campaignThesis, statement: clean(overrides.campaignThesis), evidenceType: 'hypothesis', sourceIds: [] };
  if (overrides.coreMessage !== undefined) next.coreMessage = { ...next.coreMessage, statement: clean(overrides.coreMessage), evidenceType: 'hypothesis', sourceIds: [] };
  if (overrides.primaryCta !== undefined) next.ctaStrategy = { ...next.ctaStrategy, primary: clean(overrides.primaryCta), sourceIds: [] };
  if (Array.isArray(overrides.platformRoles)) next.platformStrategy = overrides.platformRoles.map((item) => ({ ...item, sourceIds: [] })).filter((item) => item.platform || item.role);
  if (Array.isArray(overrides.contentPillars)) next.contentPillars = overrides.contentPillars.map((item) => ({ ...item, sourceIds: [] })).filter((item) => item.name || item.purpose || item.message);
  next.sourceIds = sourceIdsFrom(next.sourceIds, known);
  return next;
}
