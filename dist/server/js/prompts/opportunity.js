import { PACKET_BUDGET, bindCitedPacket, bindItemsToPacket, boundStringList, clipText } from './budget.js';
import { EVIDENCE_DISCIPLINE_RULES } from './evidence-rules.js';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function itemPacket(items = [], packetIds, packetBudget) {
  return bindItemsToPacket(items, packetIds, PACKET_BUDGET.maxSignalItems, packetBudget).map((item) => ({
    freshness: 'unknown',
    ...item,
  }));
}

export function buildOpportunityScoringPrompt() {
  return {
    system: [
      'Score each opportunity as a MarketMind assessment, not an objective market measurement.',
      'Use integer dimensions from 1 to 10 and calculate overall as a transparent weighted score out of 100.',
      'Use these weights unless evidence clearly requires a conservative adjustment: audience relevance 20%, brand fit 20%, evidence strength 15%, timing 15%, competitive whitespace 15%, actionability 15%.',
      'Never express a score as a probability of success or a percentage chance of conversion.',
      'Confidence is independent from score and must decrease when intelligence is missing, audience evidence is low-confidence, contradictions are material, or research is stale.',
    ].join(' '),
  };
}

export function buildOpportunityValidationPrompt() {
  return {
    system: [
      'Validate every proposed opportunity before returning it.',
      'Every sourceId must match an ID in the supplied source packet.',
      'Remove unsupported source IDs and do not repair them by inventing replacements.',
      'The opportunity itself is a strategic hypothesis, never a fact or guarantee.',
      'Preserve contradictions, uncertainty, and falsification signals.',
      'Prefer fewer strong opportunities and remove duplicate or near-duplicate strategic territories.',
      'Do not invent competitor behavior, statistics, quotes, urgency, customer research, or whitespace claims.',
    ].join(' '),
  };
}

export function buildOpportunityPrompt(context, evidence = {}, lens = 'balanced', variation = 0, packetBudget) {
  const scoring = buildOpportunityScoringPrompt();
  const validation = buildOpportunityValidationPrompt();
  const research = context?.research || {};
  const audience = context?.audience || {};
  const reviewedAudience = Array.isArray(evidence.audienceSignals) ? evidence.audienceSignals : [];
  const marketSignals = Array.isArray(evidence.marketSignals) ? evidence.marketSignals : [];
  const emergingThemes = Array.isArray(research.emergingThemes) ? research.emergingThemes : [];
  const contradictions = Array.isArray(research.contradictions) ? research.contradictions : [];
  const cited = bindCitedPacket(evidence.sources, [marketSignals, emergingThemes, contradictions, reviewedAudience], packetBudget);
  return {
    system: [
      'You are MarketMind, a careful senior marketing strategist.',
      'Identify strategic territories worth exploring from the supplied strategy, brand, market intelligence, audience intelligence, and source packet.',
      'An opportunity requires a meaningful intersection of market signal, audience need or tension, brand relevance, timing, and competitive context when available.',
      'Use only the supplied evidence. Clearly distinguish observed, inferred, and hypothesis content.',
      ...EVIDENCE_DISCIPLINE_RULES,
      'Only audience claims in the supplied reviewedSignals packet are eligible audience context. Do not use audience claims from strategy context or any omitted audience field.',
      'Use language such as potential opportunity, evidence-backed direction, strategic hypothesis, and worth validating.',
      'Never say an opportunity will definitely work, is guaranteed, or has a probability of success.',
      'Never create a fake persona, customer quote, statistic, source, competitor behavior, or market urgency.',
      'When an exploration pass is greater than zero, use it as a variation cue and avoid repeating prior opportunity territories supplied in the context.',
      scoring.system,
      validation.system,
      'Return valid JSON only. Do not wrap JSON in markdown.',
    ].join(' '),
    user: JSON.stringify({
      exploreThrough: lens,
      explorationPass: Number.isFinite(Number(variation)) ? Math.max(0, Math.floor(Number(variation))) : 0,
      priorOpportunities: Array.isArray(context?.previousOpportunities) ? context.previousOpportunities.slice(0, 5).map((item) => ({ title: clipText(item?.title, 120), strategicThesis: clipText(item?.strategicThesis, PACKET_BUDGET.maxStatementChars) })).filter((item) => item.title || item.strategicThesis) : [],
      strategyContext: {
        id: context?.strategy?.id,
        brand: clean(context?.brand?.name),
        industry: clean(context?.brand?.industry),
        positioning: clean(context?.brand?.description),
        idea: clean(context?.strategy?.idea),
        audience: clean(context?.strategy?.audience),
        market: clean(context?.strategy?.market),
        platforms: boundStringList(context?.strategy?.platforms),
        objective: clean(context?.strategy?.objective),
        competitors: boundStringList(context?.strategy?.competitors),
        brandVoice: context?.brand?.voice || {},
      },
      intelligenceStatus: context?.intelligenceStatus || {},
      marketIntelligence: {
        signals: itemPacket(marketSignals, cited.packetIds, packetBudget),
        emergingThemes: itemPacket(emergingThemes, cited.packetIds, packetBudget),
        contradictions: itemPacket(contradictions, cited.packetIds, packetBudget),
        sources: cited.packet,
      },
      audienceIntelligence: {
        evidenceCoverage: audience.evidenceCoverage || {},
        reviewedSignals: itemPacket(reviewedAudience, cited.packetIds, packetBudget),
      },
      requiredOutput: {
        opportunities: 'array; default up to 5, fewer when evidence is weak or territories overlap',
        opportunityShape: {
          title: 'concise strategic territory title',
          oneLineDescription: 'one-line description',
          type: 'cultural|audience|category|competitive|product|content|community|timing|positioning',
          strategicThesis: 'Because X is happening, and Y appears to matter to the audience, the brand could explore Z.',
          marketSignals: 'array of evidence items with statement, evidenceType, and sourceIds',
          audienceSignals: 'array of audience items with statement, evidenceType, and sourceIds',
          brandFit: { level: 'high|medium|low', explanation: 'reasoned explanation', evidenceType: 'inferred|hypothesis|unknown', sourceIds: [] },
          competitiveContext: { summary: 'what is known and what is not known', evidenceType: 'observed|inferred|hypothesis|unknown', sourceIds: [] },
          timing: { level: 'strong|moderate|weak|unknown', explanation: 'why now, or why timing is uncertain', evidenceType: 'observed|inferred|hypothesis|unknown', sourceIds: [] },
          evidence: 'array describing the market → audience → brand → opportunity chain',
          contradictions: 'array of relevant conflicting signals or an empty array',
          whitespace: { statement: 'potential whitespace, never an unqualified untapped-market claim', evidenceType: 'hypothesis|inferred|unknown', sourceIds: [] },
          risks: 'array of risks',
          falsificationSignals: 'array of evidence that would make this less attractive',
          confidence: 'high|medium|low',
          scores: { audienceRelevance: '1-10', brandFit: '1-10', evidenceStrength: '1-10', timing: '1-10', competitiveWhitespace: '1-10', actionability: '1-10' },
          validationPlan: { method: 'customer interviews|survey|social listening|search trend analysis|A/B content test|landing page test|paid ad test|creator test|community experiment', plan: 'practical validation plan without fabricated expected results' },
          recommendedNextStep: 'one practical next step; do not create a campaign',
        },
      },
    }, null, 2),
  };
}
