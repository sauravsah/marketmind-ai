function defaultEnvironment() {
  return globalThis.process?.env || {};
}

function environment(name, source = defaultEnvironment()) {
  return String(source?.[name] || '').trim();
}

export function getPublicRuntimeConfig(source = defaultEnvironment()) {
  return {
    firebase: {
      apiKey: environment('FIREBASE_API_KEY', source) || environment('MARKETMIND_FIREBASE_API_KEY', source),
      authDomain: environment('FIREBASE_AUTH_DOMAIN', source) || environment('MARKETMIND_FIREBASE_AUTH_DOMAIN', source),
      projectId: environment('FIREBASE_PROJECT_ID', source) || environment('MARKETMIND_FIREBASE_PROJECT_ID', source),
      storageBucket: environment('FIREBASE_STORAGE_BUCKET', source) || environment('MARKETMIND_FIREBASE_STORAGE_BUCKET', source),
      messagingSenderId: environment('FIREBASE_MESSAGING_SENDER_ID', source) || environment('MARKETMIND_FIREBASE_MESSAGING_SENDER_ID', source),
      appId: environment('FIREBASE_APP_ID', source) || environment('MARKETMIND_FIREBASE_APP_ID', source),
      measurementId: environment('FIREBASE_MEASUREMENT_ID', source) || environment('MARKETMIND_FIREBASE_MEASUREMENT_ID', source),
    },
  };
}

// Provider credentials are intentionally read only on the server. Never import this
// module from browser code or serialize its return value into a client response.
export function getInternalProviderConfig(source = defaultEnvironment()) {
  return {
    ai: {
      provider: environment('AI_PROVIDER', source) || environment('MARKETMIND_AI_PROVIDER', source) || 'OpenAI-compatible',
      endpoint: environment('AI_BASE_URL', source) || environment('MARKETMIND_AI_BASE_URL', source),
      model: environment('AI_MODEL', source) || environment('MARKETMIND_AI_MODEL', source) || 'gpt-4o-mini',
      apiKey: environment('AI_API_KEY', source) || environment('MARKETMIND_AI_API_KEY', source),
      ...(environment('AI_MAX_OUTPUT_TOKENS', source) || environment('MARKETMIND_AI_MAX_OUTPUT_TOKENS', source)
        ? { maxTokens: environment('AI_MAX_OUTPUT_TOKENS', source) || environment('MARKETMIND_AI_MAX_OUTPUT_TOKENS', source) }
        : {}),
      ...(environment('AI_REASONING_EFFORT', source) || environment('MARKETMIND_AI_REASONING_EFFORT', source)
        ? { reasoningEffort: environment('AI_REASONING_EFFORT', source) || environment('MARKETMIND_AI_REASONING_EFFORT', source) }
        : {}),
      ...(environment('AI_PROMPT_TOKEN_BUDGET', source) || environment('MARKETMIND_AI_PROMPT_TOKEN_BUDGET', source)
        ? { promptTokenBudget: environment('AI_PROMPT_TOKEN_BUDGET', source) || environment('MARKETMIND_AI_PROMPT_TOKEN_BUDGET', source) }
        : {}),
      ...(environment('AI_RETRY_BUDGET_MS', source) || environment('MARKETMIND_AI_RETRY_BUDGET_MS', source)
        ? { retryBudgetMs: environment('AI_RETRY_BUDGET_MS', source) || environment('MARKETMIND_AI_RETRY_BUDGET_MS', source) }
        : {}),
    },
    search: {
      provider: environment('SEARCH_PROVIDER', source) || environment('MARKETMIND_SEARCH_PROVIDER', source) || 'Serper',
      apiKey: environment('SEARCH_API_KEY', source) || environment('MARKETMIND_SEARCH_API_KEY', source),
    },
  };
}
