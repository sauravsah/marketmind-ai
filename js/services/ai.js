import { buildResearchSynthesisPrompt } from '../prompts/research.js';
import { buildAudienceAnalysisPrompt } from '../prompts/audience.js';
import { buildOpportunityPrompt } from '../prompts/opportunity.js';
import { buildCampaignStrategyPrompt, buildCreativeTerritoriesPrompt, buildCampaignConceptPrompt, buildPlatformStrategyPrompt } from '../prompts/campaign.js';
import { TIGHT_PACKET_BUDGET } from '../prompts/budget.js';

export const AI_PHASE_MESSAGE = 'This AI workflow is not connected yet.';
export const AI_RESEARCH_UNAVAILABLE = 'MarketMind is temporarily unable to complete this analysis. Please try again.';
const AI_UNAVAILABLE = 'MarketMind is temporarily unable to complete this analysis. Please try again.';

// Coarse, sanitized failure reasons for server-side logs. Never carries
// provider payloads, request bodies, or key material - safe to log as-is.
function failureError(reason) {
  const error = new Error(AI_UNAVAILABLE);
  error.reason = reason;
  return error;
}

// Output caps keep every request inside provider token budgets (free tiers
// limit combined input + output tokens per minute) and stop runaway bills.
// Reasoning models spend part of this budget before the visible JSON.
export const DEFAULT_MAX_OUTPUT_TOKENS = 2500;
export const CAMPAIGN_MAX_OUTPUT_TOKENS = 2500;
const MAX_OUTPUT_TOKENS_CEILING = 16000;
const MAX_RATE_LIMIT_RETRIES = 2;
// A token-per-minute window can take up to a minute to reset, so waits honor
// the provider's reset hint up to this bound (function maxDuration is 300s).
const MAX_RETRY_WAIT_MS = 65000;
// Conservative pre-flight request budget: estimated input tokens plus the
// output cap must stay under this estimate, else the prompt is rebuilt with
// the emergency profile and finally refused without calling the provider.
export const DEFAULT_PROMPT_TOKEN_BUDGET = 7800;
const ESTIMATED_FRAMING_TOKENS = 12;
// Total wall-clock budget for one synthesis call including rate-limit waits.
// Keeps retries inside the functions' declared 300s maxDuration even after
// preceding work (for example the research stage's search pass) has run.
const DEFAULT_RETRY_BUDGET_MS = 130000;

export function buildStrategyContext({ strategy, brand }) {
  return {
    strategy: {
      idea: strategy.idea,
      audience: strategy.audience,
      platforms: strategy.platforms,
      objective: strategy.objective,
      market: strategy.market,
      competitors: strategy.competitors || [],
      researchDepth: strategy.researchDepth || 'balanced',
    },
    brand: {
      name: brand.name,
      industry: brand.industry,
      description: brand.description,
      audience: brand.audience,
      voice: brand.voice,
    },
  };
}

export async function analyzeIdea() {
  throw new Error(AI_PHASE_MESSAGE);
}

export async function analyzeBrand() {
  throw new Error(AI_PHASE_MESSAGE);
}

export async function generateCampaign() {
  throw new Error(AI_PHASE_MESSAGE);
}

function endpointFor(config) {
  return String(config?.endpoint || 'https://api.openai.com/v1/chat/completions').replace(/\/$/, '');
}

function modelFor(config) {
  return config?.model || 'gpt-4o-mini';
}

export function maxOutputTokensFor(config, options = {}, fallback = DEFAULT_MAX_OUTPUT_TOKENS) {
  const raw = Number(options.maxTokens ?? config?.maxTokens);
  if (Number.isSafeInteger(raw) && raw > 0) return Math.min(raw, MAX_OUTPUT_TOKENS_CEILING);
  return fallback;
}

export function promptTokenBudgetFor(config, options = {}) {
  const raw = Number(options.promptTokenBudget ?? config?.promptTokenBudget);
  if (Number.isSafeInteger(raw) && raw > 0) return raw;
  return DEFAULT_PROMPT_TOKEN_BUDGET;
}

export function retryBudgetMsFor(config, options = {}) {
  const raw = Number(options.retryBudgetMs ?? config?.retryBudgetMs);
  if (Number.isSafeInteger(raw) && raw > 0) return raw;
  return DEFAULT_RETRY_BUDGET_MS;
}

// Rough conservative estimate, NOT a provider token count: Latin text averages
// under 4 chars/token, non-Latin (for example Devanagari) can approach one
// token per character. The provider's own accounting is authoritative.
export function estimateTokens(text) {
  const value = String(text || '');
  let ascii = 0;
  let other = 0;
  for (const ch of value) {
    if ((ch.codePointAt(0) || 0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4 + other / 1.2) + ESTIMATED_FRAMING_TOKENS;
}

export function parseStructuredJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI returned no JSON object.');
  return JSON.parse(text.slice(start, end + 1));
}

const REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

function reasoningEffortFor(config, options = {}) {
  const value = String(options.reasoningEffort ?? config?.reasoningEffort ?? '').trim().toLowerCase();
  return REASONING_EFFORTS.has(value) ? value : null;
}

// Provider rate-limit hints: Retry-After seconds, or Groq's
// x-ratelimit-reset-tokens duration (for example "7.66s" or "1m2.5s").
export function rateLimitWaitMs(response) {
  const rawRetryAfter = response?.headers?.get?.('retry-after');
  const retryAfter = rawRetryAfter === null || rawRetryAfter === undefined || rawRetryAfter === '' ? NaN : Number(rawRetryAfter);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS);
  const reset = String(response?.headers?.get?.('x-ratelimit-reset-tokens') || '').trim();
  const match = /^(?:(\d+(?:\.\d+)?)m)?([\d.]+)s$/.exec(reset);
  if (match) return Math.min(((Number(match[1] || 0) * 60) + Number(match[2])) * 1000, MAX_RETRY_WAIT_MS);
  return 1000;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rateLimitExhaustedForToday(response) {
  return response?.headers?.get?.('x-ratelimit-remaining-requests') === '0';
}

// buildPrompt(packetBudgetOverride) must return the full prompt; passing the
// emergency profile rebuilds a smaller packet when the estimate is over budget.
async function requestStructuredJson(config, buildPrompt, callOptions = {}) {
  const fetchImpl = callOptions.fetchImpl || fetch;
  const sleep = callOptions.sleepImpl || defaultSleep;
  const maxTokens = callOptions.maxTokens;
  const promptBudget = callOptions.promptTokenBudget;
  const retryBudgetMs = callOptions.retryBudgetMs ?? DEFAULT_RETRY_BUDGET_MS;
  const startedAt = Date.now();
  const attemptTimeoutMs = callOptions.timeoutMs || 30000;
  let prompt = buildPrompt();
  let estimatedInput = estimateTokens(prompt.system) + estimateTokens(prompt.user);
  if (estimatedInput + maxTokens > promptBudget) {
    prompt = buildPrompt(TIGHT_PACKET_BUDGET);
    estimatedInput = estimateTokens(prompt.system) + estimateTokens(prompt.user);
    if (estimatedInput + maxTokens > promptBudget) {
      if (callOptions.callStats) callOptions.callStats['budget-refused'] = (callOptions.callStats['budget-refused'] || 0) + 1;
      throw failureError('budget-refused'); // refuse safely before spending provider quota
    }
  }
  // Privacy-safe usage accounting: attempt outcomes as counts/statuses only.
  // No prompts, keys, headers, or response content are ever recorded.
  const note = (outcome) => {
    if (!callOptions.callStats) return;
    callOptions.callStats.total = (callOptions.callStats.total || 0) + 1;
    callOptions.callStats[outcome] = (callOptions.callStats[outcome] || 0) + 1;
  };
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    if (callOptions.signal?.aborted) { note('aborted'); throw failureError('aborted'); }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const response = await fetchImpl(endpointFor(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: modelFor(config),
          temperature: callOptions.temperature,
          max_tokens: maxTokens,
          ...(callOptions.reasoningEffort ? { reasoning_effort: callOptions.reasoningEffort } : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        }),
        signal: controller.signal,
      });
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES && !rateLimitExhaustedForToday(response)) {
        const waitMs = rateLimitWaitMs(response);
        // Defer safely: if waiting plus another attempt would exceed this
        // call's time budget, fail friendly instead of dying mid-retry.
        if (Date.now() - startedAt + waitMs + attemptTimeoutMs > retryBudgetMs) throw failureError('rate-limited');
        note('rate-limited');
        await sleep(waitMs);
        continue;
      }
      if (!response.ok) { const reason = response.status === 429 ? 'rate-limited' : 'provider-error'; note(reason); throw failureError(reason); }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (!content) { note('invalid-response'); throw failureError('invalid-response'); }
      try {
        const parsed = parseStructuredJson(content);
        note('ok');
        return parsed;
      } catch {
        note('invalid-response');
        throw failureError('invalid-response');
      }
    } catch (error) {
      if (error?.reason) throw error;
      const reason = error?.name === 'AbortError' ? 'timeout' : error?.name === 'SyntaxError' ? 'invalid-response' : 'provider-error';
      note(reason);
      throw failureError(reason);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw failureError('rate-limited');
}

function callOptionsFrom(config, options, { temperature, maxTokens }) {
  return {
    temperature,
    maxTokens: maxOutputTokensFor(config, options, maxTokens),
    promptTokenBudget: promptTokenBudgetFor(config, options),
    reasoningEffort: reasoningEffortFor(config, options),
    timeoutMs: options.timeoutMs,
    retryBudgetMs: retryBudgetMsFor(config, options),
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    signal: options.signal,
    callStats: options.callStats,
  };
}

export async function synthesizeResearch(context, sources, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: AI_RESEARCH_UNAVAILABLE };
  try {
    const candidate = await requestStructuredJson(config, (packetBudget) => buildResearchSynthesisPrompt(context, sources, packetBudget), callOptionsFrom(config, options, { temperature: 0.1, maxTokens: DEFAULT_MAX_OUTPUT_TOKENS }));
    return { candidate, status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE, reason: error?.reason || 'unknown' };
  }
}

export async function synthesizeAudience(context, sources, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: AI_UNAVAILABLE };
  try {
    const candidate = await requestStructuredJson(config, (packetBudget) => buildAudienceAnalysisPrompt(context, sources, packetBudget), callOptionsFrom(config, options, { temperature: 0.1, maxTokens: DEFAULT_MAX_OUTPUT_TOKENS }));
    return { candidate, status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE, reason: error?.reason || 'unknown' };
  }
}

export async function synthesizeOpportunities(context, evidence, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: AI_UNAVAILABLE };
  try {
    const candidate = await requestStructuredJson(config, (packetBudget) => buildOpportunityPrompt(context, evidence, options.lens || 'balanced', options.variation || 0, packetBudget), callOptionsFrom(config, options, { temperature: 0.15, maxTokens: DEFAULT_MAX_OUTPUT_TOKENS }));
    return { candidate, status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE, reason: error?.reason || 'unknown' };
  }
}

export async function synthesizeCampaignStrategy(context, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: AI_UNAVAILABLE };
  const section = options.section || 'all';
  const buildPrompt = (packetBudget) => {
    const promptOptions = packetBudget ? { ...options, packetBudget } : options;
    return section === 'territories'
      ? buildCreativeTerritoriesPrompt(context, promptOptions)
      : section === 'concept'
        ? buildCampaignConceptPrompt(context, promptOptions)
        : section === 'channels'
          ? buildPlatformStrategyPrompt(context, promptOptions)
          : buildCampaignStrategyPrompt(context, promptOptions);
  };
  try {
    const candidate = await requestStructuredJson(config, buildPrompt, callOptionsFrom(config, options, { temperature: 0.15, maxTokens: CAMPAIGN_MAX_OUTPUT_TOKENS }));
    return { candidate, status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE, reason: error?.reason || 'unknown' };
  }
}
