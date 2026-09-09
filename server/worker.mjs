import { researchMarket } from '../js/services/research.js';
import { analyzeAudience } from '../js/services/audience.js';
import { identifyOpportunities } from '../js/services/opportunity.js';
import { generateCampaignStrategy } from '../js/services/campaign.js';
import { getInternalProviderConfig, getPublicRuntimeConfig } from './config.mjs';
import { authenticateFirebaseRequest } from './firebase-auth.mjs';

const MAX_BODY_BYTES = 1_000_000;
const STREAM_ROUTES = {
  '/api/research/stream': {
    run: (payload, config, onStage) => researchMarket(payload.context, config, { onStage }),
    message: 'Live market research is temporarily unavailable. Try again shortly.',
  },
  '/api/audience/stream': {
    run: (payload, config, onStage) => analyzeAudience(payload.context, config, { onStage }),
    message: 'MarketMind is temporarily unable to complete this analysis. Please try again.',
  },
  '/api/opportunities/stream': {
    run: (payload, config, onStage) => identifyOpportunities(payload.context, config, { lens: payload.lens || 'balanced', variation: payload.variation || 0, onStage }),
    message: 'MarketMind is temporarily unable to complete this analysis. Please try again.',
  },
  '/api/campaign/stream': {
    run: (payload, config, onStage) => generateCampaignStrategy(payload.context, config, { section: payload.section || 'all', existing: payload.existing || null, onStage }),
    message: 'MarketMind is temporarily unable to complete this analysis. Please try again.',
  },
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new Error('Request is too large.');
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error('Request is too large.');
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('Request body was not valid JSON.');
  }
}

function sseResponse(run, fallbackMessage) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      Promise.resolve()
        .then(() => run(send))
        .then((result) => send('result', result))
        .catch(() => send('error', { message: fallbackMessage }))
        .finally(() => controller.close());
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function handleStream(request, path, env) {
  const auth = await authenticateFirebaseRequest(request, {
    projectId: getPublicRuntimeConfig(env).firebase.projectId,
  });
  if (!auth.ok) return jsonResponse({ error: auth.message }, auth.status);

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Request body was not valid JSON.' }, 400);
  }
  const route = STREAM_ROUTES[path];
  const config = getInternalProviderConfig(env);
  return sseResponse(
    (send) => route.run(payload, config, (stage) => send('stage', stage)),
    route.message,
  );
}

export async function handleWorkerRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);
  if (request.method === 'GET' && ['/api/public-config', '/api/public-runtime-config'].includes(url.pathname)) {
    return jsonResponse(getPublicRuntimeConfig(env));
  }
  if (request.method === 'POST' && STREAM_ROUTES[url.pathname]) return handleStream(request, url.pathname, env);
  if (url.pathname.startsWith('/api/')) return jsonResponse({ error: 'Not found' }, 404);
  if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request, env, ctx);
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export default { fetch: handleWorkerRequest };
