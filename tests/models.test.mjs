import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONALITY_OPTIONS, TONE_OPTIONS, createDefaultBrandProfile, createDefaultStrategy } from '../js/models.js';

test('brand profile starts with a structured, balanced voice', () => {
  const profile = createDefaultBrandProfile();
  assert.equal(profile.voice.strictness, 'balanced');
  assert.ok(profile.voice.tone);
  assert.ok(Array.isArray(profile.voice.personality));
  assert.ok(Array.isArray(profile.voice.examples));
});

test('voice option sets stay intentionally focused', () => {
  assert.ok(TONE_OPTIONS.includes('Premium & Minimal'));
  assert.ok(PERSONALITY_OPTIONS.includes('Intelligent'));
  assert.ok(TONE_OPTIONS.length <= 6);
  assert.ok(PERSONALITY_OPTIONS.length <= 12);
});

test('strategy model is ready for future intelligence inputs', () => {
  const strategy = createDefaultStrategy();
  assert.equal(strategy.status, 'draft');
  assert.deepEqual(strategy.platforms, []);
  assert.ok(strategy.createdAt);
  assert.ok(strategy.id.startsWith('strategy-'));
});
