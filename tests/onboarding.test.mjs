import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_CATEGORIES,
  ONBOARDING_OBJECTIVES,
  ONBOARDING_AUDIENCE_TYPES,
  ONBOARDING_MARKETS,
  SAMPLE_CAMPAIGN,
  SAMPLE_CLAIMS,
  SAMPLE_OPPORTUNITIES,
  SAMPLE_SIGNALS,
  buildOnboardingPrefill,
  buildQuestionStarters,
  createOnboardingSession,
  createSampleSession,
  mapOnboardingObjective,
  onboardingStepReady,
  sampleStageUnlocked,
  shouldOfferOnboarding,
} from '../js/onboarding.js';

const fullAnswers = {
  brand: 'Stride',
  category: 'Consumer app',
  objective: 'Launch something new',
  audienceType: 'Consumers',
  audienceDetail: 'Gen Z students in Indian metros',
  market: 'India',
  question: 'How do I get Gen Z students to try Stride?',
};

test('objective chips map onto the existing brief vocabulary', () => {
  assert.deepEqual(ONBOARDING_OBJECTIVES.map((option) => option.objective), [
    'Launch', 'Awareness', 'Conversion', 'Retention', 'Community Building',
  ]);
  assert.equal(mapOnboardingObjective('Get known'), 'Awareness');
  assert.equal(mapOnboardingObjective('not a real chip'), '');
});

test('each question step gates on a usable answer', () => {
  const answers = createOnboardingSession().answers;
  assert.equal(onboardingStepReady(answers, 0), false);
  answers.category = ONBOARDING_CATEGORIES[0];
  assert.equal(onboardingStepReady(answers, 0), true, 'category alone carries step 1');
  assert.equal(onboardingStepReady(answers, 1), false);
  answers.objective = ONBOARDING_OBJECTIVES[0].label;
  assert.equal(onboardingStepReady(answers, 1), true);
  assert.equal(onboardingStepReady(answers, 2), false);
  answers.audienceType = ONBOARDING_AUDIENCE_TYPES[0];
  assert.equal(onboardingStepReady(answers, 2), true);
  assert.equal(onboardingStepReady(answers, 3), false);
  answers.market = ONBOARDING_MARKETS[0];
  assert.equal(onboardingStepReady(answers, 3), true);
  assert.equal(onboardingStepReady(answers, 4), false);
  answers.question = 'Where should we show up first?';
  assert.equal(onboardingStepReady(answers, 4), true);
});

test('question starters are built from the answers and degrade gracefully', () => {
  const starters = buildQuestionStarters(fullAnswers);
  assert.equal(starters.length, 3);
  assert.ok(starters.slice(0, 2).every((starter) => starter.includes('gen z students in indian metros')));
  assert.ok(starters[2].includes('India'), 'the market starter uses the chosen market');
  const fallbacks = buildQuestionStarters(createOnboardingSession().answers);
  assert.ok(fallbacks[0].includes('the right people'));
  assert.ok(fallbacks[2].includes('your market'));
});

test('prefill fills brand, workspace defaults and a draft brief - nothing else', () => {
  const prefill = buildOnboardingPrefill(fullAnswers);
  assert.deepEqual(prefill.brand, {
    name: 'Stride',
    industry: 'Consumer app',
    audience: 'Gen Z students in Indian metros',
  });
  assert.deepEqual(prefill.workspace, {
    defaultMarket: 'India',
    defaultAudience: 'Gen Z students in Indian metros',
    defaultObjective: 'Launch',
  });
  assert.deepEqual(prefill.strategy, {
    idea: 'How do I get Gen Z students to try Stride?',
    audience: 'Gen Z students in Indian metros',
    market: 'India',
    objective: 'Launch',
  });
  assert.ok(!('research' in prefill.strategy), 'answers never create research');
  assert.ok(!('sources' in prefill), 'answers never create evidence');
});

test('prefill falls back to the audience type and maps Somewhere else to Global', () => {
  const prefill = buildOnboardingPrefill({ ...fullAnswers, audienceDetail: '', market: 'Somewhere else' });
  assert.equal(prefill.strategy.audience, 'Consumers');
  assert.equal(prefill.workspace.defaultMarket, 'Global');
});

test('the first-run screen only appears for a genuinely fresh workspace', () => {
  assert.equal(shouldOfferOnboarding({ strategies: [], brand: {}, record: null }), true);
  assert.equal(shouldOfferOnboarding({ strategies: [{ id: 'one' }], brand: {}, record: null }), false);
  assert.equal(shouldOfferOnboarding({ strategies: [], brand: { name: 'Nike' }, record: null }), false);
  assert.equal(shouldOfferOnboarding({ strategies: [], brand: {}, record: { completedAt: '2026-11-03' } }), false);
});

test('the sample workspace keeps the real product gates', () => {
  const sample = createSampleSession();
  assert.deepEqual(sampleStageUnlocked(sample), [true, false, false, false, false]);
  sample.briefFilled = true;
  assert.deepEqual(sampleStageUnlocked(sample), [true, true, true, false, false]);
  sample.claimStates[1] = 'approved';
  assert.deepEqual(sampleStageUnlocked(sample), [true, true, true, true, false]);
  sample.selectedOpportunity = 0;
  assert.deepEqual(sampleStageUnlocked(sample), [true, true, true, true, true]);
  sample.claimStates[1] = 'rejected';
  assert.deepEqual(sampleStageUnlocked(sample), [true, true, true, false, true], 'rejecting the only approved claim re-locks the radar; the already-earned campaign stage stays open');
});

test('every piece of sample content is explicitly labelled simulated/example', () => {
  const labelOk = (text) => /simulated|example/i.test(text);
  assert.ok(SAMPLE_SIGNALS.every((signal) => labelOk(signal.evidence)));
  assert.ok(SAMPLE_CLAIMS.every((claim) => labelOk(claim.evidence)));
  assert.ok(SAMPLE_OPPORTUNITIES.every((opportunity) => labelOk(opportunity.confidence) && labelOk(opportunity.scores)));
  assert.ok(SAMPLE_CAMPAIGN.every((card) => labelOk(card.tag)));
});
