const FIREBASE_VERSION = '12.18.0';
const FIREBASE_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

let runtime = null;
let runtimePromise = null;
let client = null;
let clientPromise = null;
let accountEpoch = 0;

function normalizeRuntime(config = {}) {
  const firebase = config?.firebase || {};
  return {
    firebase: {
      apiKey: String(firebase.apiKey || ''),
      authDomain: String(firebase.authDomain || ''),
      projectId: String(firebase.projectId || ''),
      storageBucket: String(firebase.storageBucket || ''),
      messagingSenderId: String(firebase.messagingSenderId || ''),
      appId: String(firebase.appId || ''),
      measurementId: String(firebase.measurementId || ''),
    },
  };
}

async function loadRuntime() {
  if (runtime) return runtime;
  if (!runtimePromise) {
    runtimePromise = fetch('/api/public-runtime-config', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Public runtime configuration is unavailable.');
        return response.json();
      })
      .then(normalizeRuntime);
  }
  runtime = await runtimePromise;
  return runtime;
}

function isConfigured(config) {
  return Boolean(config.firebase.apiKey && config.firebase.authDomain && config.firebase.projectId && config.firebase.appId);
}

async function getClient() {
  if (client) return client;
  if (clientPromise) return clientPromise;
  clientPromise = loadRuntime().then(async (config) => {
    if (!isConfigured(config)) return null;
    const [appApi, authApi, firestoreApi] = await Promise.all([
      import(`${FIREBASE_CDN}/firebase-app.js`),
      import(`${FIREBASE_CDN}/firebase-auth.js`),
      import(`${FIREBASE_CDN}/firebase-firestore.js`),
    ]);
    const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(config.firebase);
    const auth = authApi.getAuth(app);
    await authApi.setPersistence(auth, authApi.browserLocalPersistence);
    const db = firestoreApi.getFirestore(app);
    client = { app, auth, db, authApi, firestoreApi };
    return client;
  });
  try {
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    throw error;
  }
}

function unavailableError() {
  return new Error('Authentication is not configured yet. Add the Firebase web configuration to the server environment.');
}

function toUser(user) {
  if (!user) return null;
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email || '',
    emailVerified: Boolean(user.emailVerified),
    email_confirmed_at: user.emailVerified ? (user.metadata?.lastSignInTime || new Date().toISOString()) : null,
    displayName: user.displayName || '',
    firebaseUser: user,
  };
}

function toSession(user) {
  return user ? { user: toUser(user), firebaseUser: user } : null;
}

function actionCodeFromLocation() {
  const search = new URLSearchParams(window.location.search);
  const hash = String(window.location.hash || '');
  const hashQuery = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : null;
  return search.get('oobCode') || hashQuery?.get('oobCode') || '';
}

function actionModeFromLocation() {
  const search = new URLSearchParams(window.location.search);
  const hash = String(window.location.hash || '');
  const hashQuery = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : null;
  return search.get('mode') || hashQuery?.get('mode') || '';
}

function resetRedirectUrl() {
  return `${window.location.origin}/#reset-password`;
}

function clearActionQuery() {
  const cleanHash = String(window.location.hash || '').split('?')[0];
  window.history.replaceState(null, '', `${window.location.pathname}${cleanHash}`);
}

async function waitForInitialUser(auth, onAuthStateChanged) {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user || null);
    }, () => resolve(null));
  });
}



// The Firebase console's single "customize action URL" applies to every auth
// email template, so every mode that can arrive on this origin needs a safe
// path - not only the ones the product sends today (console, Admin SDK and
// future SDK flows can issue others). Modes the app implements are completed
// in-app; everything else is forwarded untouched to the project's default
// hosted handler, which stays live at the authDomain and completes them
// exactly as it does today. Unknown modes are never consumed silently.
export function emailActionRoute(mode) {
  if (mode === 'verifyEmail') return 'verify-in-app';
  if (mode === 'resetPassword') return 'reset-in-app';
  return 'forward-to-default-handler';
}

export function defaultActionHandlerUrl(authDomain, search) {
  const domain = String(authDomain || '').trim();
  if (!domain) return '';
  return `https://${domain}/__/auth/action${search || ''}`;
}

// User-facing copy for a failed email-verification link. Firebase shows the
// same page for a consumed and an expired link, so the distinction here comes
// from the error code when the app itself handles the action link.
export function describeEmailActionError(code, { signedIn = true } = {}) {
  // Firebase surfaces auth/invalid-action-code for links that were already
  // used, are malformed, or have expired - and auth/expired-action-code for
  // expired ones. In practice a used-then-reopened link and an expired link
  // are easy to confuse, so the copy keeps both possibilities open instead
  // of claiming one cause with certainty.
  // The "this page keeps checking" promise is only made when this browser
  // holds an unverified session; in a signed-out browser (for example the
  // mail app's own window) nothing is watching, so the copy routes the
  // person through sign-in instead.
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
    return {
      title: 'That verification link did not work.',
      body: signedIn
        ? 'The link may have expired, or it was already used. If you opened it before, your email may already be verified - this page keeps checking automatically and opens the workspace the moment you are. If nothing happens within a minute, send a fresh link below and open the newest email.'
        : 'The link may have expired, or it was already used. If you opened it before, your email may already be verified. Sign in to check your status - if you still need verification you can send a fresh link there, then open the newest email.',
    };
  }
  return {
    title: 'That verification link did not work.',
    body: signedIn
      ? 'Send yourself a fresh link below and open the newest email.'
      : 'Sign in and send yourself a fresh link, then open the newest email.',
  };
}

export const authService = {
  async init() {
    try {
      const firebase = await getClient();
      if (!firebase) return { configured: false, session: null, user: null };
      const actionMode = actionModeFromLocation();
      const actionCode = actionCodeFromLocation();
      let actionError = null;
      let actionSuccess = null;
      if (actionMode && actionCode && emailActionRoute(actionMode) === 'forward-to-default-handler') {
        // A mode this app does not complete itself (recoverEmail,
        // verifyAndChangeEmail, or anything newer): hand the untouched link
        // to Firebase's default hosted handler so it completes exactly as it
        // does today, instead of silently doing nothing with the oobCode.
        const config = await loadRuntime();
        const target = defaultActionHandlerUrl(config?.firebase?.authDomain, window.location.search);
        if (target) {
          window.location.replace(target);
          return { configured: true, session: null, user: null, actionForwarding: true };
        }
        actionError = { mode: actionMode, code: 'auth/unhandled-action-mode' };
      } else if (actionMode === 'verifyEmail' && actionCode) {
        try {
          await firebase.authApi.applyActionCode(firebase.auth, actionCode);
          // Remembered so the verify screen can confirm the link worked even
          // when this browser is signed out and cannot open the workspace.
          actionSuccess = { mode: actionMode };
          clearActionQuery();
        } catch (error) {
          // Kept so the verify screen can say what happened to the link and
          // offer the right recovery instead of failing silently.
          actionError = { mode: actionMode, code: error?.code || 'unknown' };
        }
      }
      const currentUser = await waitForInitialUser(firebase.auth, firebase.authApi.onAuthStateChanged);
      if (currentUser && actionMode === 'verifyEmail' && actionCode) {
        try { await firebase.authApi.reload(currentUser); } catch { /* A later auth refresh can retry the profile update. */ }
      }
      return { configured: true, session: toSession(currentUser), user: toUser(currentUser), actionError, actionSuccess };
    } catch (error) {
      return { configured: false, session: null, user: null, error };
    }
  },

  async getSession() {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    return { data: { session: toSession(firebase.auth.currentUser), user: toUser(firebase.auth.currentUser) }, error: null };
  },

  async getIdToken(forceRefresh = false) {
    const firebase = await getClient();
    if (!firebase?.auth.currentUser) return null;
    return firebase.auth.currentUser.getIdToken(Boolean(forceRefresh));
  },

  async signUp(email, password) {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    const { user } = await firebase.authApi.createUserWithEmailAndPassword(firebase.auth, email, password);
    await firebase.authApi.sendEmailVerification(user, { url: `${window.location.origin}/#verify-email`, handleCodeInApp: false });
    return { data: { user: toUser(user), session: toSession(user) }, error: null };
  },

  async signIn(email, password) {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    const { user } = await firebase.authApi.signInWithEmailAndPassword(firebase.auth, email, password);
    return { data: { user: toUser(user), session: toSession(user) }, error: null };
  },

  async signOut() {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    await firebase.authApi.signOut(firebase.auth);
    return { error: null };
  },

  async sendPasswordReset(email) {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    await firebase.authApi.sendPasswordResetEmail(firebase.auth, email, { url: resetRedirectUrl(), handleCodeInApp: false });
    return { error: null };
  },

  async updatePassword(password) {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    const resetCode = actionCodeFromLocation();
    if (resetCode) {
      await firebase.authApi.confirmPasswordReset(firebase.auth, resetCode, password);
      clearActionQuery();
      return { error: null };
    }
    if (!firebase.auth.currentUser) throw new Error('Your reset link has expired. Request a new password reset email.');
    await firebase.authApi.updatePassword(firebase.auth.currentUser, password);
    return { error: null };
  },

  async resendVerification(email) {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    const user = firebase.auth.currentUser;
    if (!user || (email && user.email !== email)) throw new Error('Sign in again to resend your verification email.');
    await firebase.authApi.sendEmailVerification(user, { url: `${window.location.origin}/#verify-email`, handleCodeInApp: false });
    return { error: null };
  },

  async refreshUser() {
    const firebase = await getClient();
    if (!firebase) throw unavailableError();
    const user = firebase.auth.currentUser;
    if (!user) return { data: { user: null, session: null }, error: null };
    await firebase.authApi.reload(user);
    return { data: { user: toUser(user), session: toSession(user) }, error: null };
  },

  onAuthStateChange(callback) {
    return getClient().then((firebase) => {
      if (!firebase) return { data: { subscription: { unsubscribe() {} } } };
      let initial = true;
      const unsubscribe = firebase.authApi.onAuthStateChanged(firebase.auth, (user) => {
        accountEpoch += 1;
        callback(initial ? 'INITIAL_SESSION' : (user ? 'SIGNED_IN' : 'SIGNED_OUT'), toSession(user));
        initial = false;
      });
      return { data: { subscription: { unsubscribe } } };
    }).catch(() => ({ data: { subscription: { unsubscribe() {} } } }));
  },

  getClient() { return getClient(); },
  getRuntime() { return loadRuntime(); },
};

export async function authenticatedFetch(input, init = {}) {
  const epoch = accountEpoch;
  const user = client?.auth.currentUser;
  const firebase = await getClient();
  const assertCurrent = () => {
    if (init.signal?.aborted || !user || epoch !== accountEpoch || firebase.auth.currentUser !== user) {
      throw new DOMException('The account changed or the request was cancelled.', 'AbortError');
    }
  };
  assertCurrent();
  const send = (token) => {
    assertCurrent();
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  let token = await user.getIdToken(false);
  let response = await send(token);
  // Retry once with a forced refresh for the same signed-in user, never a
  // replacement account.
  if (response.status === 401 && token) {
    assertCurrent();
    token = await user.getIdToken(true);
    if (token) response = await send(token);
    return response;
  }
  // A 403 while the cached token's email_verified claim is still false is the
  // stale pre-verification window: the user verified (claim updates on
  // refresh) but the hour-cached token predates it. Refresh once and retry so
  // they reach the real outcome. Other 403s (the invite-only gate) skip the
  // retry, so non-idempotent requests are never re-sent after them.
  if (response.status === 403 && token && typeof user.getIdTokenResult === 'function') {
    assertCurrent();
    const claims = (await user.getIdTokenResult())?.claims;
    if (claims && claims.email_verified === false) {
      token = await user.getIdToken(true);
      if (token) response = await send(token);
    }
  }
  return response;
}

export function authErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('not configured')) return 'Authentication is not configured yet. Add the Firebase web configuration to the server environment.';
  if (message.includes('invite-only') || message.includes('beta administrator') || code.includes('permission-denied') || code.includes('blocking-function')) return 'MarketMind is currently invite-only. Contact the beta administrator for access.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || message.includes('invalid login credentials')) return 'That email and password combination was not recognized.';
  if (code.includes('email-already-in-use')) return 'An account already exists for that email. Try signing in instead.';
  if (code.includes('user-not-found')) return 'That email and password combination was not recognized.';
  if (code.includes('invalid-action-code') || code.includes('expired-action-code')) return 'That reset link has expired. Request a new password reset email.';
  if (code.includes('weak-password') || message.includes('password')) return 'Use a password with at least 8 characters.';
  if (code.includes('too-many-requests') || message.includes('rate limit') || message.includes('too many')) return 'Too many attempts. Please wait a moment and try again.';
  if (code.includes('operation-not-allowed')) return 'Email and password accounts are not enabled in Firebase yet.';
  return 'We could not complete that request. Please try again.';
}
