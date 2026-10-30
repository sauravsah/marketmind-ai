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


function extractConst(name) {
  const start = appSource.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `js/app.js must define const ${name} in module scope`);
  const braceStart = appSource.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < appSource.length; i += 1) {
    if (appSource[i] === '{') depth += 1;
    if (appSource[i] === '}') depth -= 1;
    if (depth === 0) return `${appSource.slice(start, i + 1)};`;
  }
  throw new Error(`unterminated const ${name}`);
}

function loadOpportunityEvidenceButtons() {
  const uniqueSrc = extractFunction('unique');
  const buttonsSrc = extractFunction('opportunityEvidenceButtons');
  const escapeHtml = (value = '') => String(value);
  const icon = () => '';
  return new Function(
    'escapeHtml',
    'icon',
    `${uniqueSrc}\n${buttonsSrc}\nreturn opportunityEvidenceButtons;`,
  )(escapeHtml, icon);
}

test('app.js defines unique in module scope (radar results render regression)', () => {
  assert.match(appSource, /function unique\(values\)/, 'unique helper must exist in js/app.js scope');
});

test('opportunity evidence buttons render mapped sources from the exact crash input shape', () => {
  const opportunityEvidenceButtons = loadOpportunityEvidenceButtons();
  const sources = [
    { id: 's1', domain: 'yourstory.com' },
    { id: 's2', domain: 'inc42.com' },
  ];
  const items = [
    { statement: 'Gen Z prefers prevention-first skincare', sourceIds: ['s1', 's2'] },
    { statement: 'Minimalist wins on product focus', sourceIds: ['s2'] },
    { statement: 'Signal without sources' },
  ];
  const html = opportunityEvidenceButtons(items, sources);
  assert.ok(html.includes('yourstory.com'));
  assert.ok(html.includes('inc42.com'));
  assert.equal(html.match(/opportunity-evidence-buttons/g).length, 1);
  assert.equal((html.match(/data-opportunity-source-id=/g) || []).length, 2, 'deduped source buttons only');
});

test('opportunity evidence buttons tolerate empty and unknown source ids', () => {
  const opportunityEvidenceButtons = loadOpportunityEvidenceButtons();
  assert.equal(opportunityEvidenceButtons([], []), '');
  assert.equal(opportunityEvidenceButtons([{ sourceIds: ['missing'] }], []), '');
  assert.equal(opportunityEvidenceButtons(undefined, undefined), '');
});

test('campaign review banner renders a visible warning for flagged claims', () => {
  const bannerSrc = extractFunction('campaignReviewBanner');
  const escapeHtml = (value = '') => String(value).replace(/</g, '&lt;');
  const icon = () => '';
  const campaignReviewBanner = new Function(
    'escapeHtml',
    'icon',
    `${bannerSrc}\nreturn campaignReviewBanner;`,
  )(escapeHtml, icon);
  const html = campaignReviewBanner({
    meta: { claimFlags: [{ reason: 'past-date-framed-as-upcoming', datedMaterial: 'February 2026', checkedAt: '2026-10-30' }] },
  });
  assert.match(html, /Review recommended/);
  assert.match(html, /February 2026/);
  assert.match(html, /does not verify other claims/);
});

test('campaign review banner renders nothing for unflagged campaigns', () => {
  const bannerSrc = extractFunction('campaignReviewBanner');
  const escapeHtml = (value = '') => String(value);
  const icon = () => '';
  const campaignReviewBanner = new Function(
    'escapeHtml',
    'icon',
    `${bannerSrc}\nreturn campaignReviewBanner;`,
  )(escapeHtml, icon);
  assert.equal(campaignReviewBanner({}), '');
  assert.equal(campaignReviewBanner({ meta: { claimFlags: [] } }), '');
  assert.equal(campaignReviewBanner(undefined), '');
});

test('real applyClaimConsistency output renders through the real campaignReviewBanner end to end', async () => {
  const { applyClaimConsistency } = await import('../js/services/claim-consistency.js');
  const campaign = {
    meta: {},
    campaignThesis: {
      statement: 'The upcoming February 2026 profile changes will bring new gym-goers to the Nike app.',
      evidenceType: 'hypothesis',
      confidence: 'medium',
      sourceIds: [],
    },
  };
  const now = new Date('2026-10-30T05:00:00Z');
  applyClaimConsistency(campaign, [], now);

  // Guard the exact metadata path the banner depends on.
  assert.ok(Array.isArray(campaign.meta.claimFlags) && campaign.meta.claimFlags.length === 1);
  const flag = campaign.meta.claimFlags[0];
  assert.equal(flag.reason, 'past-date-framed-as-upcoming');
  assert.equal(flag.datedMaterial, 'February 2026');
  assert.equal(flag.checkedAt, '2026-10-30T05:00:00.000Z');

  // Render with the real functions extracted from js/app.js - no hand-built flag fixture.
  const escapeHtml = new Function(`${extractFunction('escapeHtml')}\nreturn escapeHtml;`)();
  const iconsSrc = extractConst('icons');
  const icon = new Function(`${iconsSrc}\n${extractFunction('icon')}\nreturn icon;`)();
  const campaignReviewBanner = new Function(
    'escapeHtml',
    'icon',
    `${extractFunction('campaignReviewBanner')}\nreturn campaignReviewBanner;`,
  )(escapeHtml, icon);
  const html = campaignReviewBanner(campaign);

  assert.match(html, /Review recommended/);
  assert.match(html, /February 2026/);
  assert.match(html, /2026-10-30T05:00:00\.000Z/);
  assert.match(html, /does not verify other claims/);
  assert.match(html, /campaign-limited-banner/);
  // The dynamic fields reach the HTML only through escapeHtml.
  const malicious = { meta: { claimFlags: [{ reason: 'past-date-framed-as-upcoming', datedMaterial: '<img src=x onerror=alert(1)>', checkedAt: '2026-10-30' }] } };
  const escaped = campaignReviewBanner(malicious);
  assert.ok(!escaped.includes('<img src=x'));
  assert.match(escaped, /&lt;img src=x/);
});
