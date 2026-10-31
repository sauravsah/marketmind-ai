// Shared evidence-discipline rules for every synthesis stage. Keep each rule
// short: they join all four stage system prompts, and prompt size is bounded
// by provider token budgets (tests/prompt-budget.test.mjs enforces the ceiling).
export const EVIDENCE_DISCIPLINE_RULES = [
  'Observed means the cited excerpt explicitly states the claim; beyond that is inferred, never observed.',
  'Absence of mention is not evidence of absence; no market-wide or product-line gap from one source.',
  'Cite only sources on the claim\'s subject; else drop the sourceId and lower evidenceType.',
  'No specifics excerpts lack (prices, demographics, brand strength); silent claims stay general.',
  'Timing words follow dates: an event dated before today is past, never upcoming or near-term.',
  'A statistic keeps its owner: name the company it belongs to or drop it; never generalize one company\'s figure to market level.',
];
