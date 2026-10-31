import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignFreshness, journeyStageReview } from '../js/client/intelligence.js';

const NOW = new Date('2026-10-31T12:00:00Z');
const fresh = '2026-10-31T10:00:00Z';
const older = '2026-10-29T10:00:00Z';

function baseStrategy() {
  return {
    selectedOpportunityId: 'opp-1',
    research: { meta: { status: 'ready', researchedAt: fresh } },
    audienceInsights: { meta: { status: 'ready' }, researchVersion: fresh, items: [] },
    opportunityRadar: { meta: { status: 'ready' }, researchTimestamp: fresh, createdAt: fresh },
    campaignStrategy: {
      meta: { status: 'ready', researchTimestamp: fresh, opportunityTimestamp: fresh },
      opportunityId: 'opp-1',
    },
  };
}

test('fresh intelligence: nothing needs review', () => {
  assert.deepEqual(journeyStageReview(baseStrategy(), NOW), { research: false, audience: false, radar: false, campaign: false });
});

test('research regenerated after audience: audience needs review', () => {
  const s = baseStrategy();
  s.audienceInsights.researchVersion = older;
  assert.equal(journeyStageReview(s, NOW).audience, true);
});

test('radar built on older research: radar needs review', () => {
  const s = baseStrategy();
  s.opportunityRadar.researchTimestamp = older;
  assert.equal(journeyStageReview(s, NOW).radar, true);
});

test('radar flagged stale by its own meta: radar needs review', () => {
  const s = baseStrategy();
  s.opportunityRadar.meta.stale = true;
  assert.equal(journeyStageReview(s, NOW).radar, true);
});

test('campaign built for a different opportunity: campaign needs review', () => {
  const s = baseStrategy();
  s.campaignStrategy.opportunityId = 'opp-old';
  assert.equal(journeyStageReview(s, NOW).campaign, true);
});

test('campaign built before latest research: campaign needs review', () => {
  const s = baseStrategy();
  s.campaignStrategy.meta.researchTimestamp = older;
  assert.equal(journeyStageReview(s, NOW).campaign, true);
});

test('radar regenerated after campaign: campaign needs review', () => {
  const s = baseStrategy();
  s.opportunityRadar.createdAt = '2026-10-31T11:00:00Z';
  s.campaignStrategy.meta.opportunityTimestamp = '2026-10-30T11:00:00Z';
  assert.equal(journeyStageReview(s, NOW).campaign, true);
});

test('age over threshold: research needs review, downstream stages untouched', () => {
  const s = baseStrategy();
  s.research.meta.researchedAt = '2026-09-01T10:00:00Z';
  s.audienceInsights.researchVersion = '2026-09-02T10:00:00Z';
  s.opportunityRadar.researchTimestamp = '2026-09-02T10:00:00Z';
  s.campaignStrategy.meta.researchTimestamp = '2026-09-02T10:00:00Z';
  const review = journeyStageReview(s, NOW);
  assert.equal(review.research, true);
  assert.equal(review.audience, false);
  assert.equal(review.campaign, false);
});

test('missing pieces do not produce false review flags', () => {
  assert.deepEqual(journeyStageReview({ research: { meta: {} } }, NOW), { research: false, audience: false, radar: false, campaign: false });
});

test('campaign without status ready is not flagged', () => {
  const s = baseStrategy();
  s.campaignStrategy.meta.status = 'not-run';
  s.campaignStrategy.opportunityId = 'opp-old';
  assert.equal(journeyStageReview(s, NOW).campaign, false);
});

test('campaignFreshness: mismatch resolves old opportunity title when still in radar', () => {
  const s = baseStrategy();
  s.opportunityRadar.opportunities = [
    { id: 'opp-1', title: 'Footwear Expo First-Gym Bundle' },
    { id: 'opp-old', title: 'Gym Starter Kit Partnerships' },
  ];
  s.campaignStrategy.opportunityId = 'opp-old';
  const f = campaignFreshness(s, NOW);
  assert.equal(f.needsReview, true);
  assert.deepEqual(f.reasons, ['opportunity-mismatch']);
  assert.equal(f.developedFor.title, 'Gym Starter Kit Partnerships');
});

test('campaignFreshness: mismatch without the old opportunity in radar yields no title', () => {
  const s = baseStrategy();
  s.opportunityRadar.opportunities = [{ id: 'opp-1', title: 'Footwear Expo First-Gym Bundle' }];
  s.campaignStrategy.opportunityId = 'opp-old';
  const f = campaignFreshness(s, NOW);
  assert.equal(f.needsReview, true);
  assert.equal(f.developedFor, null);
});

test('campaignFreshness: aligned campaign reports no reasons', () => {
  const s = baseStrategy();
  s.opportunityRadar.opportunities = [{ id: 'opp-1', title: 'Footwear Expo First-Gym Bundle' }];
  const f = campaignFreshness(s, NOW);
  assert.equal(f.needsReview, false);
  assert.deepEqual(f.reasons, []);
});

test('campaignFreshness: newer radar without timestamp on campaign does not flag', () => {
  const s = baseStrategy();
  s.campaignStrategy.meta.opportunityTimestamp = null;
  s.opportunityRadar.createdAt = '2026-10-31T11:30:00Z';
  const f = campaignFreshness(s, NOW);
  assert.equal(f.needsReview, false);
});
