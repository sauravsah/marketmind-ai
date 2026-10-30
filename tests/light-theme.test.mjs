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
