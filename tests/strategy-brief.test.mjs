import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStrategyBrief } from '../js/strategy-brief.js';

test('draft collector captures every brief field and preserves saved intelligence', () => {
  const existing = { id: 'original', createdAt: 'earlier', status: 'complete', competitors: ['Acme'], research: { sources: [{ id: 'one' }] }, audienceInsights: { reviewed: true } };
  const data = new Map(Object.entries({ idea: '  Launch? ', audience: ' Founders ', market: ' India ', platform: 'LinkedIn', objective: 'Launch', researchDepth: 'deep' }));
  const next = collectStrategyBrief(existing, data, 'now');
  assert.deepEqual(next, { ...existing, idea: 'Launch?', audience: 'Founders', market: 'India', platforms: ['LinkedIn'], objective: 'Launch', researchDepth: 'deep', updatedAt: 'now' });
  assert.equal(existing.idea, undefined);
});

test('incomplete drafts can be collected without requiring a paid research run', () => {
  assert.deepEqual(collectStrategyBrief({ id: 'draft' }, new Map(), 'now'), { id: 'draft', idea: '', audience: '', market: '', platforms: [], objective: '', researchDepth: 'balanced', status: 'draft', createdAt: 'now', updatedAt: 'now' });
});
