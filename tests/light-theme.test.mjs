import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Light-mode contrast regression: campaign studio cards sit on var(--surface),
// which the light theme sets to white, while the base campaign styles hardcode
// pale dark-palette text colors. The light theme must override them.
const OVERRIDDEN = [
  '.campaign-claim > p',
  '.campaign-page .section-heading h2',
  '.campaign-page .section-heading p',
  '.campaign-setup-form h2',
  '.campaign-header p',
  '.channel-role-card h3',
  '.pillar-row strong',
  '.measure-row strong',
  '.risk-row strong',
  '.supporting-message strong',
];

for (const selector of OVERRIDDEN) {
  test(`light theme overrides ${selector} text color`, () => {
    const pattern = new RegExp(`:root\\[data-theme="light"\\][^{]*${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&').replace(/\\>/g, '\\s*>\\s*')}[^{]*\\{[^}]*color:\\s*var\\(--text-(primary|secondary)\\)`);
    assert.match(css, pattern, `${selector} must get a light-theme text color`);
  });
}

test('dark theme campaign claim color is untouched', () => {
  assert.match(css, /\.campaign-claim > p \{ margin: 13px 0 0; color: #c3c7bb;/);
});

const LIGHT_BADGE_SELECTORS = ['.evidence-observed', '.evidence-inferred', '.evidence-hypothesis', '.evidence-unknown'];
for (const selector of LIGHT_BADGE_SELECTORS) {
  test(`light theme gives ${selector} a readable text color`, () => {
    const pattern = new RegExp(`:root\\[data-theme="light"\\][^{]*\\${selector}[^{]*\\{[^}]*color:\\s*#[0-9a-f]{6}`, 'i');
    assert.match(css, pattern, `${selector} must get an explicit light-theme color`);
  });
}

// Light-mode contrast regression: claim-card eyebrows, section eyebrows, and
// source chips inherit var(--accent) (#afd16d in the light theme), which is
// roughly 1.7:1 on white cards. The light theme must darken them.
const DARKENED = [
  '.campaign-claim .eyebrow',
  '.campaign-page .section-heading .eyebrow',
  '.campaign-page .opportunity-evidence-buttons button',
];

for (const selector of DARKENED) {
  test(`light theme darkens ${selector} for contrast`, () => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
    const pattern = new RegExp(`:root\\[data-theme="light"\\][^{]*${escaped}[^{]*\\{[^}]*color:\\s*#4a6a24`);
    assert.ok(pattern.test(css), `missing light contrast override for ${selector}`);
  });
}

test('light theme darkens emotion chips for contrast', () => {
  const pattern = /:root\[data-theme="light"\][^{]*\.emotion-list span[^{]*\{[^}]*color:\s*#4a6a24/;
  assert.ok(pattern.test(css), 'missing light contrast override for .emotion-list span');
});
