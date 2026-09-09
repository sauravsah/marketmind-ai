import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultStrategy, createEmptyOpportunity, createEmptyOpportunityRadar } from '../js/models.js';
import { assessIntelligence, calculateOpportunityConfidence, calculateOpportunityScore, deduplicateOpportunities, diversifyOpportunities, identifyOpportunities, prepareOpportunityContext, researchIsStale } from '../js/services/opportunity.js';
import { buildOpportunityPrompt } from '../js/prompts/opportunity.js';

const sources = [1, 2, 3].map((number) => ({ id: `source-${number}`, title: `Evidence ${number}`, url: `https://example.com/evidence-${number}`, domain: 'example.com', snippet: `Supplied evidence ${number}.`, sourceType: number === 1 ? 'industry' : 'audience', freshness: 'recent', quality: { score: 0.7, confidence: 'medium' } }));
const research = {
  marketSignals: [{ title: 'Community activity is visible', summary: 'The supplied evidence shows more community activity.', type: 'culture', sourceIds: ['source-1'], confidence: 'medium', freshness: 'recent' }],
  audienceSignals: [{ title: 'Audience conversations are active', summary: 'The supplied evidence shows audience conversation.', type: 'audience', sourceIds: ['source-2'], confidence: 'medium', freshness: 'recent' }],
  competitorSignals: [{ title: 'Competitors emphasize performance', summary: 'The supplied evidence describes a performance-led category.', type: 'competitor', sourceIds: ['source-3'], confidence: 'medium', freshness: 'recent' }],
  contradictions: [{ title: 'Evidence is mixed', summary: 'The supplied sources do not fully agree.', confidence: 'low', sourceIds: ['source-3'] }],
  emergingThemes: [],
  sources,
  meta: { researchedAt: '2026-08-20T00:00:00.000Z', aiStatus: 'verified' },
};
const audience = {
  createdAt: '2026-08-21T00:00:00.000Z',
  researchVersion: '2026-08-20T00:00:00.000Z',
  meta: { mode: 'research-backed' },
  evidenceCoverage: { level: 'moderate' },
  observedBehaviors: [{ statement: 'Community activity is visible in the supplied evidence.', evidenceType: 'observed', sourceIds: ['source-1'], confidence: 'medium', freshness: 'recent', reviewStatus: 'approved' }],
  motivations: [{ statement: 'Belonging may matter to this audience.', evidenceType: 'inferred', sourceIds: ['source-2'], confidence: 'medium', freshness: 'recent', reviewStatus: 'approved' }],
  tensions: [], pains: [], desires: [], barriers: [], objections: [], triggers: [], identityDrivers: [], contentBehaviors: [], decisionFactors: [], momentsThatMatter: [], hypotheses: [], uncertainties: [],
};
const context = {
  strategy: { id: 'strategy-opportunity-test', idea: 'Make running more relevant', audience: 'Young runners', market: 'India', platforms: ['Instagram'], objective: 'Engagement', competitors: ['Adidas', 'Puma'] },
  brand: { name: 'Stride', industry: 'Sportswear', description: 'Everyday running apparel', audience: 'Young runners', voice: { tone: 'Friendly & Conversational' } },
  research,
  audience,
};

function candidate(overrides = {}) {
  return {
    title: 'Community-led running identity',
    oneLineDescription: 'Explore running as a social identity and belonging territory.',
    type: 'community',
    strategicThesis: 'Because community activity is visible, and belonging appears relevant to the audience, the brand could explore a community-led running identity.',
    marketSignals: [{ statement: 'Community activity is visible in the supplied evidence.', evidenceType: 'observed', sourceIds: ['source-1'], confidence: 'medium', freshness: 'recent' }],
    audienceSignals: [{ statement: 'Belonging may matter to this audience.', evidenceType: 'inferred', sourceIds: ['source-2'], confidence: 'medium', freshness: 'recent' }],
    brandFit: { level: 'high', explanation: 'The brand operates in sportswear and can credibly explore running participation.', evidenceType: 'inferred' },
    competitiveContext: { summary: 'Performance-led competitor evidence leaves a possible identity angle to test.', evidenceType: 'inferred', sourceIds: ['source-3'] },
    timing: { level: 'moderate', explanation: 'Current community activity provides a reason to explore the territory now.', evidenceType: 'inferred', sourceIds: ['source-1'] },
    evidence: [{ statement: 'The market and audience signals create a direction worth validating.', evidenceType: 'hypothesis', sourceIds: ['source-1', 'source-2'] }],
    contradictions: [{ statement: 'Competitive evidence is mixed.', evidenceType: 'inferred', sourceIds: ['source-3'] }],
    whitespace: { statement: 'Potential whitespace may exist around social belonging rather than only technical performance.', evidenceType: 'hypothesis', sourceIds: ['source-3'] },
    risks: ['The trend may be concentrated in urban communities.'],
    falsificationSignals: ['Audience research shows low interest in community participation.'],
    confidence: 'high',
    scores: { audienceRelevance: 8, brandFit: 8, evidenceStrength: 7, timing: 6, competitiveWhitespace: 7, actionability: 8 },
    validationPlan: { method: 'Community experiment', plan: 'Test three community-led content angles with a small running group before broader investment.' },
    recommendedNextStep: 'Validate the belonging tension with a small community experiment.',
    sourceIds: ['source-1', 'source-2', 'source-3', 'invented-source'],
    ...overrides,
  };
}

test('opportunity schema includes radar persistence fields', () => {
  const strategy = createDefaultStrategy();
  const opportunity = createEmptyOpportunity();
  const radar = createEmptyOpportunityRadar();
  assert.equal(strategy.opportunityRadar, null);
  assert.equal(strategy.selectedOpportunityId, null);
  assert.ok('strategicThesis' in opportunity);
  assert.ok('selectedOpportunityId' in strategy);
  assert.deepEqual(radar.opportunities, []);
});

test('weighted opportunity score is reproducible and not a probability', () => {
  const first = calculateOpportunityScore({ audienceRelevance: 8, brandFit: 7, evidenceStrength: 6, timing: 5, competitiveWhitespace: 4, actionability: 9 });
  const second = calculateOpportunityScore({ audienceRelevance: 8, brandFit: 7, evidenceStrength: 6, timing: 5, competitiveWhitespace: 4, actionability: 9 });
  assert.deepEqual(first, second);
  assert.equal(first.overall, 66);
  assert.match(first.label, /assessment/i);
  assert.doesNotMatch(first.label, /probability/i);
});

test('invalid source IDs are removed and unsupported source-only opportunities are rejected', async () => {
  const prepared = prepareOpportunityContext(context);
  assert.deepEqual(prepared.sourceIds.sort(), ['source-1', 'source-2', 'source-3']);
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ opportunities: [candidate()] }) } }] }), { status: 200 });
  const radar = await identifyOpportunities(context, { ai: { apiKey: 'test-key' } }, { fetchImpl, now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(radar.opportunities.length, 1);
  assert.equal(radar.opportunities[0].sourceIds.includes('invented-source'), false);
  assert.ok(radar.opportunities[0].sourceIds.every((id) => prepared.sourceIds.includes(id)));
});

test('missing research and audience intelligence blocks generation without fabrication', async () => {
  const radar = await identifyOpportunities({ strategy: context.strategy, brand: context.brand }, { ai: { apiKey: 'test-key' } });
  assert.equal(radar.meta.status, 'blocked');
  assert.equal(radar.opportunities.length, 0);
  assert.match(radar.meta.warnings[0], /needs more evidence/i);
});

test('low-confidence audience evidence lowers independent opportunity confidence', () => {
  const readiness = assessIntelligence(context);
  const opportunity = { ...createEmptyOpportunity(), sourceIds: ['source-1', 'source-2', 'source-3'], audienceSignals: [{ evidenceType: 'hypothesis', confidence: 'low', sourceIds: ['source-2'] }], confidence: 'high' };
  assert.equal(readiness.audienceStatus, 'available');
  assert.equal(calculateOpportunityConfidence(opportunity, { ...context, readiness }), 'low');
});

test('contradictions are preserved in the opportunity radar metadata', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ opportunities: [candidate()] }) } }] }), { status: 200 });
  const radar = await identifyOpportunities(context, { ai: { apiKey: 'test-key' } }, { fetchImpl, now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(radar.meta.contradictionsConsidered.length, 1);
  assert.equal(radar.opportunities[0].contradictions.length, 1);
  assert.equal(radar.opportunities[0].confidence, 'medium');
});

test('opportunity evidence remains labeled as observed, inferred, or hypothesis', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ opportunities: [candidate()] }) } }] }), { status: 200 });
  const radar = await identifyOpportunities(context, { ai: { apiKey: 'test-key' } }, { fetchImpl, now: new Date('2026-08-29T00:00:00.000Z') });
  const opportunity = radar.opportunities[0];
  assert.equal(opportunity.marketSignals[0].evidenceType, 'observed');
  assert.equal(opportunity.audienceSignals[0].evidenceType, 'inferred');
  assert.equal(opportunity.evidence[0].evidenceType, 'hypothesis');
});

test('opportunity synthesis cannot reintroduce an unreviewed audience claim', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ opportunities: [candidate({ audienceSignals: [{ statement: 'An unreviewed audience claim.', evidenceType: 'inferred', sourceIds: ['source-2'] }] })] }) } }] }), { status: 200 });
  const radar = await identifyOpportunities(context, { ai: { apiKey: 'test-key' } }, { fetchImpl });
  assert.equal(radar.opportunities.length, 0);
  assert.equal(radar.meta.status, 'insufficient');
  const prompt = buildOpportunityPrompt(context, prepareOpportunityContext(context), 'balanced', 0);
  assert.match(prompt.user, /reviewedSignals/);
  assert.doesNotMatch(prompt.user, /observedBehaviors/);
});

test('repeat analyses receive a variation pass and filter prior territories', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ opportunities: [candidate()] }) } }] }), { status: 200 });
  const radar = await identifyOpportunities({ ...context, previousOpportunities: [{ title: candidate().title, strategicThesis: candidate().strategicThesis }] }, { ai: { apiKey: 'test-key' } }, { fetchImpl, variation: 2 });
  assert.equal(radar.meta.variation, 2);
  assert.equal(radar.opportunities.length, 0);
  assert.equal(radar.meta.status, 'insufficient');
});

test('stale research is explicit and affects confidence', async () => {
  assert.equal(researchIsStale('2026-01-01T00:00:00.000Z', new Date('2026-08-29T00:00:00.000Z')), true);
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ opportunities: [candidate({ confidence: 'high' })] }) } }] }), { status: 200 });
  const staleContext = { ...context, research: { ...research, meta: { ...research.meta, researchedAt: '2026-01-01T00:00:00.000Z' } }, audience: { ...audience, researchVersion: '2026-01-01T00:00:00.000Z' } };
  const radar = await identifyOpportunities(staleContext, { ai: { apiKey: 'test-key' } }, { fetchImpl, now: new Date('2026-08-29T00:00:00.000Z') });
  assert.equal(radar.meta.stale, true);
  assert.equal(radar.opportunities[0].confidence, 'low');
});

test('near-duplicate opportunities are removed and different types are preferred', () => {
  const items = [
    { title: 'Community running identity', strategicThesis: 'Explore belonging through running', type: 'community' },
    { title: 'Community running identity', strategicThesis: 'Explore belonging through running', type: 'content' },
    { title: 'Performance technology utility', strategicThesis: 'Explore technology for training', type: 'product' },
  ];
  assert.equal(deduplicateOpportunities(items).length, 2);
  assert.equal(diversifyOpportunities(items, 2).length, 2);
  assert.notEqual(diversifyOpportunities(items, 2)[0].type, diversifyOpportunities(items, 2)[1].type);
});

test('malformed AI output returns no invented opportunities', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 });
  const radar = await identifyOpportunities(context, { ai: { apiKey: 'test-key' } }, { fetchImpl });
  assert.equal(radar.opportunities.length, 0);
  assert.equal(radar.meta.status, 'failed');
});
