// Deterministic claim-consistency review for generated campaign output.
//
// These checks enforce a conservative floor: they demote or flag labels that
// are inconsistent with the cited excerpts on narrow, decidable dimensions
// (hedged language in an observed claim, claim qualifiers absent from every
// cited excerpt, past dates framed as upcoming). They never upgrade a label
// and never rewrite claim text. Passing these checks does NOT verify that a
// source supports a claim - semantic entailment still requires human review
// or a dedicated verifier. Every adjustment is recorded in campaign meta so
// the change is auditable, not silent.

const HEDGE_PATTERN = /\b(may|might|could|likely|unlikely|suggests?|tends? to|potential(?:ly)?|appears?|seems?)\b/i;
const UPCOMING_PATTERN = /\b(upcoming|coming soon|will (?:launch|roll out|release|introduce|debut)|soon|next (?:month|quarter|year)|later this year)\b/i;
// Strong population/geography qualifiers an observed claim may not invent:
// if the claim asserts one of these and no cited excerpt mentions it, the
// claim is at best inferred. Fixed list by design - a floor, not entailment.
const QUALIFIER_PATTERNS = [
  { key: 'first-time', pattern: /\bfirst[- ]tim/i },
  { key: 'newcomer', pattern: /\bnewcomers?\b|\bbeginners?\b|\bnew to\b/i },
  { key: 'gen-z', pattern: /\bgen\s?z\b/i },
  { key: 'millennial', pattern: /\bmillennials?\b/i },
  { key: 'gen-alpha', pattern: /\bgen\s?alpha\b/i },
  { key: 'urban', pattern: /\burban\b/i },
  { key: 'india', pattern: /\bindia(?:n)?\b/i },
  { key: 'gym-goer', pattern: /\bgym[- ]goers?\b/i },
  { key: 'runner', pattern: /\brunners?\b/i },
  { key: 'student', pattern: /\bstudents?\b/i },
  { key: 'women', pattern: /\bwomen\b/i },
  { key: 'men', pattern: /\bmen\b/i },
];
const MONTH_INDEX = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

function excerptText(sources, sourceIds) {
  const wanted = new Set(sourceIds || []);
  return (sources || []).filter((source) => wanted.has(source?.id)).map((source) => `${source.title || ''} ${source.snippet || ''}`).join(' ');
}

function missingQualifiers(statement, excerpts) {
  const text = String(excerpts || '').toLowerCase();
  return QUALIFIER_PATTERNS.filter(({ key, pattern }) => pattern.test(statement) && !text.includes(key.replace(/-/g, ' ')) && !new RegExp(key.replace(/-/g, '[- ]'), 'i').test(text)).map(({ key }) => key);
}

function pastDatesIn(text, now) {
  const found = [];
  const monthYear = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/gi;
  let match;
  while ((match = monthYear.exec(text)) !== null) {
    const date = new Date(Date.UTC(Number(match[2]), MONTH_INDEX[match[1].toLowerCase()], 1));
    if (date < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) found.push(match[0]);
  }
  const bareYear = /\b(20\d{2})\b/g;
  while ((match = bareYear.exec(text)) !== null) {
    if (Number(match[1]) < now.getUTCFullYear()) found.push(match[1]);
  }
  return found;
}

function futureDatesIn(text, now) {
  const monthYear = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/gi;
  let match;
  while ((match = monthYear.exec(text)) !== null) {
    const date = new Date(Date.UTC(Number(match[2]), MONTH_INDEX[match[1].toLowerCase()], 1));
    if (date > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) return true;
  }
  const bareYear = /\b(20\d{2})\b/g;
  while ((match = bareYear.exec(text)) !== null) {
    if (Number(match[1]) > now.getUTCFullYear()) return true;
  }
  return false;
}

// Reviews one normalized claim in place. Returns adjustment/flag records.
function reviewClaim(field, claim, sources, now, adjustments, flags) {
  if (!claim || typeof claim !== 'object' || !claim.statement) return;
  const excerpts = excerptText(sources, claim.sourceIds);
  if (claim.evidenceType === 'observed') {
    const hedge = claim.statement.match(HEDGE_PATTERN);
    // An observed claim may faithfully report a source's own uncertainty; only
    // demote when the hedged word is the model's addition, absent from excerpts.
    if (hedge && !excerpts.toLowerCase().includes(hedge[0].toLowerCase())) {
      adjustments.push({ field, from: 'observed', to: 'inferred', reason: 'hedged-language', detail: hedge[0].toLowerCase() });
      claim.evidenceType = 'inferred';
    }
    const missing = claim.evidenceType === 'observed' ? missingQualifiers(claim.statement, excerpts) : [];
    if (missing.length) {
      adjustments.push({ field, from: 'observed', to: 'inferred', reason: 'qualifier-not-in-sources', detail: missing.join(', ') });
      claim.evidenceType = 'inferred';
    }
  }
  if (UPCOMING_PATTERN.test(claim.statement)) {
    // Flag only when the dated material is unambiguously in the past: an old
    // source can legitimately announce a future event, so any future date in
    // the same claim or its excerpts suppresses the flag. Source publication
    // dates are never used - a past publication date is not a past event date.
    const combined = `${claim.statement} ${excerpts}`;
    const dated = futureDatesIn(combined, now) ? [] : [...new Set([...pastDatesIn(claim.statement, now), ...pastDatesIn(excerpts, now)])];
    if (dated.length) {
      flags.push({ field, reason: 'past-date-framed-as-upcoming', detail: dated.join(', ') });
      if (claim.confidence !== 'low') {
        adjustments.push({ field, from: claim.confidence, to: 'low', reason: 'past-date-framed-as-upcoming' });
        claim.confidence = 'low';
      }
    }
  }
}

const CLAIM_FIELDS = ['strategicProblem', 'audienceInsight', 'campaignThesis', 'currentPerception', 'desiredPerception', 'brandRole', 'coreMessage', 'creativePrinciple'];
const CLAIM_LIST_FIELDS = ['supportingMessages', 'contentPillars', 'kpis', 'experiments', 'risks', 'killCriteria'];

// Applies the consistency floor to a normalized campaign. Mutates the campaign
// and records every change in meta.labelAdjustments / meta.claimFlags.
export function applyClaimConsistency(campaign, sources = [], now = new Date()) {
  if (!campaign || typeof campaign !== 'object') return campaign;
  const adjustments = [];
  const flags = [];
  for (const field of CLAIM_FIELDS) reviewClaim(field, campaign[field], sources, now, adjustments, flags);
  for (const field of CLAIM_LIST_FIELDS) {
    (Array.isArray(campaign[field]) ? campaign[field] : []).forEach((item, index) => reviewClaim(`${field}[${index}]`, item, sources, now, adjustments, flags));
  }
  // Replace, never append: a fresh full-campaign check re-derives every flag
  // deterministically, so stale flags from a previous generation drop out and
  // re-running on an already-checked campaign cannot duplicate entries.
  campaign.meta = { ...(campaign.meta || {}) };
  delete campaign.meta.labelAdjustments;
  delete campaign.meta.claimFlags;
  delete campaign.meta.consistencyCheckedAt;
  if (adjustments.length) campaign.meta.labelAdjustments = adjustments;
  if (flags.length) campaign.meta.claimFlags = flags;
  if (adjustments.length || flags.length) campaign.meta.consistencyCheckedAt = now.toISOString();
  return campaign;
}
