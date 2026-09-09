import test from 'node:test';
import assert from 'node:assert/strict';
import { getInternalProviderConfig, getPublicRuntimeConfig } from '../server/config.mjs';

test('provider configuration is read from server environment only', () => {
  const names = ['AI_PROVIDER', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY', 'SEARCH_PROVIDER', 'SEARCH_API_KEY'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.AI_PROVIDER = 'InternalAI';
    process.env.AI_BASE_URL = 'https://internal.example/v1';
    process.env.AI_MODEL = 'internal-model';
    process.env.AI_API_KEY = 'server-only-ai-secret';
    process.env.SEARCH_PROVIDER = 'InternalSearch';
    process.env.SEARCH_API_KEY = 'server-only-search-secret';
    const config = getInternalProviderConfig();
    assert.deepEqual(config, {
      ai: { provider: 'InternalAI', endpoint: 'https://internal.example/v1', model: 'internal-model', apiKey: 'server-only-ai-secret' },
      search: { provider: 'InternalSearch', apiKey: 'server-only-search-secret' },
    });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('public runtime configuration contains only Firebase browser-safe values', () => {
  const names = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID', 'FIREBASE_MEASUREMENT_ID', 'MARKETMIND_FIREBASE_API_KEY', 'MARKETMIND_FIREBASE_AUTH_DOMAIN', 'MARKETMIND_FIREBASE_PROJECT_ID', 'MARKETMIND_FIREBASE_STORAGE_BUCKET', 'MARKETMIND_FIREBASE_MESSAGING_SENDER_ID', 'MARKETMIND_FIREBASE_APP_ID', 'MARKETMIND_FIREBASE_MEASUREMENT_ID', 'AI_API_KEY', 'SEARCH_API_KEY'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.FIREBASE_API_KEY = 'public-web-api-key';
    process.env.FIREBASE_AUTH_DOMAIN = 'marketmind.firebaseapp.com';
    process.env.FIREBASE_PROJECT_ID = 'marketmind';
    process.env.FIREBASE_STORAGE_BUCKET = 'marketmind.firebasestorage.app';
    process.env.FIREBASE_MESSAGING_SENDER_ID = '123456789';
    process.env.FIREBASE_APP_ID = '1:123456789:web:abcdef';
    process.env.FIREBASE_MEASUREMENT_ID = 'G-ABCDE';
    process.env.AI_API_KEY = 'server-only-ai-secret';
    process.env.SEARCH_API_KEY = 'server-only-search-secret';
    assert.deepEqual(getPublicRuntimeConfig(), { firebase: { apiKey: 'public-web-api-key', authDomain: 'marketmind.firebaseapp.com', projectId: 'marketmind', storageBucket: 'marketmind.firebasestorage.app', messagingSenderId: '123456789', appId: '1:123456789:web:abcdef', measurementId: 'G-ABCDE' } });
    assert.equal(JSON.stringify(getPublicRuntimeConfig()).includes('server-only'), false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
