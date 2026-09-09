import { getAudienceReviewSummary, getRadarEligibleAudienceItems } from '../audience-review.js';

const MARKET_KEYS = ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'];
const AUDIENCE_KEYS = ['segments', 'observedBehaviors', 'motivations', 'pains', 'desires', 'tensions', 'barriers', 'objections', 'triggers', 'identityDrivers', 'contentBehaviors', 'decisionFactors', 'momentsThatMatter', 'hypotheses', 'uncertainties'];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sourceBackedItem(raw, knownIds, fallbackType = 'hypothesis') {
  if (raw === null || raw === undefined) return null;
  const object = typeof raw === 'string' ? { statement: raw } : raw;
  if (!object || typeof object !== 'object') return null;
  const statement = clean(object.statement || object.summary || object.title || object.text);
  if (!statement) return null;
  const evidenceType = ['observed', 'inferred', 'hypothesis', 'unknown'].includes(object.evidenceType) ? object.evidenceType : fallbackType;
  const sourceIds = unique(object.sourceIds).filter((id) => knownIds.has(id));
  if (['observed', 'inferred'].includes(evidenceType) && !sourceIds.length) return null;
  return { statement, evidenceType, sourceIds, confidence: ['low', 'medium', 'high'].includes(object.confidence) ? object.confidence : evidenceType === 'observed' ? 'medium' : 'low' };
}

function signalItems(research, knownIds) {
  return MARKET_KEYS.flatMap((key) => Array.isArray(research?.[key]) ? research[key] : []).map((item) => sourceBackedItem(item, knownIds, 'observed')).filter(Boolean);
}

function audienceItems(audience, knownIds) {
  return AUDIENCE_KEYS.flatMap((key) => Array.isArray(audience?.[key]) ? audience[key] : []).map((item) => sourceBackedItem(item, knownIds, item?.evidenceType || 'unknown')).filter(Boolean);
}

export function assessIntelligence(context = {}) {
  const research = context.research || null;
  const audience = context.audience || null;
  const sources = Array.isArray(research?.sources) ? research.sources.filter((source) => source?.id && source?.url) : [];
  const knownIds = new Set(sources.map((source) => source.id));
  const researchSignals = signalItems(research, knownIds);
  const researchStatus = sources.length && research?.meta?.researchedAt ? sources.length >= 3 && research.meta.aiStatus === 'verified' && researchSignals.length ? 'available' : 'limited' : 'missing';
  const allAudienceSignals = audienceItems(audience, knownIds);
  const eligibleAudienceSignals = getRadarEligibleAudienceItems(audience, research)
    .map((item) => sourceBackedItem(item, knownIds, item?.evidenceType || 'unknown'))
    .filter(Boolean);
  const audienceReview = getAudienceReviewSummary(audience);
  let audienceStatus = 'missing';
  if (audience) {
    const researchVersionMatches = Boolean(research?.meta?.researchedAt && audience.researchVersion === research.meta.researchedAt);
    const hasSourceBackedClaims = allAudienceSignals.some((item) => ['observed', 'inferred'].includes(item.evidenceType) && item.sourceIds.length);
    if (audience.meta?.mode === 'research-light' || !research?.meta?.researchedAt) audienceStatus = 'limited';
    else if (!researchVersionMatches || (hasSourceBackedClaims && !eligibleAudienceSignals.length) || (!hasSourceBackedClaims && audienceReview.total)) audienceStatus = 'needs-review';
    else if (audience.evidenceCoverage?.level === 'limited') audienceStatus = 'limited';
    else audienceStatus = 'available';
  }
  return {
    researchStatus,
    audienceStatus,
    sources,
    researchSignals,
    audienceSignals: eligibleAudienceSignals,
    audienceReview,
    audienceEligibleCount: eligibleAudienceSignals.length,
    bothMissing: researchStatus === 'missing' && audienceStatus === 'missing',
    limited: researchStatus !== 'available' || audienceStatus !== 'available',
  };
}

export function researchIsStale(timestamp, now = new Date(), thresholdDays = 30) {
  if (!timestamp) return true;
  const age = now.getTime() - new Date(timestamp).getTime();
  return Number.isFinite(age) && age > thresholdDays * 86400000;
}
