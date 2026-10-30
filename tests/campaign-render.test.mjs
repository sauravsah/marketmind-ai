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
  const tokenConst = 'const SOURCE_TOKEN_RUN = /\\s*\\(\\s*source-[a-z0-9]+(?:\\s*[,;]\\s*source-[a-z0-9]+)*\\s*\\)/gi;';
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
