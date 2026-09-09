import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const browserFiles = ['index.html', 'js/app.js', 'js/auth.js', 'js/auth-routes.js', 'js/repository.js', 'js/storage.js', 'js/client/context.js', 'js/client/intelligence.js', 'js/client/campaign.js'];

test('browser-facing source has no admin credentials or provider credentials/endpoints', async () => {
  for (const file of browserFiles) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /FIREBASE_ADMIN|PRIVATE_KEY|client_email|service_account|service_role|AI_API_KEY|SEARCH_API_KEY|X-API-KEY|google\.serper\.dev|api\.tavily\.com/i, file);
  }
});

test('browser API calls use the Firebase session token without provider credentials', async () => {
  const authSource = await readFile('js/auth.js', 'utf8');
  const appSource = await readFile('js/app.js', 'utf8');
  assert.match(authSource, /getIdToken/);
  assert.match(authSource, /Authorization/);
  assert.match(appSource, /authenticatedFetch/);
  assert.doesNotMatch(authSource, /AI_API_KEY|SEARCH_API_KEY|google\.serper\.dev|api\.tavily\.com/i);
});

test('Firestore rules restrict workspace and strategy data to the signed-in owner', async () => {
  const rules = await readFile('firebase/firestore.rules', 'utf8');
  assert.match(rules, /match \/users\/{userId}/i);
  assert.match(rules, /match \/strategies\/{strategyId}/i);
  assert.match(rules, /request\.auth != null && request\.auth\.uid == userId/i);
  assert.doesNotMatch(rules, /allow read, write: if true/i);
});
