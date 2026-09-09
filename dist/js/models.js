export const TONE_OPTIONS = [
  'Bold & Disruptive',
  'Professional & Formal',
  'Friendly & Conversational',
  'Quirky & Humorous',
  'Premium & Minimal',
];

export const PERSONALITY_OPTIONS = [
  'Confident',
  'Playful',
  'Empathetic',
  'Ambitious',
  'Rebellious',
  'Warm',
  'Intelligent',
  'Optimistic',
  'Direct',
  'Inspirational',
];

export const WORKSPACE_NAV_ITEM = { id: 'workspace', label: 'Workspace', icon: 'settings' };

export const RESEARCH_DEPTH_OPTIONS = [
  { id: 'quick', label: 'Quick', description: 'Fast scan of the most relevant current signals.' },
  { id: 'balanced', label: 'Balanced', description: 'Broader research across trends, news, industry and audience signals.' },
  { id: 'deep', label: 'Deep', description: 'More comprehensive research with multiple search angles and stronger source validation.' },
];

export const RESEARCH_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'news', label: 'News' },
  { id: 'audience', label: 'Audience' },
  { id: 'industry', label: 'Industry' },
  { id: 'culture', label: 'Culture' },
  { id: 'competitor', label: 'Competitors' },
  { id: 'technology', label: 'Technology' },
  { id: 'events', label: 'Events' },
];

export const AUDIENCE_DEPTH_OPTIONS = [
  { id: 'quick', label: 'Quick', description: 'A focused read on the strongest behavioral signals.' },
  { id: 'balanced', label: 'Balanced', description: 'A practical audience model across behavior, motivation, friction, and decision context.' },
  { id: 'deep', label: 'Deep', description: 'A broader model with more tensions, hypotheses, and unknowns to investigate.' },
];

export const PURCHASE_RELATIONSHIPS = [
  { id: 'prospect', label: 'Prospect' },
  { id: 'existing-customer', label: 'Existing customer' },
  { id: 'lapsed-customer', label: 'Lapsed customer' },
  { id: 'mixed', label: 'Mixed' },
];

export const AUDIENCE_EVIDENCE_TYPES = ['observed', 'inferred', 'hypothesis', 'unknown'];

export const OPPORTUNITY_LENS_OPTIONS = [
  { id: 'balanced', label: 'Balanced', description: 'Connect all available intelligence layers.' },
  { id: 'audience', label: 'Audience', description: 'Start from audience needs, tensions, and motivations.' },
  { id: 'culture', label: 'Culture', description: 'Look for relevant cultural and timing intersections.' },
  { id: 'brand', label: 'Brand', description: 'Prioritize credible brand territories and fit.' },
  { id: 'competition', label: 'Competition', description: 'Look for potential whitespace around competitors.' },
  { id: 'product', label: 'Product', description: 'Connect audience needs to product relevance.' },
  { id: 'timing', label: 'Timing', description: 'Prioritize timely moments worth exploring.' },
];

export const OPPORTUNITY_TYPES = ['cultural', 'audience', 'category', 'competitive', 'product', 'content', 'community', 'timing', 'positioning'];
export const OPPORTUNITY_STATUSES = ['exploring', 'selected', 'validated', 'rejected'];
export const OPPORTUNITY_CONFIDENCE = ['high', 'medium', 'low'];
export const OPPORTUNITY_SCORE_WEIGHTS = {
  audienceRelevance: 0.20,
  brandFit: 0.20,
  evidenceStrength: 0.15,
  timing: 0.15,
  competitiveWhitespace: 0.15,
  actionability: 0.15,
};

export const CAMPAIGN_OBJECTIVES = [
  'Awareness',
  'Engagement',
  'Consideration',
  'Conversion',
  'Launch',
  'Retention',
  'Community Building',
];
export const CAMPAIGN_SCALES = [
  { id: 'lean', label: 'Lean', description: 'Focused scope with a small number of channels and experiments.' },
  { id: 'standard', label: 'Standard', description: 'Balanced scope for a focused campaign strategy.' },
  { id: 'ambitious', label: 'Ambitious', description: 'Broader scope with more channels, phases, and testing.' },
];
export const CAMPAIGN_CONFIDENCE = ['high', 'medium', 'low'];
export const CAMPAIGN_PLATFORMS = ['Instagram', 'YouTube', 'LinkedIn', 'TikTok', 'Website', 'Email', 'Community', 'Multi-platform'];

export function createDefaultBrandVoice() {
  return {
    tone: 'Friendly & Conversational',
    personality: ['Intelligent', 'Warm', 'Direct'],
    communicationStyle: 'Clear, human, and useful. Lead with the insight, then make the next step feel easy.',
    preferredWords: '',
    avoidWords: '',
    examples: [''],
    strictness: 'balanced',
    additionalGuidelines: '',
  };
}

export function createDefaultBrandProfile() {
  return {
    name: '',
    industry: '',
    description: '',
    website: '',
    audience: '',
    voice: createDefaultBrandVoice(),
  };
}

export function createDefaultStrategy() {
  return {
    id: `strategy-${Date.now()}`,
    idea: '',
    audience: '',
    platforms: [],
    objective: '',
    market: '',
    competitors: [],
    researchDepth: 'balanced',
    brandId: 'local-brand',
    status: 'draft',
    createdAt: new Date().toISOString(),
    research: null,
    audienceScope: {
      primaryAudience: '',
      market: '',
      ageRange: '',
      lifeStage: '',
      occupation: '',
      context: '',
      purchaseRelationship: 'prospect',
      analysisDepth: 'balanced',
    },
    audienceInsights: null,
    opportunityRadar: null,
    selectedOpportunityId: null,
    campaignStrategy: null,
  };
}

export function createEmptyResearch() {
  return {
    researchSummary: '',
    marketSignals: [],
    audienceSignals: [],
    industryDevelopments: [],
    culturalSignals: [],
    competitorSignals: [],
    events: [],
    technologySignals: [],
    emergingThemes: [],
    contradictions: [],
    sources: [],
    activeRunId: null,
    runs: [],
    meta: {
      researchedAt: null,
      depth: 'balanced',
      queryCount: 0,
      sourcesReviewed: 0,
      sourcesUsed: 0,
      providerStatus: 'not-configured',
      aiStatus: 'not-configured',
      warnings: [],
      failures: [],
    },
  };
}

export function createEmptyAudienceProfile() {
  return {
    id: null,
    strategyId: null,
    summary: '',
    segments: [],
    observedBehaviors: [],
    motivations: [],
    pains: [],
    desires: [],
    tensions: [],
    barriers: [],
    objections: [],
    triggers: [],
    identityDrivers: [],
    contentBehaviors: [],
    decisionFactors: [],
    momentsThatMatter: [],
    hypotheses: [],
    uncertainties: [],
    evidenceCoverage: {
      level: 'limited',
      reason: 'No audience analysis has been run yet.',
      sourceCount: 0,
      coveredInsightCount: 0,
      reviewedCount: 0,
      reviewCoveragePercent: 0,
      radarReadyCount: 0,
    },
    researchVersion: null,
    createdAt: null,
    reviewArchive: [],
    meta: {
      mode: 'research-light',
      aiStatus: 'not-configured',
      warnings: [],
    },
  };
}

export function createEmptyOpportunity() {
  return {
    id: null,
    strategyId: null,
    title: '',
    oneLineDescription: '',
    type: 'positioning',
    strategicThesis: '',
    marketSignals: [],
    audienceSignals: [],
    brandFit: { level: 'low', explanation: '', evidenceType: 'unknown', sourceIds: [] },
    competitiveContext: { summary: '', evidenceType: 'unknown', sourceIds: [] },
    timing: { level: 'unknown', explanation: '', evidenceType: 'unknown', sourceIds: [] },
    evidence: [],
    contradictions: [],
    whitespace: { statement: '', evidenceType: 'hypothesis', sourceIds: [] },
    risks: [],
    falsificationSignals: [],
    confidence: 'low',
    scores: {
      audienceRelevance: 1,
      brandFit: 1,
      evidenceStrength: 1,
      timing: 1,
      competitiveWhitespace: 1,
      actionability: 1,
      overall: 0,
      label: 'AI assessment based on available evidence.',
    },
    validationPlan: { method: '', plan: '' },
    recommendedNextStep: '',
    sourceIds: [],
    status: 'exploring',
    researchTimestamp: null,
    audienceAnalysisTimestamp: null,
    createdAt: null,
  };
}

export function createEmptyOpportunityRadar() {
  return {
    id: null,
    strategyId: null,
    opportunities: [],
    lens: 'balanced',
    createdAt: null,
    researchTimestamp: null,
    audienceAnalysisTimestamp: null,
    meta: {
      status: 'not-run',
      researchStatus: 'missing',
      audienceStatus: 'missing',
      aiStatus: 'not-configured',
      warnings: [],
      failures: [],
      variation: 0,
      assessmentLabel: 'AI assessment based on available evidence.',
    },
  };
}

export function createEmptyCampaignStrategy() {
  const claim = (evidenceType = 'inferred') => ({ statement: '', evidenceType, confidence: 'low', sourceIds: [] });
  return {
    id: null,
    strategyId: null,
    opportunityId: null,
    name: '',
    duration: '',
    primaryPlatform: '',
    secondaryPlatforms: [],
    scale: 'standard',
    originalObjective: '',
    objective: '',
    objectiveRationale: '',
    strategicProblem: claim('inferred'),
    audienceInsight: claim('inferred'),
    campaignThesis: claim('hypothesis'),
    currentPerception: claim('inferred'),
    desiredPerception: claim('hypothesis'),
    brandRole: claim('inferred'),
    differentiation: { notDo: '', doInstead: '', evidenceType: 'hypothesis', confidence: 'low', sourceIds: [] },
    coreMessage: claim('hypothesis'),
    supportingMessages: [],
    creativeTerritories: [],
    selectedCreativeTerritoryId: null,
    campaignConcept: null,
    creativePrinciple: claim('hypothesis'),
    emotionalTerritory: { include: [], avoid: [], rationale: '', sourceIds: [] },
    storyArc: [],
    platformStrategy: [],
    contentPillars: [],
    ctaStrategy: { primary: '', secondary: '', rationale: '', sourceIds: [] },
    campaignPhases: [],
    kpis: [],
    experiments: [],
    risks: [],
    killCriteria: [],
    confidence: 'low',
    sourceIds: [],
    userOverrides: {},
    createdAt: null,
    updatedAt: null,
    meta: {
      status: 'not-run',
      aiStatus: 'not-configured',
      warnings: [],
      failures: [],
      assessmentLabel: 'MarketMind assessment based on available intelligence. Not a success probability.',
      researchTimestamp: null,
      audienceAnalysisTimestamp: null,
      opportunityTimestamp: null,
    },
  };
}
