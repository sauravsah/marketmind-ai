import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_OBJECTIVES, createDefaultStrategy, createEmptyCampaignStrategy } from '../js/models.js';
import { applyCampaignOverrides, calculateCampaignConfidence, generateCampaignStrategy, normalizeCampaignStrategy, prepareCampaignContext } from '../js/services/campaign.js';
import { buildCampaignStrategyPrompt } from '../js/prompts/campaign.js';

const sources = [1, 2, 3].map((number) => ({ id: `source-${number}`, title: `Evidence ${number}`, url: `https://example.com/evidence-${number}`, domain: 'example.com', snippet: `Supplied evidence ${number}.` }));
const opportunity = {
  id: 'opportunity-1',
  strategyId: 'strategy-1',
  title: 'Community-led running identity',
  oneLineDescription: 'Explore running as a social identity and belonging territory.',
  strategicThesis: 'Because community activity is visible, and belonging appears relevant to the audience, the brand could explore a community-led running identity.',
  type: 'community',
  marketSignals: [{ statement: 'Community activity is visible.', evidenceType: 'observed', sourceIds: ['source-1'], confidence: 'medium' }],
  audienceSignals: [{ statement: 'Belonging may matter.', evidenceType: 'inferred', sourceIds: ['source-2'], confidence: 'medium' }],
  brandFit: { level: 'high', explanation: 'The brand operates in running.', evidenceType: 'inferred', sourceIds: ['source-1'] },
  competitiveContext: { summary: 'Competitor evidence emphasizes performance.', evidenceType: 'observed', sourceIds: ['source-3'] },
  timing: { level: 'moderate', explanation: 'Community activity is current.', evidenceType: 'inferred', sourceIds: ['source-1'] },
  whitespace: { statement: 'Potential whitespace around belonging.', evidenceType: 'hypothesis', sourceIds: ['source-3'] },
  risks: [{ statement: 'The territory may be concentrated in urban groups.', evidenceType: 'unknown', sourceIds: [] }],
  confidence: 'high',
  sourceIds: ['source-1', 'source-2', 'source-3'],
  researchTimestamp: '2026-08-20T00:00:00.000Z',
  audienceAnalysisTimestamp: '2026-08-21T00:00:00.000Z',
  createdAt: '2026-08-21T00:00:00.000Z',
};
const context = {
  strategy: { id: 'strategy-1', idea: 'Make running more relevant', audience: 'Young runners', market: 'India', platforms: ['Instagram'], objective: 'Engagement', competitors: ['Adidas', 'Puma'] },
  brand: { name: 'Stride', industry: 'Sportswear', description: 'Everyday running apparel', audience: 'Young runners', voice: { tone: 'Friendly & Conversational', personality: ['Warm', 'Direct'] } },
  research: { sources, meta: { researchedAt: '2026-08-20T00:00:00.000Z' } },
  audience: { summary: 'Audience seeks belonging.', evidenceCoverage: { level: 'moderate' }, meta: { mode: 'research-backed' }, createdAt: '2026-08-21T00:00:00.000Z' },
  opportunity,
};

function territory(id, name, coreThought) {
  return { id, name, coreThought, emotionalDirection: 'Belonging and confidence', audienceRelevance: 'It responds to the audience tension.', brandRelevance: 'It fits the brand context.', creativePossibilities: ['Community stories', 'Participation moments'], risks: ['Needs genuine participation.'], confidence: 'medium', scores: { audienceResonance: 8, brandFit: 8, distinctiveness: 7, emotionalPotential: 8, executionPotential: 7, risk: 4 }, sourceIds: ['source-1', 'source-2'] };
}

function candidate(overrides = {}) {
  return {
    opportunityId: 'opportunity-1',
    name: 'Run Together Strategy',
    originalObjective: 'Engagement',
    objective: 'Community Building',
    objectiveRationale: 'The selected opportunity is centered on participation and belonging.',
    strategicProblem: { statement: 'Performance-led running messages may not address the audience desire for belonging.', evidenceType: 'inferred', sourceIds: ['source-1', 'source-2'] },
    audienceInsight: { statement: 'Because running is part of identity, they want progress they can share. But technical framing can feel solitary. Therefore belonging is worth exploring.', evidenceType: 'inferred', sourceIds: ['source-1', 'source-2'] },
    campaignThesis: { statement: 'Make running feel like something you join, not something you do alone.', evidenceType: 'hypothesis', sourceIds: ['source-1', 'source-2'] },
    currentPerception: { statement: 'Running is often framed as individual performance.', evidenceType: 'inferred', sourceIds: ['source-1', 'source-3'] },
    desiredPerception: { statement: 'Running can feel like a shared identity and practice.', evidenceType: 'hypothesis', sourceIds: ['source-1', 'source-2'] },
    brandRole: { statement: 'The brand can make participation feel credible and welcoming through its running relevance.', evidenceType: 'inferred', sourceIds: ['source-1'] },
    differentiation: { notDo: 'Lead only with technical specifications.', doInstead: 'Make shared identity and participation visible.', evidenceType: 'hypothesis', sourceIds: ['source-3'] },
    coreMessage: { statement: 'Running is something we join.', evidenceType: 'hypothesis', sourceIds: ['source-1', 'source-2'] },
    supportingMessages: [{ category: 'Social', message: 'Progress feels different when it is shared.', evidenceType: 'hypothesis', sourceIds: ['source-2'] }],
    creativeTerritories: [territory('territory-1', 'Belonging', 'Show running as a shared identity.'), territory('territory-2', 'Identity', 'Show the many selves running can unlock.'), territory('territory-3', 'Progress', 'Make progress visible through participation.')],
    selectedCreativeTerritoryId: null,
    campaignConcept: null,
    creativePrinciple: { statement: 'Every creative execution should show running as a shared identity.', evidenceType: 'hypothesis', sourceIds: ['source-1'] },
    emotionalTerritory: { include: ['Belonging', 'Confidence'], avoid: ['Guilt'], rationale: 'Use warmth without overclaiming.', sourceIds: ['source-2'] },
    storyArc: [{ stage: 'Recognition', description: 'Recognize the desire to belong.' }, { stage: 'Shift', description: 'Show running as a shared practice.' }],
    platformStrategy: [{ platform: 'Instagram', role: 'Discovery and cultural participation', contentType: 'Short-form visual storytelling', audienceBehavior: 'Discover, save, and share', primaryKpi: 'Shares', sourceIds: ['source-1', 'source-2'] }],
    contentPillars: [{ name: 'The Community', purpose: 'Make belonging tangible.', audienceNeed: 'Connection', message: 'There is a place to start.', contentForms: ['Community stories'], evidenceType: 'hypothesis', sourceIds: ['source-2'] }],
    ctaStrategy: { primary: 'Join', secondary: 'Discover', rationale: 'Participation fits the objective.', sourceIds: ['source-2'] },
    campaignPhases: [{ name: 'Week 1', focus: 'Recognition', description: 'Introduce the tension.' }],
    kpis: [{ name: 'Shares', category: 'Engagement', statement: 'Track active sharing of the idea.', evidenceType: 'unknown', sourceIds: [] }],
    experiments: [{ name: 'Community vs individual framing', statement: 'Test which framing better expresses the opportunity.', variants: ['Community', 'Individual'], measure: 'Shares and qualified engagement', evidenceType: 'hypothesis', sourceIds: ['source-2'] }],
    risks: [{ category: 'Brand', statement: 'Community positioning could feel inauthentic without participation.', mitigation: 'Create a genuine participation path.', evidenceType: 'inferred', sourceIds: ['source-1'] }],
    killCriteria: [{ statement: 'Audience response contradicts the belonging tension.', evidenceType: 'unknown', sourceIds: [] }],
    confidence: 'high',
    sourceIds: ['source-1', 'source-2', 'source-3', 'invented-source'],
    ...overrides,
  };
}

function fetchImplFor(payload) {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
}

test('CampaignStrategy starts with linked persistence fields and editable sections', () => {
  const strategy = createEmptyCampaignStrategy();
  assert.equal(strategy.opportunityId, null);
  assert.equal(strategy.scale, 'standard');
  assert.equal(strategy.selectedCreativeTerritoryId, null);
  assert.deepEqual(strategy.userOverrides, {});
  assert.ok(strategy.platformStrategy);
  assert.ok(strategy.contentPillars);
});

test('default strategy persistence includes an empty campaign strategy slot', () => {
  assert.equal(createDefaultStrategy().campaignStrategy, null);
});

test('campaign strategy links to the selected opportunity and filters invalid source IDs', async () => {
  const result = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor(candidate()), now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(result.meta.status, 'ready');
  assert.equal(result.opportunityId, 'opportunity-1');
  assert.equal(result.sourceIds.includes('invented-source'), false);
  assert.equal(result.objective, 'Community Building');
});

test('a nonexistent opportunity reference is rejected', () => {
  assert.equal(normalizeCampaignStrategy(candidate({ opportunityId: 'missing-opportunity' }), context), null);
});

test('creative territories are distinct, structured, and selectable only by valid ID', async () => {
  const result = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor(candidate({ creativeTerritories: [territory('territory-1', 'Belonging', 'Show shared identity.'), territory('territory-2', 'Belonging', 'Show shared identity.'), territory('territory-3', 'Progress', 'Make progress visible.')], selectedCreativeTerritoryId: 'missing-territory' })) });
  assert.equal(result.creativeTerritories.length, 2);
  assert.equal(result.selectedCreativeTerritoryId, null);
  assert.ok(result.creativeTerritories.every((item) => item.name && item.coreThought && item.scores.audienceResonance >= 1));
});

test('low opportunity confidence lowers campaign strategy confidence', () => {
  const prepared = prepareCampaignContext({ ...context, opportunity: { ...opportunity, confidence: 'low' } });
  assert.equal(calculateCampaignConfidence({ opportunityId: 'opportunity-1', sourceIds: ['source-1', 'source-2', 'source-3'], confidence: 'high' }, { ...context, prepared }), 'low');
});

test('user-edited fields survive regeneration and lose unsupported old source mapping', async () => {
  const existing = createEmptyCampaignStrategy();
  existing.id = 'campaign-existing';
  existing.userOverrides = { name: 'My Campaign Name', campaignThesis: 'My own thesis.', coreMessage: 'My own core message.', primaryCta: 'Join' };
  const result = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { existing, section: 'foundation', fetchImpl: fetchImplFor(candidate()) });
  assert.equal(result.name, 'My Campaign Name');
  assert.equal(result.campaignThesis.statement, 'My own thesis.');
  assert.deepEqual(result.campaignThesis.sourceIds, []);
  assert.equal(result.coreMessage.statement, 'My own core message.');
  assert.equal(result.ctaStrategy.primary, 'Join');
});

test('unavailable regeneration preserves campaign setup refinements', async () => {
  const existing = createEmptyCampaignStrategy();
  Object.assign(existing, {
    id: 'campaign-setup',
    opportunityId: 'opportunity-1',
    name: 'My campaign',
    duration: '4 weeks',
    primaryPlatform: 'YouTube',
    secondaryPlatforms: ['Instagram'],
    scale: 'ambitious',
    originalObjective: 'Engagement',
    objective: 'Community Building',
  });
  const result = await generateCampaignStrategy(context, { ai: {} }, { existing });
  assert.equal(result.meta.status, 'unavailable');
  assert.equal(result.name, 'My campaign');
  assert.equal(result.duration, '4 weeks');
  assert.equal(result.primaryPlatform, 'YouTube');
  assert.deepEqual(result.secondaryPlatforms, ['Instagram']);
  assert.equal(result.scale, 'ambitious');
  assert.equal(result.objective, 'Community Building');
});

test('missing opportunity blocks without fabricated strategy output', async () => {
  const result = await generateCampaignStrategy({ strategy: context.strategy, brand: context.brand }, { ai: { apiKey: 'test-key' } });
  assert.equal(result.meta.status, 'blocked');
  assert.equal(result.opportunityId, null);
  assert.equal(result.strategicProblem.statement, '');
});

test('blocked fallback clears a stale opportunity link', async () => {
  const existing = createEmptyCampaignStrategy();
  existing.opportunityId = 'opportunity-1';
  const result = await generateCampaignStrategy({ strategy: context.strategy, brand: context.brand }, { ai: {} }, { existing });
  assert.equal(result.meta.status, 'blocked');
  assert.equal(result.opportunityId, null);
});

test('missing AI provider returns an honest unavailable state', async () => {
  const result = await generateCampaignStrategy(context, { ai: {} });
  assert.equal(result.meta.status, 'unavailable');
  assert.equal(result.meta.warnings.length, 1);
  assert.equal(result.campaignConcept, null);
});

test('malformed AI output is rejected', async () => {
  const result = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor({ bad: true }) });
  assert.equal(result.meta.status, 'failed');
  assert.equal(result.strategicProblem.statement, '');
});

test('override helper keeps objective within the controlled option set', () => {
  const base = createEmptyCampaignStrategy();
  const result = applyCampaignOverrides(base, { objective: 'Invented objective' });
  assert.equal(result.objective, '');
  assert.ok(CAMPAIGN_OBJECTIVES.includes('Community Building'));
});

test('supporting messages carrying copy in message are normalized into checkable statements and flagged', async () => {
  const discountSources = [{ id: 'source-1', title: "How Can I Get Nike's Best Deals?", url: 'https://www.nike.com/help/a/product-discount', domain: 'nike.com', snippet: 'First, we offer a 10% discount to eligible shoppers who are part of the following groups.' }];
  const localContext = { ...context, research: { sources: discountSources, meta: { researchedAt: '2026-08-20T00:00:00.000Z' } } };
  const result = await generateCampaignStrategy(localContext, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor(candidate({ supportingMessages: [{ category: 'Value', message: 'Save 10% instantly on the Metcon you need to power your workouts.', evidenceType: 'observed', sourceIds: ['source-1'] }] })), now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(result.meta.status, 'ready');
  assert.equal(result.supportingMessages[0].statement, 'Save 10% instantly on the Metcon you need to power your workouts.');
  assert.equal(result.supportingMessages[0].message, 'Save 10% instantly on the Metcon you need to power your workouts.');
  const flag = (result.meta.claimFlags || []).find((entry) => entry.field === 'supportingMessages[0]');
  assert.equal(flag?.reason, 'offer-market-unverified');
});

test('measurement regeneration merges KPIs, experiments, risks and kill criteria into the existing campaign', async () => {
  const existing = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor(candidate({ kpis: [], experiments: [], risks: [], killCriteria: [] })), now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(existing.kpis.length, 0);
  assert.equal(existing.risks.length, 0);
  const measurementPayload = {
    opportunityId: 'opportunity-1',
    kpis: [{ name: 'Bundle redemptions', category: 'Conversion', statement: 'Track bundle redemptions per gym partner.', evidenceType: 'unknown', sourceIds: [] }],
    experiments: [{ name: 'QR vs app claim', statement: 'Test which claim path converts better.', variants: ['QR', 'App'], measure: 'Redemption rate', evidenceType: 'hypothesis', sourceIds: ['source-1'] }],
    risks: [{ category: 'Partner', statement: 'Gym partners may favor local brands.', mitigation: 'Negotiate bundle terms early.', evidenceType: 'inferred', sourceIds: ['source-1'] }],
    killCriteria: [{ statement: 'Redemption stays near zero after the first month.', evidenceType: 'unknown', sourceIds: [] }],
  };
  const updated = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor(measurementPayload), existing, section: 'measurement', now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(updated.meta.status, 'ready');
  assert.equal(updated.kpis.length, 1);
  assert.equal(updated.experiments.length, 1);
  assert.equal(updated.risks.length, 1);
  assert.equal(updated.killCriteria.length, 1);
  assert.equal(updated.strategicProblem.statement, existing.strategicProblem.statement);
  assert.equal(updated.creativeTerritories.length, existing.creativeTerritories.length);
});

test('an empty measurement response preserves existing KPIs instead of wiping them', async () => {
  const measurementPayload = {
    opportunityId: 'opportunity-1',
    kpis: [{ name: 'Bundle redemptions', category: 'Conversion', statement: 'Track bundle redemptions per gym partner.', evidenceType: 'unknown', sourceIds: [] }],
    experiments: [{ name: 'QR vs app claim', statement: 'Test which claim path converts better.', variants: ['QR', 'App'], measure: 'Redemption rate', evidenceType: 'hypothesis', sourceIds: ['source-1'] }],
    risks: [{ category: 'Partner', statement: 'Gym partners may favor local brands.', mitigation: 'Negotiate bundle terms early.', evidenceType: 'inferred', sourceIds: ['source-1'] }],
    killCriteria: [{ statement: 'Redemption stays near zero after the first month.', evidenceType: 'unknown', sourceIds: [] }],
  };
  const existing = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor(candidate(measurementPayload)), now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(existing.kpis.length, 1);
  // A truncated scoped regeneration returns empty arrays: existing content must survive.
  const wiped = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor({ opportunityId: 'opportunity-1', kpis: [], experiments: [], risks: [], killCriteria: [] }), existing, section: 'measurement', now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(wiped.meta.status, 'ready');
  assert.equal(wiped.kpis.length, 1);
  assert.equal(wiped.experiments.length, 1);
  assert.equal(wiped.risks.length, 1);
  assert.equal(wiped.killCriteria.length, 1);
});

test('a failed measurement regeneration preserves existing measurement content', async () => {
  const measurementPayload = {
    opportunityId: 'opportunity-1',
    kpis: [{ name: 'Bundle redemptions', category: 'Conversion', statement: 'Track bundle redemptions per gym partner.', evidenceType: 'unknown', sourceIds: [] }],
    experiments: [{ name: 'QR vs app claim', statement: 'Test which claim path converts better.', variants: ['QR', 'App'], measure: 'Redemption rate', evidenceType: 'hypothesis', sourceIds: ['source-1'] }],
    risks: [{ category: 'Partner', statement: 'Gym partners may favor local brands.', mitigation: 'Negotiate bundle terms early.', evidenceType: 'inferred', sourceIds: ['source-1'] }],
    killCriteria: [{ statement: 'Redemption stays near zero after the first month.', evidenceType: 'unknown', sourceIds: [] }],
  };
  const existing = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: fetchImplFor(candidate(measurementPayload)), now: new Date('2026-08-29T00:00:00.000Z') });
  const failingFetch = async () => new Response('provider down', { status: 500 });
  const failed = await generateCampaignStrategy(context, { ai: { apiKey: 'test-key' } }, { fetchImpl: failingFetch, existing, section: 'measurement', now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(failed.meta.status, 'failed');
  assert.equal(failed.kpis.length, 1);
  assert.equal(failed.experiments.length, 1);
  assert.equal(failed.risks.length, 1);
  assert.equal(failed.killCriteria.length, 1);
  assert.equal(failed.strategicProblem.statement, existing.strategicProblem.statement);
});

test('measurement prompt scope requests only KPIs, experiments, risks and kill criteria', () => {
  const { system } = buildCampaignStrategyPrompt(context, { section: 'measurement' });
  assert.match(system, /killCriteria/);
  assert.match(system, /experiments/);
  assert.doesNotMatch(system, /creativeTerritories/);
});
