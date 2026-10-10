import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeedbackPayload } from '../server/feedback.mjs';

test('feedback payloads are sanitized and bounded', () => {
  const result = normalizeFeedbackPayload({ category: 'BUG', message: `  Fix this\u0000 please  `, route: '#audience<script>', clientTimestamp: '2026-10-11T00:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { category: 'bug', message: 'Fix this please', route: '#audiencescript', clientTimestamp: '2026-10-11T00:00:00.000Z' });
});

test('feedback requires a supported category and useful message', () => {
  assert.equal(normalizeFeedbackPayload({ category: 'secret', message: 'hello' }).ok, false);
  assert.equal(normalizeFeedbackPayload({ category: 'idea', message: '  ' }).ok, false);
});

test('feedback message length is capped', () => {
  const result = normalizeFeedbackPayload({ category: 'idea', message: 'x'.repeat(2000) });
  assert.equal(result.ok, true);
  assert.equal(result.value.message.length, 1200);
});
