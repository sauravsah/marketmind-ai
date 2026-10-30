import test from 'node:test';
import assert from 'node:assert/strict';

import { synthesizeResearch, synthesizeCampaignStrategy } from '../js/services/ai.js';
import { generateCampaignStrategy } from '../js/services/campaign.js';

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
});
