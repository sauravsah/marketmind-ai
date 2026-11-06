import { PACKET_BUDGET, rankSources } from './prompts/budget.js';

// Extractive provenance contract, not semantic support verification. Raw sources
// stay intact. Eligibility is about what a supplied span can safely carry.
export const RESEARCH_SIGNAL_KEYS = ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'];
const REDACTION = /\*{2,}|\[redacted\]|\bxxx\b/i;
const OFFER = /\b(?:we help|our (?:service|platform|mission)|finds? .{0,60}buyers|connect(?:s|ing)? .{0,80}brands|wholesale pricing|book(?:s|ing)? .{0,30}meetings)\b/i;
const DIRECT_REPORT = /\b(?:survey|interviews?|respondents?|participants?)\b.{0,100}\b(?:report(?:ed|s)?|said|found|prefer(?:red)?|use[sd]?|purchas(?:e|ed))\b/i;
const EVENT = /\b(?:expo|conference|summit|festival|exhibition)\b/i;
const EVENT_DATE = /\b(?:\d{1,2}(?:st|nd|rd|th)?\s*(?:[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/i;
export const normalizeEvidenceText = value => String(value || '').replace(/\s+/g, ' ').trim();
function sentences(text) { return normalizeEvidenceText(text).split(/(?<=[.!?])\s+(?=[A-Z\d])/).filter(Boolean); }
function roleFor(source) {
  const text = `${source.title || ''} ${source.snippet || ''}`;
  if (DIRECT_REPORT.test(text)) return 'reported-behavior-context';
  if (OFFER.test(text)) return 'offer-context';
  if (EVENT.test(text)) return 'event-context';
  return 'category-context';
}
export function selectResearchEvidence(sources = [], overrides = {}) {
  const budget = { ...PACKET_BUDGET, ...overrides };
  const ranked = rankSources(sources);
  const diagnostics = [];
  const eligible = ranked.flatMap(source => {
    const role = roleFor(source);
    const original = sentences(source.snippet);
    const spans = original.filter(text => {
      const rejected = REDACTION.test(text) || /(?:\.\.\.|…)\s*$/.test(text) || text.length > budget.maxSnippetChars;
      if (rejected) diagnostics.push({ sourceId: source.id, reason: REDACTION.test(text) ? 'redacted-span' : 'incomplete-or-over-budget-span', text });
      return !rejected;
    });
    if (!spans.length) { diagnostics.push({ sourceId: source.id, reason: 'no-usable-complete-span' }); return []; }
    const eventDateSpan = role === 'event-context' ? spans.find(text => EVENT_DATE.test(text)) : null;
    return [{ source, role, spans: eventDateSpan ? [eventDateSpan, ...spans.filter(text => text !== eventDateSpan)] : spans, eventDateAvailable: !!eventDateSpan }];
  });
  // Reserve decisive date context and reported behavior before publisher ranking.
  // Other candidates, including conflicting ones, remain in the audit inventory.
  const prioritized = [...eligible.filter(x => x.eventDateAvailable), ...eligible.filter(x => !x.eventDateAvailable && x.role === 'reported-behavior-context'), ...eligible.filter(x => !x.eventDateAvailable && x.role !== 'reported-behavior-context')];
  const selected = prioritized.slice(0, budget.maxSources);
  const packet = selected.map(({ source, role, spans, eventDateAvailable }) => {
    // Whole spans only: clipping cannot strip a qualification or a date.
    const chosen = []; let chars = 0;
    for (const span of spans) { if (chars + span.length + (chosen.length ? 1 : 0) <= budget.maxSnippetChars) { chosen.push(span); chars += span.length + (chosen.length > 1 ? 1 : 0); } }
    return { id: source.id, title: normalizeEvidenceText(source.title).slice(0, budget.maxTitleChars), domain: source.domain || '', snippet: chosen.join(' '), evidenceSpans: chosen, role, eventDateAvailable, publishedAt: source.publishedAt || null };
  });
  for (const item of eligible.filter(x => !selected.includes(x))) diagnostics.push({ sourceId: item.source.id, reason: 'packet-capacity', role: item.role });
  return { packet, diagnostics, limitations: ['Quoted spans establish provenance, not truth or semantic support.', 'Reported behavior context does not establish that respondents match the target audience.'] };
}

export function validateResearchEvidence(candidate, contract) {
  const packet = contract?.packet || [];
  const byId = new Map(packet.map(source => [source.id, source]));
  const rejectedCandidates = [];
  const accepted = {};
  for (const key of [...RESEARCH_SIGNAL_KEYS, 'emergingThemes', 'contradictions']) {
    accepted[key] = [];
    for (const item of Array.isArray(candidate?.[key]) ? candidate[key] : []) {
      const refs = Array.isArray(item?.evidence) ? item.evidence : [];
      const evidence = refs.filter(ref => byId.get(ref?.sourceId)?.evidenceSpans.includes(normalizeEvidenceText(ref.quote)));
      const reject = reason => rejectedCandidates.push({ section: key, reason, candidate: item });
      if (!refs.length || evidence.length !== refs.length) { reject('missing-or-nonpacket-exact-span'); continue; }
      if (key === 'audienceSignals' && evidence.some(ref => byId.get(ref.sourceId).role !== 'reported-behavior-context')) { reject('not-reported-behavior-evidence'); continue; }
      if (!normalizeEvidenceText(item.summary) || REDACTION.test(item.summary)) { reject('missing-or-redacted-summary'); continue; }
      // Keep the model's draft wording and exact provenance separately. Neither
      // exact quotation nor source-role heuristics establish claim support.
      accepted[key].push({ ...item, sourceIds: [...new Set(evidence.map(ref => ref.sourceId))], evidence, confidence: 'low', freshness: 'unknown' });
    }
  }
  const acceptedSignals = RESEARCH_SIGNAL_KEYS.flatMap(key => accepted[key]);
  // No second free-form summary can reintroduce a rejected candidate.
  const researchSummary = acceptedSignals.slice(0, 4).map(item => `${item.summary} (${item.sourceIds.join(', ')})`).join(' ');
  return { ...accepted, researchSummary, evidenceAudit: { version: 1, packet, selectionDiagnostics: contract?.diagnostics || [], limitations: contract?.limitations || [], originalCandidate: candidate, rejectedCandidates, acceptedSignalCount: acceptedSignals.length, audienceEvidence: accepted.audienceSignals.length ? 'reported-context-only-target-match-unverified' : 'insufficient', status: 'draft-provenance-checked-not-support-verified' } };
}
