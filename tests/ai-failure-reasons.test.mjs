import test from 'node:test';
import assert from 'node:assert/strict';

import { synthesizeResearch, synthesizeCampaignStrategy, synthesizeOpportunities } from '../js/services/ai.js';
import { generateCampaignStrategy } from '../js/services/campaign.js';
import { researchMarket } from '../js/services/research.js';

const config = { apiKey: 'test-key', endpoint: 'https://example.test/chat', model: 'test-model' };
const okHeaders = { get: () => null };

function fetchReturning(response) {
  return async () => response;
}

test('budget refusal is classified as budget-refused without calling the provider', async () => {
  let calls = 0;
  const result = await synthesizeResearch({}, [], config, {
    promptTokenBudget: 1,
    fetchImpl: async () => { calls += 1; throw new Error('should not fetch'); },
  });
  assert.equal(result.candidate, null);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'budget-refused');
  assert.equal(calls, 0);
  assert.equal(typeof result.warning, 'string');
  assert.ok(!String(result.warning).includes('budget'));
});

test('provider HTTP error is classified as provider-error', async () => {
  const result = await synthesizeResearch({}, [], config, {
    fetchImpl: fetchReturning({ ok: false, status: 500, headers: okHeaders }),
  });
  assert.equal(result.reason, 'provider-error');
});

test('exhausted rate limit is classified as rate-limited', async () => {
  const result = await synthesizeResearch({}, [], config, {
    fetchImpl: fetchReturning({ ok: false, status: 429, headers: { get: (h) => (h === 'x-ratelimit-remaining-requests' ? '0' : null) } }),
  });
  assert.equal(result.reason, 'rate-limited');
});

test('non-JSON model output is classified as invalid-response', async () => {
  const result = await synthesizeCampaignStrategy({ opportunity: { id: 'o1' } }, config, {
    fetchImpl: fetchReturning({
      ok: true,
      status: 200,
      headers: okHeaders,
      json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
    }),
  });
  assert.equal(result.reason, 'invalid-response');
});

test('abort during fetch is classified as timeout', async () => {
  const result = await synthesizeResearch({}, [], config, {
    fetchImpl: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
  });
  assert.equal(result.reason, 'timeout');
});

test('campaign service surfaces failureReason in meta on handled failure', async () => {
  const result = await generateCampaignStrategy(
    { opportunity: { id: 'o1', title: 'Test' }, research: {}, audience: {}, strategy: {} },
    { ai: config },
    { fetchImpl: fetchReturning({ ok: false, status: 500, headers: okHeaders }) },
  );
  assert.equal(result.meta.status, 'failed');
  assert.equal(result.meta.failureReason, 'provider-error');
  assert.equal(result.meta.providerCalls.total > 0, true);
  assert.equal(result.meta.providerCalls['provider-error'] > 0, true);
});

test('callStats counts successful attempts only (no prompts or keys recorded)', async () => {
  const callStats = {};
  const result = await synthesizeResearch({}, [], config, {
    callStats,
    fetchImpl: fetchReturning({ ok: true, status: 200, headers: okHeaders, json: async () => ({ choices: [{ message: { content: '{"summary":"ok"}' } }] }) }),
  });
  assert.equal(result.status, 'verified');
  assert.deepEqual(callStats, { total: 1, ok: 1 });
});

test('callStats counts retried rate limits and the final outcome', async () => {
  const callStats = {};
  let calls = 0;
  const result = await synthesizeResearch({}, [], config, {
    callStats,
    sleepImpl: async () => {},
    retryBudgetMs: 60000,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 429, headers: okHeaders };
      return { ok: true, status: 200, headers: okHeaders, json: async () => ({ choices: [{ message: { content: '{"summary":"ok"}' } }] }) };
    },
  });
  assert.equal(result.status, 'verified');
  assert.deepEqual(callStats, { total: 2, 'rate-limited': 1, ok: 1 });
});

test('callStats counts provider errors and budget refusals without attempts', async () => {
  const callStats = {};
  await synthesizeResearch({}, [], config, { callStats, fetchImpl: fetchReturning({ ok: false, status: 500, headers: okHeaders }) });
  assert.deepEqual(callStats, { total: 1, 'provider-error': 1 });
  const refused = {};
  await synthesizeResearch({}, [], config, { callStats: refused, promptTokenBudget: 1, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.deepEqual(refused, { 'budget-refused': 1 });
});

test('opportunity synthesis counts model attempts through callStats', async () => {
  const callStats = {};
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ title: 'Test opportunity' }]) } }] }), { status: 200 });
  const result = await synthesizeOpportunities({}, { sources: [] }, { provider: 'OpenAI-compatible', apiKey: 'test-key' }, { fetchImpl, callStats });
  assert.equal(callStats.total, 1);
  assert.equal(callStats.ok, 1);
  assert.equal(result.status, 'verified');
});

test('researchMarket records search request counts separately from model call counts', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ organic: [], news: [] }), { status: 200 });
  const research = await researchMarket({ strategy: { market: 'India', business: 'Test brand', audience: 'Test audience', category: 'Test category' } }, { search: { provider: 'serper', apiKey: 'test-key' } }, { fetchImpl });
  assert.ok(research.meta.searchCalls, 'expected meta.searchCalls on the no-sources path');
  assert.equal(research.meta.searchCalls.total, research.meta.queryCount);
  assert.equal(research.meta.searchCalls.ok, research.meta.queryCount);
  assert.equal(research.meta.searchCalls.failed, 0);
  assert.equal(research.meta.providerCalls, undefined, 'no model synthesis attempted when no sources were found');
});
