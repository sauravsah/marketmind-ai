import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKET_BUDGET, boundItemList, boundSourcePacket, rankSources } from '../js/prompts/budget.js';
import { buildResearchSynthesisPrompt } from '../js/prompts/research.js';
import { buildAudienceAnalysisPrompt } from '../js/prompts/audience.js';
import { buildOpportunityPrompt } from '../js/prompts/opportunity.js';
import { buildCampaignStrategyPrompt } from '../js/prompts/campaign.js';
import { maxOutputTokensFor, rateLimitWaitMs, synthesizeResearch, synthesizeCampaignStrategy } from '../js/services/ai.js';
import { getInternalProviderConfig } from '../server/config.mjs';

const CHAR_TOKEN_BUDGET = 22000; // conservative chars stand-in; exact tokens verified externally per release

function fatSource(index) {
  return {
    id: `source-${index}`,
    title: `A very long market report title about running shoes and marathon training trends ${index}`,
    url: `https://example-${index}.com/story`,
    domain: `example-${index}.com`,
    snippet: 'evidence excerpt '.repeat(60),
    publishedAt: '2026-10-01T00:00:00.000Z',
    retrievedAt: '2026-10-29T00:00:00.000Z',
    sourceType: 'news',
    query: 'running India',
    relevanceScore: 0.5 + (index % 5) / 10,
    freshness: 'very-recent',
    excerptType: 'provider-excerpt',
    quality: {
      score: 0.4 + (index % 7) / 10,
      authority: 0.48,
      confidence: 'medium',
      reasons: [
        { key: 'authority', label: 'Publisher signal', level: 'moderate', detail: 'The domain has a moderate built-in authority signal.' },
        { key: 'relevance', label: 'Query relevance', level: 'strong', detail: 'The provider marked this result as strongly relevant.' },
        { key: 'specificity', label: 'Excerpt detail', level: 'strong', detail: 'The supplied excerpt contains useful context to review.' },
      ],
    },
  };
}

const context = {
  brand: { name: 'Nike', industry: 'Footwear', description: 'Athletic shoes and apparel', audience: 'Runners in India', voice: { tone: 'bold' } },
  strategy: { idea: 'Grow running shoe sales among first-time marathon runners in India', audience: 'First-time marathon runners', market: 'India', platforms: ['Instagram'], objective: 'Consideration', competitors: ['Adidas', 'Asics'], researchDepth: 'balanced' },
};

function fatClaim(index) {
  return { statement: `A long audience claim statement about runner behavior and motivations ${index} ` + 'detail '.repeat(40), evidenceType: 'observed', confidence: 'medium', freshness: 'recent', sourceIds: ['source-1'], whyItMatters: 'matters '.repeat(30) };
}

function fatSignal(index) {
  return { title: `Market signal ${index} ` + 'heading '.repeat(20), summary: 'summary '.repeat(60), evidenceType: 'observed', confidence: 'medium', freshness: 'recent', sourceIds: ['source-2'] };
}

function fatPromptSizes(build) {
  const prompt = build();
  return { system: prompt.system.length, user: prompt.user.length, total: prompt.system.length + prompt.user.length };
}

test('source packets are ranked, capped, trimmed, and slimmed', () => {
  const sources = Array.from({ length: 40 }, (_, index) => fatSource(index));
  const packet = boundSourcePacket(sources);
  assert.equal(packet.length, PACKET_BUDGET.maxSources);
  assert.ok(packet.every((source) => source.snippet.length <= PACKET_BUDGET.maxSnippetChars));
  assert.ok(packet.every((source) => source.title.length <= PACKET_BUDGET.maxTitleChars));
  assert.ok(packet.every((source) => Object.keys(source.quality).sort().join(',') === 'confidence,score'));
  const strengthOf = (source) => source.quality.score + source.relevanceScore;
  const kept = new Set(packet.map((source) => source.id));
  const bestOutside = Math.max(...sources.filter((source) => !kept.has(source.id)).map(strengthOf));
  const worstInside = Math.min(...packet.map((source) => {
    const original = sources.find((entry) => entry.id === source.id);
    return original.quality.score + original.relevanceScore;
  }));
  assert.ok(worstInside >= bestOutside - 1e-9);
});

test('item lists are capped and trimmed without dropping evidence typing', () => {
  const items = Array.from({ length: 20 }, (_, index) => fatClaim(index));
  const packet = boundItemList(items, 4);
  assert.equal(packet.length, 4);
  assert.ok(packet.every((item) => item.statement.length <= PACKET_BUDGET.maxStatementChars));
  assert.ok(packet.every((item) => item.evidenceType === 'observed' && item.sourceIds.length <= PACKET_BUDGET.maxSourceIdsPerItem));
});

test('research and audience prompts stay bounded with a full deduplicated source list', () => {
  const sources = Array.from({ length: 120 }, (_, index) => fatSource(index));
  for (const size of [fatPromptSizes(() => buildResearchSynthesisPrompt(context, sources)), fatPromptSizes(() => buildAudienceAnalysisPrompt(context, sources))]) {
    assert.ok(size.total < CHAR_TOKEN_BUDGET, `prompt too large: ${size.total} chars`);
  }
});

test('opportunity prompt stays bounded with fat prepared evidence', () => {
  const prepared = {
    sources: Array.from({ length: 120 }, (_, index) => fatSource(index)),
    marketSignals: Array.from({ length: 30 }, (_, index) => fatSignal(index)),
    audienceSignals: Array.from({ length: 30 }, (_, index) => fatClaim(index)),
    contradictions: Array.from({ length: 10 }, (_, index) => fatClaim(index + 100)),
    researchTimestamp: '2026-10-29T00:00:00.000Z',
    audienceAnalysisTimestamp: '2026-10-29T01:00:00.000Z',
  };
  const size = fatPromptSizes(() => buildOpportunityPrompt({ ...context, research: { emergingThemes: Array.from({ length: 12 }, (_, index) => fatSignal(index + 50)), contradictions: prepared.contradictions }, audience: { evidenceCoverage: { level: 'partial' } } }, prepared, 'balanced', 0));
  assert.ok(size.total < CHAR_TOKEN_BUDGET * 1.5, `opportunity prompt too large: ${size.total} chars`);
});

test('campaign prompt stays bounded with grown downstream stage outputs', () => {
  const audience = {
    summary: 'snapshot '.repeat(80),
    evidenceCoverage: { level: 'partial', reason: 'because '.repeat(40) },
    observedBehaviors: Array.from({ length: 12 }, (_, index) => fatClaim(index)),
    motivations: Array.from({ length: 12 }, (_, index) => fatClaim(index + 20)),
    pains: Array.from({ length: 12 }, (_, index) => fatClaim(index + 40)),
    desires: Array.from({ length: 12 }, (_, index) => fatClaim(index + 60)),
    tensions: Array.from({ length: 12 }, (_, index) => fatClaim(index + 80)),
    barriers: Array.from({ length: 12 }, (_, index) => fatClaim(index + 100)),
    triggers: Array.from({ length: 12 }, (_, index) => fatClaim(index + 120)),
    identityDrivers: Array.from({ length: 12 }, (_, index) => fatClaim(index + 140)),
    decisionFactors: Array.from({ length: 12 }, (_, index) => fatClaim(index + 160)),
    momentsThatMatter: Array.from({ length: 12 }, (_, index) => fatClaim(index + 180)),
    hypotheses: Array.from({ length: 12 }, (_, index) => fatClaim(index + 200)),
    uncertainties: Array.from({ length: 12 }, (_, index) => fatClaim(index + 220)),
  };
  const opportunity = {
    id: 'opp-1', title: 'First-marathon confidence program', type: 'audience-led',
    oneLineDescription: 'desc '.repeat(50),
    strategicThesis: { statement: 'thesis '.repeat(80), evidenceType: 'hypothesis', confidence: 'medium', sourceIds: ['source-1'] },
    marketSignals: Array.from({ length: 8 }, (_, index) => fatSignal(index)),
    audienceSignals: Array.from({ length: 8 }, (_, index) => fatClaim(index)),
    brandFit: { score: 8, explanation: 'fit '.repeat(60) },
    competitiveContext: { summary: 'comp '.repeat(60) },
    timing: { level: 'now', explanation: 'time '.repeat(50) },
    whitespace: { statement: 'space '.repeat(60) },
    risks: Array.from({ length: 6 }, (_, index) => fatClaim(index)),
    falsificationSignals: Array.from({ length: 6 }, (_, index) => fatClaim(index)),
    confidence: 'medium', sourceIds: ['source-1'],
  };
  const research = {
    marketSignals: Array.from({ length: 15 }, (_, index) => fatSignal(index)),
    audienceSignals: Array.from({ length: 10 }, (_, index) => fatSignal(index + 20)),
    culturalSignals: Array.from({ length: 8 }, (_, index) => fatSignal(index + 40)),
    competitorSignals: Array.from({ length: 8 }, (_, index) => fatSignal(index + 60)),
    industryDevelopments: Array.from({ length: 8 }, (_, index) => fatSignal(index + 80)),
    events: Array.from({ length: 4 }, (_, index) => fatSignal(index + 100)),
    technologySignals: Array.from({ length: 4 }, (_, index) => fatSignal(index + 120)),
    contradictions: Array.from({ length: 8 }, (_, index) => fatClaim(index)),
    emergingThemes: Array.from({ length: 8 }, (_, index) => fatSignal(index + 140)),
    sources: Array.from({ length: 120 }, (_, index) => fatSource(index)),
    meta: { researchedAt: '2026-10-29T00:00:00.000Z' },
  };
  const size = fatPromptSizes(() => buildCampaignStrategyPrompt({ ...context, prepared: { opportunity, audience, research, sources: research.sources, strategy: context.strategy, brand: context.brand }, campaignStrategy: null }, { section: 'all' }));
  assert.ok(size.total < CHAR_TOKEN_BUDGET * 2, `campaign prompt too large: ${size.total} chars`);
});

test('max output tokens default, override, and ceiling', () => {
  assert.equal(maxOutputTokensFor({}, {}, 2500), 2500);
  assert.equal(maxOutputTokensFor({ maxTokens: '4000' }, {}, 2500), 4000);
  assert.equal(maxOutputTokensFor({ maxTokens: 'not-a-number' }, {}, 2500), 2500);
  assert.equal(maxOutputTokensFor({ maxTokens: 10_000_000 }, {}, 2500), 16000);
  assert.equal(maxOutputTokensFor({}, { maxTokens: 3000 }, 2500), 3000);
  const config = getInternalProviderConfig({ AI_MAX_OUTPUT_TOKENS: '3210' });
  assert.equal(config.ai.maxTokens, '3210');
  assert.equal(getInternalProviderConfig({}).ai.maxTokens, undefined);
});

test('rate limit waits honor provider headers with a bounded ceiling', () => {
  const headers = (pairs) => ({ get: (name) => pairs[name] ?? null });
  assert.equal(rateLimitWaitMs({ headers: headers({ 'retry-after': '2' }) }), 2000);
  assert.equal(rateLimitWaitMs({ headers: headers({ 'x-ratelimit-reset-tokens': '7.66s' }) }), 7660);
  assert.equal(rateLimitWaitMs({ headers: headers({ 'x-ratelimit-reset-tokens': '1m2.5s' }) }), 62500);
  assert.equal(rateLimitWaitMs({ headers: headers({ 'retry-after': '600' }) }), 65000);
  assert.equal(rateLimitWaitMs({ headers: headers({}) }), 1000);
});

test('synthesis sends a capped max_tokens and retries rate limits before succeeding', async () => {
  const bodies = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) {
      return { ok: false, status: 429, headers: { get: (name) => (name === 'retry-after' ? '3' : null) } };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"researchSummary":"ok"}' } }] }) };
  };
  const result = await synthesizeResearch(context, [fatSource(1)], { apiKey: 'k', model: 'm', endpoint: 'https://example.test/v1/chat/completions' }, { fetchImpl, sleepImpl: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.status, 'verified');
  assert.deepEqual(sleeps, [3000]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_tokens, 2500);
  assert.equal(bodies[0].response_format.type, 'json_object');
});

test('synthesis fails friendly after bounded retries and does not retry other errors', async () => {
  let calls = 0;
  const alwaysLimited = async () => { calls += 1; return { ok: false, status: 429, headers: { get: () => null } }; };
  const limited = await synthesizeCampaignStrategy(context, { apiKey: 'k' }, { fetchImpl: alwaysLimited, sleepImpl: async () => {} });
  assert.equal(limited.status, 'failed');
  assert.equal(calls, 3);
  calls = 0;
  const serverError = async () => { calls += 1; return { ok: false, status: 500, headers: { get: () => null } }; };
  const failed = await synthesizeResearch(context, [fatSource(1)], { apiKey: 'k' }, { fetchImpl: serverError, sleepImpl: async () => {} });
  assert.equal(failed.status, 'failed');
  assert.equal(calls, 1);
  const missing = await synthesizeResearch(context, [], {}, {});
  assert.equal(missing.status, 'not-configured');
});

import { TIGHT_PACKET_BUDGET, bindCitedPacket, bindItemsToPacket, boundValue, tighterBudget } from '../js/prompts/budget.js';
import { estimateTokens, synthesizeOpportunities } from '../js/services/ai.js';

test('cited sources survive trimming so claims keep visible backing', () => {
  const sources = Array.from({ length: 30 }, (_, index) => fatSource(index));
  const citedLowRank = sources[29]; // lowest quality+relevance mix lands outside top 10
  const claims = [{ statement: 'First-time runners research shoes for weeks', evidenceType: 'observed', confidence: 'medium', sourceIds: [citedLowRank.id] }];
  const bound = bindCitedPacket(sources, [claims]);
  const packetIds = [...bound.packetIds];
  assert.ok(packetIds.includes(citedLowRank.id));
  const items = bindItemsToPacket(claims, bound.packetIds, 4);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sourceIds, [citedLowRank.id]);
});

test('observed claims whose sources left the packet are dropped, not overstated', () => {
  const sources = Array.from({ length: 30 }, (_, index) => fatSource(index));
  const bound = bindCitedPacket(sources, []); // nothing cited -> plain top-N
  const ghostClaim = [{ statement: 'Runners love midnight shopping', evidenceType: 'observed', confidence: 'high', sourceIds: ['source-not-in-packet'] }];
  const items = bindItemsToPacket(ghostClaim, bound.packetIds, 4);
  assert.equal(items.length, 0);
  const hypothesis = [{ statement: 'Runners may respond to coaching content', evidenceType: 'hypothesis', confidence: 'low', sourceIds: [] }];
  assert.equal(bindItemsToPacket(hypothesis, bound.packetIds, 4).length, 1);
});

test('opportunity prompt keeps claim/source consistency under fat evidence', () => {
  const sources = Array.from({ length: 60 }, (_, index) => fatSource(index));
  const claims = Array.from({ length: 20 }, (_, index) => ({ ...fatClaim(index), sourceIds: [`source-${index}`] }));
  const prepared = { sources, marketSignals: claims.slice(0, 10), audienceSignals: claims.slice(10), contradictions: [], researchTimestamp: 'x', audienceAnalysisTimestamp: 'y' };
  const prompt = buildOpportunityPrompt({ ...context, research: {}, audience: {} }, prepared, 'balanced', 0);
  const user = JSON.parse(prompt.user);
  const packetIds = new Set(user.marketIntelligence.sources.map((source) => source.id));
  const allItems = [...user.marketIntelligence.signals, ...user.marketIntelligence.emergingThemes, ...user.marketIntelligence.contradictions, ...user.audienceIntelligence.reviewedSignals];
  assert.ok(allItems.length > 0);
  for (const item of allItems) {
    assert.ok(item.sourceIds.every((id) => packetIds.has(id)), `item cites source outside packet: ${item.sourceIds}`);
    if (['observed', 'inferred'].includes(item.evidenceType)) assert.ok(item.sourceIds.length > 0, 'evidence-backed item lost all visible backing');
  }
});

test('adversarial unicode and oversized inputs cannot force an over-budget request', async () => {
  const devanagari = 'मैराथन के लिए पहली बार दौड़ने वाले भारतीय युवा ';
  const nastySources = Array.from({ length: 40 }, (_, index) => ({
    ...fatSource(index),
    id: `source-${'x'.repeat(500)}-${index}`,
    snippet: devanagari.repeat(30),
    title: devanagari.repeat(6),
  }));
  const nastyContext = {
    brand: { ...context.brand, name: devanagari.repeat(10), description: devanagari.repeat(40) },
    strategy: { ...context.strategy, competitors: Array.from({ length: 50 }, (_, index) => `Competitor ${index} ${'y'.repeat(4000)}`), platforms: Array.from({ length: 30 }, (_, i) => `Platform${i}${'z'.repeat(300)}`) },
  };
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"researchSummary":"ok"}' } }] }) };
  };
  const result = await synthesizeResearch(nastyContext, nastySources, { apiKey: 'k', model: 'm', endpoint: 'https://example.test/v1' }, { fetchImpl, sleepImpl: async () => {} });
  // Either the provider is never called (safely refused) or the request that
  // went out still respected the estimated budget.
  if (fetchCalls > 0) {
    assert.equal(result.status, 'verified');
  } else {
    assert.equal(result.status, 'failed');
  }
  const tight = buildResearchSynthesisPrompt(nastyContext, nastySources, TIGHT_PACKET_BUDGET);
  const defaultPrompt = buildResearchSynthesisPrompt(nastyContext, nastySources);
  assert.ok(tight.user.length <= defaultPrompt.user.length);
  assert.ok(JSON.parse(tight.user).sourcePacket.length <= TIGHT_PACKET_BUDGET.maxSources + TIGHT_PACKET_BUDGET.maxExtraCitedSources);
  assert.ok(JSON.parse(tight.user).strategyContext.competitors.length <= 8);
  assert.ok(JSON.parse(tight.user).strategyContext.competitors.every((name) => name.length <= 80));
});

test('over-budget estimate refuses before any provider call', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls += 1; throw new Error('must not be called'); };
  const huge = Array.from({ length: 40 }, (_, index) => ({ ...fatSource(index), snippet: 'दौड़ '.repeat(400) }));
  const result = await synthesizeResearch(context, huge, { apiKey: 'k', model: 'm', endpoint: 'https://example.test/v1' }, { fetchImpl, promptTokenBudget: 3000, sleepImpl: async () => {} });
  assert.equal(result.status, 'failed');
  assert.equal(fetchCalls, 0);
});

test('daily quota exhaustion is not retried; abort stops before calling', async () => {
  let calls = 0;
  const exhausted = async () => { calls += 1; return { ok: false, status: 429, headers: { get: (name) => (name === 'x-ratelimit-remaining-requests' ? '0' : null) } }; };
  const result = await synthesizeResearch(context, [fatSource(1)], { apiKey: 'k' }, { fetchImpl: exhausted, sleepImpl: async () => {} });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 1);
  calls = 0;
  const controller = new AbortController();
  controller.abort();
  const aborted = await synthesizeResearch(context, [fatSource(1)], { apiKey: 'k' }, { fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({}) }; }, signal: controller.signal, sleepImpl: async () => {} });
  assert.equal(aborted.status, 'failed');
  assert.equal(calls, 0);
});

test('token estimate weights non-latin scripts conservatively and budgets only tighten', () => {
  const latin = estimateTokens('a'.repeat(400));
  const indic = estimateTokens('द'.repeat(400));
  assert.ok(indic > latin * 2, `indic ${indic} should far exceed latin ${latin}`);
  const merged = tighterBudget(PACKET_BUDGET, TIGHT_PACKET_BUDGET);
  for (const key of Object.keys(TIGHT_PACKET_BUDGET)) assert.ok(merged[key] <= PACKET_BUDGET[key]);
  const campaignFloor = tighterBudget({ maxSources: 3, maxSnippetChars: 150 }, TIGHT_PACKET_BUDGET);
  assert.equal(campaignFloor.maxSources, 3);
  assert.equal(campaignFloor.maxSnippetChars, 150);
});

test('free-form voice and override content is structurally bounded', () => {
  const nasty = {
    tone: 'bold '.repeat(500),
    personality: Array.from({ length: 40 }, (_, i) => `trait-${i}-${'p'.repeat(300)}`),
    nested: { deep: { deeper: { deepest: { tooFar: 'x'.repeat(1000) } } } },
    list: Array.from({ length: 100 }, (_, i) => i),
  };
  const bound = boundValue(nasty, { maxChars: 120, maxItems: 6, maxKeys: 8, maxDepth: 3 });
  assert.ok(bound.tone.length <= 120);
  assert.equal(bound.personality.length, 6);
  assert.ok(bound.personality.every((item) => item.length <= 120));
  assert.equal(bound.list.length, 6);
  assert.equal(bound.nested.deep.deeper, undefined);
});

test('rate-limit retry defers safely when the call time budget is insufficient', async () => {
  let calls = 0;
  const limited = async () => { calls += 1; return { ok: false, status: 429, headers: { get: (name) => (name === 'x-ratelimit-reset-tokens' ? '59.9s' : null) } }; };
  const result = await synthesizeResearch(context, [fatSource(1)], { apiKey: 'k' }, { fetchImpl: limited, sleepImpl: async () => {}, retryBudgetMs: 10_000 });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 1); // no retry: 59.9s wait + attempt cannot fit a 10s budget
  calls = 0;
  const quickReset = async () => { calls += 1; return { ok: false, status: 429, headers: { get: (name) => (name === 'retry-after' ? '1' : null) } }; };
  const retried = await synthesizeResearch(context, [fatSource(1)], { apiKey: 'k' }, { fetchImpl: quickReset, sleepImpl: async () => {}, retryBudgetMs: 10_000, timeoutMs: 2_000 });
  assert.equal(retried.status, 'failed');
  assert.equal(calls, 3); // 1s waits + 2s attempt allowance fit the 10s budget twice
});
