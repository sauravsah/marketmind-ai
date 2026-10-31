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

export const CAMPAIGN_SECTION_LABELS = {
  all: 'the full campaign strategy',
  foundation: 'the strategic foundation',
  territories: 'the creative territories',
  concept: 'the campaign concept',
  channels: 'the channel strategy',
  measurement: 'the KPIs, experiments, and risks',
};

export function campaignSectionHasContent(section, campaign = {}) {
  if (!campaign || campaign.meta?.status !== 'ready') return false;
  switch (section) {
    case 'foundation': return Boolean(campaign.strategicProblem?.statement || campaign.campaignThesis?.statement);
    case 'territories': return Boolean(campaign.creativeTerritories?.length);
    case 'concept': return Boolean(campaign.campaignConcept?.bigIdea);
    case 'channels': return Boolean(campaign.platformStrategy?.length || campaign.contentPillars?.length);
    case 'measurement': return Boolean(campaign.kpis?.length || campaign.experiments?.length || campaign.risks?.length || campaign.killCriteria?.length);
    case 'all':
    default: return true;
  }
}

export function regenerateConfirmCopy(section, hasContent) {
  const label = CAMPAIGN_SECTION_LABELS[section] || CAMPAIGN_SECTION_LABELS.all;
  if (hasContent) {
    return {
      title: `Regenerate ${label}?`,
      body: `This replaces ${label} with a new AI generation and may use your generation quota. Cancel keeps everything as it is.`,
      confirmLabel: 'Regenerate',
    };
  }
  return {
    title: `Generate ${label}?`,
    body: `This creates ${label} with a new AI generation and may use your generation quota. Cancel keeps everything as it is.`,
    confirmLabel: 'Generate',
  };
}
