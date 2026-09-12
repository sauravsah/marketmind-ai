const FIREBASE_VERSION = '12.18.0';
const FIREBASE_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

let runtime = null;
let runtimePromise = null;
let client = null;
let clientPromise = null;

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

export const authService = {
  async init() {
    try {
      const firebase = await getClient();
      if (!firebase) return { configured: false, session: null, user: null };
      const actionMode = actionModeFromLocation();
      const actionCode = actionCodeFromLocation();
      if (actionMode === 'verifyEmail' && actionCode) {
        try {
          await firebase.authApi.applyActionCode(firebase.auth, actionCode);
          clearActionQuery();
        } catch { /* The verify screen can still offer a fresh email. */ }
      }
      const currentUser = await waitForInitialUser(firebase.auth, firebase.authApi.onAuthStateChanged);
      if (currentUser && actionMode === 'verifyEmail' && actionCode) {
        try { await firebase.authApi.reload(currentUser); } catch { /* A later auth refresh can retry the profile update. */ }
      }
      return { configured: true, session: toSession(currentUser), user: toUser(currentUser) };
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

  onAuthStateChange(callback) {
    return getClient().then((firebase) => {
      if (!firebase) return { data: { subscription: { unsubscribe() {} } } };
      let initial = true;
      const unsubscribe = firebase.authApi.onAuthStateChanged(firebase.auth, (user) => {
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
  const send = (token) => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  let token = await authService.getIdToken();
  let response = await send(token);
  // Firebase can keep a stale ID token in a tab after a long session or a
  // deployment. Refresh once on a 401 so a valid user does not lose a stream.
  if (response.status === 401 && token) {
    token = await authService.getIdToken(true);
    if (token) response = await send(token);
  }
  return response;
}

export function authErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('not configured')) return 'Authentication is not configured yet. Add the Firebase web configuration to the server environment.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || message.includes('invalid login credentials')) return 'That email and password combination was not recognized.';
  if (code.includes('email-already-in-use')) return 'An account already exists for that email. Try signing in instead.';
  if (code.includes('user-not-found')) return 'That email and password combination was not recognized.';
  if (code.includes('invalid-action-code') || code.includes('expired-action-code')) return 'That reset link has expired. Request a new password reset email.';
  if (code.includes('weak-password') || message.includes('password')) return 'Use a password with at least 8 characters.';
  if (code.includes('too-many-requests') || message.includes('rate limit') || message.includes('too many')) return 'Too many attempts. Please wait a moment and try again.';
  if (code.includes('operation-not-allowed')) return 'Email and password accounts are not enabled in Firebase yet.';
  return 'We could not complete that request. Please try again.';
}
