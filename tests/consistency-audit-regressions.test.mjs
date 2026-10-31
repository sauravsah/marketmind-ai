// Regression coverage for the 2026-10-31 saved-output label audit: temporal
// grounding, company-vs-market attribution, persuasive-copy and
// offer-usage behavior labels. Fixtures replicate the audited failure shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClaimConsistency,
  applyAudienceClaimConsistency,
  applyOpportunityConsistency,
  applyResearchConsistency,
} from '../js/services/claim-consistency.js';

const NOW = new Date('2026-10-31T09:00:00Z');

const expoSource = { id: 'source-expo', title: 'FOOTWEAR INDIA EXPO | ITPO Events', url: 'https://example.test/expo', snippet: 'FOOTWEAR INDIA EXPO. B2B EXHIBITION. 20 August 2026 - 22 August 2026 Hall ... New Delhi.' };
const aggregatorSource = { id: 'source-agg', title: 'Footwear+industry | Tag', url: 'https://example.test/tag', snippet: 'Asian Footwears to invest Rs 100 crore in expansion; eyes 40% revenue growth in FY26. Bata Group appoints a new CEO.' };
const offerSource = { id: 'source-offer', title: "How Can I Get Nike's Best Deals?", url: 'https://www.nike.com/help/a/product-discount', snippet: 'First, we offer a 10% discount to eligible shoppers. Download or open the Nike App.' };
const cultureSource = { id: 'source-culture', title: 'Sneaker culture in India', snippet: 'Sneaker culture has deep performance roots in India, shaped by basketball and hip-hop.', publishedAt: '2026-08-01T00:00:00Z' };
const behaviorSource = { id: 'source-ugc', title: 'What to carry in gym for a 1st time gym joiner', url: 'https://example.test/ugc', snippet: 'I have joined gym today and will be start going from tommorow. What should I carry?' };
const futureSource = { id: 'source-future', title: 'Expo 2027 announced', url: 'https://example.test/future', snippet: 'The next edition runs March 2027 in New Delhi.' };

test('radar timing: past event framed as near-term window is flagged and level demoted', () => {
  const radar = {
    opportunities: [{
      title: 'Footwear Expo Bundle',
      strategicThesis: 'Activate around the expo.',
      oneLineDescription: 'Bundle at the trade show.',
      sourceIds: ['source-expo'],
      timing: { level: 'moderate', explanation: 'The expo occurs in August 2026, providing a concrete near-term activation window.', evidenceType: 'observed', sourceIds: ['source-expo'] },
    }],
    meta: {},
  };
  applyOpportunityConsistency(radar, [expoSource], NOW, { market: 'India' });
  const flags = radar.meta.claimFlags || [];
  assert.ok(flags.some((f) => f.reason === 'past-date-framed-as-upcoming' && f.field === 'opportunities[0].timing'));
  assert.equal(radar.opportunities[0].timing.level, 'weak');
});

test('radar timing: future-dated window stays untouched', () => {
  const radar = {
    opportunities: [{
      title: 'Next expo',
      strategicThesis: 'Activate around the next expo.',
      sourceIds: ['source-future'],
      timing: { level: 'strong', explanation: 'The next edition runs March 2027, an upcoming activation window.', evidenceType: 'observed', sourceIds: ['source-future'] },
    }],
    meta: {},
  };
  applyOpportunityConsistency(radar, [futureSource], NOW, {});
  assert.equal(radar.meta.claimFlags, undefined);
  assert.equal(radar.opportunities[0].timing.level, 'strong');
});

test('research summary: upcoming framing over past-dated sources is flagged', () => {
  const research = { researchSummary: 'Nike can win by leveraging upcoming footwear trade shows in India.', meta: {} };
  applyResearchConsistency(research, [expoSource], NOW, {});
  assert.ok((research.meta.claimFlags || []).some((f) => f.reason === 'past-date-framed-as-upcoming'));
});

test('research summary: company statistic generalized to market level is flagged', () => {
  const research = { researchSummary: 'The market shows strong growth investment (Rs 100 cr expansion, 40% FY26 revenue target).', meta: {} };
  applyResearchConsistency(research, [aggregatorSource], NOW, {});
  assert.ok((research.meta.claimFlags || []).some((f) => f.reason === 'company-stat-generalized' && /Asian Footwears/.test(f.detail)));
});

test('research summary: attributed company statistic is not flagged', () => {
  const research = { researchSummary: 'Asian Footwears plans a Rs 100 cr expansion, a sign of category momentum.', meta: {} };
  applyResearchConsistency(research, [aggregatorSource], NOW, {});
  assert.ok(!(research.meta.claimFlags || []).some((f) => f.reason === 'company-stat-generalized'));
});

test('campaign: persuasive second-person ad copy cannot be labeled observed', () => {
  const campaign = {
    supportingMessages: [{ statement: 'Get the shoes you need at a special gym-member price, so you can focus on your workout, not the bill.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['source-offer'] }],
    meta: {},
  };
  applyClaimConsistency(campaign, [offerSource], NOW, { market: 'India' });
  assert.equal(campaign.supportingMessages[0].evidenceType, 'inferred');
  const reasons = (campaign.meta.labelAdjustments || []).map((a) => a.reason);
  assert.ok(reasons.includes('persuasive-copy') || reasons.includes('qualifier-not-in-sources'));
});

test('audience: offer-usage behavior labeled observed without redemption evidence demotes', () => {
  const profile = {
    observedBehaviors: [{ statement: 'Uses the Nike app to claim a 10% discount for eligible shoppers', evidenceType: 'observed', confidence: 'medium', sourceIds: ['source-offer'] }],
    meta: {},
  };
  applyAudienceClaimConsistency(profile, [offerSource], NOW, { market: 'India' });
  assert.equal(profile.observedBehaviors[0].evidenceType, 'inferred');
  assert.ok((profile.meta.labelAdjustments || []).some((a) => a.reason === 'behavior-inferred-from-offer'));
});

test('audience: behavior evidenced by first-person account stays observed', () => {
  const profile = {
    observedBehaviors: [{ statement: 'Searches for what to carry to a first gym session', evidenceType: 'observed', confidence: 'medium', sourceIds: ['source-ugc'] }],
    meta: {},
  };
  applyAudienceClaimConsistency(profile, [behaviorSource], NOW, {});
  assert.equal(profile.observedBehaviors[0].evidenceType, 'observed');
  assert.equal(profile.meta.labelAdjustments, undefined);
});

test('campaign: faithful observed fact stays observed', () => {
  const campaign = {
    audienceInsight: { statement: 'Nike offers a 10% discount to eligible shoppers through the Nike App.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['source-offer'] },
    meta: {},
  };
  applyClaimConsistency(campaign, [offerSource], NOW, {});
  assert.equal(campaign.audienceInsight.evidenceType, 'observed');
});

test('audience segment: deal-seeking behavior inferred from offer existence is demoted', () => {
  const profile = {
    segments: [{ statement: 'Gym novices who look for discount offers on training shoes via the Nike app', evidenceType: 'observed', confidence: 'medium', sourceIds: ['source-offer'] }],
    meta: {},
  };
  applyAudienceClaimConsistency(profile, [offerSource], NOW, {});
  assert.equal(profile.segments[0].evidenceType, 'inferred');
  const adjustments = profile.meta.labelAdjustments || [];
  assert.ok(adjustments.some((a) => a.field === 'segments[0]' && a.reason === 'behavior-inferred-from-offer'));
});

test('audience segment: awareness inferred from content existence is demoted', () => {
  const profile = {
    segments: [{ statement: 'Consumers aware of sneaker culture and its performance roots', evidenceType: 'observed', confidence: 'medium', sourceIds: ['source-culture'] }],
    meta: {},
  };
  applyAudienceClaimConsistency(profile, [cultureSource], NOW, {});
  assert.equal(profile.segments[0].evidenceType, 'inferred');
  const adjustments = profile.meta.labelAdjustments || [];
  assert.ok(adjustments.some((a) => a.field === 'segments[0]' && a.reason === 'awareness-inferred-from-content'));
});

test('audience segment: awareness with survey evidence stays observed', () => {
  const surveySource = { id: 'source-survey', title: 'Brand survey', snippet: 'In a 2026 survey, 68% of respondents were aware of sneaker culture and its performance roots.', publishedAt: '2026-09-01T00:00:00Z' };
  const profile = {
    segments: [{ statement: 'Consumers aware of sneaker culture and its performance roots', evidenceType: 'observed', confidence: 'high', sourceIds: ['source-survey'] }],
    meta: {},
  };
  applyAudienceClaimConsistency(profile, [surveySource], NOW, {});
  assert.equal(profile.segments[0].evidenceType, 'observed');
});

test('radar timing: unrelated future date in a cited excerpt does not suppress the past-event flag', () => {
  const expoWithNext = { id: 'source-expo-next', title: 'Footwear fair wraps 2026 edition', snippet: 'The expo ran 20-22 August 2026 in New Delhi. Organizers announced the next edition for March 2027.', publishedAt: '2026-08-25T00:00:00Z' };
  const radar = {
    opportunities: [{
      id: 'opp-x',
      title: 'Expo bundle',
      timing: { level: 'moderate', explanation: 'The expo occurs in August 2026, providing a concrete near-term activation window.', evidenceType: 'observed', sourceIds: ['source-expo-next'] },
    }],
    meta: {},
  };
  applyOpportunityConsistency(radar, [expoWithNext], NOW, {});
  const flags = radar.meta.claimFlags || [];
  assert.ok(flags.some((f) => f.reason === 'past-date-framed-as-upcoming'), 'past expo framed as near-term must still flag');
  assert.match(flags.find((f) => f.reason === 'past-date-framed-as-upcoming').detail, /excerpts also mention future dates/);
  assert.equal(radar.opportunities[0].timing.level, 'weak');
});
