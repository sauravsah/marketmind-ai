import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublicRuntimeConfig } from './server/config.mjs';
import { loadEnvironmentFile } from './server/load-env.mjs';
import { handleWorkerRequest } from './server/worker.mjs';

await loadEnvironmentFile();

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function isBlockedStaticPath(requestedPath) {
  return requestedPath.split('/').some((segment) => segment.startsWith('.env') || /service[-_]?account|firebase[-_]?admin/i.test(segment));
}

async function proxyWorkerRequest(request, response) {
  const method = request.method || 'GET';
  const webRequest = new Request(`http://localhost:${port}${request.url || '/'}`, {
    method,
    headers: request.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : request,
    duplex: 'half',
  });
  const webResponse = await handleWorkerRequest(webRequest, process.env, {});
  const headers = Object.fromEntries(webResponse.headers.entries());
  response.writeHead(webResponse.status, headers);
  if (!webResponse.body) {
    response.end();
    return;
  }
  Readable.fromWeb(webResponse.body).pipe(response);
}

const server = createServer(async (request, response) => {
  if (request.url?.split('?')[0].startsWith('/api/')) {
    try {
      await proxyWorkerRequest(request, response);
    } catch {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'MarketMind server is temporarily unavailable.' }));
      } else {
        response.destroy();
      }
    }
    return;
  }

  const requestedPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  if (isBlockedStaticPath(requestedPath)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const safePath = normalize(requestedPath).replace(/^([.][.][/\\])+/, '');
  const filePath = join(root, safePath.replace(/^[/\\]+/, ''));

  try {
    const contents = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mime[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(contents);
  } catch {
    const fallback = await readFile(join(root, 'index.html'));
    response.writeHead(200, { 'Content-Type': mime['.html'] });
    response.end(fallback);
  }
});

server.listen(port, () => {
  console.log(`MarketMind AI running at http://localhost:${port}`);
  if (!getPublicRuntimeConfig().firebase.projectId) console.log('Firebase runtime configuration is not set; authentication remains unavailable.');
});
