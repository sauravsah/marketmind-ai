import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAudienceClaimReview,
  createAudienceClaimId,
  createAudienceReviewKey,
  ensureAudienceClaimMetadata,
  getAudienceReviewSummary,
  getRadarEligibleAudienceItems,
  mergeAudienceReviewState,
} from '../js/audience-review.js';
import { assessIntelligence as assessClientIntelligence } from '../js/client/intelligence.js';

const research = {
  meta: { researchedAt: '2026-08-29T00:00:00.000Z' },
  sources: [
    { id: 'source-one', url: 'https://example.com/one' },
    { id: 'source-two', url: 'https://example.com/two' },
  ],
};

function profile(items, extra = {}) {
  return {
    researchVersion: research.meta.researchedAt,
    observedBehaviors: items,
    motivations: [],
    ...extra,
  };
}

test('audience claims receive stable IDs and legacy claims default to pending', () => {
  const first = ensureAudienceClaimMetadata({ statement: 'Community activity is visible.' }, 'observedBehaviors');
  const second = ensureAudienceClaimMetadata({ statement: 'Community activity is visible.' }, 'observedBehaviors');
  assert.equal(first.id, second.id);
  assert.equal(first.reviewKey, second.reviewKey);
  assert.equal(first.id, createAudienceClaimId('observedBehaviors', first.statement));
  assert.equal(first.reviewKey, createAudienceReviewKey('observedBehaviors', first.statement));
  assert.equal(first.reviewStatus, 'pending');
  assert.equal(first.generatedStatement, first.statement);
  assert.deepEqual(first.originalSourceIds, []);
});

test('approve, reject, and needs-validation transitions are explicit', () => {
  const base = profile([{ statement: 'Community activity is visible.', evidenceType: 'observed', sourceIds: ['source-one'] }]);
  const id = ensureAudienceClaimMetadata(base.observedBehaviors[0], 'observedBehaviors').id;
  const approved = applyAudienceClaimReview(base, id, 'approve', { now: '2026-08-29T01:00:00.000Z' });
  assert.equal(approved.observedBehaviors[0].reviewStatus, 'approved');
  const flagged = applyAudienceClaimReview(approved, id, 'needs-validation');
  assert.equal(flagged.observedBehaviors[0].reviewStatus, 'needs-validation');
  const rejected = applyAudienceClaimReview(flagged, id, 'reject');
  assert.equal(rejected.observedBehaviors[0].reviewStatus, 'rejected');
  assert.ok(rejected.observedBehaviors[0].reviewedAt);
});

test('editing keeps the generated statement but clears evidence until revalidation', () => {
  const base = profile([{ statement: 'Community activity is visible.', evidenceType: 'observed', sourceIds: ['source-one'], confidence: 'high' }]);
  const id = ensureAudienceClaimMetadata(base.observedBehaviors[0], 'observedBehaviors').id;
  const edited = applyAudienceClaimReview(base, id, 'edit', { statement: 'Community belonging may be a meaningful motivation.' });
  const claim = edited.observedBehaviors[0];
  assert.equal(claim.reviewStatus, 'needs-validation');
  assert.equal(claim.generatedStatement, 'Community activity is visible.');
  assert.deepEqual(claim.originalSourceIds, ['source-one']);
  assert.deepEqual(claim.sourceIds, []);
  assert.equal(claim.evidenceType, 'hypothesis');
  assert.equal(claim.confidence, 'low');
  const validated = applyAudienceClaimReview(edited, id, 'validate', { allowedSourceIds: ['source-one'], sourceIds: ['source-one'], evidenceType: 'inferred' });
  assert.equal(validated.observedBehaviors[0].reviewStatus, 'edited');
  assert.deepEqual(validated.observedBehaviors[0].sourceIds, ['source-one']);
  assert.equal(validated.observedBehaviors[0].evidenceType, 'inferred');
});

test('reviewed claims survive regeneration and unmatched reviews are bounded in an archive', () => {
  const previous = profile([
    { statement: 'Community activity is visible.', evidenceType: 'observed', sourceIds: ['source-one'], reviewStatus: 'approved' },
    { statement: 'A second claim was rejected.', evidenceType: 'inferred', sourceIds: ['source-two'], reviewStatus: 'rejected' },
  ]);
  const next = profile([{ statement: 'Community activity is visible.', evidenceType: 'observed', sourceIds: ['source-one'] }]);
  const merged = mergeAudienceReviewState(previous, next, { maxArchive: 1, now: '2026-08-29T02:00:00.000Z' });
  assert.equal(merged.observedBehaviors[0].reviewStatus, 'approved');
  assert.equal(merged.reviewArchive.length, 1);
  assert.equal(merged.reviewArchive[0].reviewStatus, 'rejected');
});

test('Radar only receives current, source-backed approved or validated claims', () => {
  const reviewed = profile([
    { statement: 'Approved observation.', evidenceType: 'observed', sourceIds: ['source-one'], reviewStatus: 'approved' },
    { statement: 'Pending observation.', evidenceType: 'observed', sourceIds: ['source-two'] },
    { statement: 'Stale source observation.', evidenceType: 'observed', sourceIds: ['old-source'], reviewStatus: 'approved' },
    { statement: 'Hypothesis.', evidenceType: 'hypothesis', sourceIds: [], reviewStatus: 'approved' },
  ]);
  assert.equal(getRadarEligibleAudienceItems(reviewed, research).length, 1);
  assert.equal(getRadarEligibleAudienceItems(reviewed, { ...research, sources: [{ id: 'source-one' }] }).length, 0);
  assert.equal(getRadarEligibleAudienceItems({ ...reviewed, researchVersion: '2026-08-28T00:00:00.000Z' }, research).length, 0);
});

test('client readiness distinguishes needs-review from limited and missing', () => {
  const pending = profile([{ statement: 'Pending observation.', evidenceType: 'observed', sourceIds: ['source-one'] }]);
  assert.equal(assessClientIntelligence({ research, audience: pending }).audienceStatus, 'needs-review');
  assert.equal(assessClientIntelligence({ research, audience: { ...pending, meta: { mode: 'research-light' }, researchVersion: null } }).audienceStatus, 'limited');
  assert.equal(assessClientIntelligence({ research }).audienceStatus, 'missing');
});

test('review summary exposes status counts and separate coverage', () => {
  const summary = getAudienceReviewSummary(profile([
    { statement: 'One', reviewStatus: 'approved', evidenceType: 'observed', sourceIds: ['source-one'] },
    { statement: 'Two', reviewStatus: 'edited', evidenceType: 'inferred', sourceIds: ['source-two'] },
    { statement: 'Three' },
    { statement: 'Four', reviewStatus: 'rejected' },
    { statement: 'Five', reviewStatus: 'needs-validation' },
  ]));
  assert.equal(summary.total, 5);
  assert.equal(summary.reviewedCount, 4);
  assert.equal(summary.reviewCoveragePercent, 80);
  assert.equal(summary.radarReadyCount, 2);
});
