import { Readable } from 'node:stream';
import { handleWorkerRequest } from './worker.mjs';

function toWebRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }

  const method = String(request.method || 'GET').toUpperCase();
  const init = {
    method,
    headers,
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request;
    init.duplex = 'half';
  }

  return new Request(`https://${headers.get('host') || 'marketmind.vercel.app'}${request.url || '/'}`, init);
}

export async function handleVercelRequest(request, response) {
  try {
    const webResponse = await handleWorkerRequest(toWebRequest(request), process.env, {});
    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, name) => response.setHeader(name, value));

    if (!webResponse.body) {
      response.end();
      return;
    }

    Readable.fromWeb(webResponse.body).pipe(response);
  } catch {
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: 'MarketMind server is temporarily unavailable.' }));
      return;
    }
    response.destroy();
  }
}
