import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandHasContent,
  brandPinStatus,
  pinBrandToStrategy,
  resolveStrategyBrand,
  sortStrategiesForHistory,
  strategyBrandLabel,
  strategyStageIcon,
  strategyStageLabel,
  strategyUpdatedAt,
} from '../js/client/strategy-brand.js';
import { createDefaultBrandProfile, createDefaultStrategy } from '../js/models.js';

function brand(overrides = {}) {
  return { ...createDefaultBrandProfile(), name: 'MarketMind', industry: 'B2B software', ...overrides };
}

test('a pinned snapshot always wins over the live workspace brand', () => {
  const strategy = { ...createDefaultStrategy(), brandSnapshot: brand({ name: 'AREUM', industry: 'Beauty' }) };
  const resolved = resolveStrategyBrand({ strategy, workspaceBrand: brand() });
  assert.equal(resolved.name, 'AREUM');
  assert.equal(resolved.industry, 'Beauty');
});

test('an unpinned strategy falls back to the current workspace brand', () => {
  const strategy = createDefaultStrategy();
  const resolved = resolveStrategyBrand({ strategy, workspaceBrand: brand() });
  assert.equal(resolved.name, 'MarketMind');
});

test('pinning deep-copies the brand so later workspace edits do not leak in', () => {
  const workspaceBrand = brand();
  const pinned = pinBrandToStrategy(createDefaultStrategy(), workspaceBrand, '2026-11-06T00:00:00.000Z');
  workspaceBrand.name = 'Renamed';
  workspaceBrand.voice.tone = 'Bold & Disruptive';
  assert.equal(pinned.brandSnapshot.name, 'MarketMind');
  assert.equal(pinned.brandSnapshot.voice.tone, 'Friendly & Conversational');
  assert.equal(pinned.brandPinnedAt, '2026-11-06T00:00:00.000Z');
});

test('pinning never overwrites an existing pin and never pins an empty brand', () => {
  const first = pinBrandToStrategy(createDefaultStrategy(), brand({ name: 'AREUM' }));
  const second = pinBrandToStrategy(first, brand({ name: 'Other' }));
  assert.equal(second.brandSnapshot.name, 'AREUM');
  const empty = pinBrandToStrategy(createDefaultStrategy(), createDefaultBrandProfile());
  assert.equal(empty.brandSnapshot, null);
});

test('brand pin status distinguishes unsaved, legacy-saved, and pinned work', () => {
  const fresh = createDefaultStrategy();
  assert.equal(brandPinStatus({ strategy: fresh, savedStrategies: [] }), 'unsaved');
  const legacy = { ...createDefaultStrategy(), id: 'strategy-legacy' };
  assert.equal(brandPinStatus({ strategy: legacy, savedStrategies: [legacy] }), 'unpinned-saved');
  const pinned = pinBrandToStrategy(legacy, brand());
  assert.equal(brandPinStatus({ strategy: pinned, savedStrategies: [legacy] }), 'pinned');
});

test('brand content and labels stay honest about what exists', () => {
  assert.equal(brandHasContent(createDefaultBrandProfile()), false);
  assert.equal(brandHasContent(brand({ name: '' })), true);
  assert.equal(strategyBrandLabel(createDefaultStrategy()), '');
  assert.equal(strategyBrandLabel(pinBrandToStrategy(createDefaultStrategy(), brand())), 'MarketMind');
});

test('stage labels follow the furthest completed stage', () => {
  const base = createDefaultStrategy();
  assert.equal(strategyStageLabel(base), 'Strategy brief');
  assert.equal(strategyStageIcon(base), 'sparkles');
  assert.equal(strategyStageLabel({ ...base, research: { meta: { researchedAt: '2026-11-01' } } }), 'Market research');
  assert.equal(strategyStageLabel({ ...base, audienceInsights: {} }), 'Audience intelligence');
  assert.equal(strategyStageLabel({ ...base, opportunityRadar: {} }), 'Opportunity radar');
  assert.equal(strategyStageLabel({ ...base, opportunityRadar: {}, campaignStrategy: {} }), 'Campaign strategy');
  assert.equal(strategyStageLabel({ ...base, objective: 'Launch' }), 'Launch');
});

test('history ordering uses the freshest stage timestamp per strategy', () => {
  const old = { ...createDefaultStrategy(), id: 'a', createdAt: '2026-10-01T00:00:00.000Z' };
  const researched = { ...createDefaultStrategy(), id: 'b', createdAt: '2026-09-01T00:00:00.000Z', research: { meta: { researchedAt: '2026-11-03T10:00:00.000Z' } } };
  const campaigned = { ...createDefaultStrategy(), id: 'c', createdAt: '2026-08-01T00:00:00.000Z', campaignStrategy: { updatedAt: '2026-11-05T09:00:00.000Z' } };
  const sorted = sortStrategiesForHistory([old, researched, campaigned]);
  assert.deepEqual(sorted.map((item) => item.id), ['c', 'b', 'a']);
  assert.equal(strategyUpdatedAt(researched), '2026-11-03T10:00:00.000Z');
  assert.equal(strategyUpdatedAt(old), '2026-10-01T00:00:00.000Z');
  // Sorting must not mutate the caller's array.
  const input = [old, researched];
  sortStrategiesForHistory(input);
  assert.deepEqual(input.map((item) => item.id), ['a', 'b']);
});

test('run gate blocks saved-unpinned briefs only when a brand could leak', async () => {
  const { brandRunGate } = await import('../js/client/strategy-brand.js');
  const legacy = { ...createDefaultStrategy(), id: 'strategy-legacy' };
  const saved = [legacy];
  assert.equal(brandRunGate({ strategy: legacy, savedStrategies: saved, workspaceBrand: brand() }), 'needs-pin');
  // Empty workspace brand: nothing to leak, runs stay allowed.
  assert.equal(brandRunGate({ strategy: legacy, savedStrategies: saved, workspaceBrand: createDefaultBrandProfile() }), 'ok');
  // Unsaved briefs and pinned briefs run freely.
  assert.equal(brandRunGate({ strategy: createDefaultStrategy(), savedStrategies: saved, workspaceBrand: brand() }), 'ok');
  assert.equal(brandRunGate({ strategy: pinBrandToStrategy(legacy, brand()), savedStrategies: saved, workspaceBrand: brand({ name: 'Other' }) }), 'ok');
});

test('stage label marks partial research honestly', () => {
  const withResearch = { ...createDefaultStrategy(), research: { meta: { researchedAt: '2026-11-01' } } };
  assert.equal(strategyStageLabel(withResearch, 'partial'), 'Market research (partial)');
  assert.equal(strategyStageLabel(withResearch, 'complete'), 'Market research');
  assert.equal(strategyStageLabel(withResearch), 'Market research');
});
