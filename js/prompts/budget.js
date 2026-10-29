// Bounds the evidence serialized into AI prompts so each request stays within
// provider token budgets (for example a free tier's tokens-per-minute
// allowance). Only the serialized packet is trimmed: the full source list and
// intelligence stay stored and reviewable in the product, and sourceIds cited
// from outside the packet are still rejected by the existing validation passes.

export const PACKET_BUDGET = {
  maxSources: 10,
  maxSnippetChars: 250,
  maxTitleChars: 120,
  maxStatementChars: 220,
  maxItemsPerSection: 4,
  maxSignalItems: 12,
  maxSourceIdsPerItem: 6,
  maxExtraCitedSources: 4,
};

// Emergency profile used when a request still estimates over budget: roughly
// halves every allowance before the call is abandoned as safely unavailable.
export const TIGHT_PACKET_BUDGET = {
  maxSources: 5,
  maxSnippetChars: 150,
  maxTitleChars: 90,
  maxStatementChars: 140,
  maxItemsPerSection: 2,
  maxSignalItems: 6,
  maxSourceIdsPerItem: 4,
  maxExtraCitedSources: 2,
};

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value, maxChars) {
  const text = clean(value);
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function clipText(value, maxChars) {
  return clip(value, maxChars);
}

// Per-key minimum merge: an override profile can only tighten a base profile,
// never loosen it (used when retrying with the emergency profile).
export function tighterBudget(base = {}, override = {}) {
  const merged = { ...base };
  for (const key of Object.keys(override)) {
    if (Number.isFinite(override[key])) merged[key] = Math.min(Number(base[key] ?? override[key]), override[key]);
  }
  return merged;
}

function sourceStrength(source) {
  const quality = Number(source?.quality?.score ?? 0);
  const relevance = Number(source?.relevanceScore ?? 0.5);
  return quality + relevance;
}

export function rankSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .map((source, index) => ({ source, index }))
    .sort((a, b) => (sourceStrength(b.source) - sourceStrength(a.source)) || (a.index - b.index))
    .map((entry) => entry.source);
}

function slimSource(source, budget) {
  return {
    id: source.id,
    title: clip(source.title, budget.maxTitleChars) || 'Untitled source',
    domain: clean(source.domain),
    snippet: clip(source.snippet, budget.maxSnippetChars),
    publishedAt: source.publishedAt || null,
    sourceType: clean(source.sourceType) || 'unknown',
    freshness: source.freshness || 'unknown',
    quality: {
      score: Number(source?.quality?.score ?? 0),
      confidence: source?.quality?.confidence || 'low',
    },
  };
}

// Slim provider-facing source packet: ranked, count-capped, field-trimmed, and
// without the verbose quality reasons (kept in the product for reviewers).
export function boundSourcePacket(sources = [], overrides = {}) {
  const budget = { ...PACKET_BUDGET, ...overrides };
  return rankSources(sources).slice(0, budget.maxSources).map((source) => slimSource(source, budget));
}

// Like boundSourcePacket, but every source cited by the supplied items is kept
// alongside the ranked picks (up to maxExtraCitedSources extra), so a claim in
// the packet never points at evidence the model cannot see. Item sourceIds that
// still fall outside the packet are stripped; observed/inferred items left with
// no visible backing are dropped rather than presented as evidence-backed.
export function bindCitedPacket(sources = [], itemLists = [], overrides = {}) {
  const budget = { ...PACKET_BUDGET, ...overrides };
  const ranked = rankSources(sources);
  const packet = ranked.slice(0, budget.maxSources);
  const inPacket = new Set(packet.map((source) => source.id));
  const cited = [];
  const seen = new Set(inPacket);
  for (const items of itemLists) {
    for (const item of Array.isArray(items) ? items : []) {
      for (const id of Array.isArray(item?.sourceIds) ? item.sourceIds : []) {
        if (id && !seen.has(id)) { seen.add(id); cited.push(id); }
      }
    }
  }
  if (cited.length) {
    const byId = new Map(ranked.map((source) => [source.id, source]));
    for (const id of cited.slice(0, budget.maxExtraCitedSources)) {
      const source = byId.get(id);
      if (source) { packet.push(source); inPacket.add(id); }
    }
  }
  return {
    packet: packet.map((source) => slimSource(source, budget)),
    packetIds: inPacket,
  };
}

export function bindItemsToPacket(items = [], packetIds, maxItems, overrides = {}) {
  const budget = { ...PACKET_BUDGET, ...overrides };
  const limit = Number.isFinite(Number(maxItems)) ? Math.max(0, Math.floor(Number(maxItems))) : budget.maxItemsPerSection;
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const packet = boundItem(item, budget);
      packet.sourceIds = packet.sourceIds.filter((id) => !packetIds || packetIds.has(id));
      return { packet, original: item };
    })
    .filter(({ packet, original }) => {
      if (!packet.statement) return false;
      const needsBacking = ['observed', 'inferred'].includes(original?.evidenceType) && (Array.isArray(original?.sourceIds) && original.sourceIds.length > 0);
      return !needsBacking || packet.sourceIds.length > 0;
    })
    .slice(0, limit)
    .map(({ packet }) => packet);
}

export function boundItem(item, overrides = {}) {
  const budget = { ...PACKET_BUDGET, ...overrides };
  const packet = {
    statement: clip(item?.statement || item?.message || item?.summary || item?.title, budget.maxStatementChars),
    evidenceType: item?.evidenceType || 'unknown',
    confidence: item?.confidence || 'low',
    sourceIds: (Array.isArray(item?.sourceIds) ? item.sourceIds : []).slice(0, budget.maxSourceIdsPerItem),
  };
  if (item?.freshness) packet.freshness = item.freshness;
  return packet;
}

export function boundItemList(items = [], maxItems, overrides = {}) {
  const budget = { ...PACKET_BUDGET, ...overrides };
  const limit = Number.isFinite(Number(maxItems)) ? Math.max(0, Math.floor(Number(maxItems))) : budget.maxItemsPerSection;
  return (Array.isArray(items) ? items : [])
    .map((item) => boundItem(item, budget))
    .filter((item) => item.statement)
    .slice(0, limit);
}

// Generic bounding for free-form nested user content (brand voice, campaign
// overrides): clips long strings and caps arrays/objects so adversarial or
// accidental growth cannot blow up the serialized request.
export function boundValue(value, { maxChars = 220, maxItems = 8, maxKeys = 12, maxDepth = 4 } = {}, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return clip(value, maxChars);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= maxDepth) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, maxItems).map((entry) => boundValue(entry, { maxChars, maxItems, maxKeys, maxDepth }, depth + 1)).filter((entry) => entry !== undefined);
  }
  if (typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).slice(0, maxKeys)) {
      const bounded = boundValue(value[key], { maxChars, maxItems, maxKeys, maxDepth }, depth + 1);
      if (bounded !== undefined) output[key] = bounded;
    }
    return output;
  }
  return undefined;
}

export function boundStringList(values = [], { maxItems = 8, maxChars = 80 } = {}) {
  return (Array.isArray(values) ? values : []).map((value) => clip(value, maxChars)).filter(Boolean).slice(0, maxItems);
}
