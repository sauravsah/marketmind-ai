const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const DEFAULT_CERTIFICATE_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 5 * 60;

let certificateCache = null;
let importedKeyCache = new Map();

function decodeBase64(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof globalThis.atob !== 'function') throw new Error('Base64 decoding is unavailable.');
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value, label) {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64(value)));
  } catch {
    const error = new Error(`Firebase token ${label} is invalid.`);
    error.code = 'INVALID_TOKEN';
    throw error;
  }
}

function pemToDer(value) {
  const body = String(value || '').replace(/-----BEGIN [^-]+-----|-----END [^-]+-----/g, '').replace(/\s+/g, '');
  return decodeBase64(body);
}

function readDerElement(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array) || offset >= bytes.length) throw new Error('Invalid DER data.');
  const tag = bytes[offset];
  const lengthByte = bytes[offset + 1];
  if (lengthByte === undefined) throw new Error('Invalid DER length.');
  let length;
  let headerLength = 2;
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const count = lengthByte & 0x7f;
    if (!count || count > 4 || offset + 2 + count > bytes.length) throw new Error('Invalid DER length.');
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + bytes[offset + 2 + index];
    headerLength += count;
  }
  const start = offset;
  const contentStart = offset + headerLength;
  const end = contentStart + length;
  if (end > bytes.length) throw new Error('Invalid DER bounds.');
  return { tag, start, contentStart, end, encoded: bytes.slice(start, end), content: bytes.slice(contentStart, end) };
}

function certificateToSubjectPublicKeyInfo(certificate) {
  const root = readDerElement(pemToDer(certificate));
  const rootChildren = [];
  for (let offset = 0; offset < root.content.length;) {
    const child = readDerElement(root.content, offset);
    rootChildren.push(child);
    offset = child.end;
  }
  const tbs = rootChildren[0];
  if (!tbs || tbs.tag !== 0x30) throw new Error('Firebase certificate is invalid.');
  const tbsChildren = [];
  for (let offset = 0; offset < tbs.content.length;) {
    const child = readDerElement(tbs.content, offset);
    tbsChildren.push(child);
    offset = child.end;
  }
  const spkiIndex = tbsChildren[0]?.tag === 0xa0 ? 6 : 5;
  const spki = tbsChildren[spkiIndex];
  if (!spki || spki.tag !== 0x30) throw new Error('Firebase certificate public key is invalid.');
  return spki.encoded;
}

function publicKeyMaterial(material) {
  if (material && typeof material === 'object') return { format: 'jwk', value: material };
  const value = String(material || '');
  if (value.includes('BEGIN CERTIFICATE')) return { format: 'spki', value: certificateToSubjectPublicKeyInfo(value) };
  return { format: 'spki', value: pemToDer(value) };
}

function cryptoSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    const error = new Error('Web Crypto is unavailable.');
    error.code = 'CRYPTO_UNAVAILABLE';
    throw error;
  }
  return subtle;
}

async function importFirebaseKey(kid, material) {
  const cached = importedKeyCache.get(kid);
  if (cached?.material === material) return cached.key;
  const source = publicKeyMaterial(material);
  const key = await cryptoSubtle().importKey(
    source.format,
    source.value,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  importedKeyCache.set(kid, { material, key });
  return key;
}

export function extractBearerToken(request) {
  const header = request?.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function decodeFirebaseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    const error = new Error('Firebase token format is invalid.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  const header = decodeJsonPart(parts[0], 'header');
  const payload = decodeJsonPart(parts[1], 'payload');
  const signature = decodeBase64(parts[2]);
  if (header.alg !== 'RS256' || !header.kid || !signature.length) {
    const error = new Error('Firebase token signing metadata is invalid.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  return { header, payload, signature, signingInput: `${parts[0]}.${parts[1]}` };
}

export function validateFirebaseClaims(payload, { projectId, now = Math.floor(Date.now() / 1000) } = {}) {
  const expectedProjectId = String(projectId || '').trim();
  if (!expectedProjectId) {
    const error = new Error('Firebase project configuration is missing.');
    error.code = 'CONFIGURATION';
    throw error;
  }
  if (payload.aud !== expectedProjectId || payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
    const error = new Error('Firebase token audience or issuer is invalid.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    const error = new Error('Firebase token subject is invalid.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now - CLOCK_SKEW_SECONDS) {
    const error = new Error('Firebase token has expired.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  if (!Number.isFinite(payload.iat) || payload.iat > now + CLOCK_SKEW_SECONDS) {
    const error = new Error('Firebase token issued-at time is invalid.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    emailVerified: payload.email_verified === true,
    claims: payload,
  };
}

async function fetchCertificates(fetchImpl = globalThis.fetch) {
  if (certificateCache && certificateCache.expiresAt > Date.now()) return certificateCache.certificates;
  if (typeof fetchImpl !== 'function') {
    const error = new Error('Firebase token certificates are unavailable.');
    error.code = 'CERTIFICATES_UNAVAILABLE';
    throw error;
  }
  const response = await fetchImpl(GOOGLE_JWK_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const error = new Error('Firebase token certificates are unavailable.');
    error.code = 'CERTIFICATES_UNAVAILABLE';
    throw error;
  }
  const certificates = await response.json();
  if (!certificates || typeof certificates !== 'object' || !Array.isArray(certificates.keys)) {
    const error = new Error('Firebase token certificates are invalid.');
    error.code = 'CERTIFICATES_UNAVAILABLE';
    throw error;
  }
  const cacheControl = response.headers?.get?.('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 0);
  certificateCache = {
    certificates,
    expiresAt: Date.now() + (maxAge > 0 ? maxAge * 1000 : DEFAULT_CERTIFICATE_TTL_MS),
  };
  return certificates;
}

function findKey(certificates, kid) {
  if (Array.isArray(certificates?.keys)) return certificates.keys.find((key) => key?.kid === kid);
  return certificates?.[kid];
}

export async function verifyFirebaseIdToken(token, { projectId, certificates, fetchImpl, now } = {}) {
  if (!String(projectId || '').trim()) {
    const error = new Error('Firebase project configuration is missing.');
    error.code = 'CONFIGURATION';
    throw error;
  }
  const decoded = decodeFirebaseToken(token);
  const availableCertificates = certificates || await fetchCertificates(fetchImpl);
  const material = findKey(availableCertificates, decoded.header.kid);
  if (!material || (typeof material !== 'string' && typeof material !== 'object')) {
    const error = new Error('Firebase token key is unknown.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }
  try {
    const key = await importFirebaseKey(decoded.header.kid, material);
    const valid = await cryptoSubtle().verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      decoded.signature,
      new TextEncoder().encode(decoded.signingInput),
    );
    if (!valid) throw new Error('Signature mismatch.');
  } catch (error) {
    if (error?.code === 'CRYPTO_UNAVAILABLE') throw error;
    const invalid = new Error('Firebase token signature is invalid.');
    invalid.code = 'INVALID_TOKEN';
    throw invalid;
  }
  return validateFirebaseClaims(decoded.payload, { projectId, now });
}

export async function authenticateFirebaseRequest(request, options = {}) {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, status: 401, message: 'Authentication is required.' };
  if (!String(options.projectId || '').trim()) return { ok: false, status: 503, message: 'Firebase authentication is not configured.' };
  try {
    const user = await verifyFirebaseIdToken(token, options);
    if (!user.emailVerified) return { ok: false, status: 403, message: 'Verify your email before using the MarketMind workspace.' };
    return { ok: true, user };
  } catch (error) {
    return {
      ok: false,
      status: error?.code === 'CONFIGURATION' || error?.code === 'CERTIFICATES_UNAVAILABLE' ? 503 : 401,
      message: error?.code === 'CONFIGURATION' ? 'Firebase authentication is not configured.' : error?.code === 'CERTIFICATES_UNAVAILABLE' ? 'Firebase authentication is temporarily unavailable.' : 'The Firebase session is invalid or expired.',
    };
  }
}

export function resetFirebaseCertificateCache() {
  certificateCache = null;
  importedKeyCache = new Map();
}
