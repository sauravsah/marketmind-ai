import { synthesizeOpportunities } from './ai.js';
import { getAudienceReviewSummary, getRadarEligibleAudienceItems } from '../audience-review.js';
import {
  OPPORTUNITY_CONFIDENCE,
  OPPORTUNITY_SCORE_WEIGHTS,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  createEmptyOpportunity,
  createEmptyOpportunityRadar,
} from '../models.js';

const MARKET_KEYS = ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'];
const AUDIENCE_KEYS = ['segments', 'observedBehaviors', 'motivations', 'pains', 'desires', 'tensions', 'barriers', 'objections', 'triggers', 'identityDrivers', 'contentBehaviors', 'decisionFactors', 'momentsThatMatter', 'hypotheses', 'uncertainties'];
const SCORE_KEYS = Object.keys(OPPORTUNITY_SCORE_WEIGHTS);
const STAGES = [
  { id: 'market', label: 'Reading market signals' },
  { id: 'audience', label: 'Connecting audience insights' },
  { id: 'brand', label: 'Evaluating brand fit' },
  { id: 'competition', label: 'Checking competitive context' },
  { id: 'whitespace', label: 'Identifying strategic whitespace' },
  { id: 'scoring', label: 'Scoring opportunities' },
];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sourceIdsFrom(value, knownIds) {
  const ids = Array.isArray(value) ? value : [];
  return unique(ids).filter((id) => knownIds.has(id));
}

function sourceBackedItem(raw, knownIds, fallbackType = 'hypothesis', requireSource = false) {
  if (raw === null || raw === undefined) return null;
  const object = typeof raw === 'string' ? { statement: raw } : raw;
  if (!object || typeof object !== 'object') return null;
  const statement = clean(object.statement || object.summary || object.title || object.text);
  if (!statement) return null;
  const evidenceType = ['observed', 'inferred', 'hypothesis', 'unknown'].includes(object.evidenceType) ? object.evidenceType : fallbackType;
  const mapped = sourceIdsFrom(object.sourceIds, knownIds);
  if (requireSource && !mapped.length) return null;
  if (['observed', 'inferred'].includes(evidenceType) && !mapped.length) return null;
  return {
    statement,
    evidenceType,
    sourceIds: mapped,
    confidence: ['low', 'medium', 'high'].includes(object.confidence) ? object.confidence : evidenceType === 'observed' ? 'medium' : 'low',
    freshness: ['very-recent', 'recent', 'older', 'unknown'].includes(object.freshness) ? object.freshness : 'unknown',
    whyItMatters: clean(object.whyItMatters || object.interpretation),
    validationMethod: clean(object.validationMethod || object.test),
  };
}

function itemCollection(items, knownIds, fallbackType = 'hypothesis', requireSource = false) {
  return (Array.isArray(items) ? items : []).map((item) => sourceBackedItem(item, knownIds, fallbackType, requireSource)).filter(Boolean);
}

function normalizedStatement(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function allSourceIds(opportunity) {
  const nested = [
    ...(opportunity.marketSignals || []),
    ...(opportunity.audienceSignals || []),
    ...(opportunity.evidence || []),
    ...(opportunity.contradictions || []),
    opportunity.brandFit,
    opportunity.competitiveContext,
    opportunity.timing,
    opportunity.whitespace,
  ];
  return unique(nested.flatMap((item) => item?.sourceIds || []));
}

function signalItems(research, knownIds) {
  return MARKET_KEYS.flatMap((key) => (Array.isArray(research?.[key]) ? research[key] : [])).map((item) => sourceBackedItem(item, knownIds, 'observed', true)).filter(Boolean);
}

function themeItems(research, knownIds) {
  return (Array.isArray(research?.emergingThemes) ? research.emergingThemes : []).map((item) => sourceBackedItem(item, knownIds, 'inferred', true)).filter(Boolean);
}

function audienceItems(audience, research, knownIds) {
  return getRadarEligibleAudienceItems(audience, research).map((item) => sourceBackedItem(item, knownIds, item?.evidenceType || 'unknown', true)).filter(Boolean);
}

export function assessIntelligence(context) {
  const research = context?.research || null;
  const audience = context?.audience || null;
  const sources = Array.isArray(research?.sources) ? research.sources.filter((source) => source?.id && source?.url) : [];
  const researchSignals = signalItems(research, new Set(sources.map((source) => source.id)));
  let researchStatus = 'missing';
  if (sources.length && research?.meta?.researchedAt) researchStatus = sources.length >= 3 && research?.meta?.aiStatus === 'verified' && researchSignals.length ? 'available' : 'limited';
  const knownIds = new Set(sources.map((source) => source.id));
  const eligibleAudienceSignals = audienceItems(audience, research, knownIds);
  const audienceReview = getAudienceReviewSummary(audience);
  const hasSourceBackedClaims = AUDIENCE_KEYS.flatMap((key) => (Array.isArray(audience?.[key]) ? audience[key] : [])).some((item) => ['observed', 'inferred'].includes(item?.evidenceType) && sourceIdsFrom(item?.sourceIds, knownIds).length);
  let audienceStatus = 'missing';
  if (audience) {
    const researchVersionMatches = Boolean(research?.meta?.researchedAt && audience.researchVersion === research.meta.researchedAt);
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
    limited: researchStatus === 'limited' || audienceStatus === 'limited' || researchStatus === 'missing' || audienceStatus === 'missing',
  };
}

export function prepareOpportunityContext(context) {
  const readiness = assessIntelligence(context);
  const knownIds = new Set(readiness.sources.map((source) => source.id));
  const research = context?.research || {};
  return {
    sources: readiness.sources,
    sourceIds: [...knownIds],
    marketSignals: [...readiness.researchSignals, ...themeItems(research, knownIds)],
    audienceSignals: readiness.audienceSignals,
    contradictions: itemCollection(research.contradictions, knownIds, 'inferred', true),
    researchTimestamp: research.meta?.researchedAt || null,
    audienceAnalysisTimestamp: context?.audience?.createdAt || null,
    readiness,
  };
}

export function calculateOpportunityScore(scores = {}) {
  const dimensions = {};
  for (const key of SCORE_KEYS) dimensions[key] = clamp(Math.round(Number(scores[key]) || 1), 1, 10);
  const overall = Math.round(SCORE_KEYS.reduce((total, key) => total + dimensions[key] * OPPORTUNITY_SCORE_WEIGHTS[key], 0) * 10);
  return { ...dimensions, overall: clamp(overall, 1, 100), label: 'AI assessment based on available evidence.' };
}

const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };

export function calculateOpportunityConfidence(opportunity, context = {}) {
  const readiness = context.readiness || assessIntelligence(context);
  const sourceCount = (opportunity?.sourceIds || []).length;
  let level = sourceCount >= 3 && readiness.researchStatus === 'available' && readiness.audienceStatus === 'available' ? 'high' : sourceCount >= 1 ? 'medium' : 'low';
  const audienceEvidence = opportunity?.audienceSignals || [];
  if (readiness.audienceStatus === 'missing' || !audienceEvidence.length) level = 'low';
  if (readiness.audienceStatus === 'limited' || audienceEvidence.some((item) => item.confidence === 'low' || item.evidenceType === 'hypothesis')) level = level === 'high' ? 'medium' : 'low';
  if (readiness.researchStatus === 'missing' || readiness.audienceStatus === 'missing') level = 'low';
  if ((context.research?.contradictions || []).length) level = level === 'high' ? 'medium' : 'low';
  if (context.stale) level = level === 'high' ? 'medium' : 'low';
  const candidate = OPPORTUNITY_CONFIDENCE.includes(opportunity?.confidence) ? opportunity.confidence : level;
  return CONFIDENCE_RANK[candidate] < CONFIDENCE_RANK[level] ? candidate : level;
}

function derivedScores(raw, opportunity, context) {
  const readiness = context.readiness || assessIntelligence(context);
  const sourceCount = opportunity.sourceIds.length;
  const candidate = raw?.scores || {};
  const fallback = {
    audienceRelevance: readiness.audienceStatus === 'available' ? 7 : readiness.audienceStatus === 'limited' ? 4 : 2,
    brandFit: ({ high: 8, medium: 5, low: 2 }[opportunity.brandFit.level] || 2),
    evidenceStrength: sourceCount >= 4 ? 8 : sourceCount >= 2 ? 6 : sourceCount === 1 ? 4 : 2,
    timing: ({ strong: 8, moderate: 6, weak: 3, unknown: 2 }[opportunity.timing.level] || 2),
    competitiveWhitespace: opportunity.whitespace.sourceIds.length || opportunity.competitiveContext.sourceIds.length ? 7 : 3,
    actionability: opportunity.validationPlan.plan && opportunity.recommendedNextStep ? 7 : 4,
  };
  return calculateOpportunityScore({ ...fallback, ...Object.fromEntries(SCORE_KEYS.map((key) => [key, Number.isFinite(Number(candidate[key])) ? candidate[key] : fallback[key]])) });
}

function normalizeOpportunity(raw, index, context, prepared) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clean(raw.title);
  const thesis = clean(raw.strategicThesis);
  if (!title || !thesis) return null;
  const knownIds = new Set(prepared.sourceIds);
  const marketSignals = itemCollection(raw.marketSignals, knownIds, 'observed', false);
  const eligibleAudienceStatements = new Set((prepared.audienceSignals || []).map((item) => normalizedStatement(item.statement)));
  const audienceSignals = itemCollection(raw.audienceSignals, knownIds, 'hypothesis', false).filter((item) => eligibleAudienceStatements.has(normalizedStatement(item.statement)));
  if (!marketSignals.length || !audienceSignals.length) return null;
  const evidence = itemCollection(raw.evidence, knownIds, 'hypothesis', false);
  const contradictions = itemCollection(raw.contradictions, knownIds, 'inferred', false);
  const brandRaw = raw.brandFit && typeof raw.brandFit === 'object' ? raw.brandFit : {};
  const competitiveRaw = raw.competitiveContext && typeof raw.competitiveContext === 'object' ? raw.competitiveContext : {};
  const timingRaw = raw.timing && typeof raw.timing === 'object' ? raw.timing : {};
  const whitespaceRaw = raw.whitespace && typeof raw.whitespace === 'object' ? raw.whitespace : {};
  const opportunity = {
    ...createEmptyOpportunity(),
    id: `opportunity-${Date.now()}-${index + 1}`,
    strategyId: context?.strategy?.id || null,
    title,
    oneLineDescription: clean(raw.oneLineDescription || raw.description),
    type: OPPORTUNITY_TYPES.includes(raw.type) ? raw.type : 'positioning',
    strategicThesis: thesis,
    marketSignals,
    audienceSignals,
    brandFit: { level: ['high', 'medium', 'low'].includes(brandRaw.level) ? brandRaw.level : 'low', explanation: clean(brandRaw.explanation), evidenceType: ['inferred', 'hypothesis', 'unknown', 'observed'].includes(brandRaw.evidenceType) ? brandRaw.evidenceType : 'inferred', sourceIds: sourceIdsFrom(brandRaw.sourceIds, knownIds) },
    competitiveContext: { summary: clean(competitiveRaw.summary), evidenceType: ['observed', 'inferred', 'hypothesis', 'unknown'].includes(competitiveRaw.evidenceType) ? competitiveRaw.evidenceType : 'unknown', sourceIds: sourceIdsFrom(competitiveRaw.sourceIds, knownIds) },
    timing: { level: ['strong', 'moderate', 'weak', 'unknown'].includes(timingRaw.level) ? timingRaw.level : 'unknown', explanation: clean(timingRaw.explanation || timingRaw.whyNow), evidenceType: ['observed', 'inferred', 'hypothesis', 'unknown'].includes(timingRaw.evidenceType) ? timingRaw.evidenceType : 'unknown', sourceIds: sourceIdsFrom(timingRaw.sourceIds, knownIds) },
    evidence,
    contradictions,
    whitespace: { statement: clean(whitespaceRaw.statement || whitespaceRaw.summary), evidenceType: ['inferred', 'hypothesis', 'unknown'].includes(whitespaceRaw.evidenceType) ? whitespaceRaw.evidenceType : 'hypothesis', sourceIds: sourceIdsFrom(whitespaceRaw.sourceIds, knownIds) },
    risks: itemCollection(raw.risks, knownIds, 'unknown', false),
    falsificationSignals: itemCollection(raw.falsificationSignals, knownIds, 'hypothesis', false),
    validationPlan: typeof raw.validationPlan === 'string' ? { method: 'Research or experiment', plan: clean(raw.validationPlan) } : { method: clean(raw.validationPlan?.method), plan: clean(raw.validationPlan?.plan) },
    recommendedNextStep: clean(raw.recommendedNextStep),
    sourceIds: sourceIdsFrom(raw.sourceIds, knownIds),
    status: OPPORTUNITY_STATUSES.includes(raw.status) ? raw.status : 'exploring',
    researchTimestamp: prepared.researchTimestamp,
    audienceAnalysisTimestamp: prepared.audienceAnalysisTimestamp,
    createdAt: new Date().toISOString(),
  };
  opportunity.sourceIds = unique([...opportunity.sourceIds, ...allSourceIds(opportunity)]);
  if (!opportunity.sourceIds.length) return null;
  opportunity.scores = derivedScores(raw, opportunity, context);
  opportunity.confidence = calculateOpportunityConfidence({ ...opportunity, confidence: raw.confidence }, { ...context, readiness: prepared.readiness, stale: context.stale });
  return opportunity;
}

function tokens(value) {
  return new Set(clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((token) => token.length > 2));
}

function similarity(first, second) {
  const a = tokens(`${first.title} ${first.strategicThesis}`); const b = tokens(`${second.title} ${second.strategicThesis}`);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / new Set([...a, ...b]).size;
}

export function deduplicateOpportunities(opportunities) {
  const kept = [];
  for (const opportunity of opportunities) {
    if (kept.some((existing) => similarity(existing, opportunity) >= 0.62)) continue;
    kept.push(opportunity);
  }
  return kept;
}

export function diversifyOpportunities(opportunities, limit = 5) {
  const uniqueTypes = [];
  const selected = [];
  for (const opportunity of opportunities) {
    if (!uniqueTypes.includes(opportunity.type)) { uniqueTypes.push(opportunity.type); selected.push(opportunity); }
    if (selected.length >= limit) return selected;
  }
  for (const opportunity of opportunities) {
    if (!selected.includes(opportunity)) selected.push(opportunity);
    if (selected.length >= limit) break;
  }
  return selected;
}

function baseRadar(context, readiness, status, warnings = [], now = new Date(), variation = 0) {
  const radar = createEmptyOpportunityRadar();
  radar.id = `radar-${now.getTime()}`;
  radar.strategyId = context?.strategy?.id || null;
  radar.createdAt = now.toISOString();
  radar.meta = { ...radar.meta, status, researchStatus: readiness.researchStatus, audienceStatus: readiness.audienceStatus, variation, warnings: warnings.filter(Boolean) };
  return radar;
}

function stage(onStage, index, detail = '') {
  const current = STAGES[Math.min(index, STAGES.length - 1)];
  onStage({ ...current, detail });
}

export function researchIsStale(timestamp, now = new Date(), thresholdDays = 30) {
  if (!timestamp) return true;
  const age = now.getTime() - new Date(timestamp).getTime();
  return Number.isFinite(age) && age > thresholdDays * 86400000;
}

export async function identifyOpportunities(context, configs = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const variation = Number.isFinite(Number(options.variation)) ? Math.max(0, Math.floor(Number(options.variation))) : 0;
  const onStage = options.onStage || (() => {});
  const readiness = assessIntelligence(context);
  const prepared = prepareOpportunityContext(context);
  stage(onStage, 0);
  if (readiness.bothMissing) {
    const radar = baseRadar(context, readiness, 'blocked', ['MarketMind needs more evidence before it can identify meaningful opportunities.'], now, variation);
    radar.meta.assessmentLabel = 'AI assessment based on available evidence.';
    return radar;
  }
  if (readiness.audienceEligibleCount === 0) {
    const radar = baseRadar(context, readiness, 'blocked', ['Review and validate at least one audience claim against the current research sources before using Opportunity Radar.'], now, variation);
    radar.meta.assessmentLabel = 'AI assessment based on available evidence.';
    return radar;
  }
  stage(onStage, 1, `${prepared.audienceSignals.length} audience insights connected.`);
  stage(onStage, 2);
  stage(onStage, 3, `${context?.strategy?.competitors?.length || 0} competitors in strategy context.`);
  stage(onStage, 4, `${prepared.contradictions.length} contradictory evidence item${prepared.contradictions.length === 1 ? '' : 's'} preserved.`);
  if (!prepared.sources.length) {
    return baseRadar(context, readiness, 'insufficient', ['No mapped research sources are available. Add or refresh market intelligence before generating opportunities.'], now, variation);
  }
  if (!configs.ai?.apiKey) {
    return baseRadar(context, readiness, 'unavailable', ['MarketMind is temporarily unable to complete this analysis. Please try again.'], now, variation);
  }
  const stale = researchIsStale(prepared.researchTimestamp, now);
  const synthesis = await synthesizeOpportunities({ ...context, intelligenceStatus: { research: readiness.researchStatus, audience: readiness.audienceStatus } }, prepared, configs.ai, { ...options, lens: options.lens || 'balanced', variation });
  stage(onStage, 5, 'Applying transparent score and confidence assessments.');
  if (!synthesis.candidate) return baseRadar(context, readiness, 'failed', [synthesis.warning || 'Opportunity synthesis failed.'], now, variation);
  const candidates = Array.isArray(synthesis.candidate) ? synthesis.candidate : synthesis.candidate.opportunities;
  const normalized = (Array.isArray(candidates) ? candidates : []).map((item, index) => normalizeOpportunity(item, index, { ...context, stale }, { ...prepared, readiness })).filter(Boolean);
  const previous = Array.isArray(context?.previousOpportunities) ? context.previousOpportunities : [];
  const fresh = normalized.filter((item) => !previous.some((prior) => similarity(item, prior) >= 0.62));
  const opportunities = diversifyOpportunities(deduplicateOpportunities(fresh), 5);
  const radar = baseRadar(context, readiness, opportunities.length ? 'ready' : 'insufficient', [synthesis.warning], now);
  radar.opportunities = opportunities;
  radar.lens = options.lens || 'balanced';
  radar.researchTimestamp = prepared.researchTimestamp;
  radar.audienceAnalysisTimestamp = prepared.audienceAnalysisTimestamp;
  radar.meta = { ...radar.meta, aiStatus: synthesis.status, stale, variation, assessmentLabel: 'AI assessment based on available evidence.', contradictionsConsidered: prepared.contradictions };
  return radar;
}

export { STAGES as OPPORTUNITY_ANALYSIS_STAGES };
