import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_DISCIPLINE_RULES } from '../js/prompts/evidence-rules.js';
import { buildResearchSynthesisPrompt } from '../js/prompts/research.js';
import { buildAudienceAnalysisPrompt } from '../js/prompts/audience.js';
import { buildOpportunityPrompt } from '../js/prompts/opportunity.js';
import { buildCampaignStrategyPrompt, buildCreativeTerritoriesPrompt, buildCampaignConceptPrompt, buildPlatformStrategyPrompt } from '../js/prompts/campaign.js';

const context = {
  brand: { name: 'Nike', industry: 'Footwear', description: 'Athletic shoes and apparel', audience: 'Runners in India', voice: { tone: 'bold' } },
  strategy: { idea: 'Make running more exciting for Gen Z in India', audience: 'Gen Z runners in urban India', market: 'India', platforms: ['Instagram'], objective: 'Launch', competitors: ['Adidas'] },
};

const stages = {
  research: () => buildResearchSynthesisPrompt(context, []),
  audience: () => buildAudienceAnalysisPrompt(context, []),
  opportunity: () => buildOpportunityPrompt(context, {}),
  campaignFoundation: () => buildCampaignStrategyPrompt(context),
  campaignTerritories: () => buildCreativeTerritoriesPrompt(context),
  campaignConcept: () => buildCampaignConceptPrompt(context),
  campaignChannels: () => buildPlatformStrategyPrompt(context),
};

test('evidence discipline rules are short enough for bounded prompts', () => {
  assert.equal(EVIDENCE_DISCIPLINE_RULES.length, 6);
  for (const rule of EVIDENCE_DISCIPLINE_RULES) {
    assert.ok(rule.length <= 130, `rule too long (${rule.length} chars): ${rule}`);
    assert.ok(!/https?:/i.test(rule), 'rules must not embed URLs');
  }
  const joinedLength = EVIDENCE_DISCIPLINE_RULES.reduce((total, rule) => total + rule.length, 0) + EVIDENCE_DISCIPLINE_RULES.length - 1;
  // Ceiling raised 400 -> 650 on 2026-10-31 for two audit-driven rules
  // (temporal grounding, statistic attribution); prompt-budget.test.mjs
  // remains the hard wall per stage.
  assert.ok(joinedLength <= 650, `rules add ${joinedLength} chars to every stage system prompt; ceiling is 650 to stay inside prompt budgets`);
});

test('every synthesis stage prompt carries all evidence discipline rules', () => {
  for (const [stage, build] of Object.entries(stages)) {
    const { system } = build();
    for (const rule of EVIDENCE_DISCIPLINE_RULES) {
      assert.ok(system.includes(rule), `${stage} system prompt missing rule: ${rule.slice(0, 50)}`);
    }
  }
});

test('observed is defined as explicitly stated by the cited excerpt, not inference', () => {
  const observedRule = EVIDENCE_DISCIPLINE_RULES.find((rule) => rule.startsWith('Observed'));
  assert.ok(observedRule, 'missing observed definition rule');
  assert.match(observedRule, /explicitly states the claim/);
  assert.match(observedRule, /never observed/);
});

test('absence of mention is not evidence of absence', () => {
  const absenceRule = EVIDENCE_DISCIPLINE_RULES.find((rule) => rule.includes('not evidence of absence'));
  assert.ok(absenceRule, 'missing absence-of-mention rule');
  assert.match(absenceRule, /market-wide or product-line gap/);
});

test('citation relevance rule forbids tangential sources', () => {
  const relevanceRule = EVIDENCE_DISCIPLINE_RULES.find((rule) => rule.includes("claim's subject"));
  assert.ok(relevanceRule, 'missing citation relevance rule');
  assert.match(relevanceRule, /drop the sourceId and lower evidenceType/);
  assert.match(relevanceRule, /Cite only sources on the claim's subject/);
});

test('pre-existing honesty guardrails are intact after the repair', () => {
  assert.match(buildResearchSynthesisPrompt(context, []).system, /Never invent sources, URLs, dates, statistics, quotes, or current events/);
  assert.match(buildAudienceAnalysisPrompt(context, []).system, /Never stereotype people by age, geography, occupation, identity, or life stage/);
  assert.match(buildOpportunityPrompt(context, {}).system, /Never say an opportunity will definitely work, is guaranteed, or has a probability of success/);
  assert.match(buildCampaignStrategyPrompt(context).system, /Never invent sources, statistics, customer quotes, personas, competitor behavior, urgency, or benchmarks/);
});
