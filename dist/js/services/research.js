import { synthesizeResearch } from './ai.js';
import { createEmptyResearch } from '../models.js';

const DEPTH_LIMITS = {
  quick: { maxQueries: 7, maxResultsPerQuery: 5 },
  balanced: { maxQueries: 11, maxResultsPerQuery: 7 },
  deep: { maxQueries: 15, maxResultsPerQuery: 8 },
};

const KNOWN_HIGH_AUTHORITY = new Set(['who.int', 'worldbank.org', 'mckinsey.com', 'nielsen.com', 'statista.com', 'reuters.com', 'bbc.com', 'theguardian.com']);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compactQuery(parts) {
  return unique(parts.map(clean)).join(' ').replace(/\s+/g, ' ').trim();
}

function baseContext(context) {
  const strategy = context?.strategy || {};
  const brand = context?.brand || {};
  return {
    brand: clean(brand.name),
    category: clean(brand.industry) || clean(brand.description).split(/[,.]/)[0] || 'the category',
    idea: clean(strategy.idea),
    audience: clean(strategy.audience) || clean(brand.audience) || 'consumers',
    market: clean(strategy.market) || 'the target market',
    competitors: Array.isArray(strategy.competitors) ? strategy.competitors.map(clean).filter(Boolean) : [],
  };
}

export function buildResearchQueries(context, depth = 'balanced') {
  const input = baseContext(context);
  const safeDepth = DEPTH_LIMITS[depth] ? depth : 'balanced';
  const queries = [];
  const add = (angle, sourceType, parts, recency = false) => {
    const query = compactQuery([...parts, recency ? 'latest' : '']);
    if (query) queries.push({ id: `query-${queries.length + 1}`, angle, sourceType, query });
  };

  add('Category trends', 'industry', [input.category, 'trends', input.market]);
  add('Category participation', 'industry', [input.category, 'participation', input.market]);
  add('Current developments', 'news', [input.category, input.market, 'recent developments'], true);
  add('Audience signals', 'audience', [input.audience, input.category, 'behavior', input.market]);
  add('Audience conversation', 'audience', [input.audience, input.category, 'conversation', input.market]);
  add('Cultural signals', 'culture', [input.category, 'culture', 'communities', input.market]);
  add('Relevant events', 'events', [input.category, 'events', input.market], true);
  add('Technology signals', 'technology', [input.category, 'technology', 'innovation', input.market]);
  for (const competitor of input.competitors) add('Competitor signals', 'competitor', [competitor, input.category, input.market], true);
  add('Idea context', 'industry', [input.idea, input.market]);

  const limit = DEPTH_LIMITS[safeDepth].maxQueries;
  return queries.slice(0, limit).map((item) => ({ ...item, market: input.market, maxResults: DEPTH_LIMITS[safeDepth].maxResultsPerQuery }));
}

export function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function domainFromUrl(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function parsePublishedAt(value) {
  const raw = clean(value);
  if (!raw || !/\b20\d{2}\b/.test(raw)) return null;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function classifyFreshness(publishedAt, now = new Date()) {
  if (!publishedAt) return 'unknown';
  const days = Math.max(0, (now.getTime() - new Date(publishedAt).getTime()) / 86400000);
  if (days <= 30) return 'very-recent';
  if (days <= 180) return 'recent';
  return 'older';
}

function hash(value) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return Math.abs(result).toString(36);
}

function tokenSet(value) {
  return new Set(clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((token) => token.length > 2));
}

function titleSimilarity(first, second) {
  const a = tokenSet(first); const b = tokenSet(second);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function sourceAuthority(domain) {
  if (!domain) return 0.25;
  if (KNOWN_HIGH_AUTHORITY.has(domain)) return 0.92;
  if (/\.(gov|gov\.in|ac\.in|edu|edu\.in)$/.test(domain)) return 0.95;
  if (/\.(org|co\.uk)$/.test(domain)) return 0.68;
  return 0.48;
}

export function evaluateSourceQuality(source) {
  const authority = sourceAuthority(source.domain);
  const relevance = Math.max(0, Math.min(1, Number(source.relevanceScore ?? 0.5)));
  const specificity = source.snippet ? Math.min(1, 0.4 + source.snippet.length / 500) : 0.35;
  const score = Number((authority * 0.4 + relevance * 0.4 + specificity * 0.2).toFixed(2));
  const authorityLevel = authority >= 0.75 ? 'strong' : authority >= 0.5 ? 'moderate' : 'limited';
  const relevanceLevel = relevance >= 0.75 ? 'strong' : relevance >= 0.5 ? 'moderate' : 'limited';
  const specificityLevel = specificity >= 0.75 ? 'strong' : specificity >= 0.5 ? 'moderate' : 'limited';
  return {
    score,
    authority: Number(authority.toFixed(2)),
    confidence: score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low',
    reasons: [
      { key: 'authority', label: 'Publisher signal', level: authorityLevel, detail: source.domain ? (authorityLevel === 'strong' ? 'The domain has a strong built-in authority signal.' : authorityLevel === 'moderate' ? 'The domain has a moderate built-in authority signal.' : 'The domain has a limited built-in authority signal.') : 'No publisher domain was available.' },
      { key: 'relevance', label: 'Query relevance', level: relevanceLevel, detail: relevanceLevel === 'strong' ? 'The provider marked this result as strongly relevant.' : relevanceLevel === 'moderate' ? 'The provider marked this result as moderately relevant.' : 'The provider marked this result as having limited relevance.' },
      { key: 'specificity', label: 'Excerpt detail', level: specificityLevel, detail: specificityLevel === 'strong' ? 'The supplied excerpt contains useful context to review.' : specificityLevel === 'moderate' ? 'The supplied excerpt contains some context, but should be checked.' : 'The supplied excerpt is thin or missing.' },
    ],
  };
}

export function normalizeSearchResult(raw, query, retrievedAt = new Date().toISOString()) {
  const url = normalizeUrl(raw?.url || raw?.link);
  if (!url) return null;
  const publishedAt = parsePublishedAt(raw?.publishedAt || raw?.published || raw?.date);
  const source = {
    id: `source-${hash(url)}`,
    title: clean(raw?.title) || 'Untitled source',
    url,
    domain: domainFromUrl(url),
    snippet: clean(raw?.snippet || raw?.description || raw?.content),
    publishedAt,
    retrievedAt,
    sourceType: clean(raw?.sourceType || query?.sourceType) || 'unknown',
    query: clean(raw?.query || query?.query),
    relevanceScore: Number(raw?.relevanceScore ?? raw?.score ?? 0.5),
    excerptType: 'provider-excerpt',
  };
  source.freshness = classifyFreshness(source.publishedAt, new Date(retrievedAt));
  source.quality = evaluateSourceQuality(source);
  return source;
}

export function deduplicateSources(sources) {
  const kept = [];
  for (const source of sources.filter(Boolean)) {
    const duplicateIndex = kept.findIndex((existing) => existing.url === source.url || (existing.domain === source.domain && titleSimilarity(existing.title, source.title) >= 0.72));
    if (duplicateIndex < 0) { kept.push(source); continue; }
    const existing = kept[duplicateIndex];
    const existingStrength = existing.quality.score + existing.relevanceScore;
    const newStrength = source.quality.score + source.relevanceScore;
    if (newStrength > existingStrength) kept[duplicateIndex] = source;
  }
  return kept;
}

function emptyWithWarning(message, depth, providerStatus = 'failed', queryCount = 0) {
  const output = createEmptyResearch();
  output.meta = { ...output.meta, depth, queryCount, providerStatus, warnings: [message] };
  return output;
}

function allSignals(research) {
  return ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'].flatMap((key) => research[key] || []);
}

function cleanSignal(raw, sourcesById) {
  if (!raw || typeof raw !== 'object') return null;
  const sourceIds = unique(Array.isArray(raw.sourceIds) ? raw.sourceIds : []).filter((id) => sourcesById.has(id));
  if (!sourceIds.length) return null;
  return {
    title: clean(raw.title) || 'Untitled signal',
    summary: clean(raw.summary) || 'Insufficient evidence for a concise summary.',
    type: clean(raw.type) || 'industry',
    importance: ['low', 'medium', 'high'].includes(raw.importance) ? raw.importance : 'medium',
    freshness: ['very-recent', 'recent', 'older', 'unknown'].includes(raw.freshness) ? raw.freshness : 'unknown',
    confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'low',
    interpretation: clean(raw.interpretation),
    sourceIds,
  };
}

function cleanGroupedItems(items, sourcesById, fallbackKeys = ['title', 'summary', 'interpretation']) {
  return (Array.isArray(items) ? items : []).map((item) => cleanSignal(item, sourcesById)).filter(Boolean).map((item) => {
    for (const key of fallbackKeys) if (!item[key]) item[key] = '';
    return item;
  });
}

export function validateResearchOutput(candidate, sources) {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const keys = ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'];
  const output = createEmptyResearch();
  output.researchSummary = clean(candidate?.researchSummary);
  for (const key of keys) output[key] = cleanGroupedItems(candidate?.[key], sourcesById);
  output.emergingThemes = cleanGroupedItems(candidate?.emergingThemes, sourcesById).map((item) => ({ title: item.title, summary: item.summary, confidence: item.confidence, sourceIds: item.sourceIds }));
  output.contradictions = cleanGroupedItems(candidate?.contradictions, sourcesById).map((item) => ({ title: item.title, summary: item.summary, confidence: item.confidence, sourceIds: item.sourceIds }));
  output.sources = sources;
  return output;
}

function sourceOnlyOutput(sources, depth, queryCount, providerStatus, aiStatus, warnings = [], failures = []) {
  const output = createEmptyResearch();
  output.sources = sources;
  output.meta = {
    ...output.meta,
    researchedAt: new Date().toISOString(),
    depth,
    queryCount,
    sourcesReviewed: sources.length,
    sourcesUsed: 0,
    providerStatus,
    aiStatus,
    warnings,
    failures,
  };
  return output;
}

export async function researchMarket(context, configs = {}, options = {}) {
  const depth = context?.strategy?.researchDepth || 'balanced';
  const onStage = options.onStage || (() => {});
  onStage({ id: 'understanding', label: 'Understanding strategy' });
  const queries = buildResearchQueries(context, depth);
  onStage({ id: 'queries', label: 'Building research queries', queryCount: queries.length });
  if (!configs.search?.apiKey) return emptyWithWarning('Live market research is temporarily unavailable. Try again shortly.', depth, 'not-configured', queries.length);

  let provider;
  try {
    provider = createSearchProvider(configs.search, options);
  } catch {
    return emptyWithWarning('Live market research is temporarily unavailable. Try again shortly.', depth, 'failed', queries.length);
  }

  onStage({ id: 'searching', label: 'Searching the market', queryCount: queries.length });
  const searchResult = await searchMany(provider, queries, options);
  onStage({ id: 'evaluating', label: 'Evaluating sources', reviewed: searchResult.results.length });
  const retrievedAt = new Date().toISOString();
  const normalized = searchResult.results.map(({ raw, query }) => normalizeSearchResult(raw, query, retrievedAt)).filter(Boolean);
  const sources = deduplicateSources(normalized);
  if (!sources.length) return sourceOnlyOutput([], depth, queries.length, searchResult.failures.length ? 'failed' : 'verified', 'not-configured', [searchResult.failures.length ? 'Search was unavailable for every query.' : 'No search results matched this strategy context.'], searchResult.failures);

  onStage({ id: 'synthesizing', label: 'Synthesizing findings', sources: sources.length });
  const synthesis = await synthesizeResearch(context, sources, configs.ai, options);
  if (!synthesis.candidate) return sourceOnlyOutput(sources, depth, queries.length, 'verified', synthesis.status, [synthesis.warning].filter(Boolean), searchResult.failures);

  const output = validateResearchOutput(synthesis.candidate, sources);
  const usedSourceIds = new Set(allSignals(output).flatMap((signal) => signal.sourceIds));
  output.meta = { ...output.meta, researchedAt: new Date().toISOString(), depth, queryCount: queries.length, sourcesReviewed: sources.length, sourcesUsed: usedSourceIds.size, providerStatus: 'verified', aiStatus: synthesis.status, warnings: [], failures: searchResult.failures };
  output.sources = sources;
  onStage({ id: 'complete', label: 'Research ready', signals: allSignals(output).length });
  return output;
}

class SerperSearchProvider {
  constructor(config, options = {}) { this.config = config; this.fetchImpl = options.fetchImpl || fetch; this.timeoutMs = options.timeoutMs || 20000; }
  async search(query) {
    return requestJson('https://google.serper.dev/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': this.config.apiKey }, body: JSON.stringify({ q: query.query, num: query.maxResults || 7, gl: marketCode(query.market), hl: 'en' }) }, this.fetchImpl, this.timeoutMs).then((payload) => [...(payload?.organic || []), ...(payload?.news || [])].map((item) => ({ ...item, sourceType: item.date ? 'news' : query.sourceType, query: query.query })));
  }
}

class TavilySearchProvider {
  constructor(config, options = {}) { this.config = config; this.fetchImpl = options.fetchImpl || fetch; this.timeoutMs = options.timeoutMs || 20000; }
  async search(query) {
    return requestJson('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: this.config.apiKey, query: query.query, max_results: query.maxResults || 7, search_depth: this.config.depth === 'deep' ? 'advanced' : 'basic', include_answer: false }) }, this.fetchImpl, this.timeoutMs).then((payload) => (payload?.results || []).map((item) => ({ ...item, sourceType: query.sourceType, query: query.query })));
  }
}

export function createSearchProvider(config, options = {}) {
  const provider = clean(config?.provider || config?.name).toLowerCase();
  if (provider === 'serper') return new SerperSearchProvider(config, options);
  if (provider === 'tavily') return new TavilySearchProvider(config, options);
  throw new Error(`Search provider “${config?.provider || 'Unknown'}” is not supported yet. Choose Serper or Tavily.`);
}

async function requestJson(url, init, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Search provider rejected the API key.');
      if (response.status === 429) throw new Error('Search provider rate limit reached.');
      throw new Error(`Search provider returned HTTP ${response.status}.`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Search provider timed out.');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function searchMany(provider, queries, options = {}) {
  const settled = await Promise.allSettled(queries.map((query) => provider.search(query).then((results) => results.map((raw) => ({ raw, query })) )));
  const results = []; const failures = [];
  settled.forEach((item, index) => { if (item.status === 'fulfilled') results.push(...item.value); else failures.push({ query: queries[index].query, message: 'Live market research is temporarily unavailable. Try again shortly.' }); });
  return { results, failures };
}

function marketCode(market) {
  const value = clean(market).toLowerCase();
  if (value.includes('india')) return 'in';
  if (value.includes('united states') || value === 'us' || value === 'usa') return 'us';
  if (value.includes('united kingdom') || value === 'uk') return 'gb';
  if (value.includes('australia')) return 'au';
  if (value.includes('singapore')) return 'sg';
  return undefined;
}
