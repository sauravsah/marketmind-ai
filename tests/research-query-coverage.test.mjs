import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchQueries, researchMarket } from '../js/services/research.js';

const limits = { quick: [7, 5], balanced: [11, 7], deep: [15, 8] };
const idea = 'Should we launch refillable running shoes for night-shift nurses?';
const names = Array.from({ length: 12 }, (_, i) => `DistinctBrand${String(i + 1).padStart(2, '0')}`);
const context = (competitors = names.slice(0, 8), depth = 'quick') => ({
  strategy: { idea, audience: 'Night-shift nurses', market: 'Bengaluru, India', competitors, researchDepth: depth },
  brand: { name: 'Stride', industry: 'Sportswear' },
});

for (const [depth, [cap, maxResults]] of Object.entries(limits)) {
  for (const count of [0, 1, 2, 8, 12]) {
    test(`${depth} preserves the decision and all ${count} competitors inside its query budget`, () => {
      const competitors = names.slice(0, count);
      const queries = buildResearchQueries(context(competitors, depth), depth);
      assert.ok(queries.length <= cap);
      assert.ok(queries.find(q => q.angle === 'Idea context').query.includes(idea));
      assert.ok(queries.some(q => q.query.includes('Night-shift nurses')));
      assert.ok(queries.some(q => q.angle === 'Category trends'));
      assert.ok(queries.some(q => q.angle === 'Current developments'));
      for (const name of competitors) assert.ok(queries.some(q => q.sourceType === 'competitor' && q.query.includes(name)), name);
      assert.ok(queries.every(q => q.query.includes('Bengaluru, India') && q.maxResults === maxResults));
      assert.deepEqual(queries.map(q => q.id), queries.map((_, i) => `query-${i + 1}`));
      assert.equal(new Set(queries.map(q => q.query)).size, queries.length);
      assert.deepEqual(buildResearchQueries(context(competitors, depth), depth), queries);
    });
  }
}

test('competitor names are trimmed and deduplicated without mutating the brief', () => {
  const input = context([' Puma ', 'puma', '', 'Adidas', '  ']);
  const before = structuredClone(input);
  const queries = buildResearchQueries(input, 'quick').filter(q => q.sourceType === 'competitor');
  assert.equal(queries.length, 2);
  assert.ok(queries.some(q => q.query.startsWith('Puma ')));
  assert.deepEqual(input, before);
});

test('unknown depth falls back to balanced and absent optional fields remain safe', () => {
  assert.deepEqual(buildResearchQueries(context(), 'unexpected'), buildResearchQueries(context(), 'balanced'));
  for (const depth of Object.keys(limits)) {
    const queries = buildResearchQueries({}, depth);
    assert.ok(queries.length <= limits[depth][0]);
    assert.ok(queries.every(q => q.query && q.market === 'the target market'));
  }
});

for (const provider of ['Serper', 'Tavily']) {
  test(`${provider} receives every planned query without extra calls using stubbed search`, async () => {
    const calls = [];
    const input = context();
    const expected = buildResearchQueries(input, 'quick');
    const result = await researchMarket(input, { search: { provider, apiKey: 'stub-only' }, ai: {} }, {
      fetchImpl: async (url, init) => {
        calls.push({ url, payload: JSON.parse(init.body) });
        return new Response(JSON.stringify(provider === 'Serper' ? { organic: [] } : { results: [] }), { status: 200 });
      },
    });
    assert.equal(calls.length, expected.length);
    assert.equal(calls.length, 7);
    assert.deepEqual(calls.map(c => c.payload.q || c.payload.query), expected.map(q => q.query));
    assert.equal(result.meta.queryCount, 7);
    assert.equal(result.sources.length, 0);
    assert.equal(result.meta.aiStatus, 'not-configured');
  });
}

 test('grouped competitors retain quoted multi-word names and explicit OR boundaries', () => {
  const queries = buildResearchQueries(context(['New Balance', 'On Running', 'Puma', 'Nike', 'Asics', 'Hoka', 'Reebok', 'Adidas']), 'quick');
  const grouped = queries.filter(q => q.sourceType === 'competitor');
  assert.equal(grouped.length, 3);
  assert.ok(grouped.every(q => q.query.startsWith('(') && q.query.includes(' OR ')));
  assert.ok(grouped.some(q => q.query.includes('"New Balance"')));
  assert.ok(grouped.some(q => q.query.includes('"On Running"')));
});
