function value(input) {
  return String(input || '').trim();
}

export function buildResearchSynthesisPrompt(context, sources) {
  const sourcePacket = sources.map((source) => ({
    id: source.id,
    title: source.title,
    domain: source.domain,
    snippet: source.snippet,
    publishedAt: source.publishedAt,
    sourceType: source.sourceType,
    freshness: source.freshness,
    quality: source.quality,
  }));

  return {
    system: [
      'You are MarketMind, a careful marketing intelligence analyst.',
      'Synthesize only the evidence supplied in the source packet.',
      'Never invent sources, URLs, dates, statistics, quotes, or current events.',
      'Every factual signal must include one or more sourceIds from the supplied packet.',
      'Separate evidence from MarketMind interpretation and state uncertainty explicitly.',
      'If evidence is insufficient, say "Insufficient evidence" rather than guessing.',
      'Return valid JSON only. Do not wrap JSON in markdown.',
    ].join(' '),
    user: JSON.stringify({
      strategyContext: {
        brand: value(context.brand?.name),
        industry: value(context.brand?.industry),
        product: value(context.brand?.description),
        idea: value(context.strategy?.idea),
        audience: value(context.strategy?.audience || context.brand?.audience),
        market: value(context.strategy?.market),
        platform: value(context.strategy?.platforms?.join(', ')),
        objective: value(context.strategy?.objective),
        competitors: context.strategy?.competitors || [],
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
      signalShape: {
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
