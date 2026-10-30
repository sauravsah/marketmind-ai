import { synthesizeAudience } from './ai.js';
import { createEmptyAudienceProfile } from '../models.js';
import { validateAudienceEvidence as validateItemEvidence } from '../prompts/audience.js';
import { ensureAudienceClaimMetadata, getAudienceReviewSummary } from '../audience-review.js';
import { applyAudienceClaimConsistency } from './claim-consistency.js';

const SIGNAL_KEYS = ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'];
const ITEM_KEYS = ['segments', 'observedBehaviors', 'motivations', 'pains', 'desires', 'tensions', 'barriers', 'objections', 'triggers', 'identityDrivers', 'contentBehaviors', 'decisionFactors', 'momentsThatMatter', 'hypotheses', 'uncertainties'];

const STAGES = [
  { id: 'reading', label: 'Reading market evidence' },
  { id: 'signals', label: 'Identifying behavioral signals' },
  { id: 'motivations', label: 'Mapping motivations and barriers' },
  { id: 'evidence', label: 'Separating evidence from hypotheses' },
  { id: 'model', label: 'Building audience model' },
];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stage(onStage, index, detail = '') {
  const current = STAGES[Math.min(index, STAGES.length - 1)];
  onStage({ ...current, detail });
}

export function prepareAudienceEvidence(context) {
  const research = context?.research || null;
  const sources = Array.isArray(research?.sources) ? research.sources.filter((source) => source?.id && source?.url) : [];
  const signals = SIGNAL_KEYS.flatMap((key) => (Array.isArray(research?.[key]) ? research[key] : [])).map((signal) => ({
    title: clean(signal.title),
    summary: clean(signal.summary),
    type: clean(signal.type),
    sourceIds: unique(Array.isArray(signal.sourceIds) ? signal.sourceIds : []).filter((id) => sources.some((source) => source.id === id)),
    freshness: signal.freshness,
    confidence: signal.confidence,
  })).filter((signal) => signal.title && signal.sourceIds.length);
  return {
    sources,
    signals,
    sourceIds: sources.map((source) => source.id),
    researchAvailable: Boolean(sources.length || signals.length || research?.meta?.researchedAt),
  };
}

function looksLikeQuote(value) {
  const text = clean(value);
  return (/^["“].+["”]$/.test(text) && text.split(/\s+/).length > 3) || /^(customer|participant|user)\s+(said|says|voice):/i.test(text) || /^(i|we|my|our)\b/i.test(text);
}

function normalizeItem(raw, sourceIds, forcedType = '', category = '') {
  if (raw === null || raw === undefined) return null;
  const object = typeof raw === 'string' ? { statement: raw } : raw;
  if (!object || typeof object !== 'object') return null;
  if (object.quote || object.customerQuote || object.verbatimVoice || object.testimonial) return null;
  const statement = clean(object.statement || object.title || object.summary || object.text);
  if (!statement || looksLikeQuote(statement)) return null;
  const evidence = validateItemEvidence({ ...object, evidenceType: forcedType || object.evidenceType }, sourceIds);
  let evidenceType = forcedType || evidence.evidenceType;
  let mappedSourceIds = evidence.sourceIds;
  if (evidenceType === 'observed' && !evidence.hasKnownSources) return null;
  if (evidenceType === 'inferred' && !evidence.hasKnownSources) evidenceType = 'hypothesis';
  if (evidenceType === 'unknown') mappedSourceIds = [];
  return ensureAudienceClaimMetadata({
    statement,
    evidenceType,
    sourceIds: mappedSourceIds,
    confidence: ['low', 'medium', 'high'].includes(object.confidence) ? object.confidence : evidenceType === 'hypothesis' || evidenceType === 'unknown' ? 'low' : 'medium',
    freshness: ['very-recent', 'recent', 'older', 'unknown'].includes(object.freshness) ? object.freshness : 'unknown',
    whyItMatters: clean(object.whyItMatters || object.interpretation),
    validationMethod: clean(object.validationMethod || object.test),
  }, category);
}

function normalizeCollection(items, sourceIds, forcedType = '', category = '') {
  return (Array.isArray(items) ? items : []).map((item) => normalizeItem(item, sourceIds, forcedType, category)).filter(Boolean);
}

export function validateAudienceProfile(candidate, sources = [], options = {}) {
  const profile = createEmptyAudienceProfile();
  const sourceIds = sources.map((source) => source.id).filter(Boolean);
  profile.summary = clean(candidate?.summary);
  profile.segments = normalizeCollection(candidate?.segments, sourceIds, '', 'segments');
  profile.observedBehaviors = normalizeCollection(candidate?.observedBehaviors, sourceIds, 'observed', 'observedBehaviors');
  for (const key of ITEM_KEYS.filter((itemKey) => !['segments', 'observedBehaviors', 'hypotheses', 'uncertainties'].includes(itemKey))) profile[key] = normalizeCollection(candidate?.[key], sourceIds, '', key);
  profile.hypotheses = normalizeCollection(candidate?.hypotheses, sourceIds, 'hypothesis', 'hypotheses');
  profile.uncertainties = normalizeCollection(candidate?.uncertainties, sourceIds, 'unknown', 'uncertainties');
  profile.evidenceCoverage = calculateEvidenceCoverage(options.research || null, profile);
  return profile;
}

export function calculateEvidenceCoverage(research, profile) {
  const sourceCount = Array.isArray(research?.sources) ? research.sources.length : 0;
  const items = ITEM_KEYS.flatMap((key) => profile?.[key] || []);
  const mappedInsightCount = items.filter((item) => item.sourceIds?.length && ['observed', 'inferred'].includes(item.evidenceType)).length;
  const claimCount = items.filter((item) => ['observed', 'inferred'].includes(item.evidenceType)).length;
  const review = getAudienceReviewSummary(profile);
  const withReview = (coverage) => ({ ...coverage, reviewedCount: review.reviewedCount, reviewCoveragePercent: review.reviewCoveragePercent, radarReadyCount: review.radarReadyCount });
  if (!sourceCount || !research?.meta?.researchedAt) return withReview({ level: 'limited', reason: 'Based primarily on strategy context and general reasoning, not live market evidence.', sourceCount, coveredInsightCount: mappedInsightCount });
  const ratio = claimCount ? mappedInsightCount / claimCount : 0;
  if (sourceCount >= 5 && ratio >= 0.7) return withReview({ level: 'strong', reason: 'Most evidence-backed audience claims are mapped to current research sources.', sourceCount, coveredInsightCount: mappedInsightCount });
  if (mappedInsightCount) return withReview({ level: 'moderate', reason: 'Some audience claims are mapped to current research sources; hypotheses and unknowns remain.', sourceCount, coveredInsightCount: mappedInsightCount });
  return withReview({ level: 'limited', reason: 'Research is available, but it did not support a mapped audience claim.', sourceCount, coveredInsightCount: 0 });
}

function baseProfile(context, research, mode, aiStatus, warnings = []) {
  const profile = createEmptyAudienceProfile();
  profile.id = `audience-${Date.now()}`;
  profile.strategyId = context?.strategy?.id || null;
  profile.researchVersion = research?.meta?.researchedAt || null;
  profile.createdAt = new Date().toISOString();
  profile.meta = { mode, aiStatus, warnings: warnings.filter(Boolean) };
  return profile;
}

function researchLightProfile(context) {
  const profile = baseProfile(context, null, 'research-light', 'not-configured');
  profile.summary = 'Based primarily on strategy context and general reasoning, not live market evidence.';
  profile.hypotheses = [{
    statement: 'The stated audience may respond to messaging that connects the strategy idea to a meaningful outcome.',
    evidenceType: 'hypothesis', sourceIds: [], confidence: 'low', freshness: 'unknown',
    whyItMatters: 'This gives the team a safe starting point for message testing without presenting an assumption as audience truth.',
    validationMethod: 'Customer interviews, a survey, or message testing with the stated audience.',
  }];
  profile.uncertainties = [{
    statement: 'We do not yet know which behaviors, motivations, barriers, or decision factors are most common for this audience in the stated market.',
    evidenceType: 'unknown', sourceIds: [], confidence: 'low', freshness: 'unknown',
    whyItMatters: 'The next research step should test this before targeting or creative decisions are finalized.',
    validationMethod: 'Run focused interviews or collect current market evidence.',
  }];
  profile.hypotheses = profile.hypotheses.map((item) => ensureAudienceClaimMetadata(item, 'hypotheses'));
  profile.uncertainties = profile.uncertainties.map((item) => ensureAudienceClaimMetadata(item, 'uncertainties'));
  profile.evidenceCoverage = calculateEvidenceCoverage(null, profile);
  return profile;
}

function unavailableProfile(context, research, warning) {
  const profile = baseProfile(context, research, 'research-backed', 'not-configured', [warning]);
  profile.summary = 'Audience intelligence is temporarily unavailable. The research evidence remains available for review.';
  profile.uncertainties = [ensureAudienceClaimMetadata({ statement: 'The supplied research has not been synthesized into an audience model yet.', evidenceType: 'unknown', sourceIds: [], confidence: 'low', freshness: 'unknown', whyItMatters: 'Avoid making audience claims until the evidence is synthesized.', validationMethod: 'Try the analysis again shortly.' }, 'uncertainties')];
  profile.evidenceCoverage = calculateEvidenceCoverage(research, profile);
  return profile;
}

export async function analyzeAudience(context, configs = {}, options = {}) {
  const onStage = options.onStage || (() => {});
  stage(onStage, 0);
  const evidence = prepareAudienceEvidence(context);
  stage(onStage, 1, `${evidence.signals.length} relevant evidence signals found.`);
  if (!evidence.researchAvailable) {
    stage(onStage, 2, 'No live research is attached; keeping claims explicitly hypothetical.');
    stage(onStage, 3);
    stage(onStage, 4);
    return researchLightProfile(context);
  }

  stage(onStage, 2);
  stage(onStage, 3);
  if (!configs.ai?.apiKey) {
    stage(onStage, 4);
    return unavailableProfile(context, context.research, 'MarketMind is temporarily unable to complete this analysis. Please try again.');
  }

  const synthesis = await synthesizeAudience({ ...context, research: context.research }, evidence.sources, configs.ai, options);
  stage(onStage, 4);
  if (!synthesis.candidate) {
    const failed = unavailableProfile(context, context.research, synthesis.warning || 'Audience synthesis failed.');
    failed.meta = { ...(failed.meta || {}), failureReason: synthesis.reason || 'unknown' };
    return failed;
  }
  const profile = baseProfile(context, context.research, 'research-backed', synthesis.status, [synthesis.warning]);
  const validated = validateAudienceProfile(synthesis.candidate, evidence.sources, { research: context.research });
  Object.assign(profile, validated);
  applyAudienceClaimConsistency(profile, evidence.sources, options.now instanceof Date ? options.now : new Date(), { market: context?.strategy?.market });
  profile.id = `audience-${Date.now()}`;
  profile.strategyId = context?.strategy?.id || null;
  profile.researchVersion = context.research?.meta?.researchedAt || null;
  profile.createdAt = new Date().toISOString();
  profile.meta = { ...(profile.meta || {}), mode: 'research-backed', aiStatus: synthesis.status, warnings: [synthesis.warning].filter(Boolean) };
  return profile;
}

export { STAGES as AUDIENCE_ANALYSIS_STAGES };
