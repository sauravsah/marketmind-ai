import { synthesizeCampaignStrategy } from './ai.js';
import { applyClaimConsistency } from './claim-consistency.js';
import {
  CAMPAIGN_CONFIDENCE,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_SCALES,
  createEmptyCampaignStrategy,
} from '../models.js';

const EVIDENCE_TYPES = ['observed', 'inferred', 'hypothesis', 'unknown'];
const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };
const CAMPAIGN_STAGES = [
  { id: 'opportunity', label: 'Reading selected opportunity' },
  { id: 'audience', label: 'Connecting audience insight' },
  { id: 'foundation', label: 'Building strategic foundation' },
  { id: 'territories', label: 'Exploring creative territories' },
  { id: 'concept', label: 'Developing campaign concept' },
  { id: 'channels', label: 'Building channel strategy' },
];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function validConfidence(value, fallback = 'low') {
  return CAMPAIGN_CONFIDENCE.includes(value) ? value : fallback;
}

function knownSources(context) {
  return Array.isArray(context?.research?.sources) ? context.research.sources.filter((source) => source?.id && source?.url) : [];
}

function sourceIdsFrom(value, knownIds) {
  return unique(Array.isArray(value) ? value : []).filter((id) => knownIds.has(id));
}

function normalizeClaim(raw, knownIds, fallbackType = 'hypothesis') {
  const object = typeof raw === 'string' ? { statement: raw } : raw && typeof raw === 'object' ? raw : {};
  const statement = clean(object.statement || object.text || object.message || object.summary || object.title);
  const evidenceType = EVIDENCE_TYPES.includes(object.evidenceType) ? object.evidenceType : fallbackType;
  const sourceIds = sourceIdsFrom(object.sourceIds, knownIds);
  return {
    statement,
    evidenceType: ['observed', 'inferred'].includes(evidenceType) && !sourceIds.length ? 'hypothesis' : evidenceType,
    confidence: validConfidence(object.confidence, evidenceType === 'observed' ? 'medium' : 'low'),
    sourceIds,
  };
}

function normalizeList(items, knownIds, fallbackType = 'hypothesis') {
  return (Array.isArray(items) ? items : []).map((item) => {
    const object = typeof item === 'string' ? { statement: item } : item;
    const claim = normalizeClaim(object, knownIds, fallbackType);
    return {
      ...claim,
      category: clean(object?.category),
      message: clean(object?.message || claim.statement),
      purpose: clean(object?.purpose),
      audienceNeed: clean(object?.audienceNeed),
      contentForms: Array.isArray(object?.contentForms) ? object.contentForms.map(clean).filter(Boolean) : [],
      mitigation: clean(object?.mitigation),
      variants: Array.isArray(object?.variants) ? object.variants.map(clean).filter(Boolean) : [],
      measure: clean(object?.measure),
      name: clean(object?.name),
    };
  }).filter((item) => item.statement || item.message || item.name);
}

function normalizeScore(value, fallback = 5) {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'high') return 8;
    if (lower === 'medium') return 6;
    if (lower === 'low') return 3;
  }
  return clamp(Math.round(Number(value) || fallback), 1, 10);
}

function tokens(value) {
  return new Set(clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((token) => token.length > 2));
}

function similarity(first, second) {
  const a = tokens(`${first.name} ${first.coreThought}`);
  const b = tokens(`${second.name} ${second.coreThought}`);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / new Set([...a, ...b]).size;
}

function normalizeTerritories(items, knownIds) {
  const kept = [];
  for (const [index, raw] of (Array.isArray(items) ? items : []).entries()) {
    const object = raw && typeof raw === 'object' ? raw : {};
    const name = clean(object.name || object.title);
    const coreThought = clean(object.coreThought || object.thought || object.description);
    if (!name || !coreThought) continue;
    const territory = {
      id: clean(object.id) || `territory-${index + 1}`,
      name,
      coreThought,
      emotionalDirection: clean(object.emotionalDirection || object.emotion),
      audienceRelevance: clean(object.audienceRelevance),
      brandRelevance: clean(object.brandRelevance),
      creativePossibilities: Array.isArray(object.creativePossibilities) ? object.creativePossibilities.map(clean).filter(Boolean) : [],
      risks: normalizeList(object.risks, knownIds, 'unknown'),
      confidence: validConfidence(object.confidence, 'medium'),
      scores: {
        audienceResonance: normalizeScore(object.scores?.audienceResonance || object.audienceResonance),
        brandFit: normalizeScore(object.scores?.brandFit || object.brandFit),
        distinctiveness: normalizeScore(object.scores?.distinctiveness),
        emotionalPotential: normalizeScore(object.scores?.emotionalPotential),
        executionPotential: normalizeScore(object.scores?.executionPotential),
        risk: normalizeScore(object.scores?.risk, 5),
      },
      sourceIds: sourceIdsFrom(object.sourceIds, knownIds),
    };
    if (!kept.some((existing) => similarity(existing, territory) >= 0.62)) kept.push(territory);
    if (kept.length >= 3) break;
  }
  return kept;
}

function normalizeConcept(raw, knownIds) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    campaignName: clean(raw.campaignName || raw.name),
    bigIdea: clean(raw.bigIdea),
    campaignThought: clean(raw.campaignThought || raw.thought),
    coreNarrative: clean(raw.coreNarrative || raw.narrative),
    emotionalPromise: clean(raw.emotionalPromise),
    brandRole: clean(raw.brandRole),
    audienceRole: clean(raw.audienceRole),
    cta: clean(raw.cta),
    sourceIds: sourceIdsFrom(raw.sourceIds, knownIds),
  };
}

function normalizePlatformStrategy(items, knownIds) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    platform: clean(item?.platform),
    role: clean(item?.role),
    contentType: clean(item?.contentType),
    audienceBehavior: clean(item?.audienceBehavior),
    primaryKpi: clean(item?.primaryKpi),
    sourceIds: sourceIdsFrom(item?.sourceIds, knownIds),
  })).filter((item) => item.platform || item.role);
}

function normalizePhases(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    name: clean(item?.name || item?.week || item?.phase),
    focus: clean(item?.focus),
    description: clean(item?.description),
  })).filter((item) => item.name || item.focus || item.description);
}

function normalizeCta(raw, knownIds) {
  return {
    primary: clean(raw?.primary),
    secondary: clean(raw?.secondary),
    rationale: clean(raw?.rationale),
    sourceIds: sourceIdsFrom(raw?.sourceIds, knownIds),
  };
}

function normalizeStoryArc(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({ stage: clean(item?.stage || item?.name), description: clean(item?.description || item?.statement) })).filter((item) => item.stage || item.description);
}

function nestedSourceIds(value) {
  if (Array.isArray(value)) return value.flatMap(nestedSourceIds);
  if (!value || typeof value !== 'object') return [];
  return [...(Array.isArray(value.sourceIds) ? value.sourceIds : []), ...Object.values(value).flatMap((item) => item === value.sourceIds ? [] : nestedSourceIds(item))];
}

function selectedOpportunityFrom(context) {
  if (context?.opportunity?.id) return context.opportunity;
  const opportunities = context?.strategy?.opportunityRadar?.opportunities || context?.opportunityRadar?.opportunities || [];
  const selectedId = context?.strategy?.selectedOpportunityId;
  return opportunities.find((item) => item.id === selectedId) || null;
}

export function prepareCampaignContext(context = {}) {
  const opportunity = selectedOpportunityFrom(context);
  const sources = knownSources(context);
  return {
    opportunity,
    sources,
    sourceIds: sources.map((source) => source.id),
    strategy: context.strategy || {},
    brand: context.brand || {},
    research: context.research || {},
    audience: context.audience || {},
    evidence: {
      marketSignals: opportunity?.marketSignals || [],
      audienceSignals: opportunity?.audienceSignals || [],
      opportunityEvidence: opportunity?.evidence || [],
      contradictions: opportunity?.contradictions || [],
    },
  };
}

export function calculateCampaignConfidence(campaign, context = {}) {
  const prepared = context.prepared || prepareCampaignContext(context);
  const opportunity = prepared.opportunity;
  let level = validConfidence(opportunity?.confidence, 'low');
  const sourceCount = unique(campaign?.sourceIds).length;
  const audience = prepared.audience;
  const audienceLimited = audience?.meta?.mode === 'research-light' || audience?.evidenceCoverage?.level === 'limited';
  const brandFit = opportunity?.brandFit?.level || 'low';
  const competitiveLimited = !opportunity?.competitiveContext?.sourceIds?.length;
  if (sourceCount < 2 || audienceLimited || brandFit === 'low' || competitiveLimited) level = level === 'high' ? 'medium' : 'low';
  if (!opportunity || !campaign?.opportunityId) level = 'low';
  const candidate = validConfidence(campaign?.confidence, level);
  return CONFIDENCE_RANK[candidate] < CONFIDENCE_RANK[level] ? candidate : level;
}

function mergeForSection(existing, raw, section) {
  const base = existing && typeof existing === 'object' ? existing : {};
  if (!raw || typeof raw !== 'object') return { ...base };
  if (!section || section === 'all') return { ...base, ...raw };
  const keys = {
    foundation: ['name', 'duration', 'primaryPlatform', 'secondaryPlatforms', 'scale', 'originalObjective', 'objective', 'objectiveRationale', 'strategicProblem', 'audienceInsight', 'campaignThesis', 'currentPerception', 'desiredPerception', 'brandRole', 'differentiation', 'coreMessage', 'supportingMessages'],
    territories: ['creativeTerritories'],
    concept: ['campaignConcept', 'creativePrinciple', 'emotionalTerritory', 'selectedCreativeTerritoryId'],
    channels: ['storyArc', 'platformStrategy', 'contentPillars', 'ctaStrategy', 'campaignPhases', 'kpis', 'experiments'],
  }[section] || [];
  return { ...base, ...Object.fromEntries(keys.filter((key) => key in raw).map((key) => [key, raw[key]])) };
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

export function normalizeCampaignStrategy(raw, context, options = {}) {
  const prepared = options.prepared || prepareCampaignContext(context);
  const opportunity = prepared.opportunity;
  if (!opportunity?.id || !raw || typeof raw !== 'object') return null;
  const knownIds = new Set(prepared.sourceIds);
  const merged = mergeForSection(options.existing, raw, options.section);
  const base = createEmptyCampaignStrategy();
  if (merged.opportunityId && merged.opportunityId !== opportunity.id) return null;
  const originalObjective = clean(merged.originalObjective || prepared.strategy.objective);
  const objective = CAMPAIGN_OBJECTIVES.includes(merged.objective) ? merged.objective : CAMPAIGN_OBJECTIVES.includes(originalObjective) ? originalObjective : '';
  const territories = normalizeTerritories(merged.creativeTerritories, knownIds);
  const primaryPlatform = CAMPAIGN_PLATFORMS.includes(merged.primaryPlatform) ? merged.primaryPlatform : CAMPAIGN_PLATFORMS.includes(options.existing?.primaryPlatform) ? options.existing.primaryPlatform : '';
  const validSelected = territories.some((item) => item.id === merged.selectedCreativeTerritoryId) ? merged.selectedCreativeTerritoryId : options.existing?.selectedCreativeTerritoryId && territories.some((item) => item.id === options.existing.selectedCreativeTerritoryId) ? options.existing.selectedCreativeTerritoryId : null;
  const campaign = {
    ...base,
    ...(options.existing || {}),
    id: options.existing?.id || `campaign-${Date.now()}`,
    strategyId: prepared.strategy.id || options.existing?.strategyId || null,
    opportunityId: opportunity.id,
    name: clean(merged.name || options.existing?.name || `Campaign strategy · ${opportunity.title}`),
    duration: clean(merged.duration || options.existing?.duration),
    primaryPlatform,
    secondaryPlatforms: unique((Array.isArray(merged.secondaryPlatforms) ? merged.secondaryPlatforms : options.existing?.secondaryPlatforms || []).filter((item) => CAMPAIGN_PLATFORMS.includes(item) && item !== primaryPlatform)),
    scale: CAMPAIGN_SCALES.some((item) => item.id === merged.scale) ? merged.scale : CAMPAIGN_SCALES.some((item) => item.id === options.existing?.scale) ? options.existing.scale : 'standard',
    originalObjective,
    objective,
    objectiveRationale: clean(merged.objectiveRationale),
    strategicProblem: normalizeClaim(merged.strategicProblem, knownIds, 'inferred'),
    audienceInsight: normalizeClaim(merged.audienceInsight, knownIds, 'inferred'),
    campaignThesis: normalizeClaim(merged.campaignThesis, knownIds, 'hypothesis'),
    currentPerception: normalizeClaim(merged.currentPerception, knownIds, 'inferred'),
    desiredPerception: normalizeClaim(merged.desiredPerception, knownIds, 'hypothesis'),
    brandRole: normalizeClaim(merged.brandRole, knownIds, 'inferred'),
    differentiation: { notDo: clean(merged.differentiation?.notDo), doInstead: clean(merged.differentiation?.doInstead), evidenceType: EVIDENCE_TYPES.includes(merged.differentiation?.evidenceType) ? merged.differentiation.evidenceType : 'hypothesis', confidence: validConfidence(merged.differentiation?.confidence), sourceIds: sourceIdsFrom(merged.differentiation?.sourceIds, knownIds) },
    coreMessage: normalizeClaim(merged.coreMessage, knownIds, 'hypothesis'),
    supportingMessages: normalizeList(merged.supportingMessages, knownIds, 'hypothesis').slice(0, 5),
    creativeTerritories: territories,
    selectedCreativeTerritoryId: validSelected,
    campaignConcept: normalizeConcept(merged.campaignConcept, knownIds),
    creativePrinciple: normalizeClaim(merged.creativePrinciple, knownIds, 'hypothesis'),
    emotionalTerritory: { include: Array.isArray(merged.emotionalTerritory?.include) ? merged.emotionalTerritory.include.map(clean).filter(Boolean) : [], avoid: Array.isArray(merged.emotionalTerritory?.avoid) ? merged.emotionalTerritory.avoid.map(clean).filter(Boolean) : [], rationale: clean(merged.emotionalTerritory?.rationale), sourceIds: sourceIdsFrom(merged.emotionalTerritory?.sourceIds, knownIds) },
    storyArc: normalizeStoryArc(merged.storyArc),
    platformStrategy: normalizePlatformStrategy(merged.platformStrategy, knownIds),
    contentPillars: normalizeList(merged.contentPillars, knownIds, 'hypothesis').slice(0, 5),
    ctaStrategy: normalizeCta(merged.ctaStrategy, knownIds),
    campaignPhases: normalizePhases(merged.campaignPhases),
    kpis: normalizeList(merged.kpis, knownIds, 'unknown'),
    experiments: normalizeList(merged.experiments, knownIds, 'hypothesis').slice(0, 4),
    risks: normalizeList(merged.risks, knownIds, 'unknown'),
    killCriteria: normalizeList(merged.killCriteria, knownIds, 'unknown'),
    confidence: validConfidence(merged.confidence),
    sourceIds: sourceIdsFrom(merged.sourceIds, knownIds),
    userOverrides: options.existing?.userOverrides || merged.userOverrides || {},
    createdAt: options.existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    meta: { ...base.meta, ...(options.existing?.meta || {}), ...(merged.meta || {}), status: 'ready', researchTimestamp: prepared.research?.meta?.researchedAt || null, audienceAnalysisTimestamp: prepared.audience?.createdAt || null, opportunityTimestamp: opportunity.researchTimestamp || opportunity.createdAt || null },
  };
  campaign.sourceIds = sourceIdsFrom(unique([...campaign.sourceIds, ...nestedSourceIds(campaign)]), knownIds);
  const overridden = applyCampaignOverrides(campaign, campaign.userOverrides);
  overridden.confidence = calculateCampaignConfidence(overridden, { ...context, prepared });
  applyClaimConsistency(overridden, prepared.sources, options.now instanceof Date ? options.now : new Date(), { market: prepared.strategy?.market });
  overridden.meta.assessmentLabel = 'MarketMind assessment based on available intelligence. Not a success probability.';
  const hasStrategicOutput = Boolean(overridden.strategicProblem.statement || overridden.audienceInsight.statement || overridden.campaignThesis.statement || overridden.campaignConcept?.bigIdea || overridden.creativeTerritories.length || overridden.platformStrategy.length);
  if (!hasStrategicOutput) return null;
  return overridden;
}

function baseCampaign(context, prepared, status, warnings, now, existing = null) {
  const campaign = { ...createEmptyCampaignStrategy(), ...(existing || {}) };
  campaign.id = existing?.id || `campaign-${now.getTime()}`;
  campaign.strategyId = prepared.strategy.id || existing?.strategyId || null;
  campaign.opportunityId = prepared.opportunity?.id || null;
  campaign.name = existing?.name || (prepared.opportunity ? `Campaign strategy · ${prepared.opportunity.title}` : '');
  campaign.originalObjective = clean(existing?.originalObjective || prepared.strategy.objective);
  campaign.objective = CAMPAIGN_OBJECTIVES.includes(existing?.objective) ? existing.objective : CAMPAIGN_OBJECTIVES.includes(campaign.originalObjective) ? campaign.originalObjective : '';
  campaign.primaryPlatform = CAMPAIGN_PLATFORMS.includes(existing?.primaryPlatform) ? existing.primaryPlatform : CAMPAIGN_PLATFORMS.includes(prepared.strategy.platforms?.[0]) ? prepared.strategy.platforms[0] : '';
  campaign.scale = CAMPAIGN_SCALES.some((item) => item.id === existing?.scale) ? existing.scale : 'standard';
  campaign.createdAt = existing?.createdAt || now.toISOString();
  campaign.updatedAt = now.toISOString();
  campaign.meta = { ...campaign.meta, ...(existing?.meta || {}), status, warnings: warnings.filter(Boolean), researchTimestamp: prepared.research?.meta?.researchedAt || null, audienceAnalysisTimestamp: prepared.audience?.createdAt || null, opportunityTimestamp: prepared.opportunity?.researchTimestamp || prepared.opportunity?.createdAt || null };
  return campaign;
}

function sendStage(onStage, index, detail = '') {
  const stage = CAMPAIGN_STAGES[Math.min(index, CAMPAIGN_STAGES.length - 1)];
  onStage({ ...stage, detail });
}

export async function generateCampaignStrategy(context = {}, configs = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const onStage = options.onStage || (() => {});
  const prepared = prepareCampaignContext(context);
  sendStage(onStage, 0);
  if (!prepared.opportunity) return baseCampaign(context, prepared, 'blocked', ['Select an opportunity before developing a campaign strategy.'], now);
  sendStage(onStage, 1, `${prepared.audience?.evidenceCoverage?.level || 'limited'} audience evidence connected.`);
  sendStage(onStage, 2);
  if (!configs.ai?.apiKey) return baseCampaign(context, prepared, 'unavailable', ['MarketMind is temporarily unable to complete this analysis. Please try again.'], now, options.existing);
  sendStage(onStage, 3);
  const callStats = {};
  const synthesis = await synthesizeCampaignStrategy({ ...context, prepared, campaignStrategy: options.existing || context.campaignStrategy || null, regenerationScope: options.section || 'all' }, configs.ai, { ...options, section: options.section || 'all', callStats });
  sendStage(onStage, 4);
  if (!synthesis.candidate) {
    const failed = baseCampaign(context, prepared, 'failed', [synthesis.warning || 'Campaign strategy synthesis failed.'], now, options.existing);
    failed.meta.failureReason = synthesis.reason || 'unknown';
    failed.meta.providerCalls = callStats;
    return failed;
  }
  sendStage(onStage, 5);
  const candidate = Array.isArray(synthesis.candidate) ? synthesis.candidate[0] : synthesis.candidate;
  const campaign = normalizeCampaignStrategy(candidate, context, { prepared, existing: options.existing, section: options.section, now });
  if (!campaign) {
    const failed = baseCampaign(context, prepared, 'failed', ['MarketMind returned an incomplete or invalid campaign strategy.'], now, options.existing);
    failed.meta.failureReason = 'invalid-response';
    return failed;
  }
  campaign.meta.aiStatus = synthesis.status;
  campaign.meta.providerCalls = callStats;
  campaign.meta.warnings = [synthesis.warning].filter(Boolean);
  return campaign;
}

export { CAMPAIGN_STAGES as CAMPAIGN_STRATEGY_STAGES };
