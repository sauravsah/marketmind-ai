// Keep prompt templates outside UI code so Phase 2 can add structured output safely.
export const strategyBriefOutputShape = Object.freeze({
  summary: 'string',
  audience: 'object',
  insights: 'array',
  opportunities: 'array',
  campaigns: 'array',
});

export const strategyBriefInstruction = [
  'Return valid JSON matching the strategy brief output shape.',
  'Use only the provided brand and strategy context.',
  'Do not claim market research was performed unless research evidence is provided.',
].join(' ');
