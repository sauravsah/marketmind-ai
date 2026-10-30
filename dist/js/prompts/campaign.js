import { PACKET_BUDGET, bindCitedPacket, bindItemsToPacket, boundStringList, boundValue, clipText, tighterBudget } from './budget.js';
import { EVIDENCE_DISCIPLINE_RULES } from './evidence-rules.js';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function claimPacket(value, budget, packetIds) {
  if (!value) return null;
  if (typeof value === 'string') return { statement: clipText(value, budget.maxStatementChars), evidenceType: 'unknown', sourceIds: [] };
  const sourceIds = (value.sourceIds || []).slice(0, budget.maxSourceIdsPerItem).filter((id) => !packetIds || packetIds.has(id));
  return { statement: clipText(value.statement || value.text || value.summary, budget.maxStatementChars), evidenceType: value.evidenceType || 'unknown', confidence: value.confidence || 'low', sourceIds };
}

// Campaign packets serialize every prior stage, so they use a tighter profile
// to keep the largest request inside provider token budgets.
const CAMPAIGN_PACKET_BUDGET = {
  maxSources: 2,
  maxSnippetChars: 150,
  maxTitleChars: 90,
  maxStatementChars: 140,
  maxItemsPerSection: 2,
  maxSignalItems: 8,
  maxSourceIdsPerItem: 4,
};

const AUDIENCE_SECTION_KEYS = ['observedBehaviors', 'motivations', 'pains', 'desires', 'tensions', 'barriers', 'triggers', 'identityDrivers', 'decisionFactors', 'momentsThatMatter', 'hypotheses', 'uncertainties'];

function contextPacket(context, options = {}) {
  const budget = tighterBudget(CAMPAIGN_PACKET_BUDGET, options.packetBudget || {});
  const prepared = context?.prepared || {};
  const opportunity = prepared.opportunity || context.opportunity || {};
  const research = prepared.research || context.research || {};
  const audience = prepared.audience || context.audience || {};
  const strategy = prepared.strategy || context.strategy || {};
  const brand = prepared.brand || context.brand || {};
  const campaign = context.campaignStrategy || options.existing || {};
  const combinedSignals = [...(research.marketSignals || []), ...(research.audienceSignals || []), ...(research.culturalSignals || []), ...(research.competitorSignals || []), ...(research.industryDevelopments || []), ...(research.events || []), ...(research.technologySignals || [])];
  const audienceSections = Object.fromEntries(AUDIENCE_SECTION_KEYS.map((key) => [key, Array.isArray(audience[key]) ? audience[key] : []]));
  const cited = bindCitedPacket(prepared.sources || research.sources || [], [
    opportunity.marketSignals, opportunity.audienceSignals, opportunity.risks, opportunity.falsificationSignals,
    combinedSignals, research.contradictions, research.emergingThemes, ...AUDIENCE_SECTION_KEYS.map((key) => audienceSections[key]),
  ], budget);
  const packetIds = cited.packetIds;
  const itemPacket = (items = [], maxItems = budget.maxItemsPerSection) => bindItemsToPacket(items, packetIds, maxItems, budget);
  return {
    regenerationScope: options.section || 'all',
    strategy: {
      id: strategy.id,
      idea: strategy.idea,
      audience: strategy.audience,
      market: strategy.market,
      objective: strategy.objective,
      platforms: boundStringList(strategy.platforms),
      competitors: boundStringList(strategy.competitors),
    },
    brand: {
      name: brand.name,
      industry: brand.industry,
      description: brand.description,
      audience: brand.audience,
      voice: boundValue(brand.voice || {}, { maxChars: 120, maxItems: 6, maxKeys: 8, maxDepth: 3 }) || {},
    },
    selectedOpportunity: {
      id: opportunity.id,
      title: opportunity.title,
      type: opportunity.type,
      oneLineDescription: clipText(opportunity.oneLineDescription, budget.maxStatementChars),
      strategicThesis: claimPacket(opportunity.strategicThesis, budget, packetIds),
      marketSignals: itemPacket(opportunity.marketSignals),
      audienceSignals: itemPacket(opportunity.audienceSignals),
      brandFit: { ...opportunity.brandFit, explanation: clipText(opportunity.brandFit?.explanation, budget.maxStatementChars) },
      competitiveContext: { ...opportunity.competitiveContext, summary: clipText(opportunity.competitiveContext?.summary, budget.maxStatementChars) },
      timing: { ...opportunity.timing, explanation: clipText(opportunity.timing?.explanation, budget.maxStatementChars) },
      whitespace: { ...opportunity.whitespace, statement: clipText(opportunity.whitespace?.statement, budget.maxStatementChars) },
      risks: itemPacket(opportunity.risks),
      falsificationSignals: itemPacket(opportunity.falsificationSignals),
      confidence: opportunity.confidence,
      sourceIds: opportunity.sourceIds || [],
      researchTimestamp: opportunity.researchTimestamp,
      audienceAnalysisTimestamp: opportunity.audienceAnalysisTimestamp,
    },
    marketIntelligence: {
      signals: itemPacket(combinedSignals, budget.maxSignalItems),
      contradictions: itemPacket(research.contradictions),
      emergingThemes: itemPacket(research.emergingThemes),
      sources: cited.packet,
      researchedAt: research.meta?.researchedAt || null,
    },
    audienceIntelligence: {
      summary: clipText(audience.summary, 300),
      evidenceCoverage: audience.evidenceCoverage || {},
      observedBehaviors: itemPacket(audience.observedBehaviors),
      motivations: itemPacket(audience.motivations),
      pains: itemPacket(audience.pains),
      desires: itemPacket(audience.desires),
      tensions: itemPacket(audience.tensions),
      barriers: itemPacket(audience.barriers),
      triggers: itemPacket(audience.triggers),
      identityDrivers: itemPacket(audience.identityDrivers),
      decisionFactors: itemPacket(audience.decisionFactors),
      momentsThatMatter: itemPacket(audience.momentsThatMatter),
      hypotheses: itemPacket(audience.hypotheses),
      uncertainties: itemPacket(audience.uncertainties),
      analyzedAt: audience.createdAt || null,
    },
    currentCampaignStrategy: {
      id: campaign.id || null,
      userOverrides: boundValue(campaign.userOverrides || {}, { maxChars: 200, maxItems: 6, maxKeys: 16, maxDepth: 4 }) || {},
      selectedCreativeTerritoryId: campaign.selectedCreativeTerritoryId || null,
      selectedCreativeTerritory: (campaign.creativeTerritories || []).find((territory) => territory.id === campaign.selectedCreativeTerritoryId) || null,
    },
  };
}

function guardrails() {
  return [
    'You are MarketMind, a careful senior campaign strategist.',
    'Use the selected opportunity as the only strategic starting point and connect every major claim to supplied market, audience, opportunity, or brand evidence.',
    'Treat interpretations as interpretations and strategic directions as hypotheses. Preserve evidenceType, confidence, uncertainty, and sourceIds.',
    ...EVIDENCE_DISCIPLINE_RULES,
    'Every sourceId must match a supplied source packet. Never invent sources, statistics, customer quotes, personas, competitor behavior, urgency, or benchmarks.',
    'Respect the supplied Brand Voice Studio tone, personality, preferred words, avoided words, examples, and strictness. Keep the strategy strategic; do not write production assets.',
    'Do not generate captions, posts, ad copy, video scripts, image prompts, shot lists, storyboards, content calendars, music recommendations, or publishing plans.',
    'Prefer fewer, meaningfully different creative territories over three variations of one idea. Do not call a strategy guaranteed or a probability of success.',
  ].join(' ');
}

function outputContract(scope) {
  const common = {
    name: 'campaign name',
    duration: 'optional duration as supplied by the user',
    primaryPlatform: 'one platform',
    secondaryPlatforms: 'array of platforms',
    scale: 'lean|standard|ambitious',
    originalObjective: 'the user objective, unchanged',
    objective: 'Awareness|Engagement|Consideration|Conversion|Launch|Retention|Community Building',
    objectiveRationale: 'explain any objective refinement; empty when unchanged',
    strategicProblem: '{ statement, evidenceType, confidence, sourceIds }',
    audienceInsight: '{ statement using Because... They... But... Therefore..., evidenceType, confidence, sourceIds }',
    campaignThesis: '{ statement, evidenceType: hypothesis, confidence, sourceIds }',
    currentPerception: '{ statement, evidenceType, confidence, sourceIds }',
    desiredPerception: '{ statement, evidenceType: hypothesis, confidence, sourceIds }',
    brandRole: '{ statement, evidenceType, confidence, sourceIds }',
    differentiation: '{ notDo, doInstead, evidenceType, confidence, sourceIds }',
    coreMessage: '{ statement, evidenceType: hypothesis, confidence, sourceIds }',
    supportingMessages: '[{ category, message, evidenceType, confidence, sourceIds }], 3 to 5 only',
    creativeTerritories: '[{ id, name, coreThought, emotionalDirection, audienceRelevance, brandRelevance, creativePossibilities[], risks[], confidence, scores: { audienceResonance, brandFit, distinctiveness, emotionalPotential, executionPotential, risk }, sourceIds }], up to 3 distinct territories',
    selectedCreativeTerritoryId: 'existing valid territory id or null',
    campaignConcept: '{ campaignName, bigIdea, campaignThought, coreNarrative, emotionalPromise, brandRole, audienceRole, cta, sourceIds } or null',
    creativePrinciple: '{ statement, evidenceType: hypothesis, confidence, sourceIds }',
    emotionalTerritory: '{ include[], avoid[], rationale, sourceIds }',
    storyArc: '[{ stage, description }]',
    platformStrategy: '[{ platform, role, contentType, audienceBehavior, primaryKpi, sourceIds }]',
    contentPillars: '[{ name, purpose, audienceNeed, message, contentForms[], evidenceType, confidence, sourceIds }], 3 to 5 only',
    ctaStrategy: '{ primary, secondary, rationale, sourceIds }',
    campaignPhases: '[{ name, focus, description }]',
    kpis: '[{ name, category, statement, evidenceType, confidence, sourceIds }]',
    experiments: '[{ name, statement, variants[], measure, evidenceType, confidence, sourceIds }], 2 to 4 only',
    risks: '[{ category, statement, mitigation, evidenceType, confidence, sourceIds }]',
    killCriteria: '[{ statement, evidenceType, confidence, sourceIds }]',
    confidence: 'high|medium|low',
    sourceIds: 'array of supplied source IDs only',
  };
  if (scope === 'territories') return { creativeTerritories: common.creativeTerritories, selectedCreativeTerritoryId: common.selectedCreativeTerritoryId };
  if (scope === 'concept') return { campaignConcept: common.campaignConcept, creativePrinciple: common.creativePrinciple, emotionalTerritory: common.emotionalTerritory };
  if (scope === 'channels') return { storyArc: common.storyArc, platformStrategy: common.platformStrategy, contentPillars: common.contentPillars, ctaStrategy: common.ctaStrategy, campaignPhases: common.campaignPhases, kpis: common.kpis, experiments: common.experiments };
  if (scope === 'measurement') return { kpis: common.kpis, experiments: common.experiments, risks: common.risks, killCriteria: common.killCriteria };
  if (scope === 'foundation') return Object.fromEntries(Object.entries(common).slice(0, 18));
  return common;
}

function buildPrompt(context, scope = 'all') {
  const contract = outputContract(scope);
  return {
    system: `${guardrails()} Return valid JSON only. This is regeneration scope: ${scope}. Return only the requested scope unless the scope is all. Keep userOverrides as the source of truth for edited fields. Output contract: ${JSON.stringify(contract)}.`,
    user: JSON.stringify(contextPacket(context, { section: scope }), null, 2),
  };
}

export function buildCampaignStrategyPrompt(context, options = {}) {
  return buildPrompt(context, options.section || 'foundation');
}

export function buildCreativeTerritoriesPrompt(context, options = {}) {
  return buildPrompt(context, 'territories');
}

export function buildCampaignConceptPrompt(context, options = {}) {
  return buildPrompt(context, 'concept');
}

export function buildPlatformStrategyPrompt(context, options = {}) {
  return buildPrompt(context, 'channels');
}

export function buildStrategyValidationPrompt() {
  return {
    system: 'Validate a CampaignStrategy before it reaches the UI. The opportunityId must match the selected opportunity. Remove sourceIds that are not in the supplied source packet. Reject malformed or missing required strategic fields, invalid objectives, invalid confidence values, invalid selectedCreativeTerritoryId values, and unsupported production content. Preserve user edits and evidenceType labels. Never invent repairs.',
  };
}
