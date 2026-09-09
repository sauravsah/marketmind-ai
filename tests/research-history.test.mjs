import test from 'node:test';
import assert from 'node:assert/strict';
import { appendResearchRun, countResearchSignals, createResearchRunSnapshot } from '../js/research-history.js';

function research(summary, researchedAt, sourceCount = 1) {
  return {
    researchSummary: summary,
    marketSignals: [{ title: summary }],
    audienceSignals: [],
    industryDevelopments: [],
    culturalSignals: [],
    competitorSignals: [],
    events: [],
    technologySignals: [],
    emergingThemes: [],
    contradictions: [],
    sources: Array.from({ length: sourceCount }, (_, index) => ({ id: `source-${index}` })),
    meta: { researchedAt, depth: 'balanced', providerStatus: 'verified', aiStatus: 'verified' },
  };
}

test('research run snapshots strip nested history and record useful audit metadata', () => {
  const run = createResearchRunSnapshot({ ...research('Current', '2026-09-01T00:00:00.000Z', 2), runs: [{ id: 'old' }] }, { id: 'run-current' });
  assert.equal(run.id, 'run-current');
  assert.equal(run.sourceCount, 2);
  assert.equal(run.signalCount, 1);
  assert.equal(run.snapshot.runs, undefined);
  assert.equal(run.summary, 'Current');
});

test('appending research preserves prior snapshots and caps history', () => {
  const first = research('First', '2026-09-01T00:00:00.000Z');
  const second = research('Second', '2026-09-02T00:00:00.000Z', 2);
  const withFirst = appendResearchRun(null, first, { id: 'run-first' });
  const withSecond = appendResearchRun(withFirst, second, { id: 'run-second', maxRuns: 2 });
  assert.equal(withSecond.activeRunId, 'run-second');
  assert.deepEqual(withSecond.runs.map((run) => run.id), ['run-first', 'run-second']);
  assert.equal(withSecond.runs[0].snapshot.researchSummary, 'First');
  assert.equal(withSecond.runs[1].sourceCount, 2);
});

test('signal counting covers every supported research signal group', () => {
  assert.equal(countResearchSignals({ marketSignals: [1], events: [1, 2], technologySignals: [1] }), 4);
});
