function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourcePacket(sources = []) {
  return sources.map((source) => ({
    id: source.id,
    title: source.title,
    domain: source.domain,
    snippet: source.snippet,
    publishedAt: source.publishedAt,
    sourceType: source.sourceType,
    freshness: source.freshness,
    quality: source.quality,
  }));
}

export function validateAudienceEvidence(item, sourceIds = []) {
  const allowed = new Set(sourceIds);
  const ids = [...new Set(Array.isArray(item?.sourceIds) ? item.sourceIds : [])].filter((id) => allowed.has(id));
  const evidenceType = ['observed', 'inferred', 'hypothesis', 'unknown'].includes(item?.evidenceType) ? item.evidenceType : 'unknown';
  return {
    evidenceType,
    sourceIds: ids,
    hasKnownSources: ids.length > 0,
    supported: evidenceType === 'observed' ? ids.length > 0 : true,
  };
}

export function buildBehavioralSynthesisPrompt(context, evidence, focus = 'behavior, motivation, friction, and decision context') {
  return {
    system: [
      'You are MarketMind, a careful audience intelligence analyst.',
      'Use only the strategy context and evidence packet supplied by the user.',
      'Treat source snippets as incomplete evidence, not as permission to fill gaps.',
      'Never invent sources, source IDs, quotes, survey results, statistics, demographics, or customer stories.',
      'Never stereotype people by age, geography, occupation, identity, or life stage.',
      'Do not present a plausible marketing convention as an observation.',
      'Every observed item must cite one or more sourceIds from the packet.',
      'Inferred items must be framed as interpretation from cited observations.',
      'Hypotheses are testable possibilities and must remain hypotheses.',
      'Use unknown when the evidence does not support a claim.',
      'Return valid JSON only. Do not wrap JSON in markdown.',
    ].join(' '),
    user: JSON.stringify({
      task: `Build an evidence-aware audience model focused on ${focus}.`,
      strategyContext: {
        brand: clean(context?.brand?.name),
        industry: clean(context?.brand?.industry),
        product: clean(context?.brand?.description),
        brandAudience: clean(context?.brand?.audience),
        idea: clean(context?.strategy?.idea),
        audience: clean(context?.strategy?.audience),
        market: clean(context?.strategy?.market),
        platforms: context?.strategy?.platforms || [],
        objective: clean(context?.strategy?.objective),
        competitors: context?.strategy?.competitors || [],
      },
      audienceScope: context?.audienceScope || {},
      evidencePacket: sourcePacket(evidence),
    }, null, 2),
  };
}

export function buildAudienceAnalysisPrompt(context, evidence = []) {
  const behavioralPrompt = buildBehavioralSynthesisPrompt(context, evidence);
  return {
    system: `${behavioralPrompt.system} Build a structured audience profile, keeping evidence, inference, hypothesis, and unknown visibly distinct. Do not create a persona biography or write a customer quote.`,
    user: JSON.stringify({
      ...JSON.parse(behavioralPrompt.user),
      requiredOutput: {
        summary: 'short evidence-aware audience snapshot',
        segments: 'array of narrowly defined audience segments, each with evidenceType and sourceIds',
        observedBehaviors: 'array',
        motivations: 'array',
        pains: 'array',
        desires: 'array',
        tensions: 'array',
        barriers: 'array',
        objections: 'array',
        triggers: 'array',
        identityDrivers: 'array',
        contentBehaviors: 'array',
        decisionFactors: 'array',
        momentsThatMatter: 'array',
        hypotheses: 'array of testable hypotheses',
        uncertainties: 'array of explicit unknowns',
      },
      itemShape: {
        statement: 'one concise claim; never a quote',
        evidenceType: 'observed|inferred|hypothesis|unknown',
        sourceIds: 'only IDs from evidencePacket; [] is valid for hypotheses or unknowns',
        confidence: 'low|medium|high; confidence is not certainty',
        freshness: 'very-recent|recent|older|unknown',
        whyItMatters: 'brief interpretation for the strategy, or empty string',
        validationMethod: 'optional test or research method for hypotheses and unknowns',
      },
      constraints: [
        'Observed requires at least one sourceId from the evidencePacket.',
        'Do not infer age, income, gender, ethnicity, disability, or other demographics unless directly supported by evidence and relevant to the stated scope.',
        'If no live evidence is supplied, use hypothesis or unknown only and say so in summary and uncertainties.',
        'Do not include fields named quote, customerQuote, testimonial, or verbatimVoice.',
      ],
    }, null, 2),
  };
}
