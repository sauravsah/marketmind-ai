import test from 'node:test';
import assert from 'node:assert/strict';
import { researchStageStatus, assessIntelligence } from '../js/client/intelligence.js';

function research({ sourceCount = 0, aiStatus = 'verified', signals = 0, researchedAt = '2026-11-04T10:00:00.000Z' } = {}) {
  const sources = Array.from({ length: sourceCount }, (_, index) => ({ id: `s${index + 1}`, url: `https://example.com/${index + 1}`, title: `Source ${index + 1}` }));
  const marketSignals = Array.from({ length: signals }, (_, index) => ({ statement: `Signal ${index + 1}`, sourceIds: [`s${(index % Math.max(sourceCount, 1)) + 1}`] }));
  return { researchSummary: '', marketSignals, sources, meta: { researchedAt, aiStatus } };
}

test('no run, or a failed run without sources, is not progress', () => {
  assert.equal(researchStageStatus(null), 'none');
  assert.equal(researchStageStatus(research({ sourceCount: 0, researchedAt: null })), 'none');
  assert.equal(researchStageStatus(research({ sourceCount: 0 })), 'none');
});

test('a run without synthesized signals stays partial, never complete', () => {
  assert.equal(researchStageStatus(research({ sourceCount: 5, signals: 0 })), 'partial');
  assert.equal(researchStageStatus(research({ sourceCount: 1, signals: 0 })), 'partial');
});

test('thin or unverified synthesis stays partial', () => {
  assert.equal(researchStageStatus(research({ sourceCount: 2, signals: 3 })), 'partial');
  assert.equal(researchStageStatus(research({ sourceCount: 4, signals: 3, aiStatus: 'limited' })), 'partial');
});

test('a sourced, verified run with signals is complete', () => {
  assert.equal(researchStageStatus(research({ sourceCount: 3, signals: 2 })), 'complete');
  const assessed = assessIntelligence({ research: research({ sourceCount: 3, signals: 2 }), audience: null });
  assert.equal(assessed.researchStatus, 'available');
  const partial = assessIntelligence({ research: research({ sourceCount: 1, signals: 0 }), audience: null });
  assert.equal(partial.researchStatus, 'limited');
});
