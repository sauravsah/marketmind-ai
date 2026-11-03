// First-run onboarding: five tap-to-answer questions that prefill real
// workspace fields, plus a fixed fictional sample workspace for people who
// would rather look around first. Onboarding answers only fill context and
// defaults the user can edit; market, audience, opportunity and campaign
// intelligence still come only from real runs the user starts. The sample
// workspace is fixed, pre-written, fictional content - every card is labelled
// as simulated, it never spends AI or search allowance, and it never writes
// into the user's real workspace.

export const ONBOARDING_VERSION = 1;

export const ONBOARDING_CATEGORIES = [
  'Consumer app',
  'B2B software',
  'E-commerce / D2C',
  'Local business',
  'Agency or freelance',
  'Something else',
];

// Chip label -> the objective vocabulary the strategy brief already uses.
export const ONBOARDING_OBJECTIVES = [
  { label: 'Launch something new', objective: 'Launch' },
  { label: 'Get known', objective: 'Awareness' },
  { label: 'Win first customers', objective: 'Conversion' },
  { label: 'Keep customers coming back', objective: 'Retention' },
  { label: 'Build a community', objective: 'Community Building' },
];

export const ONBOARDING_AUDIENCE_TYPES = ['Consumers', 'Businesses', 'A mix of both'];

export const ONBOARDING_MARKETS = ['India', 'United States', 'United Kingdom', 'Southeast Asia', 'Global', 'Somewhere else'];

export function createOnboardingSession() {
  return {
    view: 'choice', // choice -> questions | sample
    step: 0,
    answers: { brand: '', category: '', objective: '', audienceType: '', audienceDetail: '', market: '', question: '' },
  };
}

export function mapOnboardingObjective(label) {
  return ONBOARDING_OBJECTIVES.find((option) => option.label === label)?.objective || '';
}

export function onboardingAudienceText(answers) {
  return String(answers.audienceDetail || '').trim() || answers.audienceType || '';
}

export function onboardingMarket(answers) {
  return answers.market === 'Somewhere else' ? 'Global' : answers.market || '';
}

export function buildQuestionStarters(answers) {
  const brand = String(answers.brand || '').trim() || 'your brand';
  const audience = onboardingAudienceText(answers).toLowerCase() || 'the right people';
  const market = onboardingMarket(answers) || 'your market';
  return [
    `How do I get ${audience} to try ${brand}?`,
    `What would make ${audience} choose ${brand} over the usual options?`,
    `Where should ${brand} show up first in ${market}?`,
  ];
}

// Each step can advance with a chip answer alone; typing is only required
// where the product genuinely needs the user's own words.
export function onboardingStepReady(answers, step) {
  return [
    String(answers.brand || '').trim().length > 0 || answers.category.length > 0,
    answers.objective.length > 0,
    answers.audienceType.length > 0,
    answers.market.length > 0,
    String(answers.question || '').trim().length > 0,
  ][step] ?? false;
}

// What each answer fills. Everything returned here lands in existing,
// user-editable fields - never in research, claims, or opportunities.
export function buildOnboardingPrefill(answers) {
  const audience = onboardingAudienceText(answers);
  const market = onboardingMarket(answers);
  const objective = mapOnboardingObjective(answers.objective);
  return {
    brand: {
      name: String(answers.brand || '').trim(),
      industry: answers.category || '',
      audience,
    },
    workspace: {
      defaultMarket: market,
      defaultAudience: audience,
      defaultObjective: objective,
    },
    strategy: {
      idea: String(answers.question || '').trim(),
      audience,
      market,
      objective,
    },
  };
}

// The first-run screen only appears while the workspace is genuinely fresh:
// no saved strategies, no brand profile, and no earlier onboarding record.
export function shouldOfferOnboarding({ strategies = [], brand = null, record = null } = {}) {
  if (record) return false;
  if (strategies.length > 0) return false;
  if (brand?.name || brand?.description || brand?.industry || brand?.audience) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sample workspace: "Stride", a fictional running app for Gen Z in India.
// Fixed content, written once, reviewed before shipping. Every evidence label
// explicitly says simulated/example - no real citations, no real brands, no
// live data.
// ---------------------------------------------------------------------------

export const SAMPLE_STAGE_NAMES = ['Brief', 'Market', 'Audience', 'Radar', 'Campaign'];

export const SAMPLE_BRIEF = {
  question: 'How does Stride make running a daily habit for Gen Z in India?',
  audience: 'Gen Z students and first-jobbers in Indian metros',
  market: 'India',
  objective: 'Launch',
};

export const SAMPLE_SIGNALS = [
  { name: 'Organised 5K runs are the most common first race for new Indian runners', evidence: 'Simulated excerpt · example event-calendar data · Observed (example)' },
  { name: 'Metro running clubs organise through WhatsApp groups and Instagram pages, not dedicated apps', evidence: 'Simulated excerpt · example community listings · Observed (example)' },
  { name: 'Fitness app sign-ups among Indian students spike in January and right after exam seasons', evidence: 'Simulated excerpt · example industry report · Inferred (example)' },
  { name: 'Short-form video is the main way this audience discovers new fitness apps', evidence: 'Simulated excerpt · example audience survey · Inferred (example)' },
];

export const SAMPLE_CLAIMS = [
  { name: 'Gen Z runners share progress publicly when the format feels native, not forced', evidence: 'Simulated evidence · example claim' },
  { name: 'Motivation dips after the second week without social accountability', evidence: 'Simulated evidence · example claim' },
  { name: 'First-jobbers run early morning or late evening, fitted around commute windows', evidence: 'Simulated evidence · example claim' },
];

export const SAMPLE_OPPORTUNITIES = [
  {
    name: 'Campus run-club challenges',
    confidence: 'High (example)',
    thesis: 'Weekly inter-college 5K leaderboards give new runners built-in accountability and a reason to invite friends.',
    scores: 'Audience relevance 5/5 · Brand fit 4/5 · Timing 4/5 (example scores)',
  },
  {
    name: 'Streak-sharing cards for Instagram',
    confidence: 'Medium (example)',
    thesis: 'A streak card designed for Stories turns private progress into public identity and free distribution.',
    scores: 'Audience relevance 4/5 · Brand fit 3/5 · Timing 3/5 (example scores)',
  },
];

export const SAMPLE_CAMPAIGN = [
  {
    tag: 'Example campaign direction',
    name: '"Run your first 5K" - a campus-first challenge',
    detail: 'Weekly inter-college 5K leaderboards in three metros, kicking off in the post-exam window. New runners join through their college club, not a download prompt.',
  },
  {
    tag: 'Core message (example)',
    name: '"Your first 5K, together."',
    detail: 'Speaks to the week-two motivation dip: the club carries you past it.',
  },
  {
    tag: 'Channels and measurement (example)',
    name: 'Instagram Reels + campus WhatsApp groups',
    detail: 'Measurement questions: sign-ups per club, week-two retention, shares per streak card.',
  },
];

export function createSampleSession() {
  return {
    stage: 0,
    briefFilled: false,
    claimStates: SAMPLE_CLAIMS.map(() => 'pending'), // pending | approved | rejected
    selectedOpportunity: null,
  };
}

// The same gates as the real workspace: research follows the brief, the radar
// waits for an approved claim, and the campaign waits for a selected opening.
export function sampleStageUnlocked(session) {
  const approvedCount = session.claimStates.filter((state) => state === 'approved').length;
  return [
    true,
    session.briefFilled,
    session.briefFilled,
    approvedCount > 0,
    session.selectedOpportunity !== null,
  ];
}
