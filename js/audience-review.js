export const AUDIENCE_ITEM_KEYS = [
  'segments',
  'observedBehaviors',
  'motivations',
  'pains',
  'desires',
  'tensions',
  'barriers',
  'objections',
  'triggers',
  'identityDrivers',
  'contentBehaviors',
  'decisionFactors',
  'momentsThatMatter',
  'hypotheses',
  'uncertainties',
];

export const AUDIENCE_REVIEW_STATUSES = ['pending', 'approved', 'edited', 'rejected', 'needs-validation'];
const REVIEWED_STATUSES = new Set(['approved', 'edited', 'rejected', 'needs-validation']);
const RADAR_STATUSES = new Set(['approved', 'edited']);
const MAX_REVIEW_ARCHIVE = 50;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function hash(value) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return Math.abs(result).toString(36);
}

function reviewText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function validStatus(value) {
  return AUDIENCE_REVIEW_STATUSES.includes(value) ? value : 'pending';
}

function validEvidenceType(value) {
  return ['observed', 'inferred', 'hypothesis', 'unknown'].includes(value) ? value : 'unknown';
}

function nowIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value || Date.now()).toISOString();
}

export function createAudienceReviewKey(category, statement) {
  return `audience-review-${hash(`${clean(category)}|${reviewText(statement)}`)}`;
}

export function createAudienceClaimId(category, statement, providedId = '') {
  const safeProvidedId = clean(providedId);
  if (/^audience-claim-[a-z0-9-]{4,100}$/i.test(safeProvidedId)) return safeProvidedId;
  return `audience-claim-${hash(`${clean(category)}|${reviewText(statement)}`)}`;
}

export function ensureAudienceClaimMetadata(item, category = '') {
  const sourceIds = unique(item?.sourceIds);
  const generatedStatement = clean(item?.generatedStatement || item?.statement || item?.title || item?.summary || item?.text);
  const statement = clean(item?.statement || generatedStatement);
  const originalSourceIds = unique(item?.originalSourceIds?.length ? item.originalSourceIds : sourceIds);
  const originalEvidenceType = validEvidenceType(item?.originalEvidenceType || item?.evidenceType);
  return {
    ...(item || {}),
    id: createAudienceClaimId(category, generatedStatement || statement, item?.id),
    reviewKey: clean(item?.reviewKey) || createAudienceReviewKey(category, generatedStatement || statement),
    statement,
    generatedStatement,
    reviewStatus: validStatus(item?.reviewStatus),
    reviewedAt: item?.reviewedAt ? nowIso(item.reviewedAt) : null,
    reviewNote: clean(item?.reviewNote),
    originalSourceIds,
    originalEvidenceType,
  };
}

export function getAudienceClaims(profile) {
  return AUDIENCE_ITEM_KEYS.flatMap((category) => (Array.isArray(profile?.[category]) ? profile[category] : []).map((item) => ({
    category,
    item: ensureAudienceClaimMetadata(item, category),
  })));
}

export function ensureAudienceReviewProfile(profile) {
  const output = JSON.parse(JSON.stringify(profile || {}));
  for (const category of AUDIENCE_ITEM_KEYS) output[category] = getAudienceClaims(profile).filter((entry) => entry.category === category).map((entry) => entry.item);
  output.reviewArchive = (Array.isArray(profile?.reviewArchive) ? profile.reviewArchive : []).map((item) => ensureAudienceClaimMetadata(item, item?.category || 'archive'));
  const summary = getAudienceReviewSummary(output);
  output.evidenceCoverage = { ...(output.evidenceCoverage || {}), reviewedCount: summary.reviewedCount, reviewCoveragePercent: summary.reviewCoveragePercent, radarReadyCount: summary.radarReadyCount };
  return output;
}

export function getAudienceReviewSummary(profile) {
  const claims = getAudienceClaims(profile);
  const counts = Object.fromEntries(AUDIENCE_REVIEW_STATUSES.map((status) => [status, 0]));
  claims.forEach(({ item }) => { counts[validStatus(item.reviewStatus)] += 1; });
  const reviewedCount = claims.length - counts.pending;
  const sourceBackedCount = claims.filter(({ item }) => ['observed', 'inferred'].includes(validEvidenceType(item.evidenceType)) && item.sourceIds.length).length;
  const radarReadyCount = claims.filter(({ item }) => RADAR_STATUSES.has(validStatus(item.reviewStatus)) && ['observed', 'inferred'].includes(validEvidenceType(item.evidenceType)) && item.sourceIds.length).length;
  return {
    total: claims.length,
    ...counts,
    reviewedCount,
    sourceBackedCount,
    radarReadyCount,
    reviewCoveragePercent: claims.length ? Math.round((reviewedCount / claims.length) * 100) : 0,
  };
}

export function getRadarEligibleAudienceItems(profile, research) {
  const currentResearchVersion = clean(research?.meta?.researchedAt);
  if (!currentResearchVersion || clean(profile?.researchVersion) !== currentResearchVersion) return [];
  const knownSourceIds = new Set((Array.isArray(research?.sources) ? research.sources : []).filter((source) => clean(source?.id) && clean(source?.url)).map((source) => clean(source.id)));
  return getAudienceClaims(profile).map(({ item }) => item).filter((item) => (
    RADAR_STATUSES.has(validStatus(item.reviewStatus))
    && ['observed', 'inferred'].includes(validEvidenceType(item.evidenceType))
    && item.sourceIds.length > 0
    && item.sourceIds.every((sourceId) => knownSourceIds.has(sourceId))
  ));
}

function reviewMap(profile) {
  return new Map(getAudienceClaims(profile).map(({ item }) => [item.reviewKey, item]));
}

function reviewed(item) {
  return REVIEWED_STATUSES.has(validStatus(item?.reviewStatus));
}

export function mergeAudienceReviewState(previousProfile, nextProfile, { now = new Date(), maxArchive = MAX_REVIEW_ARCHIVE } = {}) {
  const previous = ensureAudienceReviewProfile(previousProfile);
  const next = ensureAudienceReviewProfile(nextProfile);
  const previousByKey = reviewMap(previous);
  const previousKeys = new Set();
  for (const category of AUDIENCE_ITEM_KEYS) {
    next[category] = next[category].map((item) => {
      const prior = previousByKey.get(item.reviewKey) || getAudienceClaims(previous).find(({ item: candidate }) => candidate.id === item.id)?.item;
      if (!prior || !reviewed(prior)) return item;
      previousKeys.add(prior.reviewKey);
      const carried = {
        ...item,
        reviewStatus: prior.reviewStatus,
        reviewedAt: prior.reviewedAt,
        reviewNote: prior.reviewNote,
        generatedStatement: prior.generatedStatement || item.generatedStatement,
        originalSourceIds: unique(prior.originalSourceIds),
        originalEvidenceType: prior.originalEvidenceType || item.originalEvidenceType,
      };
      if (prior.reviewStatus === 'edited' || prior.reviewStatus === 'needs-validation') carried.statement = prior.statement;
      if (prior.reviewStatus === 'edited' || prior.reviewStatus === 'approved') carried.sourceIds = unique(prior.sourceIds);
      if (['approved', 'edited'].includes(carried.reviewStatus) && (!carried.sourceIds.length || !['observed', 'inferred'].includes(validEvidenceType(carried.evidenceType)))) {
        carried.reviewStatus = 'needs-validation';
        carried.evidenceType = 'hypothesis';
        carried.confidence = 'low';
        carried.sourceIds = [];
      }
      return carried;
    });
  }

  const retained = [];
  for (const { category, item } of getAudienceClaims(previous)) {
    if (!reviewed(item) || previousKeys.has(item.reviewKey) || getAudienceClaims(next).some(({ item: candidate }) => candidate.reviewKey === item.reviewKey)) continue;
    retained.push({ ...item, category, archivedAt: nowIso(now), archiveReason: 'No matching claim in the regenerated audience model.' });
  }
  const existingArchive = Array.isArray(previous.reviewArchive) ? previous.reviewArchive : [];
  const nextArchive = Array.isArray(next.reviewArchive) ? next.reviewArchive : [];
  const archive = [...existingArchive, ...nextArchive, ...retained].filter((item, index, values) => {
    const key = clean(item.reviewKey) || clean(item.id);
    return key && values.findIndex((candidate) => (clean(candidate.reviewKey) || clean(candidate.id)) === key) === index;
  }).slice(-Math.max(1, Number(maxArchive) || MAX_REVIEW_ARCHIVE));
  return ensureAudienceReviewProfile({ ...next, reviewArchive: archive });
}

function updateClaim(profile, claimId, updater) {
  const output = ensureAudienceReviewProfile(profile);
  let found = false;
  for (const category of AUDIENCE_ITEM_KEYS) {
    output[category] = output[category].map((item) => {
      if (item.id !== claimId) return item;
      found = true;
      return ensureAudienceClaimMetadata(updater(item), category);
    });
  }
  if (!found) throw new Error('Audience claim could not be found.');
  return ensureAudienceReviewProfile(output);
}

export function applyAudienceClaimReview(profile, claimId, action, payload = {}) {
  const timestamp = nowIso(payload.now);
  if (action === 'approve') return updateClaim(profile, claimId, (item) => {
    if (!item.sourceIds.length || !['observed', 'inferred'].includes(item.evidenceType)) throw new Error('Only source-backed observed or inferred claims can be approved.');
    return { ...item, reviewStatus: 'approved', reviewedAt: timestamp, reviewNote: clean(payload.reviewNote) };
  });
  if (action === 'reject') return updateClaim(profile, claimId, (item) => ({ ...item, reviewStatus: 'rejected', reviewedAt: timestamp, reviewNote: clean(payload.reviewNote || 'Rejected during audience review.') }));
  if (action === 'needs-validation') return updateClaim(profile, claimId, (item) => ({ ...item, reviewStatus: 'needs-validation', reviewedAt: timestamp, reviewNote: clean(payload.reviewNote || 'Needs validation before it can influence Opportunity Radar.') }));
  if (action === 'edit') return updateClaim(profile, claimId, (item) => {
    const statement = clean(payload.statement);
    if (!statement) throw new Error('Edited audience claims need a statement.');
    return {
      ...item,
      statement,
      generatedStatement: item.generatedStatement || item.statement,
      originalSourceIds: unique(item.originalSourceIds.length ? item.originalSourceIds : item.sourceIds),
      originalEvidenceType: item.originalEvidenceType || item.evidenceType,
      sourceIds: [],
      evidenceType: 'hypothesis',
      confidence: 'low',
      reviewStatus: 'needs-validation',
      reviewedAt: timestamp,
      reviewNote: clean(payload.reviewNote || 'Edited claim requires explicit source revalidation.'),
      validationMethod: clean(payload.validationMethod || item.validationMethod || 'Review the supporting source excerpts before using this claim.'),
    };
  });
  if (action === 'validate') return updateClaim(profile, claimId, (item) => {
    const allowed = new Set(unique(payload.allowedSourceIds));
    const sourceIds = unique(payload.sourceIds).filter((sourceId) => allowed.has(sourceId));
    if (!sourceIds.length) throw new Error('Select at least one current research source before validating this claim.');
    const evidenceType = ['observed', 'inferred'].includes(payload.evidenceType) ? payload.evidenceType : item.originalEvidenceType;
    if (!['observed', 'inferred'].includes(evidenceType)) throw new Error('A validated claim needs observed or inferred evidence type.');
    return {
      ...item,
      sourceIds,
      originalSourceIds: sourceIds,
      evidenceType,
      confidence: ['low', 'medium', 'high'].includes(payload.confidence) ? payload.confidence : 'medium',
      reviewStatus: item.statement === item.generatedStatement ? 'approved' : 'edited',
      reviewedAt: timestamp,
      reviewNote: clean(payload.reviewNote || 'Source mapping explicitly revalidated.'),
    };
  });
  throw new Error(`Unsupported audience review action: ${action}`);
}
