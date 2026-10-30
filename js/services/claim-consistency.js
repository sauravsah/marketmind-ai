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
// Absolute risk/certainty language ("risk-free", "guaranteed results") asserts
// what market evidence cannot prove. Flag only - never demote, never rewrite -
// and only when the absolute phrase is the model's addition, absent from every
// cited excerpt, so a claim faithfully quoting a source's own wording stays
// untouched. Fixed list by design - a floor, not entailment.
const ABSOLUTE_PATTERN = /\b(risk[- ]free|(?:no|zero|without) risk|eliminates? (?:all |any )?(?:purchase )?risk|guaranteed (?:results?|outcomes?|conversions?|sales|returns?)|works? for everyone|always (?:converts?|works?|wins?)|never (?:fails?|loses?))\b/i;

// Offer-geography floor: a claim that cites sources for offer language ("10%
// discount", "free exchange") presents the offer as evidenced. When none of the
// cited sources that mention an offer place it in the strategy's target market,
// the market fit of that premise is unverified - flag only, never demote or
// rewrite. A source explicitly describing a global offer suppresses the flag.
const OFFER_PATTERN = /\b\d{1,2}\s?%\s*(?:off|discount)\b|\bdiscounts?\b|\bpromo(?:tion|tional|tions)?\b|\bcoupons?\b|\bvouchers?\b|\bfree (?:shipping|delivery|returns?|exchanges?|trials?)\b|\boffer\b|\bdeals?\b/i;
const GLOBAL_MARKET_PATTERN = /\b(global(?:ly)?|worldwide|international(?:ly)?|all (?:markets|countries|regions))\b/i;
// "Worldwide" wording does not clear the check when the same excerpts carry
// expiry, eligibility, or regional-restriction signals.
// Offer aspects checked individually: coverage of one aspect in the target
// market does not substantiate another aspect of the same claim. The generic
// "offer or deal" facet is covered by any market offer source.
const OFFER_FACETS = [
  ['price reduction', /\b\d{1,2}\s?%\s*(?:off|discount)\b|\bdiscounts?\b|\bsave\s?\d{1,2}\s?%|\bsavings\b|\bcoupons?\b|\bvouchers?\b|\bpromo(?:tion|tional|tions)?\b/i],
  ['free shipping or delivery', /\bfree (?:shipping|delivery)\b/i],
  ['free returns or exchanges', /\bfree (?:returns?|exchanges?)\b/i],
  ['free trial', /\bfree trials?\b/i],
  ['offer or deal', /\boffer\b|\bdeals?\b/i],
];

const OFFER_RESTRICTION_PATTERN = /\b(excludes?|except|not (?:available|valid|eligible) in|only (?:available|valid|eligible) in|limited to|selected (?:countries|markets|regions|cities)|participating (?:countries|markets|stores|locations)|eligibility (?:varies|depends)|terms (?:and conditions )?apply|expires?|expiry|valid (?:till|until|through)|ends? on|limited[- ]time)\b/i;
// An offer framed as existing fact (definite/possessive/explicitly existing) is
// a checkable premise; an indefinite proposal ("test a 10% discount") is not.
const EXISTING_OFFER_PATTERN = /\b(?:existing|current(?:ly)?|ongoing|already)\b[^.]{0,60}?\b(?:discount|offer|guarantee|trial|deal|promo(?:tion)?)\b|\b(?:the|its|their|our)\s+(?:[\w%+()-]+\s+){0,3}(?:discount|guarantee|trial|deal|promo(?:tion)?)\b/i;
// A claim that already hedges the offer's market fit ("may not apply to the
// India storefront") states the uncertainty itself - never flag it.
const UNCERTAIN_OFFER_PATTERN = /\b(?:may|might|could)\s+not\s+(?:apply|be\s+(?:available|eligible|valid|redeemable))\b|\bnot\s+(?:yet\s+)?(?:verified|confirmed|available|eligible)\s+(?:for|in)\b/i;
const MARKET_TERMS = [
  { id: 'india', terms: ['india', 'indian'] },
  { id: 'united states', terms: ['united states', 'usa', 'u.s.', 'america', 'american'] },
  { id: 'united kingdom', terms: ['united kingdom', 'uk', 'britain', 'british', 'england'] },
  { id: 'australia', terms: ['australia', 'australian'] },
  { id: 'germany', terms: ['germany', 'german'] },
  { id: 'france', terms: ['france', 'french'] },
  { id: 'japan', terms: ['japan', 'japanese'] },
  { id: 'mexico', terms: ['mexico', 'mexican'] },
  { id: 'philippines', terms: ['philippines', 'philippine', 'filipino'] },
  { id: 'canada', terms: ['canada', 'canadian'] },
  { id: 'brazil', terms: ['brazil', 'brazilian'] },
  { id: 'singapore', terms: ['singapore', 'singaporean'] },
  { id: 'new zealand', terms: ['new zealand'] },
  { id: 'south africa', terms: ['south africa', 'south african'] },
  { id: 'uae', terms: ['uae', 'united arab emirates', 'dubai'] },
];
const REGION_TO_MARKET = { in: 'india', us: 'united states', gb: 'united kingdom', uk: 'united kingdom', au: 'australia', de: 'germany', fr: 'france', jp: 'japan', mx: 'mexico', ph: 'philippines', ca: 'canada', br: 'brazil', sg: 'singapore', nz: 'new zealand', za: 'south africa', ae: 'uae' };

function marketIdOf(text) {
  const lower = String(text || '').toLowerCase();
  const hit = MARKET_TERMS.find(({ terms }) => terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)));
  return hit ? MARKET_TERMS.indexOf(hit) : -1;
}

// Region marker from a source URL: a country-code path segment (nike.com/au/...)
// or ccTLD (nike.in). Absence of a marker proves nothing - nike.com/help is a
// global default - so only a positive marker for a DIFFERENT market counts.
function sourceRegionMarket(url) {
  try {
    const parsed = new URL(url);
    const tld = parsed.hostname.split('.').pop().toLowerCase();
    if (REGION_TO_MARKET[tld]) return REGION_TO_MARKET[tld];
    const segment = (parsed.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    if (REGION_TO_MARKET[segment]) return REGION_TO_MARKET[segment];
  } catch { /* unparseable URLs carry no region signal */ }
  return null;
}

function sourceMentionsMarket(source, marketIndex) {
  if (marketIndex < 0) return false;
  const market = MARKET_TERMS[marketIndex];
  if (sourceRegionMarket(source?.url) === market.id) return true;
  const text = normalizeForMatch(`${source?.title || ''} ${source?.snippet || ''}`).toLowerCase();
  return market.terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
}
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

const DASH_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
const SPACE_VARIANTS = /[\u00A0\u2007\u2009\u202F]/g;

// Matching-only normalization: Unicode dash/space variants become their ASCII
// equivalents so token checks see the words claims and sources actually use.
// Never written back - stored claim text and source excerpts stay untouched.
function normalizeForMatch(value) {
  return String(value || '').replace(DASH_VARIANTS, '-').replace(SPACE_VARIANTS, ' ');
}

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
function reviewClaim(field, claim, sources, now, adjustments, flags, context = {}) {
  if (!claim || typeof claim !== 'object' || !claim.statement) return;
  const statement = normalizeForMatch(claim.statement);
  const excerpts = normalizeForMatch(excerptText(sources, claim.sourceIds));
  if (claim.evidenceType === 'observed') {
    const hedge = statement.match(HEDGE_PATTERN);
    // An observed claim may faithfully report a source's own uncertainty; only
    // demote when the hedged word is the model's addition, absent from excerpts.
    if (hedge && !excerpts.toLowerCase().includes(hedge[0].toLowerCase())) {
      adjustments.push({ field, from: 'observed', to: 'inferred', reason: 'hedged-language', detail: hedge[0].toLowerCase() });
      claim.evidenceType = 'inferred';
    }
    const missing = claim.evidenceType === 'observed' ? missingQualifiers(statement, excerpts) : [];
    if (missing.length) {
      adjustments.push({ field, from: 'observed', to: 'inferred', reason: 'qualifier-not-in-sources', detail: missing.join(', ') });
      claim.evidenceType = 'inferred';
    }
  }
  if (UPCOMING_PATTERN.test(statement)) {
    // Flag only when the dated material is unambiguously in the past: an old
    // source can legitimately announce a future event, so any future date in
    // the same claim or its excerpts suppresses the flag. Source publication
    // dates are never used - a past publication date is not a past event date.
    const combined = `${statement} ${excerpts}`;
    const dated = futureDatesIn(combined, now) ? [] : [...new Set([...pastDatesIn(statement, now), ...pastDatesIn(excerpts, now)])];
    if (dated.length) {
      flags.push({ field, reason: 'past-date-framed-as-upcoming', detail: dated.join(', '), datedMaterial: dated.join(', '), checkedAt: now.toISOString() });
      if (claim.confidence !== 'low') {
        adjustments.push({ field, from: claim.confidence, to: 'low', reason: 'past-date-framed-as-upcoming' });
        claim.confidence = 'low';
      }
    }
  }
  // Applies to every evidence type: an absolute is unsupported at any label.
  const absolute = statement.match(ABSOLUTE_PATTERN);
  if (absolute && !excerpts.toLowerCase().includes(absolute[0].toLowerCase())) {
    flags.push({ field, reason: 'absolute-language', detail: absolute[0].toLowerCase(), checkedAt: now.toISOString() });
  }
  const marketIndex = marketIdOf(context.market);
  const market = marketIndex >= 0 ? MARKET_TERMS[marketIndex] : null;
  const marketLabel = market ? market.id.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  const cited = (sources || []).filter((source) => (claim.sourceIds || []).includes(source?.id));
  if (market && cited.length) {
    // A positive region marker for a different market is a mismatch; an
    // unmarked URL is a global default and stays silent.
    const mismatched = cited.filter((source) => { const region = sourceRegionMarket(source?.url); return region && region !== market.id; });
    if (mismatched.length) {
      const detail = mismatched.map((source) => `${source.url} is specific to ${sourceRegionMarket(source.url)}, not ${marketLabel}`).join('; ');
      flags.push({ field, reason: 'source-region-mismatch', detail, checkedAt: now.toISOString() });
    }
  }
  // Offer guards skip directive fields (KPIs, experiments, risks, kill
  // criteria): those instruct or measure, they do not assert a premise.
  const directive = /^(kpis|experiments|risks|killCriteria)\[/.test(field);
  const normalizedStatement = normalizeForMatch(statement);
  if (!directive && OFFER_PATTERN.test(normalizedStatement) && !UNCERTAIN_OFFER_PATTERN.test(normalizedStatement)) {
    const offerSources = cited.filter((source) => OFFER_PATTERN.test(normalizeForMatch(`${source?.title || ''} ${source?.snippet || ''}`)));
    const globallyCovered = GLOBAL_MARKET_PATTERN.test(excerpts) && !OFFER_RESTRICTION_PATTERN.test(excerpts);
    if (!offerSources.length) {
      // An existing-offer premise with no offer evidence behind it - including
      // the zero-citation case. Indefinite proposals stay silent.
      if (EXISTING_OFFER_PATTERN.test(normalizedStatement) && !globallyCovered) {
        flags.push({ field, reason: 'offer-premise-unsourced', detail: market ? `existing offer asserted without a cited source; not verified for ${marketLabel}` : 'existing offer asserted without a cited source', checkedAt: now.toISOString() });
      }
    } else if (market && !globallyCovered) {
      // Coverage is checked per offer aspect: a source that places one aspect
      // (free exchanges) in the market does not substantiate another aspect of
      // the same claim (a discount) - co-citation cannot launder foreign offers.
      const marketSources = offerSources.filter((source) => sourceMentionsMarket(source, marketIndex));
      if (!marketSources.length) {
        flags.push({ field, reason: 'offer-market-unverified', detail: `offer not verified for ${marketLabel}`, checkedAt: now.toISOString() });
      } else {
        const uncovered = OFFER_FACETS
          .filter(([name, pattern]) => name !== 'offer or deal' && pattern.test(normalizedStatement))
          .filter(([, pattern]) => !marketSources.some((source) => pattern.test(normalizeForMatch(`${source?.title || ''} ${source?.snippet || ''}`))))
          .map(([name]) => name);
        if (uncovered.length) {
          flags.push({ field, reason: 'offer-market-unverified', detail: `no cited source places the ${uncovered.join(' or ')} in ${marketLabel}`, checkedAt: now.toISOString() });
        }
      }
    }
  }
}

const CLAIM_FIELDS = ['strategicProblem', 'audienceInsight', 'campaignThesis', 'currentPerception', 'desiredPerception', 'brandRole', 'coreMessage', 'creativePrinciple'];
const CLAIM_LIST_FIELDS = ['supportingMessages', 'contentPillars', 'kpis', 'experiments', 'risks', 'killCriteria'];
const AUDIENCE_LIST_FIELDS = ['segments', 'observedBehaviors', 'motivations', 'pains', 'desires', 'tensions', 'barriers', 'objections', 'triggers', 'identityDrivers', 'contentBehaviors', 'decisionFactors', 'momentsThatMatter', 'hypotheses', 'uncertainties'];

// Shared core: reviews the given claim fields and records every change in
// meta.labelAdjustments / meta.claimFlags. Replace, never append: a fresh full
// check re-derives every flag deterministically, so stale flags from a previous
// generation drop out and re-running cannot duplicate entries.
function applyConsistencyFloor(target, sources, now, context, { claims = [], lists = [] }) {
  if (!target || typeof target !== 'object') return target;
  const adjustments = [];
  const flags = [];
  for (const field of claims) reviewClaim(field, target[field], sources, now, adjustments, flags, context);
  for (const field of lists) {
    (Array.isArray(target[field]) ? target[field] : []).forEach((item, index) => reviewClaim(`${field}[${index}]`, item, sources, now, adjustments, flags, context));
  }
  target.meta = { ...(target.meta || {}) };
  delete target.meta.labelAdjustments;
  delete target.meta.claimFlags;
  delete target.meta.consistencyCheckedAt;
  if (adjustments.length) target.meta.labelAdjustments = adjustments;
  if (flags.length) target.meta.claimFlags = flags;
  if (adjustments.length || flags.length) target.meta.consistencyCheckedAt = now.toISOString();
  return target;
}

// Applies the consistency floor to a normalized campaign.
export function applyClaimConsistency(campaign, sources = [], now = new Date(), context = {}) {
  return applyConsistencyFloor(campaign, sources, now, context, { claims: CLAIM_FIELDS, lists: CLAIM_LIST_FIELDS });
}

// Applies the same floor to a normalized audience profile. Audience items are
// already evidence-normalized (uncertainties state unknowns, observed items
// carry citations); the floor adds the deterministic review flags on top and
// never rewrites claim text.
export function applyAudienceClaimConsistency(profile, sources = [], now = new Date(), context = {}) {
  return applyConsistencyFloor(profile, sources, now, context, { lists: AUDIENCE_LIST_FIELDS });
}
