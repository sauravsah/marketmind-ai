import { buildResearchSynthesisPrompt } from '../prompts/research.js';
import { buildAudienceAnalysisPrompt } from '../prompts/audience.js';
import { buildOpportunityPrompt } from '../prompts/opportunity.js';
import { buildCampaignStrategyPrompt, buildCreativeTerritoriesPrompt, buildCampaignConceptPrompt, buildPlatformStrategyPrompt } from '../prompts/campaign.js';

export const AI_PHASE_MESSAGE = 'This AI workflow is not connected yet.';
export const AI_RESEARCH_UNAVAILABLE = 'MarketMind is temporarily unable to complete this analysis. Please try again.';
const AI_UNAVAILABLE = 'MarketMind is temporarily unable to complete this analysis. Please try again.';

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

export function parseStructuredJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI returned no JSON object.');
  return JSON.parse(text.slice(start, end + 1));
}

export async function synthesizeResearch(context, sources, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: AI_RESEARCH_UNAVAILABLE };
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  try {
    const prompt = buildResearchSynthesisPrompt(context, sources);
    const response = await fetchImpl(endpointFor(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: modelFor(config),
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(AI_UNAVAILABLE);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error(AI_UNAVAILABLE);
    return { candidate: parseStructuredJson(content), status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE };
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeAudience(context, sources, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: 'MarketMind is temporarily unable to complete this analysis. Please try again.' };
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  try {
    const prompt = buildAudienceAnalysisPrompt(context, sources);
    const response = await fetchImpl(endpointFor(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: modelFor(config),
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(AI_UNAVAILABLE);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error(AI_UNAVAILABLE);
    return { candidate: parseStructuredJson(content), status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE };
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeOpportunities(context, evidence, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: 'MarketMind is temporarily unable to complete this analysis. Please try again.' };
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  try {
    const prompt = buildOpportunityPrompt(context, evidence, options.lens || 'balanced', options.variation || 0);
    const response = await fetchImpl(endpointFor(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: modelFor(config),
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(AI_UNAVAILABLE);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error(AI_UNAVAILABLE);
    return { candidate: parseStructuredJson(content), status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE };
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeCampaignStrategy(context, config, options = {}) {
  if (!config?.apiKey) return { candidate: null, status: 'not-configured', warning: 'MarketMind is temporarily unable to complete this analysis. Please try again.' };
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  const section = options.section || 'all';
  try {
    const prompt = section === 'territories'
      ? buildCreativeTerritoriesPrompt(context, options)
      : section === 'concept'
        ? buildCampaignConceptPrompt(context, options)
        : section === 'channels'
          ? buildPlatformStrategyPrompt(context, options)
          : buildCampaignStrategyPrompt(context, options);
    const response = await fetchImpl(endpointFor(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: modelFor(config),
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(AI_UNAVAILABLE);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error(AI_UNAVAILABLE);
    return { candidate: parseStructuredJson(content), status: 'verified', warning: null };
  } catch (error) {
    return { candidate: null, status: 'failed', warning: AI_UNAVAILABLE };
  } finally {
    clearTimeout(timeout);
  }
}
