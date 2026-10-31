import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `js/app.js must define ${name} in its own module scope`);
  let depth = 0;
  const braceStart = appSource.indexOf('{', start);
  for (let i = braceStart; i < appSource.length; i += 1) {
    if (appSource[i] === '{') depth += 1;
    if (appSource[i] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function loadCampaignClaim() {
  const escapeHtml = new Function(`${extractFunction('escapeHtml')}\nreturn escapeHtml;`)();
  const tokenConst = appSource.match(/const SOURCE_TOKEN_RUN = \/.*\/gi;/)[0];
  return new Function(
    'escapeHtml',
    `${tokenConst}\n${extractFunction('stripSourceTokens')}\n${extractFunction('campaignClaim')}\nreturn campaignClaim;`,
  )(escapeHtml);
}

test('campaign claim text hides internal source tokens but keeps the sentence intact', () => {
  const campaignClaim = loadCampaignClaim();
  const out = campaignClaim({ statement: 'India app shoppers respond to app-only incentives (source-szp8ew, source-4ozw8q).' });
  assert.equal(out.includes('source-'), false);
  assert.ok(out.includes('India app shoppers respond to app-only incentives.'), `clean sentence survives: ${out}`);
});

test('source-token stripping keeps real parenthetical prose and citation-free text untouched', () => {
  const campaignClaim = loadCampaignClaim();
  assert.equal(campaignClaim({ statement: 'Members save 10% (app only) on full-price styles.' }), 'Members save 10% (app only) on full-price styles.');
  assert.equal(campaignClaim({ statement: 'Plain claim without tokens.' }), 'Plain claim without tokens.');
});

test('source tokens with Unicode dashes (U+2010-2015, U+2212) are stripped like ASCII hyphens', () => {
  const campaignClaim = loadCampaignClaim();
  const out = campaignClaim({ statement: 'Because Nike\u2019s training shoes are priced at \u20B913,995 (source\u2011szp8ew) and first-time gym\u2011goers are price-sensitive, they hesitate (source\u20144ozw8q, source\u2212qxuqd4).' });
  assert.equal(/source[\u2010-\u2015\u2212-][a-z0-9]+/.test(out), false, `no token survives: ${out}`);
  assert.ok(out.includes('priced at \u20B913,995 and'), `sentence intact: ${out}`);
  assert.ok(out.includes('price-sensitive, they hesitate.'), `tail intact: ${out}`);
});

test('claim of only a source token falls back instead of rendering empty', () => {
  const campaignClaim = loadCampaignClaim();
  assert.equal(campaignClaim({ statement: '(source-szp8ew)' }, 'Not defined yet.'), 'Not defined yet.');
});

test('real applyClaimConsistency absolute-language flag renders through the real campaignReviewBanner end to end', async () => {
  const { applyClaimConsistency } = await import('../js/services/claim-consistency.js');
  const campaign = {
    meta: {},
    audienceInsight: {
      statement: 'A free-exchange guarantee makes trying the shoes risk-free.',
      evidenceType: 'inferred',
      confidence: 'medium',
      sourceIds: [],
    },
  };
  applyClaimConsistency(campaign, [], new Date('2026-10-30T05:00:00Z'));

  assert.ok(Array.isArray(campaign.meta.claimFlags) && campaign.meta.claimFlags.length === 1);
  assert.equal(campaign.meta.claimFlags[0].reason, 'absolute-language');
  assert.equal(campaign.audienceInsight.evidenceType, 'inferred', 'flag only, never a label change');

  const escapeHtml = new Function(`${extractFunction('escapeHtml')}\nreturn escapeHtml;`)();
  const bannerSrc = extractFunction('campaignReviewBanner');
  const icon = () => '';
  const campaignReviewBanner = new Function(
    'escapeHtml',
    'icon',
    `${bannerSrc}\nreturn campaignReviewBanner;`,
  )(escapeHtml, icon);
  const html = campaignReviewBanner(campaign);
  assert.match(html, /Review recommended/);
  assert.match(html, /risk-free/);
  assert.match(html, /absolute language that no cited excerpt supports/);
});

// Every campaign-page render point that displays model-generated prose must pass
// it through stripSourceTokens - a token leak at any of these points was visible
// in production output.
const STRIPPED_RENDER_POINTS = [
  'escapeHtml(stripSourceTokens(item.purpose || item.message))',
  'escapeHtml(stripSourceTokens(item.role || \'Platform role not defined\'))',
  'escapeHtml(stripSourceTokens(territory.coreThought))',
  'escapeHtml(stripSourceTokens(campaign.ctaStrategy?.rationale || \'CTA rationale will appear here.\'))',
  'escapeHtml(stripSourceTokens(campaign.differentiation?.notDo || \'Not defined yet.\'))',
  'escapeHtml(stripSourceTokens(concept.coreNarrative))',
  'escapeHtml(stripSourceTokens(item.statement || item.message))',
];

for (const point of STRIPPED_RENDER_POINTS) {
  test(`render point strips source tokens: ${point.slice(28, 70)}...`, () => {
    assert.ok(appSource.includes(point), `js/app.js must contain: ${point}`);
  });
}

test('real applyClaimConsistency offer-market flag renders through the real campaignReviewBanner end to end', async () => {
  const { applyClaimConsistency } = await import('../js/services/claim-consistency.js');
  const sources = [
    { id: 'src-discount', url: 'https://www.nike.com/help/a/product-discount', title: "How Can I Get Nike's Best Deals?", snippet: 'First, we offer a 10% discount to eligible shoppers. Download or open the Nike App.' },
  ];
  const campaign = {
    meta: {},
    campaignThesis: {
      statement: 'A pilot that couples the 10% app discount with free exchanges will convert first-time gym-goers in India.',
      evidenceType: 'hypothesis',
      confidence: 'low',
      sourceIds: ['src-discount'],
    },
  };
  applyClaimConsistency(campaign, sources, new Date('2026-10-30T05:00:00Z'), { market: 'India' });
  assert.equal(campaign.meta.claimFlags?.length, 1);
  assert.equal(campaign.meta.claimFlags[0].reason, 'offer-market-unverified');

  const escapeHtml = new Function(`${extractFunction('escapeHtml')}\nreturn escapeHtml;`)();
  const campaignReviewBanner = new Function(
    'escapeHtml',
    'icon',
    `${extractFunction('campaignReviewBanner')}\nreturn campaignReviewBanner;`,
  )(escapeHtml, () => '');
  const html = campaignReviewBanner(campaign);
  assert.match(html, /Review recommended/);
  assert.match(html, /no cited source verifies for the target market/);
  assert.match(html, /india/i);
});

test('real applyClaimConsistency offer-premise flag renders through the real campaignReviewBanner end to end', async () => {
  const { applyClaimConsistency } = await import('../js/services/claim-consistency.js');
  const campaign = {
    meta: {},
    campaignThesis: {
      statement: 'A pilot that couples the 10% app discount with free exchanges will convert first-time gym-goers in India.',
      evidenceType: 'hypothesis',
      confidence: 'low',
      sourceIds: [],
    },
  };
  applyClaimConsistency(campaign, [], new Date('2026-10-30T05:00:00Z'), { market: 'India' });
  assert.equal(campaign.meta.claimFlags?.length, 1);
  assert.equal(campaign.meta.claimFlags[0].reason, 'offer-premise-unsourced');

  const escapeHtml = new Function(`${extractFunction('escapeHtml')}\nreturn escapeHtml;`)();
  const campaignReviewBanner = new Function(
    'escapeHtml',
    'icon',
    `${extractFunction('campaignReviewBanner')}\nreturn campaignReviewBanner;`,
  )(escapeHtml, () => '');
  const html = campaignReviewBanner(campaign);
  assert.match(html, /Review recommended/);
  assert.match(html, /asserts an existing offer that no cited source supports/);
  assert.match(html, /not verified for india/i);
});

test('audience results page renders the real campaignReviewBanner for audience claimFlags', () => {
  assert.ok(appSource.includes('${campaignReviewBanner(profile)}'), 'audience results template must render the review banner for audience flags');
  assert.ok(readFileSync(new URL('../js/services/audience.js', import.meta.url), 'utf8').includes('applyAudienceClaimConsistency(profile'), 'audience.js must apply the consistency floor to audience profiles');
});

function loadReadyBanner() {
  const escapeHtml = new Function(`${extractFunction('escapeHtml')}\nreturn escapeHtml;`)();
  return new Function(
    'escapeHtml',
    'icon',
    `${extractFunction('campaignIncompleteSections')}\n${extractFunction('campaignReadyBanner')}\nreturn { campaignIncompleteSections, campaignReadyBanner };`,
  )(escapeHtml, () => '[icon]');
}

test('campaign ready banner lists missing sections with generate paths instead of claiming readiness', () => {
  const { campaignReadyBanner } = loadReadyBanner();
  const partial = {
    creativeTerritories: [{ id: 't1', name: 'Territory' }],
    campaignConcept: { bigIdea: 'Idea' },
    platformStrategy: [{ platform: 'Instagram' }],
    kpis: [],
    experiments: [],
    risks: [],
    killCriteria: [],
  };
  const html = campaignReadyBanner(partial, partial.campaignConcept, true);
  assert.match(html, /CAMPAIGN STRATEGY INCOMPLETE/);
  assert.doesNotMatch(html, /Every section has content/);
  assert.doesNotMatch(html, /Create Creative/);
  assert.match(html, /Success metrics/);
  assert.match(html, /Experiments/);
  assert.match(html, /Risks/);
  assert.match(html, /Kill criteria/);
  assert.match(html, /data-section="measurement"/);
  assert.doesNotMatch(html, /Creative territories<\/button>/);
});

test('campaign ready banner requires a territory selection before concept generation', () => {
  const { campaignReadyBanner } = loadReadyBanner();
  const partial = {
    creativeTerritories: [{ id: 't1', name: 'Territory' }],
    platformStrategy: [{ platform: 'Instagram' }],
    kpis: [{ name: 'KPI' }],
    experiments: [{ name: 'Test' }],
    risks: [{ statement: 'Risk' }],
    killCriteria: [{ statement: 'Stop' }],
  };
  const html = campaignReadyBanner(partial, null, false);
  assert.match(html, /select a creative territory first/i);
  assert.doesNotMatch(html, /data-section="concept"/);
});

test('campaign ready banner only claims readiness when every section has content', () => {
  const { campaignReadyBanner } = loadReadyBanner();
  const complete = {
    creativeTerritories: [{ id: 't1', name: 'Territory' }],
    campaignConcept: { bigIdea: 'Idea' },
    platformStrategy: [{ platform: 'Instagram' }],
    kpis: [{ name: 'KPI' }],
    experiments: [{ name: 'Test' }],
    risks: [{ statement: 'Risk' }],
    killCriteria: [{ statement: 'Stop' }],
  };
  const html = campaignReadyBanner(complete, complete.campaignConcept, true);
  assert.match(html, /CAMPAIGN STRATEGY READY/);
  assert.doesNotMatch(html, /INCOMPLETE/);
  // Creative development is Phase 6 and does not exist yet: the hand-off must
  // read as unavailable, never as an enabled action.
  assert.match(html, /disabled/);
  assert.match(html, /Coming in Phase 6/);
  assert.doesNotMatch(html, /data-action="creative-coming"/);
});

test('campaignReviewBanner surfaces label adjustments and company-stat flags with field tags', () => {
  const escapeHtml = new Function(`${extractFunction('escapeHtml')}\nreturn escapeHtml;`)();
  const icon = () => '';
  const campaignReviewBanner = new Function(
    'escapeHtml',
    'icon',
    `${extractFunction('campaignReviewBanner')}\nreturn campaignReviewBanner;`,
  )(escapeHtml, icon);

  // Adjustments alone (no flags) must still render - a silent demotion list is a visible change.
  const adjustmentsOnly = campaignReviewBanner({ meta: { labelAdjustments: [
    { field: 'supportingMessages[1]', from: 'observed', to: 'inferred', reason: 'persuasive-copy' },
  ] } });
  assert.match(adjustmentsOnly, /relabeled 1 claim toward caution/);
  assert.match(adjustmentsOnly, /Supporting message 2 \(persuasive copy, not an observation\)/);

  const flagged = campaignReviewBanner({ meta: { claimFlags: [
    { field: 'researchSummary', reason: 'company-stat-generalized', detail: 'figure "Rs 100 cr" reads as market-level; the source attributes it to Asian Footwears', checkedAt: '2026-10-31T00:00:00.000Z' },
  ] } });
  assert.match(flagged, /\(Research summary\)/);
  assert.match(flagged, /reads as market-level; the source attributes it to Asian Footwears/);

  assert.equal(campaignReviewBanner({ meta: { claimFlags: [], labelAdjustments: [] } }), '');
});
