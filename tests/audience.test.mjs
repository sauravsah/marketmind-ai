import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyAudienceProfile } from '../js/models.js';
import { analyzeAudience, calculateEvidenceCoverage, prepareAudienceEvidence, validateAudienceProfile } from '../js/services/audience.js';

const source = {
  id: 'source-known',
  title: 'Running communities grow',
  url: 'https://example.com/running',
  domain: 'example.com',
  snippet: 'Running groups are becoming more visible in cities.',
  sourceType: 'culture',
  freshness: 'recent',
  quality: { score: 0.7, confidence: 'medium' },
};

const research = {
  sources: [source],
  culturalSignals: [{ title: 'Running is becoming more social', summary: 'Community activity is visible.', type: 'culture', sourceIds: [source.id], freshness: 'recent', confidence: 'medium' }],
  meta: { researchedAt: '2026-08-29T00:00:00.000Z' },
};

const context = {
  strategy: { id: 'strategy-test', idea: 'Make running more social', audience: 'Young runners', market: 'India', platforms: ['Instagram'], objective: 'Awareness', competitors: [] },
  brand: { name: 'Stride', industry: 'Sportswear', description: 'Everyday running apparel', audience: 'Young runners', voice: {} },
  audienceScope: { primaryAudience: 'Young runners', market: 'India', purchaseRelationship: 'prospect', analysisDepth: 'balanced' },
};

test('audience model starts with a complete empty profile shape', () => {
  const profile = createEmptyAudienceProfile();
  assert.ok(Array.isArray(profile.motivations));
  assert.equal(profile.evidenceCoverage.level, 'limited');
  assert.equal(profile.meta.mode, 'research-light');
});

test('research-light analysis is explicit and has no fabricated evidence', async () => {
  const profile = await analyzeAudience(context, { ai: { apiKey: '' } });
  assert.equal(profile.meta.mode, 'research-light');
  assert.equal(profile.evidenceCoverage.level, 'limited');
  assert.match(profile.summary, /not live market evidence/i);
  assert.equal(profile.hypotheses[0].evidenceType, 'hypothesis');
  assert.deepEqual(profile.hypotheses[0].sourceIds, []);
  assert.equal(profile.observedBehaviors.length, 0);
});

test('unsupported observed items are rejected while hypotheses stay hypotheses', () => {
  const profile = validateAudienceProfile({
    observedBehaviors: [
      { statement: 'People prefer social running groups.', evidenceType: 'observed', sourceIds: ['invented-source'], confidence: 'high' },
      { statement: 'The supplied source shows community activity.', evidenceType: 'observed', sourceIds: [source.id], confidence: 'medium' },
    ],
    motivations: [{ statement: 'Belonging may matter in the decision.', evidenceType: 'inferred', sourceIds: [], confidence: 'medium' }],
    hypotheses: [{ statement: 'A belonging-led message may be worth testing.', evidenceType: 'observed', sourceIds: [source.id], confidence: 'high' }],
  }, [source], { research });
  assert.equal(profile.observedBehaviors.length, 1);
  assert.equal(profile.observedBehaviors[0].sourceIds[0], source.id);
  assert.equal(profile.motivations[0].evidenceType, 'hypothesis');
  assert.equal(profile.hypotheses[0].evidenceType, 'hypothesis');
});

test('quote-shaped and customer-voice fields are not rendered as evidence', () => {
  const profile = validateAudienceProfile({
    motivations: [{ statement: 'I finally found my people.', evidenceType: 'observed', sourceIds: [source.id] }],
    desires: [{ customerQuote: 'I want this now', statement: 'A customer said this', evidenceType: 'observed', sourceIds: [source.id] }],
  }, [source], { research });
  assert.equal(profile.motivations.length, 0);
  assert.equal(profile.desires.length, 0);
});

test('prepared evidence only includes source-mapped research signals', () => {
  const prepared = prepareAudienceEvidence({ ...context, research: { ...research, audienceSignals: [{ title: 'Unmapped', summary: 'No source', sourceIds: ['missing'] }] } });
  assert.equal(prepared.sources.length, 1);
  assert.equal(prepared.signals.length, 1);
  assert.deepEqual(prepared.signals[0].sourceIds, [source.id]);
});

test('controlled AI analysis returns mapped observations and moderate coverage', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    summary: 'The supplied evidence points to a social dimension in the audience context.',
    observedBehaviors: [{ statement: 'Community activity is visible in the supplied market evidence.', evidenceType: 'observed', sourceIds: [source.id], confidence: 'medium', freshness: 'recent' }],
    motivations: [{ statement: 'Belonging may be an important motivation to test.', evidenceType: 'inferred', sourceIds: [source.id], confidence: 'low' }],
    hypotheses: [{ statement: 'Belonging-led framing may be worth testing.', evidenceType: 'observed', sourceIds: [source.id], confidence: 'low', validationMethod: 'Message test' }],
  }) } }] }), { status: 200 });
  const profile = await analyzeAudience({ ...context, research }, { ai: { provider: 'OpenAI-compatible', apiKey: 'test-key' } }, { fetchImpl });
  assert.equal(profile.meta.mode, 'research-backed');
  assert.equal(profile.meta.aiStatus, 'verified');
  assert.equal(profile.observedBehaviors.length, 1);
  assert.deepEqual(profile.observedBehaviors[0].sourceIds, [source.id]);
  assert.match(profile.observedBehaviors[0].id, /^audience-claim-/);
  assert.equal(profile.observedBehaviors[0].reviewStatus, 'pending');
  assert.equal(profile.observedBehaviors[0].generatedStatement, profile.observedBehaviors[0].statement);
  assert.equal(profile.hypotheses[0].evidenceType, 'hypothesis');
  assert.equal(profile.evidenceCoverage.level, 'moderate');
});

test('analyzeAudience applies the consistency floor and records provider call counts at the call site', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    summary: 'The supplied evidence points to a social dimension in the audience context.',
    hypotheses: [{ statement: 'Signing up is completely risk-free for every new customer.', evidenceType: 'inferred', sourceIds: [source.id], confidence: 'low' }],
  }) } }] }), { status: 200 });
  const profile = await analyzeAudience({ ...context, research }, { ai: { provider: 'OpenAI-compatible', apiKey: 'test-key' } }, { fetchImpl });
  assert.equal(profile.meta.providerCalls.total, 1);
  assert.equal(profile.meta.providerCalls.ok, 1);
  assert.equal(JSON.stringify(profile.meta.providerCalls).includes('test-key'), false);
  const flags = profile.meta.claimFlags || [];
  assert.ok(flags.some((flag) => flag.reason === 'absolute-language'), 'expected an absolute-language flag from the real analyzeAudience path');
});

test('coverage remains limited when no profile claims are mapped', () => {
  const profile = createEmptyAudienceProfile();
  assert.equal(calculateEvidenceCoverage(research, profile).level, 'limited');
});
