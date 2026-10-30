import test from 'node:test';
import assert from 'node:assert/strict';
import { applyClaimConsistency } from '../js/services/claim-consistency.js';
import { normalizeCampaignStrategy } from '../js/services/campaign.js';

const NOW = new Date('2026-10-30T00:00:00Z');

// Source excerpts mirror the real saved campaigns (post-patch gym-goers run,
// pre-patch Vegam Run run) - these fixtures capture the observed failures.
const sources = [
  { id: 'src-discount', url: 'https://www.nike.com/help/a/product-discount', title: "How Can I Get Nike's Best Deals?", snippet: 'Training & Gym Custom Shoes Clothing. First, we offer a 10% discount to eligible shoppers. Download or open the Nike App and visiting a nearby Nike Factory.' },
  { id: 'src-india-change', url: 'https://www.nike.com/in/help/a/nike-india-changes', title: 'Nike India Changes Coming February 2026 | Nike Help', snippet: 'Some changes are coming to Nike India February 2026. You will need to create a new profile on Nike.in.' },
  { id: 'src-gym-study', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10103055/', title: 'Exercise Behaviour and Body Esteem of Gym-Goers in India', snippet: 'The seven dimensions are Tolerance, Withdrawal, Intention Effects, Lack of Control, Time, Reduction in Other Activity, and Continuance.' },
  { id: 'src-vegam', url: 'https://about.nike.com/en/newsroom/releases/nike-vegam-run-is-built-for-the-next-generation-of-india-runners', title: 'Nike Vegam Run Is Built for India\u2019s Next Generation of Runners', snippet: 'Nike Vegam Run is Nike\u2019s first running shoe for India, combining cushioning, breathability and durability at a more accessible Nike Running price point.' },
];

function campaign(claims) {
  return { meta: {}, ...claims };
}

test('interpretive brand-role framing labeled observed is demoted (saved gym-goers failure)', () => {
  const c = campaign({ brandRole: { statement: 'Nike acts as an enabler, giving new gym-goers confidence through digital incentives and performance-focused footwear.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-discount'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.brandRole.evidenceType, 'inferred');
  assert.equal(c.meta.labelAdjustments.length, 1);
  assert.equal(c.meta.labelAdjustments[0].reason, 'qualifier-not-in-sources');
});

test('mixed-evidence insight with hedged clause is demoted from observed (saved gym-goers failure)', () => {
  const c = campaign({ audienceInsight: { statement: 'Because first-time gym-goers in urban India experience intention effects and time constraints, they look for low-friction incentives, but they may hesitate to adopt a new app quickly.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-gym-study'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.audienceInsight.evidenceType, 'inferred');
  const reasons = c.meta.labelAdjustments.map((a) => a.reason);
  assert.ok(reasons.includes('hedged-language'));
});

test('first-timer extrapolation of a general gym-goer study is demoted (saved clinical-scope failure)', () => {
  const c = campaign({ audienceInsight: { statement: 'First-time gym-goers in urban India experience intention effects, lack of control, and time constraints.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-gym-study'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.audienceInsight.evidenceType, 'inferred');
  assert.equal(c.meta.labelAdjustments[0].reason, 'qualifier-not-in-sources');
  assert.match(c.meta.labelAdjustments[0].detail, /first-time/);
});

test('past-dated change framed as upcoming is flagged and confidence lowered (saved Feb-2026 failure)', () => {
  const c = campaign({ campaignThesis: { statement: 'If Nike leverages its existing 10% app discount and upcoming profile updates, more first-time gym-goers will choose Nike training shoes.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: ['src-discount', 'src-india-change'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.meta.claimFlags.length, 1);
  assert.equal(c.meta.claimFlags[0].reason, 'past-date-framed-as-upcoming');
  assert.match(c.meta.claimFlags[0].detail, /February 2026/);
  assert.equal(c.campaignThesis.confidence, 'low');
});

test('observed claim explicitly supported by its cited excerpt stays observed (positive control)', () => {
  const c = campaign({ audienceInsight: { statement: 'Gym-goers in India report dimensions including Intention Effects, Lack of Control and Time influencing exercise patterns.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-gym-study'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.audienceInsight.evidenceType, 'observed');
  assert.equal(c.meta.labelAdjustments, undefined);
  assert.equal(c.meta.claimFlags, undefined);
});

test('hypothesis labels are never upgraded and undated upcoming framing is left alone', () => {
  const c = campaign({ campaignThesis: { statement: 'If Nike adds sensor tracking to a future shoe, running may become more exciting.', evidenceType: 'hypothesis', confidence: 'low', sourceIds: ['src-vegam'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.campaignThesis.evidenceType, 'hypothesis');
  assert.equal(c.meta.claimFlags, undefined);
});

test('invented price or demographic specifics in an observed claim are demoted (pre-patch Vegam failure shape)', () => {
  const c = campaign({ strategicProblem: { statement: 'Nike lacks a mid-price smart running shoe for Gen Z athletes in India.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-vegam'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.strategicProblem.evidenceType, 'inferred');
  const reasons = c.meta.labelAdjustments.map((a) => a.reason);
  assert.ok(reasons.includes('qualifier-not-in-sources'));
});

test('normalizeCampaignStrategy applies the consistency floor and records adjustments in meta', () => {
  const context = {
    strategy: { id: 'strategy-1', idea: 'test', opportunityRadar: { opportunities: [{ id: 'opp-1', title: 'Test opportunity', confidence: 'low', brandFit: { level: 'low' }, competitiveContext: {} }] }, selectedOpportunityId: 'opp-1' },
    research: { sources },
    audience: {},
    brand: { name: 'Nike' },
  };
  const raw = {
    opportunityId: 'opp-1',
    name: 'Test campaign',
    objective: 'Launch',
    strategicProblem: { statement: 'Nike lacks a mid-price smart running shoe for Gen Z athletes in India.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-vegam'] },
    campaignThesis: { statement: 'If Nike leverages its existing 10% app discount and upcoming profile updates, more first-time gym-goers will choose Nike training shoes.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: ['src-discount', 'src-india-change'] },
  };
  const normalized = normalizeCampaignStrategy(raw, context, { now: NOW });
  assert.ok(normalized);
  assert.equal(normalized.strategicProblem.evidenceType, 'inferred');
  assert.ok(normalized.meta.labelAdjustments.length >= 1);
  assert.ok(normalized.meta.claimFlags.some((f) => f.reason === 'past-date-framed-as-upcoming'));
  assert.equal(normalized.meta.assessmentLabel, 'MarketMind assessment based on available intelligence. Not a success probability.');
});

test('user-overridden fields are not re-labeled by the consistency review', () => {
  const context = {
    strategy: { id: 'strategy-1', idea: 'test', opportunityRadar: { opportunities: [{ id: 'opp-1', title: 'Test', confidence: 'low', brandFit: { level: 'low' }, competitiveContext: {} }] }, selectedOpportunityId: 'opp-1' },
    research: { sources },
    audience: {},
    brand: { name: 'Nike' },
  };
  const existing = normalizeCampaignStrategy({ opportunityId: 'opp-1', name: 'T', objective: 'Launch' }, context, { now: NOW });
  const raw = { opportunityId: 'opp-1', name: 'T', objective: 'Launch', campaignThesis: { statement: 'User wrote this with upcoming plans in February 2026.', evidenceType: 'hypothesis', confidence: 'low', sourceIds: [] }, userOverrides: { campaignThesis: 'User wrote this with upcoming plans in February 2026.' } };
  const normalized = normalizeCampaignStrategy(raw, context, { existing, now: NOW });
  assert.ok(normalized);
  assert.equal(normalized.campaignThesis.evidenceType, 'hypothesis');
});

test('old source announcing a future event is NOT flagged (publication-age control)', () => {
  const futureSources = [{ id: 'src-future', url: 'https://example.com/news', title: 'Nike announces smart shoe', snippet: 'First reported in 2024, the sensor shoe launches in 2027 across India.' }];
  const c = campaign({ campaignThesis: { statement: 'If Nike builds on its upcoming sensor shoe launch, runners may engage more.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: ['src-future'] } });
  applyClaimConsistency(c, futureSources, NOW);
  assert.equal(c.meta.claimFlags, undefined, 'future event date must suppress the past-date flag');
  assert.equal(c.campaignThesis.confidence, 'medium');
});

test('source-faithful hedged language keeps the observed label', () => {
  const hedgeSources = [{ id: 'src-hedge', url: 'https://example.com/study', title: 'Gym study in India', snippet: 'The study suggests gym-goers in India may reduce other activities over time.' }];
  const c = campaign({ audienceInsight: { statement: 'The study suggests gym-goers in India may reduce other activities over time.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-hedge'] } });
  applyClaimConsistency(c, hedgeSources, NOW);
  assert.equal(c.audienceInsight.evidenceType, 'observed', 'hedge present in the cited excerpt is source-faithful');
  assert.equal(c.meta.labelAdjustments, undefined);
});

test('model-added hedged language absent from excerpts is still demoted', () => {
  const c = campaign({ audienceInsight: { statement: 'Gym-goers in India report time constraints and they may hesitate to adopt new apps.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-gym-study'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.audienceInsight.evidenceType, 'inferred');
  assert.equal(c.meta.labelAdjustments[0].reason, 'hedged-language');
});

test('qualifier present in excerpt under a spelling variant is not demoted', () => {
  const variantSources = [{ id: 'src-variant', url: 'https://example.com/study2', title: 'Beginner study', snippet: 'First-timers and regular gym-goers in India report time constraints and intention effects.' }];
  const c = campaign({ audienceInsight: { statement: 'First-time gym-goers in India report time constraints and intention effects.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-variant'] } });
  applyClaimConsistency(c, variantSources, NOW);
  assert.equal(c.audienceInsight.evidenceType, 'observed');
});

test('upcoming framing with a past date only in the statement is flagged', () => {
  const c = campaign({ campaignThesis: { statement: 'The upcoming February 2026 profile changes will bring new gym-goers to the Nike app.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: [] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.meta.claimFlags.length, 1);
  assert.equal(c.meta.claimFlags[0].reason, 'past-date-framed-as-upcoming');
});

test('adjustments and flags record the generation timestamp for provenance', () => {
  const c = campaign({ campaignThesis: { statement: 'The upcoming February 2026 profile changes will bring new gym-goers.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: [] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.meta.consistencyCheckedAt, NOW.toISOString());
});

test('re-checking an already-flagged campaign replaces rather than duplicates flags', () => {
  const c = campaign({ campaignThesis: { statement: 'The upcoming February 2026 profile changes will bring new gym-goers.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: [] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.meta.claimFlags.length, 1);
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.meta.claimFlags.length, 1, 'no duplicated flags on re-check');
});

test('stale flags from a previous generation drop out when the claim is fixed', () => {
  const c = campaign({ campaignThesis: { statement: 'The February 2026 profile changes brought new gym-goers to the Nike app.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: [] } });
  c.meta = { claimFlags: [{ reason: 'past-date-framed-as-upcoming', datedMaterial: 'February 2026', checkedAt: '2026-10-01' }], consistencyCheckedAt: '2026-10-01T00:00:00.000Z' };
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.meta.claimFlags, undefined, 'stale flag must not survive a clean re-check');
  assert.equal(c.meta.consistencyCheckedAt, undefined);
});

test('non-breaking hyphens in the statement no longer evade qualifier detection (live unicode failure)', () => {
  const c = campaign({ audienceInsight: { statement: 'Because first‑time gym‑goers compare gym‑shoe options online and seek performance‑enhancing footwear, they are price‑sensitive and often unaware of Nike models.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-gym-study'] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.audienceInsight.evidenceType, 'inferred');
  assert.equal(c.meta.labelAdjustments[0].reason, 'qualifier-not-in-sources');
});

test('non-breaking hyphens and spaces in excerpts still satisfy an ASCII statement qualifier', () => {
  const unicodeSources = [{ id: 'src-uni', url: 'https://example.com/study', title: 'Beginner study', snippet: 'First‑time gym‑goers in India report time constraints and price sensitivity.' }];
  const c = campaign({ audienceInsight: { statement: 'First-time gym-goers in India report time constraints and price sensitivity.', evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-uni'] } });
  applyClaimConsistency(c, sources.concat(unicodeSources), NOW);
  assert.equal(c.audienceInsight.evidenceType, 'observed', 'unicode excerpt text must count as qualifier support');
});

test('matching normalization never mutates stored claim text or source excerpts', () => {
  const statement = 'Because first‑time gym‑goers compare options online, they may hesitate.';
  const snippet = 'First‑time gym‑goers report time constraints.';
  const originalStatement = statement.slice();
  const originalSnippet = snippet.slice();
  const uniSources = [{ id: 'src-uni2', url: 'https://example.com/x', title: 'T', snippet }];
  const c = campaign({ audienceInsight: { statement, evidenceType: 'observed', confidence: 'medium', sourceIds: ['src-uni2'] } });
  applyClaimConsistency(c, uniSources, NOW);
  assert.equal(c.audienceInsight.statement, originalStatement);
  assert.equal(uniSources[0].snippet, originalSnippet);
});

test('temporal flag records datedMaterial and checkedAt for the review banner', () => {
  const c = campaign({ campaignThesis: { statement: 'The upcoming February 2026 profile changes will bring new gym-goers.', evidenceType: 'hypothesis', confidence: 'medium', sourceIds: [] } });
  applyClaimConsistency(c, sources, NOW);
  assert.equal(c.meta.claimFlags.length, 1);
  assert.equal(c.meta.claimFlags[0].datedMaterial, 'February 2026');
  assert.equal(c.meta.claimFlags[0].checkedAt, NOW.toISOString());
});
