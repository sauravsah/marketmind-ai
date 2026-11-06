import { selectResearchEvidence } from '../research-evidence.js';
import { boundStringList } from './budget.js';
import { EVIDENCE_DISCIPLINE_RULES } from './evidence-rules.js';

function value(input) {
  return String(input || '').trim();
}

export function buildResearchSynthesisPrompt(context, sources, packetBudget) {
  const evidenceContract = selectResearchEvidence(sources, packetBudget);
  const sourcePacket = evidenceContract.packet;

  return {
    system: [
      'You are MarketMind, a careful marketing intelligence analyst.',
      'Synthesize only the evidence supplied in the source packet.',
      'Never invent sources, URLs, dates, statistics, quotes, or current events.',
      'Write an explicitly provisional analyst draft. Matching quotes establishes provenance only, not semantic support. Do not infer buyer behavior from company offers, guides or consumer category context.',
      'Each signal must include evidence: [{sourceId, quote}]. Copy quote exactly from evidenceSpans. Offer context is not buyer behavior. Return empty arrays when evidence is insufficient.',
      'Every factual signal must include one or more sourceIds from the supplied packet.',
      'Separate evidence from MarketMind interpretation and state uncertainty explicitly.',
      ...EVIDENCE_DISCIPLINE_RULES,
      'Use analysisDate as today when evaluating event timing; a forecast in another sentence does not make a past event upcoming.',
      'If evidence is insufficient, say "Insufficient evidence" rather than guessing.',
      'Return valid JSON only. Do not wrap JSON in markdown.',
    ].join(' '),
    evidenceContract,
    user: JSON.stringify({
      analysisDate: (context?.now instanceof Date ? context.now : new Date()).toISOString().slice(0, 10),
      strategyContext: {
        brand: value(context.brand?.name),
        industry: value(context.brand?.industry),
        product: value(context.brand?.description),
        idea: value(context.strategy?.idea),
        audience: value(context.strategy?.audience || context.brand?.audience),
        market: value(context.strategy?.market),
        platform: value(boundStringList(context.strategy?.platforms).join(', ')),
        objective: value(context.strategy?.objective),
        competitors: boundStringList(context.strategy?.competitors),
      },
      requiredOutput: {
        researchSummary: 'string',
        marketSignals: 'array',
        audienceSignals: 'array',
        industryDevelopments: 'array',
        culturalSignals: 'array',
        competitorSignals: 'array',
        events: 'array',
        technologySignals: 'array',
        emergingThemes: 'array',
        contradictions: 'array',
      },
      evidenceLimitations: evidenceContract.limitations,
      signalShape: {
        evidence: [{ sourceId: 'packet ID', quote: 'one exact complete evidenceSpan' }],
        title: 'string',
        summary: 'evidence-grounded summary',
        type: 'news|audience|industry|culture|competitor|technology|events',
        importance: 'low|medium|high',
        freshness: 'very-recent|recent|older|unknown',
        confidence: 'low|medium|high',
        interpretation: 'clearly labeled MarketMind interpretation, or empty string',
        sourceIds: ['only IDs from the source packet'],
      },
      sourcePacket,
    }, null, 2),
  };
}
