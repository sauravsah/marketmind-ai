import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchQueries, deduplicateSources, evaluateSourceQuality, normalizeSearchResult, validateResearchOutput, researchMarket } from '../js/services/research.js';

const context = {
  strategy: { idea: 'Make running more relevant to young people', audience: 'Gen Z', market: 'India', competitors: ['Adidas', 'Puma'], researchDepth: 'balanced' },
  brand: { name: 'Stride', industry: 'Sportswear', description: 'Everyday running apparel', audience: 'Gen Z' },
};

test('query generation reflects geography, audience, competitors, and depth', () => {
  const queries = buildResearchQueries(context, 'balanced');
  assert.ok(queries.length > 5);
  assert.ok(queries.some((query) => query.query.includes('India')));
  assert.ok(queries.some((query) => query.query.includes('Gen Z')));
  assert.ok(queries.some((query) => query.query.includes('Adidas')));
  assert.ok(buildResearchQueries(context, 'quick').length < queries.length);
});

test('normalization preserves unknown publication dates and normalizes tracking URLs', () => {
  const source = normalizeSearchResult({ title: 'A signal', link: 'https://www.example.com/story/?utm_source=test', snippet: 'Useful evidence' }, { query: 'running India', sourceType: 'industry' }, '2026-08-29T00:00:00.000Z');
  assert.equal(source.url, 'https://www.example.com/story');
  assert.equal(source.publishedAt, null);
  assert.equal(source.freshness, 'unknown');
  assert.equal(source.excerptType, 'provider-excerpt');
});

test('source quality exposes review reasons without presenting a score as proof', () => {
  const source = normalizeSearchResult({ title: 'A signal', link: 'https://www.who.int/story', snippet: 'A detailed evidence excerpt with enough context to review the result.', relevanceScore: 0.9 }, { query: 'running India', sourceType: 'industry' }, '2026-08-29T00:00:00.000Z');
  const quality = evaluateSourceQuality(source);
  assert.equal(quality.confidence, 'high');
  assert.deepEqual(quality.reasons.map((reason) => reason.key), ['authority', 'relevance', 'specificity']);
  assert.ok(quality.reasons.every((reason) => reason.detail.length > 0));
});

test('deduplication keeps the stronger version of a repeated source', () => {
  const first = normalizeSearchResult({ title: 'Running communities are growing', url: 'https://example.com/story', snippet: 'Short' }, { query: 'running', sourceType: 'culture' });
  const duplicate = normalizeSearchResult({ title: 'Running communities are growing in cities', url: 'https://example.com/story?utm_medium=social', snippet: 'A much more useful evidence excerpt with enough context to evaluate relevance.' }, { query: 'running', sourceType: 'culture' });
  const sources = deduplicateSources([first, duplicate]);
  assert.equal(sources.length, 1);
  assert.ok(sources[0].snippet.length >= first.snippet.length);
});

test('research without a configured search provider returns no fabricated results', async () => {
  const result = await researchMarket(context, { search: { provider: 'Serper', apiKey: '' }, ai: { apiKey: '' } });
  assert.equal(result.sources.length, 0);
  assert.equal(result.marketSignals.length, 0);
  assert.equal(result.meta.providerStatus, 'not-configured');
  assert.equal(result.meta.warnings[0], 'Live market research is temporarily unavailable. Try again shortly.');
});

test('validation removes AI evidence IDs that were not supplied by research', () => {
  const source = normalizeSearchResult({ title: 'Known source', url: 'https://example.com/known', snippet: 'Evidence' }, { query: 'known', sourceType: 'industry' });
  const result = validateResearchOutput({ marketSignals: [{ title: 'Grounded', summary: 'Supported', sourceIds: [source.id, 'invented-source-id'], confidence: 'high' }] }, [source]);
  assert.deepEqual(result.marketSignals[0].sourceIds, [source.id]);
  assert.equal(result.sources.some((item) => item.id === 'invented-source-id'), false);
});

test('configured providers produce normalized, evidence-mapped research output', async () => {
  const expectedSource = normalizeSearchResult({ title: 'Running communities grow', link: 'https://example.com/running', snippet: 'Running groups are becoming more visible in cities.', date: 'August 12, 2026' }, { query: 'running trends India', sourceType: 'culture' }, '2026-08-29T00:00:00.000Z');
  const fetchImpl = async (url) => {
    if (url.includes('serper.dev')) return new Response(JSON.stringify({ organic: [{ title: expectedSource.title, link: expectedSource.url, snippet: expectedSource.snippet, date: 'August 12, 2026' }, { title: expectedSource.title, link: `${expectedSource.url}?utm_source=social`, snippet: expectedSource.snippet, date: 'August 12, 2026' }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ researchSummary: 'The supplied evidence points to more visible running communities.', culturalSignals: [{ title: 'Running is becoming more social', summary: 'Community activity is visible in the supplied source.', type: 'culture', importance: 'medium', freshness: 'recent', confidence: 'medium', interpretation: 'This may create room for belonging-led positioning.', sourceIds: [expectedSource.id] }] }) } }] }), { status: 200 });
  };
  const result = await researchMarket(context, { search: { provider: 'Serper', apiKey: 'search-key' }, ai: { provider: 'OpenAI-compatible', apiKey: 'ai-key' } }, { fetchImpl });
  assert.equal(result.meta.providerStatus, 'verified');
  assert.equal(result.meta.aiStatus, 'verified');
  assert.equal(result.sources.length, 1);
  assert.equal(result.culturalSignals.length, 1);
  assert.deepEqual(result.culturalSignals[0].sourceIds, [expectedSource.id]);
});

test('malformed AI synthesis degrades to sources without invented signals', async () => {
  const fetchImpl = async (url) => url.includes('serper.dev')
    ? new Response(JSON.stringify({ organic: [{ title: 'Known evidence', link: 'https://example.com/evidence', snippet: 'A provider result.' }] }), { status: 200 })
    : new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 });
  const result = await researchMarket(context, { search: { provider: 'Serper', apiKey: 'search-key' }, ai: { provider: 'OpenAI-compatible', apiKey: 'ai-key' } }, { fetchImpl });
  assert.equal(result.sources.length, 1);
  assert.equal(result.marketSignals.length, 0);
  assert.equal(result.meta.aiStatus, 'failed');
  assert.equal(result.meta.warnings[0], 'MarketMind is temporarily unable to complete this analysis. Please try again.');
});
