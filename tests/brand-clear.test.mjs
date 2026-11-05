import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
test('Brand Voice can save an incomplete or cleared profile through the normal save path', () => {
  const save = app.slice(app.indexOf('function saveBrand()'), app.indexOf('async function persistStrategy'));
  assert.doesNotMatch(save, /if\s*\(!nextBrand\.name/);
  assert.match(save, /storage\.saveBrand\(state\.brand\); persistWorkspace\(\)/);
  assert.match(app, /Brand name <span class="optional">OPTIONAL<\/span>/);
});
