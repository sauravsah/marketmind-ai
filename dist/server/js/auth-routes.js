export const PUBLIC_ROUTES = new Set(['landing', 'sign-in', 'sign-up', 'verify-email', 'forgot-password', 'reset-password']);
export const PROTECTED_ROUTES = new Set(['dashboard', 'strategy', 'research', 'audience', 'radar', 'campaigns', 'brand', 'workspace']);

export const LEGACY_ROUTE_MAP = {
  settings: 'workspace',
  dashboard: 'dashboard',
  strategy: 'strategy',
  research: 'research',
  audience: 'audience',
  radar: 'radar',
  campaigns: 'campaigns',
  brand: 'brand',
  workspace: 'workspace',
  'sign-in': 'sign-in',
  'sign-up': 'sign-up',
  'verify-email': 'verify-email',
  'forgot-password': 'forgot-password',
  'reset-password': 'reset-password',
  landing: 'landing',
};

export function routeFromHash(hash = '') {
  const raw = String(hash || '').replace(/^#/, '').split('?')[0].trim().toLowerCase();
  return LEGACY_ROUTE_MAP[raw] || (raw ? 'landing' : 'landing');
}

export function isProtectedRoute(route) {
  return PROTECTED_ROUTES.has(route);
}

export function decideAuthRoute(route, session, user = session?.user || null) {
  const requested = LEGACY_ROUTE_MAP[route] || 'landing';
  if (!session) return isProtectedRoute(requested) ? { route: 'landing', redirectTo: requested } : { route: requested };
  if (!isVerifiedUser(user)) {
    return requested === 'verify-email' ? { route: 'verify-email' } : { route: 'verify-email', redirectTo: requested };
  }
  if (requested === 'landing' || requested === 'sign-in' || requested === 'sign-up' || requested === 'verify-email') {
    return { route: 'dashboard' };
  }
  return { route: requested };
}

export function isVerifiedUser(user) {
  return Boolean(user?.email_confirmed_at || user?.emailVerified);
}
