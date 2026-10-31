import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignSectionHasContent, regenerateConfirmCopy } from '../js/client/campaign.js';

const ready = { meta: { status: 'ready' } };

test('full strategy with ready campaign is a replace', () => {
  assert.equal(campaignSectionHasContent('all', ready), true);
  const copy = regenerateConfirmCopy('all', true);
  assert.equal(copy.title, 'Regenerate the full campaign strategy?');
  assert.match(copy.body, /replaces the full campaign strategy with a new AI generation/);
  assert.match(copy.body, /generation quota/);
  assert.match(copy.body, /Cancel keeps everything as it is/);
});

test('full strategy without ready campaign is a create', () => {
  assert.equal(campaignSectionHasContent('all', { meta: { status: 'not-run' } }), false);
  const copy = regenerateConfirmCopy('all', false);
  assert.equal(copy.title, 'Generate the full campaign strategy?');
  assert.doesNotMatch(copy.body, /replaces/);
});

test('foundation content detected from statements', () => {
  assert.equal(campaignSectionHasContent('foundation', { ...ready, strategicProblem: { statement: 'x' } }), true);
  assert.equal(campaignSectionHasContent('foundation', ready), false);
});

test('territories, concept, channels, measurement detection', () => {
  assert.equal(campaignSectionHasContent('territories', { ...ready, creativeTerritories: [{}] }), true);
  assert.equal(campaignSectionHasContent('territories', ready), false);
  assert.equal(campaignSectionHasContent('concept', { ...ready, campaignConcept: { bigIdea: 'x' } }), true);
  assert.equal(campaignSectionHasContent('channels', { ...ready, platformStrategy: [{}] }), true);
  assert.equal(campaignSectionHasContent('measurement', { ...ready, kpis: [{}] }), true);
  assert.equal(campaignSectionHasContent('measurement', ready), false);
});

test('unknown section falls back to full-strategy label', () => {
  const copy = regenerateConfirmCopy('mystery', true);
  assert.match(copy.title, /full campaign strategy/);
});
