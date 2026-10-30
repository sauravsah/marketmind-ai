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
