import { applyResearchConsistency } from './services/claim-consistency.js';

// Readiness is a safety floor, not verification of semantic claim support.
// Never mutate stored synthesis or sources: rejected output remains auditable.
const SIGNAL_KEYS = ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'];
const REDACTED_FIGURE = /(?:\*{2,}|\[redacted\]|\b(?:xxx|n\/a)\b)\s*(?:million|billion|crore|lakh|usd|inr|%)/i;
export function researchReadinessIssues(research) {
  if (!research || typeof research !== 'object') return [];
  // Recheck legacy saved summaries too, without changing their stored text/meta.
  const reviewed = applyResearchConsistency({ ...research, meta: { ...research.meta } }, research.sources || []);
  const flags = [...(research.meta?.claimFlags || []).filter(flag => flag.reason !== 'past-date-framed-as-upcoming'), ...(reviewed.meta?.claimFlags || [])];
  const uniqueFlags = flags.filter((flag, index) => flags.findIndex(other => other.field === flag.field && other.reason === flag.reason) === index);
  const issues = uniqueFlags.map(flag => ({ field: flag.field || 'research', reason: flag.reason || 'claim-consistency', detail: flag.detail || '' }));
  if (research.evidenceAudit && !research.evidenceAudit.acceptedSignalCount) issues.push({ field: 'research', reason: 'insufficient-packet-evidence', detail: 'No candidate met the packet provenance contract; review the sources.' });
  const inspect = (field, text) => {
    if (REDACTED_FIGURE.test(String(text || ''))) issues.push({ field, reason: 'redacted-numeric-placeholder', detail: 'A redacted number is not a usable factual figure.' });
  };
  inspect('researchSummary', research.researchSummary);
  for (const key of [...SIGNAL_KEYS, 'emergingThemes', 'contradictions']) (Array.isArray(research[key]) ? research[key] : []).forEach((item, index) => inspect(`${key}[${index}]`, typeof item === 'string' ? item : `${item?.title || ''} ${item?.summary || ''} ${item?.interpretation || ''}`));
  return issues;
}
export function researchNeedsReview(research) { return researchReadinessIssues(research).length > 0; }
export function assertResearchReadyForAnalysis(research) {
  if (!researchNeedsReview(research)) return;
  const error = new Error('Research needs review. Downstream analysis is paused; review the sources and flagged synthesis first.');
  error.code = 'research-needs-review';
  throw error;
}
