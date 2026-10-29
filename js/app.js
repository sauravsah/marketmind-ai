import {
  AUDIENCE_DEPTH_OPTIONS,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_SCALES,
  OPPORTUNITY_LENS_OPTIONS,
  PURCHASE_RELATIONSHIPS,
  PERSONALITY_OPTIONS,
  RESEARCH_DEPTH_OPTIONS,
  RESEARCH_FILTERS,
  TONE_OPTIONS,
  createEmptyResearch,
  createEmptyOpportunityRadar,
  createEmptyCampaignStrategy,
  createDefaultBrandProfile,
  createDefaultStrategy,
} from './models.js';
import { buildStrategyContext } from './client/context.js';
import { assessIntelligence, researchIsStale } from './client/intelligence.js';
import { applyCampaignOverrides } from './client/campaign.js';
import { storage } from './storage.js';
import { collectStrategyBrief } from './strategy-brief.js';
import { authService, authErrorMessage, authenticatedFetch } from './auth.js';
import { createWorkspaceRepository, summarizeMigration } from './repository.js';
import { decideAuthRoute, isProtectedRoute, isVerifiedUser, routeFromHash as mapHashRoute, PUBLIC_ROUTES } from './auth-routes.js';
import { appendResearchRun, countResearchSignals, researchRunIsCurrent } from './research-history.js';
import {
  AUDIENCE_ITEM_KEYS,
  applyAudienceClaimReview,
  ensureAudienceClaimMetadata,
  ensureAudienceReviewProfile,
  getAudienceReviewSummary,
  getRadarEligibleAudienceItems,
  mergeAudienceReviewState,
} from './audience-review.js';

function routeFromHash() {
  const queryMode = new URLSearchParams(window.location.search).get('mode');
  if (queryMode === 'resetPassword') return 'reset-password';
  if (queryMode === 'verifyEmail') return 'verify-email';
  return mapHashRoute(window.location.hash);
}

const WORKSPACE_ROUTES = new Set(['dashboard', 'strategy', 'research', 'audience', 'radar', 'campaigns', 'brand', 'workspace']);
const PAGE_LABELS = { dashboard: 'Dashboard', strategy: 'New Strategy', research: 'Market Intelligence', audience: 'Audience Intelligence', radar: 'Opportunity Radar', campaigns: 'Campaign Strategy', brand: 'Brand Voice', workspace: 'Workspace' };

const state = {
  page: routeFromHash(),
  brand: storage.getBrand(createDefaultBrandProfile()),
  strategies: storage.getStrategies(),
  workspace: storage.getWorkspace(),
  strategy: createDefaultStrategy(),
  researchFilter: 'all',
  audienceReviewFilter: 'all',
  audienceEditingClaimId: null,
  audienceValidationClaimId: null,
  selectedSource: null,
  researchRun: null,
  audienceRun: null,
  opportunityRun: null,
  campaignRun: null,
  campaignEditorOpen: false,
  campaignHandoff: false,
  compareTerritoryIds: [],
  openOpportunityId: null,
  compareOpportunityIds: [],
  auth: { status: 'loading', configured: null, session: null, user: null, error: null, redirectTo: null, feedback: null, pendingEmail: '' },
  cloud: { status: 'idle', repository: null, error: null, userId: null },
  migration: { status: 'idle', summary: null, error: null },
  betaFeedback: { open: false, sending: false, error: null },
};

const activeRequests = new Map();

function beginRequest(key) {
  activeRequests.get(key)?.abort();
  const controller = new AbortController();
  activeRequests.set(key, controller);
  return controller;
}

function finishRequest(key, controller) {
  if (activeRequests.get(key) === controller) activeRequests.delete(key);
}

function abortActiveRequests() {
  const runStateByRequest = {
    research: 'researchRun',
    audience: 'audienceRun',
    radar: 'opportunityRun',
    campaigns: 'campaignRun',
  };
  activeRequests.forEach((controller, key) => {
    controller.abort();
    if (runStateByRequest[key]) state[runStateByRequest[key]] = null;
  });
  activeRequests.clear();
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

const root = document.querySelector('#app');

if (state.page === 'research' || state.page === 'audience' || state.page === 'radar' || state.page === 'campaigns') {
  const savedStrategy = state.strategies.find((strategy) => strategy.campaignStrategy || strategy.opportunityRadar || strategy.audienceInsights || strategy.research) || state.strategies[0];
  if (savedStrategy) state.strategy = { ...state.strategy, ...normalizeStrategyAudience(savedStrategy) };
}

const icons = {
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  sparkles: '<path d="m12 3-1.3 5.7L5 10l5.7 1.3L12 17l1.3-5.7L19 10l-5.7-1.3L12 3Z"/><path d="m5 16-.6 2.4L2 19l2.4.6L5 22l.6-2.4L8 19l-2.4-.6L5 16ZM19 2l-.5 1.5L17 4l1.5.5L19 6l.5-1.5L21 4l-1.5-.5L19 2Z"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12 18 6M12 3.5V2M20.5 12H22M12 20.5V22M3.5 12H2"/><circle cx="12" cy="12" r="1.3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  message: '<path d="M20 11.5a7.5 7.5 0 0 1-7.8 7.5 8.7 8.7 0 0 1-3.5-.7L4 20l1.7-4.2A7.3 7.3 0 0 1 4.5 11c.5-3.8 3.7-6.5 7.7-6.5A7.5 7.5 0 0 1 20 11.5Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.3a2 2 0 1 1-4 0v-.2A2 2 0 0 0 5.8 18l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 1.6 12a2 2 0 1 1 0-4h.2A2 2 0 0 0 3 4.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A2 2 0 0 0 9.2 0h.3a2 2 0 1 1 4 0v.2A2 2 0 0 0 17 1.8l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A2 2 0 0 0 21.2 8h.2a2 2 0 1 1 0 4h-.2a2 2 0 0 0-1.8 3Z" transform="translate(.4 1.7) scale(.8)"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 5.5V21M8 7h8M8 11h8"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0 2 5.3"/><path d="M20 5v6h-6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>',
  moon: '<path d="M20.5 14.7A8.5 8.5 0 0 1 9.3 3.5 8.5 8.5 0 1 0 20.5 14.7Z"/>',
};

function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
}

const THEME_STORAGE_KEY = 'marketmind.theme';

function readThemePreference() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* Private browsing or storage restrictions should not block rendering. */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function updateThemeControls() {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  document.querySelectorAll('[data-action="toggle-theme"]').forEach((button) => {
    button.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
    button.setAttribute('aria-pressed', String(theme === 'light'));
    button.dataset.theme = theme;
    const label = button.querySelector('[data-theme-label]');
    if (label) label.textContent = `${nextTheme === 'light' ? 'Light' : 'Dark'} mode`;
    const iconTarget = button.querySelector('[data-theme-icon]');
    if (iconTarget) iconTarget.innerHTML = icon(nextTheme === 'light' ? 'sun' : 'moon', 15);
  });
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  if (persist) {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch { /* Keep the theme for this page when storage is unavailable. */ }
  }
  updateThemeControls();
}

function themeToggleMarkup() {
  return `<button class="theme-toggle" type="button" data-action="toggle-theme" aria-label="Switch to light mode" aria-pressed="false"><span class="theme-toggle-icon" data-theme-icon>${icon('sun', 15)}</span><span data-theme-label>Light mode</span></button>`;
}

applyTheme(readThemePreference(), false);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function initials(name = '') {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'MM';
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
}

function sanitizeProductCopy(markup) {
  return markup
    .replaceAll('Configure an AI provider to turn the collected evidence into a grounded market view.', 'MarketMind is temporarily unable to complete this analysis. Please try again.')
    .replaceAll('AI synthesis is not configured. Evidence is shown without invented conclusions.', 'MarketMind is temporarily unable to complete this analysis. Please try again.')
    .replaceAll('Live evidence is available, but an AI provider has not synthesized it into signals yet.', 'MarketMind is temporarily unable to complete this analysis. Please try again.')
    .replaceAll('The provider returned no excerpt for this source.', 'No excerpt was available for this source.')
    .replaceAll('No creative territories are available yet. Regenerate this section when an AI provider is connected.', 'No creative territories are available yet. Try again when strategy generation is available.');
}

function loadingPage() {
  return `<div class="public-loading"><div class="brand-lockup"><div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div><div><div class="brand-name">MarketMind</div><div class="brand-caption">MARKETING INTELLIGENCE</div></div></div><p>Preparing your workspace…</p></div>`;
}

function publicHeader() {
  return `<header class="public-header"><a class="public-brand" href="#landing" data-route="landing" aria-label="MarketMind home"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span><strong>MarketMind</strong><small>MARKETING INTELLIGENCE</small></span></a><nav class="public-nav" aria-label="Public navigation"><a href="#how-it-works">How it works</a><a href="#capabilities">Capabilities</a><a href="#evidence">Evidence philosophy</a></nav><button class="public-nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="public-mobile-nav" data-action="toggle-public-nav"><span></span><span></span><span></span></button><div class="public-nav-panel" id="public-mobile-nav" aria-label="Mobile navigation"><a href="#how-it-works">How it works</a><a href="#capabilities">Capabilities</a><a href="#evidence">Evidence philosophy</a></div><div class="public-actions"><div class="public-theme-toggle">${themeToggleMarkup()}</div><button class="button button-ghost" type="button" data-route="sign-in">Sign in</button><button class="button button-primary" type="button" data-route="sign-up">Get started ${icon('arrow', 15)}</button></div></header>`;
}

function landingVisualMap() {
  const stages = [
    { number: '01', title: 'Strategy', detail: 'Frame the decision clearly.', output: 'A focused brief', icon: 'sparkles', tone: 'green' },
    { number: '02', title: 'Market', detail: 'See what is changing now.', output: 'A sourced signal set', icon: 'radar', tone: 'green' },
    { number: '03', title: 'Audience', detail: 'Map people, tensions, and gaps.', output: 'An evidence-aware audience map', icon: 'message', tone: 'violet' },
    { number: '04', title: 'Radar', detail: 'Compare openings worth exploring.', output: 'A ranked opportunity shortlist', icon: 'radar', tone: 'amber' },
    { number: '05', title: 'Campaign', detail: 'Give the choice a strategic shape.', output: 'A grounded campaign direction', icon: 'layers', tone: 'green' },
  ];
  return `<section class="decision-map" id="workflow-map" aria-labelledby="decision-map-title"><div class="decision-map-heading"><div><div class="eyebrow">THE WHOLE SYSTEM AT A GLANCE</div><h2 id="decision-map-title">Five stages.<br><em>One clearer next move.</em></h2></div><p>Each stage hands a more useful piece of context to the next. The result is a connected path from an open question to a campaign direction your team can explain.</p></div><div class="decision-map-visual"><div class="decision-map-track" aria-hidden="true"></div><ol class="decision-map-nodes">${stages.map((stage, index) => `<li class="decision-map-node tone-${stage.tone}"><div class="decision-map-node-top"><span class="decision-map-number">${stage.number}</span><span class="decision-map-icon">${icon(stage.icon, 17)}</span></div><h3>${stage.title}</h3><p>${stage.detail}</p><span class="decision-map-output"><i></i>${stage.output}</span>${index < stages.length - 1 ? `<span class="decision-map-arrow" aria-hidden="true">${icon('arrow', 15)}</span>` : ''}</li>`).join('')}</ol></div><div class="decision-map-legend" aria-label="Evidence labels used in the workflow"><span><i class="evidence-dot observed"></i>Observed</span><span><i class="evidence-dot inferred"></i>Inferred</span><span><i class="evidence-dot hypothesis"></i>Hypothesis</span><span><i class="evidence-dot unknown"></i>Unknown</span><small>Evidence stays visible as the work moves forward.</small></div></section>`;
}

function landingPage() {
  const stages = [
    ['01', 'Strategy', 'Start with the decision, launch, or challenge you need to understand.'],
    ['02', 'Market intelligence', 'Bring current market evidence and source context into the room.'],
    ['03', 'Audience intelligence', 'Map motivations, barriers, behavior, and unknowns with humility.'],
    ['04', 'Opportunity radar', 'Connect the strongest signals into opportunities worth exploring.'],
    ['05', 'Campaign strategy', 'Turn a selected opportunity into a grounded campaign direction.'],
  ];
  return `<div class="public-page landing-page"><div class="public-shell">${publicHeader()}<main><section class="landing-hero"><div class="hero-ambient hero-ambient-one"></div><div class="hero-ambient hero-ambient-two"></div><div class="landing-hero-copy"><div class="eyebrow"><span class="status-pulse"></span> MARKETING INTELLIGENCE FOR WHAT COMES NEXT</div><h1>Know what is changing.<br><em>Decide what to do next.</em></h1><p>MarketMind helps marketing teams and founders move from a sharp question to a clear, evidence-aware direction — without confusing confident language for certainty.</p><div class="landing-hero-actions"><button class="button button-primary button-large" type="button" data-route="sign-up">Explore your next move ${icon('arrow', 17)}</button><button class="text-button" type="button" data-route="sign-in">Already have an account? Sign in</button></div><div class="landing-proof-line"><span>${icon('check', 14)} Current signals, clearly sourced</span><span>${icon('check', 14)} One connected workflow</span><span>${icon('check', 14)} No invented evidence</span></div></div><div class="landing-hero-visual" aria-label="A visual preview of the MarketMind workflow"><div class="visual-ring ring-large"></div><div class="visual-ring ring-small"></div><div class="visual-core"><span class="visual-core-dot"></span><small>YOUR QUESTION</small><strong>What changed<br>around us?</strong></div><div class="visual-chip visual-chip-top"><span class="chip-dot green"></span> Market signal <strong>Observed</strong></div><div class="visual-chip visual-chip-right"><span class="chip-dot violet"></span> Audience context <strong>Inferred</strong></div><div class="visual-chip visual-chip-bottom"><span class="chip-dot amber"></span> Next move <strong>To explore</strong></div><div class="visual-axis axis-one"></div><div class="visual-axis axis-two"></div><div class="visual-axis axis-three"></div></div></section><section class="landing-intro" id="how-it-works"><div><div class="eyebrow">A BETTER ORDER OF OPERATIONS</div><h2>From noise to<br><em>direction.</em></h2></div><p>MarketMind keeps strategy, research, audience understanding, opportunity selection, and campaign planning in one deliberate path. Every stage adds context to the next — and keeps the boundary between evidence and interpretation visible.</p></section><section class="workflow-section"><div class="workflow-line" aria-hidden="true"></div><div class="workflow-cards">${stages.map(([number, title, detail]) => `<article class="workflow-card"><div class="workflow-card-number">${number}</div><div class="workflow-card-icon">${icon(number === '01' ? 'sparkles' : number === '02' ? 'radar' : number === '03' ? 'message' : number === '04' ? 'radar' : 'layers', 19)}</div><h3>${title}</h3><p>${detail}</p><span class="workflow-card-arrow">${icon('arrow', 15)}</span></article>`).join('')}</div></section><section class="capabilities-section" id="capabilities"><div class="section-intro"><div class="eyebrow">THE INTELLIGENCE LAYER</div><h2>Make the next decision<br><em>feel less foggy.</em></h2><p>Each capability is useful on its own. Together, they create a shared line of sight from what is happening to what your team can credibly do about it.</p></div><div class="capability-grid"><article class="capability-card capability-wide"><div class="capability-index">01 · MARKET</div><h3>See the field as it is moving.</h3><p>Search current signals across news, category, culture, competitors, technology, and events. Explore sources, freshness, confidence, and contradictions before a conclusion is drawn.</p><div class="capability-visual market-visual"><span class="bar bar-one"></span><span class="bar bar-two"></span><span class="bar bar-three"></span><span class="bar bar-four"></span><span class="bar bar-five"></span><span class="market-label">CURRENT<br>SIGNALS</span></div></article><article class="capability-card"><div class="capability-index">02 · AUDIENCE</div><h3>Understand the people inside the problem.</h3><p>Turn context into a model of motivations, frictions, decision moments, and behavioral tensions — with unknowns kept explicit.</p><div class="audience-visual"><span>OBSERVED</span><span>INFERRED</span><span>HYPOTHESIS</span><span>UNKNOWN</span></div></article><article class="capability-card"><div class="capability-index">03 · OPPORTUNITY</div><h3>Find the openings worth a closer look.</h3><p>Connect market evidence, audience context, brand fit, timing, and actionability into a shortlist your team can compare.</p><div class="opportunity-visual"><span class="opportunity-point point-a"></span><span class="opportunity-point point-b"></span><span class="opportunity-point point-c"></span><span class="opportunity-path"></span></div></article><article class="capability-card capability-wide campaign-capability"><div class="capability-index">04 · CAMPAIGN STRATEGY</div><h3>Give the chosen opportunity a strategic shape.</h3><p>Develop the role, audience, objective, platforms, territories, phases, and measurement logic around the opportunity you selected. Production stays a separate, explicit future boundary.</p><div class="campaign-visual"><span class="campaign-block active">OPPORTUNITY</span><span class="campaign-connector"></span><span class="campaign-block">CAMPAIGN<br>DIRECTION</span><span class="campaign-connector"></span><span class="campaign-block muted">PHASE 06<br>NOT HERE</span></div></article></div></section><section class="evidence-section" id="evidence"><div class="evidence-quote"><div class="eyebrow">THE MARKETMIND PROMISE</div><h2>Useful confidence<br><em>has edges.</em></h2><p>We separate observed facts from interpretation, hypothesis, and unknown. Sources stay close to the claims they support. When live evidence or synthesis is unavailable, the product says so.</p><button class="text-button" type="button" data-route="sign-up">See the workflow in action ${icon('arrow', 15)}</button></div><div class="evidence-list"><div><span class="evidence-dot observed"></span><div><strong>Observed</strong><p>What the available evidence directly supports.</p></div></div><div><span class="evidence-dot inferred"></span><div><strong>Inferred</strong><p>A reasoned reading that should stay connected to its source.</p></div></div><div><span class="evidence-dot hypothesis"></span><div><strong>Hypothesis</strong><p>A promising idea to test, not a fact to repeat.</p></div></div><div><span class="evidence-dot unknown"></span><div><strong>Unknown</strong><p>An honest gap where more evidence is needed.</p></div></div></div></section><section class="landing-preview"><div class="preview-copy"><div class="eyebrow">A QUIETER WAY TO WORK</div><h2>One question.<br><em>Five connected moves.</em></h2><p>Use the progression rail to move forward when a stage is ready, revisit completed work whenever you need, and keep Brand Voice and Workspace settings available without competing with the main journey.</p></div><div class="preview-window"><div class="preview-window-top"><span class="preview-dot"></span><span class="preview-dot"></span><span class="preview-dot"></span><span>MARKETMIND / STRATEGY</span></div><div class="preview-rail"><span class="preview-stage active"><b>01</b>Strategy</span><span class="preview-stage"><b>02</b>Market</span><span class="preview-stage"><b>03</b>Audience</span><span class="preview-stage"><b>04</b>Radar</span><span class="preview-stage"><b>05</b>Campaign</span></div><div class="preview-window-body"><div class="preview-kicker">STRATEGY QUESTION</div><strong>What should we<br><em>figure out next?</em></strong><div class="preview-input"></div><div class="preview-input short"></div><div class="preview-button">Continue ${icon('arrow', 13)}</div></div></div></section><section class="landing-cta"><div><div class="eyebrow">YOUR NEXT MOVE STARTS HERE</div><h2>Bring the question.<br><em>Leave with direction.</em></h2></div><div><p>Create a workspace for the decisions your team is already trying to make.</p><button class="button button-primary button-large" type="button" data-route="sign-up">Create your workspace ${icon('arrow', 17)}</button></div></section></main><footer class="public-footer"><span>MARKETMIND AI</span><span>Marketing intelligence for what comes next.</span><span>© ${new Date().getFullYear()}</span></footer></div></div>`;
}

function authPage(route) {
  const isSignUp = route === 'sign-up';
  const isForgot = route === 'forgot-password';
  const isReset = route === 'reset-password';
  const isVerify = route === 'verify-email';
  const feedback = state.auth.feedback;
  const email = state.auth.pendingEmail || '';
  const configNotice = state.auth.configured === false ? `<div class="config-notice" role="status">${icon('settings', 15)} <span>Authentication is not connected yet. Add the Firebase web configuration to the server environment to activate accounts.</span></div>` : '';
  let content = '';
  if (isVerify) {
    content = `<div class="auth-message-card"><div class="auth-icon">${icon('check', 24)}</div><div class="eyebrow">ONE SMALL STEP</div><h1>Check your<br><em>inbox.</em></h1><p>We sent a verification link${email ? ` to <strong>${escapeHtml(email)}</strong>` : ''}. Verify your email before opening the workspace.</p>${feedback ? `<div class="form-feedback ${feedback.type}" role="status">${escapeHtml(feedback.message)}</div>` : ''}<button class="button button-primary button-wide" type="button" data-auth-action="resend">Resend verification email ${icon('arrow', 16)}</button><button class="text-button centered" type="button" data-route="sign-in">Back to sign in</button></div>`;
  } else if (isForgot) {
    content = `<div class="auth-form-card"><div class="eyebrow">ACCOUNT RECOVERY</div><h1>Reset your<br><em>password.</em></h1><p>Enter your email and we’ll send a secure reset link.</p>${feedback ? `<div class="form-feedback ${feedback.type}" role="alert">${escapeHtml(feedback.message)}</div>` : ''}<form id="forgot-form" class="auth-form" novalidate><div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required value="${escapeHtml(email)}" placeholder="you@company.com"></div><button class="button button-primary button-wide" type="submit">Send reset link ${icon('arrow', 16)}</button></form><button class="text-button centered" type="button" data-route="sign-in">Back to sign in</button></div>`;
  } else if (isReset) {
    content = `<div class="auth-form-card"><div class="eyebrow">ACCOUNT RECOVERY</div><h1>Choose a new<br><em>password.</em></h1><p>Set a new password for your MarketMind account.</p>${feedback ? `<div class="form-feedback ${feedback.type}" role="alert">${escapeHtml(feedback.message)}</div>` : ''}<form id="reset-form" class="auth-form" novalidate><div class="field"><label for="auth-password">New password</label><input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></div><div class="field"><label for="auth-password-confirm">Confirm password</label><input id="auth-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="Repeat your password"></div><button class="button button-primary button-wide" type="submit">Update password ${icon('arrow', 16)}</button></form></div>`;
  } else {
    content = `<div class="auth-form-card"><div class="eyebrow">${isSignUp ? 'CREATE YOUR WORKSPACE' : 'WELCOME BACK'}</div><h1>${isSignUp ? 'Start with a<br><em>sharp question.</em>' : 'Return to your<br><em>direction.</em>'}</h1><p>${isSignUp ? 'Create your account and bring your team’s next decision into focus.' : 'Sign in to continue the intelligence path you started.'}</p>${feedback ? `<div class="form-feedback ${feedback.type}" role="alert">${escapeHtml(feedback.message)}</div>` : ''}<form id="auth-form" class="auth-form" novalidate><div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required value="${escapeHtml(email)}" placeholder="you@company.com"></div><div class="field"><div class="field-label-row"><label for="auth-password">Password</label>${!isSignUp ? '<button class="inline-link" type="button" data-route="forgot-password">Forgot password?</button>' : ''}</div><input id="auth-password" name="password" type="password" autocomplete="${isSignUp ? 'new-password' : 'current-password'}" minlength="8" required placeholder="At least 8 characters"></div>${isSignUp ? '<div class="field"><label for="auth-password-confirm">Confirm password</label><input id="auth-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="Repeat your password"></div>' : ''}<button class="button button-primary button-wide" type="submit">${isSignUp ? 'Create account' : 'Sign in'} ${icon('arrow', 16)}</button></form><p class="auth-switch">${isSignUp ? 'Already have an account?' : 'New to MarketMind?'} <button class="inline-link" type="button" data-route="${isSignUp ? 'sign-in' : 'sign-up'}">${isSignUp ? 'Sign in' : 'Create an account'}</button></p></div>`;
  }
  return `<div class="public-page auth-page"><div class="auth-shell"><div class="auth-topbar"><a class="public-brand auth-brand" href="#landing" data-route="landing" aria-label="MarketMind home"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span><strong>MarketMind</strong><small>MARKETING INTELLIGENCE</small></span></a>${themeToggleMarkup()}</div>${configNotice}<div class="auth-layout"><div class="auth-aside"><div class="eyebrow">${isVerify ? 'EMAIL VERIFICATION' : 'MARKETING INTELLIGENCE FOR WHAT COMES NEXT'}</div><h2>${isVerify ? 'Your workspace is<br><em>almost ready.</em>' : 'Keep the signal.<br><em>Lose the noise.</em>'}</h2><p>${isVerify ? 'A verified account keeps your strategy context and intelligence private to you.' : 'A focused workflow for teams who need to make a better next move, with evidence and uncertainty in the same frame.'}</p><div class="auth-aside-line"></div><span class="auth-aside-note">STRATEGY → MARKET → AUDIENCE → OPPORTUNITY → CAMPAIGN</span></div>${content}</div><footer class="public-footer auth-footer"><span>© ${new Date().getFullYear()} MarketMind AI</span><button class="inline-link" type="button" data-route="landing">Back to home</button></footer></div></div>`;
}

function betaFeedbackModal() {
  if (!state.betaFeedback.open) return '';
  return `<div class="feedback-overlay" data-action="close-feedback"><section class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" data-feedback-dialog><button class="modal-close" type="button" aria-label="Close feedback" data-action="close-feedback">${icon('close', 17)}</button><div class="eyebrow">BETA FEEDBACK</div><h2 id="feedback-title">Help us make the next move clearer.</h2><p>Share a short note about what worked, what felt confusing, or what you would change.</p>${state.betaFeedback.error ? `<div class="form-feedback error" role="alert">${escapeHtml(state.betaFeedback.error)}</div>` : ''}<form id="beta-feedback-form"><label for="feedback-category">Feedback type</label><select id="feedback-category" name="category" required><option value="bug">Something is broken</option><option value="confusing">Something is confusing</option><option value="idea">I have an idea</option><option value="praise">Something worked well</option><option value="other">Other</option></select><label for="feedback-message">Your note</label><textarea id="feedback-message" name="message" rows="5" maxlength="1200" required placeholder="What should we know?"></textarea><div class="feedback-dialog-actions"><button class="button button-secondary" type="button" data-action="close-feedback">Cancel</button><button class="button button-primary" type="submit" ${state.betaFeedback.sending ? 'disabled' : ''}>${state.betaFeedback.sending ? 'Sending…' : 'Send feedback'} ${icon('arrow', 15)}</button></div></form></section></div>`;
}

function renderPublic() {
  root.innerHTML = state.page === 'landing' ? landingPage() : authPage(state.page);
  attachPublicEvents();
}

function attachThemeEvents() {
  document.querySelectorAll('[data-action="toggle-theme"]').forEach((element) => element.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }));
  updateThemeControls();
}

function setAuthFeedback(type, message) {
  state.auth.feedback = { type, message };
  render();
}

async function loadCloudWorkspace() {
  if (state.cloud.status === 'loading' && state.cloud.userId === state.auth.user?.id) return;
  state.cloud.status = 'loading';
  state.cloud.userId = state.auth.user?.id || null;
  try {
    const client = await authService.getClient();
    if (!client || !state.auth.user?.id) throw new Error('Workspace persistence is not configured yet.');
    const repository = createWorkspaceRepository({ client, userId: state.auth.user.id });
    state.cloud.repository = repository;
    let workspace = await repository.getWorkspace();
    const strategies = await repository.getStrategies();
    if (!workspace) workspace = await repository.saveWorkspace({ workspaceName: '', defaultMarket: '', defaultAudience: '', defaultPlatform: '', defaultObjective: '', brandProfile: {} });
    state.workspace = { ...state.workspace, ...workspace };
    state.brand = { ...createDefaultBrandProfile(), ...(workspace.brandProfile || {}) };
    state.strategies = strategies.map((strategy) => normalizeStrategyAudience(strategy));
    state.strategy = state.strategies[0] ? { ...createDefaultStrategy(), ...state.strategies[0] } : createDefaultStrategy();
    state.cloud.status = 'ready';
    const marker = storage.getMigrationMarker(state.auth.user.id);
    if (!marker && storage.hasLocalData()) {
      const snapshot = storage.getLocalSnapshot();
      state.migration = { status: 'pending', summary: summarizeMigration(snapshot, workspace, strategies), error: null };
      render();
      return;
    }
    state.migration = { status: 'ready', summary: null, error: null };
    const decision = decideAuthRoute(state.auth.redirectTo || state.page, state.auth.session, state.auth.user);
    state.page = decision.route;
    state.auth.redirectTo = null;
    render();
  } catch (error) {
    state.cloud.status = 'error';
    state.cloud.repository = null;
    state.cloud.error = error;
    state.auth.status = 'signed-in';
    state.auth.feedback = { type: 'error', message: 'Your account is signed in, but the workspace could not be loaded. Check the Firebase Firestore rules and try again.' };
    state.page = 'workspace';
    render();
  }
}

async function applyAuthState(session, user = session?.user || null) {
  state.auth.session = session || null;
  state.auth.user = user || session?.user || null;
  state.auth.feedback = null;
  if (!session) {
    state.auth.status = 'signed-out';
    state.cloud = { status: 'idle', repository: null, error: null, userId: null };
    state.migration = { status: 'idle', summary: null, error: null };
    const decision = decideAuthRoute(state.page, null);
    state.page = decision.route;
    state.auth.redirectTo = decision.redirectTo || state.auth.redirectTo || null;
    if (window.location.hash !== `#${state.page}`) window.history.replaceState(null, '', `#${state.page}`);
    render();
    return;
  }
  if (!isVerifiedUser(state.auth.user)) {
    state.auth.status = 'signed-in-unverified';
    state.auth.pendingEmail = state.auth.user?.email || state.auth.pendingEmail;
    const decision = decideAuthRoute(state.auth.redirectTo || state.page, state.auth.session, state.auth.user);
    state.auth.redirectTo = decision.redirectTo || state.auth.redirectTo;
    state.page = 'verify-email';
    if (window.location.hash !== '#verify-email') window.history.replaceState(null, '', '#verify-email');
    render();
    return;
  }
  if (state.cloud.status === 'ready' && state.cloud.userId === state.auth.user?.id) {
    const decision = decideAuthRoute(state.auth.redirectTo || state.page, state.auth.session, state.auth.user);
    state.page = decision.route;
    state.auth.redirectTo = null;
    render();
    return;
  }
  state.auth.status = 'signed-in';
  await loadCloudWorkspace();
}

function attachMigrationEvents() {
  document.querySelector('[data-migration-action="skip"]')?.addEventListener('click', () => {
    storage.setMigrationMarker(state.auth.user.id, { completedAt: new Date().toISOString(), skipped: true });
    state.migration = { status: 'ready', summary: null, error: null };
    state.page = state.auth.redirectTo || 'dashboard';
    state.auth.redirectTo = null;
    render();
  });
  document.querySelector('[data-migration-action="import"]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    state.migration.error = null;
    try {
      const result = await state.cloud.repository.migrateLocalData();
      state.workspace = { ...state.workspace, ...result.workspace };
      state.brand = { ...createDefaultBrandProfile(), ...(result.workspace.brandProfile || {}) };
      state.strategies = result.strategies.map((strategy) => normalizeStrategyAudience(strategy));
      state.strategy = state.strategies[0] ? { ...createDefaultStrategy(), ...state.strategies[0] } : createDefaultStrategy();
      state.migration = { status: 'ready', summary: result.summary, error: null };
      state.page = state.auth.redirectTo || 'dashboard';
      state.auth.redirectTo = null;
      render();
      showToast(`Imported ${result.imported.length} strateg${result.imported.length === 1 ? 'y' : 'ies'} into your workspace.`, 'success');
    } catch (error) {
      state.migration.error = 'The import could not be completed. Your local backup is unchanged.';
      event.currentTarget.disabled = false;
      render();
    }
  });
}

function attachPublicEvents() {
  attachThemeEvents();
  const landing = document.querySelector('.landing-page');
  if (landing && !landing.querySelector('.decision-map')) {
    landing.querySelector('.landing-intro')?.insertAdjacentHTML('afterend', landingVisualMap());
  }
  // The visual map is the single landing-page walkthrough; remove the older
  // card strip that preceded it so visitors do not see the journey twice.
  landing?.querySelector('.workflow-section')?.remove();
  if (landing && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    landing.classList.add('motion-ready');
    const revealables = landing.querySelectorAll('.landing-intro, .decision-map, .workflow-card, .capabilities-section, .capability-card, .evidence-section, .landing-preview, .landing-cta');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      revealables.forEach((element) => {
        element.classList.add('motion-reveal');
        observer.observe(element);
      });
    } else {
      revealables.forEach((element) => element.classList.add('is-visible'));
    }
  }
  document.querySelectorAll('[data-route]').forEach((element) => element.addEventListener('click', (event) => {
    if (element.tagName === 'A') event.preventDefault();
    navigate(element.dataset.route);
  }));
  document.querySelectorAll('[data-action="toggle-public-nav"]').forEach((element) => element.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('public-nav-open');
    element.setAttribute('aria-expanded', String(isOpen));
    element.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  }));
  document.querySelectorAll('.public-nav-panel a').forEach((element) => element.addEventListener('click', () => document.body.classList.remove('public-nav-open')));
  document.querySelector('#auth-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const confirmPassword = String(data.get('confirmPassword') || '');
    if (!email || !email.includes('@')) return setAuthFeedback('error', 'Enter a valid email address.');
    if (password.length < 8) return setAuthFeedback('error', 'Use a password with at least 8 characters.');
    if (state.page === 'sign-up' && password !== confirmPassword) return setAuthFeedback('error', 'Passwords do not match.');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    state.auth.pendingEmail = email;
    try {
      if (state.page === 'sign-up') {
        const { data: result, error } = await authService.signUp(email, password);
        if (error) throw error;
        state.auth.feedback = { type: 'success', message: 'Verification email sent. Check your inbox to continue.' };
        state.auth.pendingEmail = result?.user?.email || email;
        state.page = 'verify-email';
        window.location.hash = 'verify-email';
        render();
      } else {
        const { data: result, error } = await authService.signIn(email, password);
        if (error) throw error;
        state.auth.session = result?.session || null;
        state.auth.user = result?.user || result?.session?.user || null;
        await applyAuthState(state.auth.session, state.auth.user);
      }
    } catch (error) {
      submit.disabled = false;
      if (state.page === 'sign-in' && /email not confirmed/i.test(String(error?.message || ''))) {
        state.auth.feedback = { type: 'error', message: 'Verify your email before entering the workspace.' };
        state.page = 'verify-email';
        window.history.replaceState(null, '', '#verify-email');
        render();
        return;
      }
      setAuthFeedback('error', authErrorMessage(error));
    }
  });
  document.querySelector('#forgot-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') || '').trim();
    if (!email || !email.includes('@')) return setAuthFeedback('error', 'Enter a valid email address.');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const { error } = await authService.sendPasswordReset(email);
      if (error) throw error;
      state.auth.pendingEmail = email;
      setAuthFeedback('success', 'If an account matches that email, a secure reset link is on its way.');
    } catch (error) {
      submit.disabled = false;
      setAuthFeedback('error', authErrorMessage(error));
    }
  });
  document.querySelector('#reset-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    if (password.length < 8) return setAuthFeedback('error', 'Use a password with at least 8 characters.');
    if (password !== String(data.get('confirmPassword') || '')) return setAuthFeedback('error', 'Passwords do not match.');
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const { error } = await authService.updatePassword(password);
      if (error) throw error;
      state.auth.feedback = { type: 'success', message: 'Password updated. You can sign in with your new password.' };
      state.page = 'sign-in';
      window.location.hash = 'sign-in';
      render();
    } catch (error) {
      submit.disabled = false;
      setAuthFeedback('error', authErrorMessage(error));
    }
  });
  document.querySelector('[data-auth-action="resend"]')?.addEventListener('click', async (event) => {
    const email = state.auth.pendingEmail;
    if (!email) return setAuthFeedback('error', 'Enter your email on the sign-in screen so we know where to send the verification link.');
    event.currentTarget.disabled = true;
    try {
      const { error } = await authService.resendVerification(email);
      if (error) throw error;
      setAuthFeedback('success', 'A fresh verification link is on its way.');
    } catch (error) {
      event.currentTarget.disabled = false;
      setAuthFeedback('error', authErrorMessage(error));
    }
  });
}

function renderShell(content) {
  const brandName = state.workspace.workspaceName || state.brand.name || 'Your workspace';
  const workspaceSyncNotice = state.cloud.error ? `<div class="config-notice workspace-sync-notice" role="alert">${icon('sparkles', 15)}<span>Your account is signed in, but workspace sync is unavailable. Check the Firebase Firestore rules, then <button class="inline-link" type="button" data-action="retry-cloud">retry the connection</button>.</span></div>` : '';
  root.innerHTML = sanitizeProductCopy(`
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <div><div class="brand-name">MarketMind</div><div class="brand-caption">MARKETING INTELLIGENCE</div></div>
        </div>
          <details class="account-menu">
            <summary class="workspace-switcher" aria-label="Open workspace and account menu">
            <div class="avatar">${escapeHtml(initials(state.brand.name))}</div>
            <div class="workspace-copy"><strong>${escapeHtml(brandName)}</strong><span>${escapeHtml(state.auth.user?.email || 'Workspace account')}</span></div>
            ${icon('chevron', 15)}
            </summary>
            <div class="account-popover"><button type="button" data-route="workspace">${icon('settings', 15)} Workspace settings</button><button type="button" data-route="brand">${icon('message', 15)} Brand voice</button><button type="button" data-action="open-feedback">${icon('message', 15)} Send beta feedback</button><div class="account-popover-rule"></div><button type="button" data-auth-action="sign-out">${icon('arrow', 15)} Sign out</button></div>
          </details>
        <div class="journey-intro"><div class="eyebrow">YOUR JOURNEY</div><p>Move from a question to a clearer next move.</p></div>
        <div class="sidebar-bottom">
          <div class="sidebar-rule"></div>
          <button class="sidebar-help" type="button" data-action="help">${icon('book', 16)} <span>Read the product guide</span></button>
          <div class="sidebar-footer"><span>MARKETMIND AI</span><span>v0.5</span></div>
        </div>
      </aside>
      <div class="mobile-backdrop" data-action="close-menu"></div>
      <main class="main-content">
        <header class="topbar">
          <button class="mobile-menu" type="button" aria-label="Open navigation" data-action="open-menu">☰</button>
          <div class="breadcrumb"><span>${escapeHtml(brandName)}</span><span class="breadcrumb-separator">/</span><strong>${escapeHtml(pageLabel(state.page))}</strong></div>
          <div class="topbar-actions">${themeToggleMarkup()}<button class="icon-button" type="button" aria-label="Open help" data-action="help">?</button><div class="topbar-divider"></div><button class="profile-avatar profile-avatar-button" type="button" data-route="workspace" aria-label="Open workspace settings">${escapeHtml(initials(state.brand.name || state.auth.user?.email))}</button></div>
        </header>
        <div class="page-wrap">${workspaceSyncNotice}${progressionRail()}${content}</div>
      </main>
      <div id="toast-region" class="toast-region" aria-live="polite"></div>${betaFeedbackModal()}
    </div>`);
  attachGlobalEvents();
}

function pageLabel(page) {
  return PAGE_LABELS[page] || 'Dashboard';
}

const JOURNEY_STAGES = [
  { id: 'strategy', short: 'Strategy', label: 'Strategy brief', icon: 'sparkles' },
  { id: 'research', short: 'Market', label: 'Market intelligence', icon: 'radar' },
  { id: 'audience', short: 'Audience', label: 'Audience intelligence', icon: 'message' },
  { id: 'radar', short: 'Radar', label: 'Opportunity radar', icon: 'radar' },
  { id: 'campaigns', short: 'Campaign', label: 'Campaign strategy', icon: 'layers' },
];

function journeyState() {
  const strategy = state.strategy || {};
  const hasBrief = Boolean(strategy.idea?.trim() && strategy.market?.trim());
  const hasResearch = Boolean(strategy.research?.meta?.researchedAt || strategy.research?.sources?.length);
  const hasAudience = Boolean(strategy.audienceInsights);
  const hasReviewedAudience = getRadarEligibleAudienceItems(strategy.audienceInsights, strategy.research).length > 0;
  const hasOpportunity = Boolean(strategy.selectedOpportunityId);
  const hasCampaign = strategy.campaignStrategy?.meta?.status === 'ready';
  return [
    { unlocked: true, complete: hasBrief },
    { unlocked: hasBrief, complete: hasResearch },
    { unlocked: hasBrief, complete: hasAudience },
    { unlocked: hasReviewedAudience, complete: Boolean(strategy.opportunityRadar?.opportunities?.length) || strategy.opportunityRadar?.meta?.status === 'ready' },
    { unlocked: hasOpportunity, complete: hasCampaign },
  ];
}

function journeyCurrentStage() {
  if (state.page === 'dashboard') {
    const index = journeyState().findIndex((item) => !item.complete && item.unlocked);
    return index >= 0 ? JOURNEY_STAGES[index].id : JOURNEY_STAGES[JOURNEY_STAGES.length - 1].id;
  }
  return JOURNEY_STAGES.some((stage) => stage.id === state.page) ? state.page : 'strategy';
}

function progressionRail() {
  const statuses = journeyState();
  const current = journeyCurrentStage();
  const nextLocked = statuses.findIndex((item) => !item.unlocked);
  const lockedCopy = ['Start with a strategy question and market.', 'Save a strategy brief first.', 'Complete audience intelligence first.', 'Approve or validate a source-backed audience claim first.', 'Select an opportunity from the radar first.'];
  return `<section class="progression-wrap" aria-label="Strategy progression"><div class="progression-header"><div><div class="eyebrow">YOUR PROGRESSION</div><p>Build confidence one connected stage at a time.</p></div><span class="progression-count">${statuses.filter((item) => item.complete).length} / ${JOURNEY_STAGES.length} complete</span></div><div class="progression-rail" role="list">${JOURNEY_STAGES.map((stage, index) => { const status = statuses[index]; const isCurrent = stage.id === current; const stateClass = status.complete ? 'complete' : status.unlocked ? 'available' : 'locked'; return `<button class="progression-stage ${stateClass} ${isCurrent ? 'current' : ''}" type="button" data-route="${stage.id}" ${status.unlocked ? '' : 'disabled'} aria-current="${isCurrent ? 'step' : 'false'}" aria-label="${stage.label}${status.complete ? ', completed' : status.unlocked ? ', available' : `, locked. ${lockedCopy[Math.min(index, lockedCopy.length - 1)]}`}" title="${status.unlocked ? stage.label : lockedCopy[Math.min(index, lockedCopy.length - 1)]}"><span class="progression-number">${status.complete ? icon('check', 13) : `0${index + 1}`}</span><span class="progression-stage-copy"><strong>${stage.short}</strong><small>${status.complete ? 'Complete' : status.unlocked ? (isCurrent ? 'In progress' : 'Available') : 'Locked'}</small></span><span class="progression-icon">${icon(stage.icon, 15)}</span></button>${index < JOURNEY_STAGES.length - 1 ? `<span class="progression-connector ${statuses[index + 1].unlocked ? 'active' : ''}" aria-hidden="true"></span>` : ''}`; }).join('')}</div>${nextLocked >= 0 ? `<div class="progression-helper"><span class="helper-lock">${icon('lock', 13)}</span><span><strong>Next up: ${JOURNEY_STAGES[nextLocked].label}</strong> · ${lockedCopy[Math.min(nextLocked, lockedCopy.length - 1)]}</span><button class="inline-link" type="button" data-route="${nextLocked === 0 ? 'strategy' : JOURNEY_STAGES[Math.max(0, nextLocked - 1)].id}">${nextLocked === 0 ? 'Begin' : 'Continue previous stage'} ${icon('arrow', 13)}</button></div>` : `<div class="progression-helper ready"><span class="helper-lock">${icon('check', 13)}</span><span><strong>Your intelligence path is complete.</strong> Revisit any stage to keep refining the direction.</span></div>`}</section>`;
}

function migrationPage() {
  const summary = state.migration.summary || {};
  return `<div class="migration-page page-entrance"><div class="migration-card"><div class="auth-icon">${icon('refresh', 23)}</div><div class="eyebrow">WELCOME TO YOUR WORKSPACE</div><h1>Bring your existing<br><em>context with you.</em></h1><p>We found local MarketMind work in this browser. Review the one-time import before anything is copied to your private workspace. Your local backup stays here.</p><div class="migration-summary"><div><strong>${summary.importableStrategyCount || 0}</strong><span>strateg${summary.importableStrategyCount === 1 ? 'y' : 'ies'} ready to import</span></div><div><strong>${summary.workspaceFieldCount || 0}</strong><span>workspace defaults to add</span></div><div><strong>${summary.brandFieldCount || 0}</strong><span>brand fields to fill</span></div><div><strong>${summary.conflictingStrategyCount || 0}</strong><span>existing conflicts kept remote</span></div></div>${state.migration.error ? `<div class="form-feedback error" role="alert">${escapeHtml(state.migration.error)}</div>` : ''}<div class="migration-actions"><button class="button button-primary" type="button" data-migration-action="import">Import into workspace ${icon('arrow', 16)}</button><button class="button button-secondary" type="button" data-migration-action="skip">Skip for now</button></div><small class="migration-note">Local data is retained as a browser backup until you remove it explicitly.</small></div></div>`;
}

function sectionEyebrow(number, label, detail = '') {
  return `<div class="section-heading"><div class="section-number">${number}</div><div><div class="eyebrow">${label}</div>${detail ? `<p>${detail}</p>` : ''}</div></div>`;
}

function dashboardPage() {
  const recent = state.strategies.slice(0, 3);
  const active = state.strategies[0] || null;
  const brandReady = Boolean(state.brand.name || state.brand.description || state.brand.industry || state.brand.audience);
  const researchReady = Boolean(active?.research?.meta?.researchedAt);
  const audienceReady = Boolean(active?.audienceInsights);
  const audienceReview = getAudienceReviewSummary(active?.audienceInsights);
  const radarReady = getRadarEligibleAudienceItems(active?.audienceInsights, active?.research).length > 0 && (Boolean(active?.opportunityRadar?.opportunities?.length) || active?.opportunityRadar?.meta?.status === 'ready');
  const campaignReady = active?.campaignStrategy?.meta?.status === 'ready';
  const intelligenceSteps = [
    { route: 'strategy', number: '01', label: 'Strategy brief', detail: state.strategies.length ? `${state.strategies.length} saved ${state.strategies.length === 1 ? 'brief' : 'briefs'}` : 'Start with a clear question', ready: state.strategies.length > 0 },
    { route: 'research', number: '02', label: 'Market intelligence', detail: researchReady ? `${active.research.sources?.length || 0} sources · ${capitalize(active.research.meta?.aiStatus || 'limited')}` : 'Not started', ready: researchReady },
    { route: 'audience', number: '03', label: 'Audience intelligence', detail: audienceReady ? `${audienceReview.reviewedCount}/${audienceReview.total} claims reviewed` : 'Not started', ready: audienceReady },
    { route: 'radar', number: '04', label: 'Opportunity radar', detail: radarReady ? (active.opportunityRadar.opportunities?.length ? `${active.opportunityRadar.opportunities.length} openings surfaced` : 'Analysis saved') : 'Not started', ready: radarReady },
    { route: 'campaigns', number: '05', label: 'Campaign strategy', detail: campaignReady ? 'Strategy saved' : 'Not started', ready: campaignReady },
  ];
  return `
    <div class="dashboard-page page-entrance">
      <div class="page-header dashboard-header"><div><div class="eyebrow">${greeting()} · WORKSPACE</div><h1>What should we<br><em>figure out today?</em></h1><p>Turn what's happening in the market into what your brand should do next.</p></div><button class="button button-primary" type="button" data-route="strategy" data-new-strategy="true">${icon('plus', 17)} New strategy</button></div>
      <section class="hero-panel">
        <div class="hero-copy"><div class="status-kicker"><span class="status-pulse"></span> YOUR STRATEGY WORKSPACE</div><h2>From a sharp question<br>to a <span>clear direction.</span></h2><p>Start with what's on your mind. MarketMind will keep your brand context close as the intelligence layer grows.</p><button class="text-button" type="button" data-route="strategy" data-new-strategy="true">Start a new strategy ${icon('arrow', 16)}</button></div>
        <div class="hero-diagram" aria-label="MarketMind workflow diagram"><div class="diagram-orbit orbit-one"></div><div class="diagram-orbit orbit-two"></div><div class="diagram-core">${icon('sparkles', 24)}<span>YOUR<br>QUESTION</span></div><div class="diagram-node node-top">MARKET<br>SIGNALS</div><div class="diagram-node node-right">AUDIENCE<br>CONTEXT</div><div class="diagram-node node-bottom">NEXT<br>MOVE</div><div class="diagram-line line-a"></div><div class="diagram-line line-b"></div><div class="diagram-line line-c"></div></div>
      </section>
      <section class="dashboard-intelligence" aria-labelledby="dashboard-intelligence-title">
        <div class="dashboard-section-heading"><div><div class="eyebrow">YOUR INTELLIGENCE PATH</div><h2 id="dashboard-intelligence-title">See what is ready to use.</h2></div><button class="quiet-button" type="button" data-route="workspace">Workspace defaults ${icon('arrow', 14)}</button></div>
        <div class="dashboard-signal-grid">${intelligenceSteps.map((item) => `<button class="dashboard-signal ${item.ready ? 'ready' : 'not-started'}" type="button" data-route="${item.route}"><span class="dashboard-signal-number">${item.number}</span><span class="dashboard-signal-copy"><strong>${item.label}</strong><small>${item.detail}</small></span>${icon('arrow', 14)}</button>`).join('')}</div>
      </section>
      <div class="dashboard-grid">
        <section class="content-card recent-card"><div class="card-heading"><div><div class="eyebrow">WORK IN PROGRESS</div><h3>Recent strategies</h3></div>${recent.length ? '<button class="quiet-button" type="button" data-route="campaigns">View all</button>' : ''}</div>${recent.length ? recent.map(strategyRow).join('') : emptyRecent()}</section>
<section class="content-card context-card"><div class="card-heading"><div><div class="eyebrow">YOUR CONTEXT</div><h3>Brand profile</h3></div><button class="quiet-button" type="button" data-route="brand">Edit</button></div><div class="context-preview"><div class="context-avatar">${escapeHtml(initials(state.brand.name))}</div><div><strong>${escapeHtml(state.brand.name || 'Add your brand')}</strong><span>${escapeHtml(state.brand.industry || 'Industry not set')}</span></div></div><div class="context-state ${brandReady ? 'ready' : 'not-started'}"><span class="context-state-dot"></span><span>${brandReady ? 'Brand context is ready to travel with new work.' : 'Brand context is not set yet.'}</span></div><p class="card-note">${brandReady ? 'Your brand voice will shape every strategy you create.' : 'Define your voice once, then reuse it across the workspace.'}</p></section>
      </div>
    </div>`;
}

function strategyRow(strategy) {
  const label = strategy.campaignStrategy ? 'Campaign strategy' : strategy.opportunityRadar ? 'Opportunity Radar' : strategy.audienceInsights ? 'Audience intelligence' : strategy.research ? 'Market research' : strategy.objective || 'Strategy brief';
  return `<button class="strategy-row" type="button" data-action="open-strategy" data-id="${escapeHtml(strategy.id)}"><span class="strategy-icon">${icon(strategy.campaignStrategy ? 'layers' : strategy.opportunityRadar ? 'radar' : strategy.audienceInsights ? 'message' : strategy.research ? 'radar' : 'sparkles', 16)}</span><span class="strategy-row-copy"><strong>${escapeHtml(strategy.idea)}</strong><span>${escapeHtml(label)} · ${escapeHtml(strategy.market || strategy.platforms?.join(', ') || 'Market to define')}</span></span><span class="strategy-date">${formatDate(strategy.campaignStrategy?.updatedAt || strategy.opportunityRadar?.createdAt || strategy.audienceInsights?.createdAt || strategy.research?.meta?.researchedAt || strategy.createdAt)}</span>${icon('arrow', 15)}</button>`;
}

function competitorTag(competitor) {
  return `<span class="input-tag">${escapeHtml(competitor)}<button type="button" data-action="remove-competitor" data-competitor="${escapeHtml(competitor)}" aria-label="Remove ${escapeHtml(competitor)}">${icon('close', 12)}</button></span>`;
}

function emptyRecent() {
  return `<div class="empty-state compact"><div class="empty-icon">${icon('sparkles', 20)}</div><div><strong>No strategies yet</strong><p>Your next clear direction starts with a question.</p></div><button class="quiet-button" type="button" data-route="strategy" data-new-strategy="true">Create one ${icon('arrow', 14)}</button></div>`;
}

function strategyPage() {
  const strategy = state.strategy;
  const workspace = state.workspace;
  const audience = strategy.audience || workspace.defaultAudience || "";
  const market = strategy.market || workspace.defaultMarket || "";
  const platform = strategy.platforms?.[0] || workspace.defaultPlatform || "";
  const objective = strategy.objective || workspace.defaultObjective || "";
  const isValid = strategy.idea.trim().length > 0;
  return `
    <div class="strategy-page page-entrance">
      <div class="page-header strategy-header"><div><div class="eyebrow">NEW STRATEGY · START HERE</div><h1>Begin with the<br><em>question.</em></h1><p>A focused brief gives MarketMind the context to connect market signals, people, opportunities, and strategy.</p></div><div class="step-indicator"><div class="step active"><span>01</span><small>Brief</small></div><div class="step-line"></div><div class="step"><span>02</span><small>Intelligence</small></div><div class="step-line"></div><div class="step"><span>03</span><small>Direction</small></div></div></div>
      <form id="strategy-form" class="strategy-layout" novalidate>
        <div class="strategy-main">
          <section class="form-card strategy-step strategy-question">${sectionEyebrow("01", "WHAT ARE YOU TRYING TO SOLVE?", "Start with the change you want to create.")}
            <div class="field large-field"><label for="strategy-idea">Your strategy question <span class="required">*</span></label><textarea id="strategy-idea" name="idea" maxlength="600" rows="5" placeholder="What challenge, launch, or opportunity are you exploring?">${escapeHtml(strategy.idea)}</textarea><div class="field-meta"><span>Be specific about the decision or change you want to make.</span><span id="idea-count">${strategy.idea.length} / 600</span></div><div id="idea-error" class="field-error" role="alert"></div></div>
            <div class="example-callout"><div class="example-label">EXAMPLE</div><p>“I want to make running more exciting for Gen Z in India.”</p><button class="inline-link" type="button" data-action="use-example">Use this example ${icon("arrow", 14)}</button></div>
          </section>
          <section class="form-card strategy-steps-card">${sectionEyebrow("02", "WHO ARE YOU TRYING TO REACH?", "Name the people this strategy should understand.")}<div class="field"><label for="strategy-audience">Audience</label><input id="strategy-audience" name="audience" maxlength="180" value="${escapeHtml(audience)}" placeholder="e.g. First-time founders in India"></div></section>
          <section class="form-card strategy-steps-card">${sectionEyebrow("03", "WHERE DOES THIS MATTER?", "Market context keeps intelligence relevant.")}<div class="field"><label for="strategy-market">Market / region <span class="required">*</span></label><input id="strategy-market" name="market" list="market-suggestions" maxlength="100" value="${escapeHtml(market)}" placeholder="e.g. India"><datalist id="market-suggestions"><option>India</option><option>United States</option><option>United Kingdom</option><option>Global</option><option>Southeast Asia</option><option>Australia</option></datalist><div class="field-meta"><span>Trends and audience behavior are geographically dependent.</span></div><div id="market-error" class="field-error" role="alert"></div></div></section>
          <section class="form-card strategy-steps-card">${sectionEyebrow("04", "WHAT DO YOU WANT TO ACHIEVE?", "Choose the primary job for this strategy.")}<div class="field"><label for="strategy-objective">Objective</label><select id="strategy-objective" name="objective"><option value="">Choose an objective</option>${["Awareness", "Engagement", "Consideration", "Conversion", "Retention", "Launch", "Community Building"].map((item) => `<option ${objective === item ? "selected" : ""}>${item}</option>`).join("")}</select></div></section>
          <details class="optional-details"><summary><span><span class="eyebrow">OPTIONAL CONTEXT</span><strong>Add context</strong></span><span class="optional-summary">Platform, competitors, and research depth ${icon("chevron", 14)}</span></summary><div class="optional-details-body"><div class="form-grid"><div class="field"><label for="strategy-platform">Primary platform</label><select id="strategy-platform" name="platform"><option value="">Choose a platform</option>${["Instagram", "LinkedIn", "YouTube", "TikTok", "Website", "Multi-platform"].map((item) => `<option ${platform === item ? "selected" : ""}>${item}</option>`).join("")}</select></div><div class="field"><label for="strategy-depth">Research depth</label><select id="strategy-depth" name="researchDepth">${RESEARCH_DEPTH_OPTIONS.map((option) => `<option value="${option.id}" ${strategy.researchDepth === option.id ? "selected" : ""}>${option.label}</option>`).join("")}</select><div class="field-meta"><span id="depth-description">${escapeHtml(RESEARCH_DEPTH_OPTIONS.find((option) => option.id === strategy.researchDepth)?.description || RESEARCH_DEPTH_OPTIONS[1].description)}</span></div></div></div><div class="field"><label for="competitor-entry">Competitors <span class="optional">OPTIONAL</span></label><div class="tag-input"><div id="competitor-tags" class="tag-list">${(strategy.competitors || []).map(competitorTag).join("")}</div><input id="competitor-entry" maxlength="80" placeholder="Add brands for MarketMind to watch..." aria-describedby="competitor-help"></div><div id="competitor-help" class="field-meta"><span>Press Enter or comma after each brand.</span></div></div></div></details>
          <section class="form-card brand-context-summary">${sectionEyebrow("05", "BRAND CONTEXT", "Your existing voice and context will shape the work.")}${state.brand.name || state.brand.description ? `<div class="brand-summary-ready"><div class="context-avatar">${escapeHtml(initials(state.brand.name))}</div><div><strong>${escapeHtml(state.brand.name || "Untitled brand")}</strong><span>${escapeHtml(state.brand.industry || "Industry not set")} · ${escapeHtml(state.brand.voice.tone)}</span></div><button class="quiet-button" type="button" data-route="brand">Manage Brand Voice</button></div>` : `<div class="brand-summary-empty"><div class="empty-icon">${icon("message", 18)}</div><div><strong>No brand context yet</strong><p>Add your brand details so the strategy sounds like you.</p></div><button class="quiet-button" type="button" data-route="brand">Set up brand ${icon("arrow", 14)}</button></div>`}</section>
        </div>
        <aside class="strategy-aside"><div class="aside-card strategy-brief-aside"><div class="aside-mark">${icon("sparkles", 18)}</div><div class="eyebrow">A USEFUL BRIEF</div><h3>Clarity gives intelligence somewhere to go.</h3><p>MarketMind will use this brief to connect what is happening with what your brand should do next.</p><div class="aside-divider"></div><div class="aside-list"><div><span class="list-check">${icon("check", 13)}</span><span>One clear question</span></div><div><span class="list-check">${icon("check", 13)}</span><span>A defined audience</span></div><div><span class="list-check">${icon("check", 13)}</span><span>A market to understand</span></div></div></div><div class="form-actions"><button class="button button-primary button-wide" type="submit" ${isValid ? "" : "disabled"}>${icon("radar", 17)} Research Market</button><button class="text-button centered" type="button" data-action="save-strategy-draft">Save for later</button></div></aside>
      </form>
    </div>`;
}

function brandPage() {
  const brand = state.brand;
  const voice = brand.voice;
  return `
    <div class="brand-page page-entrance">
      <div class="page-header"><div><div class="eyebrow">BRAND VOICE STUDIO</div><h1>Make it sound<br><em>like you.</em></h1><p>Give MarketMind the context behind your brand. This becomes the creative filter for every strategy that follows.</p></div><button class="button button-primary" type="button" data-action="save-brand">${icon('check', 17)} Save brand voice</button></div>
      <form id="brand-form" class="brand-layout" novalidate>
        <div class="brand-main">
          <section class="form-card">${sectionEyebrow('01', 'BRAND FOUNDATIONS', 'The context behind the work.')}
            <div class="form-grid"><div class="field"><label for="brand-name">Brand name <span class="required">*</span></label><input id="brand-name" name="name" maxlength="80" value="${escapeHtml(brand.name)}" placeholder="e.g. Nike"></div><div class="field"><label for="brand-industry">Industry / category</label><input id="brand-industry" name="industry" maxlength="80" value="${escapeHtml(brand.industry)}" placeholder="e.g. Sports & wellness"></div></div>
            <div class="field"><label for="brand-description">What does your brand do?</label><textarea id="brand-description" name="description" maxlength="400" rows="3" placeholder="Describe your product, the problem it solves, and why it matters...">${escapeHtml(brand.description)}</textarea><div class="field-meta"><span>Keep it clear and human.</span><span id="description-count">${brand.description.length} / 400</span></div></div>
            <div class="form-grid"><div class="field"><label for="brand-website">Website <span class="optional">OPTIONAL</span></label><input id="brand-website" name="website" type="url" value="${escapeHtml(brand.website)}" placeholder="https://yourbrand.com"></div><div class="field"><label for="brand-audience">Who is your audience?</label><input id="brand-audience" name="audience" maxlength="180" value="${escapeHtml(brand.audience)}" placeholder="e.g. Curious, time-poor urban professionals"></div></div>
          </section>
          <section class="form-card voice-card">${sectionEyebrow('02', 'TONE & PERSONALITY', 'Tone is how you sound. Personality is what people feel.')}
            <div class="field"><label>Preferred tone</label><div class="tone-grid">${TONE_OPTIONS.map((tone) => `<button class="tone-option ${voice.tone === tone ? 'selected' : ''}" type="button" data-tone="${escapeHtml(tone)}"><span class="tone-radio"></span><span>${tone}</span></button>`).join('')}</div></div>
            <div class="field personality-field"><label>Personality traits <span class="field-hint">Choose up to 4</span></label><div class="chip-grid">${PERSONALITY_OPTIONS.map((trait) => `<button class="trait-chip ${voice.personality.includes(trait) ? 'selected' : ''}" type="button" data-trait="${trait}">${voice.personality.includes(trait) ? icon('check', 13) : ''}${trait}</button>`).join('')}</div></div>
            <div class="field"><label for="communication-style">Communication style</label><textarea id="communication-style" name="communicationStyle" maxlength="500" rows="3" placeholder="How should the brand communicate? e.g. Short, direct sentences. Explain the why, not just the what.">${escapeHtml(voice.communicationStyle)}</textarea></div>
          </section>
          <section class="form-card">${sectionEyebrow('03', 'COMMUNICATION RULES', 'The rules that keep every output recognizably yours.')}
            <div class="form-grid"><div class="field"><label for="preferred-words">Words & phrases to use</label><textarea id="preferred-words" name="preferredWords" rows="4" placeholder="Paste words, phrases, or ideas you want to hear...">${escapeHtml(voice.preferredWords)}</textarea></div><div class="field"><label for="avoid-words">Words & phrases to avoid</label><textarea id="avoid-words" name="avoidWords" rows="4" placeholder="Paste clichés, claims, or language to stay away from...">${escapeHtml(voice.avoidWords)}</textarea></div></div>
            <div class="field"><label for="additional-guidelines">Additional brand guidelines</label><textarea id="additional-guidelines" name="additionalGuidelines" rows="3" placeholder="Anything else the team should know about your brand...">${escapeHtml(voice.additionalGuidelines)}</textarea></div>
          </section>
          <section class="form-card examples-card">${sectionEyebrow('04', 'TEACH MARKETMIND HOW YOUR BRAND SOUNDS', 'Paste previous ads, social posts, campaign copy, emails, website messaging, or other examples.')}
            <div id="examples-list">${voice.examples.map((example, index) => exampleField(example, index)).join('')}</div><button class="add-example" type="button" data-action="add-example">${icon('plus', 15)} Add example</button>
          </section>
        </div>
        <aside class="brand-aside"><div class="voice-preview-card"><div class="preview-top"><div class="eyebrow">VOICE PREVIEW</div><span class="live-badge"><i></i> Live</span></div><div class="preview-quote">“${escapeHtml(voice.personality.length ? `${voice.personality[0]} ideas for ${brand.name || 'your brand'}.` : 'Your brand, in a sentence.') }”</div><div class="preview-meta"><span class="preview-swatch"></span><span>${escapeHtml(voice.tone)}</span></div></div><div class="strictness-card"><div class="eyebrow">VOICE STRICTNESS</div><p>How much creative room should MarketMind have?</p><div class="strictness-options">${[['loose','Loose','Stay recognizable, but give the AI creative freedom.'],['balanced','Balanced','Maintain the brand identity while allowing creative exploration.'],['strict','Strict','Stay closely aligned with your voice and communication rules.']].map(([id, label, copy]) => `<button class="strictness-option ${voice.strictness === id ? 'selected' : ''}" type="button" data-strictness="${id}"><span class="strictness-radio"></span><span><strong>${label}</strong><small>${copy}</small></span></button>`).join('')}</div></div><div class="save-reminder">${icon('lock', 15)} <span>Your brand voice is saved locally in this browser.</span></div></aside>
      </form>
    </div>`;
}

function exampleField(example, index) {
  return `<div class="example-field"><div class="example-field-top"><label for="example-${index}">Example ${index + 1}</label>${index > 0 || example ? `<button class="remove-example" type="button" data-action="remove-example" data-index="${index}" aria-label="Remove example ${index + 1}">${icon('close', 15)}</button>` : ''}</div><textarea id="example-${index}" data-example-index="${index}" rows="4" maxlength="1000" placeholder="Paste a piece of real brand communication...">${escapeHtml(example)}</textarea></div>`;
}


const RESEARCH_STAGES = [
  { id: 'understanding', label: 'Understanding strategy' },
  { id: 'queries', label: 'Building research queries' },
  { id: 'searching', label: 'Searching the market' },
  { id: 'evaluating', label: 'Evaluating sources' },
  { id: 'synthesizing', label: 'Synthesizing findings' },
];

function currentResearch() {
  return state.strategy?.research || createEmptyResearch();
}

function researchForStream(research) {
  if (!research) return null;
  // Run history is for the local audit UI; the analysis services only need the
  // active research payload. Keeping it out of the request avoids oversized
  // requests after several research passes.
  const { runs, activeRunId, ...activeResearch } = research;
  return activeResearch;
}

function normalizeStrategyAudience(strategy) {
  if (!strategy?.audienceInsights) return strategy;
  return { ...strategy, audienceInsights: ensureAudienceReviewProfile(strategy.audienceInsights) };
}

function researchLoadingPage() {
  const run = state.researchRun || { current: 'understanding', stages: [] };
  const activeIndex = Math.max(0, RESEARCH_STAGES.findIndex((stage) => stage.id === run.current));
  return `<div class="research-loading page-entrance"><div class="eyebrow">MARKET INTELLIGENCE · LIVE RESEARCH</div><h1>Reading the<br><em>market signals.</em></h1><p class="loading-context">${escapeHtml(state.strategy.idea)}</p><div class="loading-board"><div class="loading-board-top"><span class="status-kicker"><span class="status-pulse"></span> RESEARCH IN PROGRESS</span><span class="loading-depth">${escapeHtml(capitalize(state.strategy.researchDepth || 'balanced'))} depth</span></div><div class="research-stage-list">${RESEARCH_STAGES.map((stage, index) => `<div class="research-stage ${index < activeIndex ? 'complete' : ''} ${stage.id === run.current ? 'active' : ''}"><span class="stage-marker">${index < activeIndex ? icon('check', 13) : index + 1}</span><span>${stage.label}</span>${stage.id === run.current ? '<i class="stage-pending"></i>' : ''}</div>`).join('')}</div><div class="loading-detail">${run.detail ? escapeHtml(run.detail) : 'Working from the strategy context you provided. No conclusions are being generated ahead of evidence.'}</div></div><button class="text-button" type="button" data-route="dashboard">Return to workspace</button></div>`;
}

function researchEmptyPage() {
  return `<div class="research-empty page-entrance"><div class="research-empty-art">${icon('radar', 28)}<span></span><span></span><span></span></div><div class="eyebrow">MARKET INTELLIGENCE</div><h1>Start with a<br><em>strategy question.</em></h1><p>Research becomes useful when it has a real point of view. Create a strategy brief first, then MarketMind will search current signals around your brand, audience, category, and market.</p><button class="button button-primary" type="button" data-route="strategy">${icon('sparkles', 16)} Start a new strategy</button></div>`;
}

function researchUnavailablePage(research) {
  const warning = research.meta?.warnings?.[0] || 'Live research is unavailable.';
  return `<div class="research-page page-entrance"><div class="page-header research-header"><div><div class="eyebrow">MARKET INTELLIGENCE · ${escapeHtml(capitalize(state.strategy.researchDepth || 'balanced'))} DEPTH</div><h1>Here's what could<br><em>happen next.</em></h1><p>We have the strategy context. Live evidence is not available yet, so MarketMind will not invent market signals.</p></div><div class="research-header-actions"><button class="button button-secondary" type="button" data-route="strategy">Edit strategy</button><button class="button button-primary" type="button" data-route="audience">${icon('message', 16)} Understand audience</button></div></div><section class="research-unavailable"><div class="unavailable-icon">${icon('radar', 21)}</div><div><div class="eyebrow">LIVE RESEARCH UNAVAILABLE</div><h2>${escapeHtml(warning)}</h2><p>MarketMind could not connect to live market intelligence right now. You can still build a clearly labelled research-light audience model from the strategy context.</p><div class="unavailable-actions"><button class="text-button" type="button" data-route="workspace">Open workspace ${icon('arrow', 15)}</button><button class="text-button" type="button" data-route="audience">Proceed with limited context ${icon('arrow', 15)}</button></div></div></section>${researchRunHistorySection(research)}${researchHistorySection()}</div>`;
}

function researchResultsPage() {
  const research = currentResearch();
  const signals = filteredSignals(research);
  const all = allResearchSignals(research);
  const metricData = [
    ['signals', all.length, 'meaningful signals'],
    ['sources', research.sources.length, 'sources reviewed'],
    ['themes', research.emergingThemes.length, 'emerging themes'],
    ['competitors', research.competitorSignals.length, 'competitor movements'],
  ];
  return `<div class="research-page page-entrance"><div class="page-header research-header"><div><div class="eyebrow">MARKET INTELLIGENCE · ${escapeHtml(capitalize(research.meta?.depth || 'balanced'))} DEPTH</div><h1>Here's what is<br><em>happening around you.</em></h1><p>${escapeHtml(state.strategy.idea)}</p></div><div class="research-header-actions"><button class="button button-secondary" type="button" data-action="refresh-research" ${state.researchRun?.loading ? 'disabled' : ''}>${icon('refresh', 16)} Refresh research</button><button class="button button-secondary" type="button" data-action="save-research">${icon('check', 16)} Save to strategy</button><button class="button button-primary" type="button" data-route="audience">${icon('message', 16)} Understand audience</button></div></div><div class="research-meta-line"><span>${escapeHtml(state.strategy.market || 'Market not specified')}</span><span>·</span><span>Last researched: ${research.meta?.researchedAt ? formatDateTime(research.meta.researchedAt) : 'Not yet'}</span><span>·</span><span>${capitalize(research.meta?.depth || 'balanced')} depth</span></div>${researchIntegrityNote(research)}<section class="research-snapshot"><div class="snapshot-lead"><div class="eyebrow">RESEARCH SNAPSHOT</div><h2>Evidence before<br><em>assumptions.</em></h2><p>Every factual signal below is mapped to a source. Interpretations are clearly separated.</p></div><div class="snapshot-metrics">${metricData.map(([id, value, label]) => `<div class="snapshot-metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div></section><section class="research-summary"><div class="summary-label"><span class="summary-index">01</span><div><div class="eyebrow">RESEARCH SUMMARY</div><h2>What's happening?</h2></div></div><p>${escapeHtml(research.researchSummary || 'No synthesized summary is available. Configure an AI provider to turn the collected evidence into a grounded market view.')}</p>${research.meta?.aiStatus !== 'verified' ? `<div class="summary-note">${icon('lock', 14)} <span>${escapeHtml(research.meta?.warnings?.[0] || 'AI synthesis is not configured. Evidence is shown without invented conclusions.')}</span></div>` : ''}</section>${research.emergingThemes.length ? themesSection(research.emergingThemes, research.sources) : ''}<section class="signals-section"><div class="signals-heading"><div><div class="eyebrow">OBSERVED SIGNALS</div><h2>Read the field.</h2></div><div class="signal-count">${signals.length} shown</div></div><div class="filter-bar" role="tablist" aria-label="Filter research signals">${RESEARCH_FILTERS.map((filter) => `<button class="filter-tab ${state.researchFilter === filter.id ? 'active' : ''}" type="button" data-filter="${filter.id}" role="tab" aria-selected="${state.researchFilter === filter.id}">${filter.label}</button>`).join('')}</div>${signals.length ? `<div class="signal-list">${signals.map((signal) => signalCard(signal, research.sources)).join('')}</div>` : `<div class="research-no-signals"><div class="empty-icon">${icon('radar', 19)}</div><div><strong>${all.length ? 'No signals in this view' : 'No synthesized signals yet'}</strong><p>${all.length ? 'Try another category filter.' : 'Live evidence is available, but an AI provider has not synthesized it into signals yet.'}</p></div></div>`}</section>${research.contradictions.length ? contradictionsSection(research.contradictions, research.sources) : ''}<section class="sources-section"><div class="signals-heading"><div><div class="eyebrow">EVIDENCE TRAIL</div><h2>Sources reviewed.</h2></div><div class="signal-count">${research.sources.length} total</div></div><div class="source-grid">${research.sources.length ? research.sources.map(sourceRow).join('') : '<p class="muted-copy">No sources were returned.</p>'}</div></section>${researchRunHistorySection(research)}${researchHistorySection()}${state.selectedSource ? sourceModal(state.selectedSource, research.sources) : ''}</div>`;
}

function currentAudienceScope() {
  const saved = state.strategy.audienceScope || {};
  return {
    ageRange: '',
    lifeStage: '',
    occupation: '',
    context: '',
    purchaseRelationship: 'prospect',
    analysisDepth: 'balanced',
    ...saved,
    primaryAudience: saved.primaryAudience || state.strategy.audience || state.brand.audience || '',
    market: saved.market || state.strategy.market || '',
  };
}

function audienceHasResearch() {
  const research = currentResearch();
  return Boolean(research.sources?.length || research.meta?.researchedAt);
}

function audienceSetupPage() {
  const scope = currentAudienceScope();
  const hasResearch = audienceHasResearch();
  const stale = state.strategy.audienceInsights && audienceNeedsUpdate(state.strategy.audienceInsights);
  return `<div class="audience-page page-entrance"><div class="page-header audience-header"><div><div class="eyebrow">AUDIENCE INTELLIGENCE · STEP 01 OF 02</div><h1>Understand the<br><em>people behind it.</em></h1><p>Turn your strategy and market context into an evidence-aware audience model. Observations, inferences, hypotheses, and unknowns stay visibly separate.</p></div><div class="audience-header-mark">${icon('message', 25)}<span>Evidence<br>with humility.</span></div></div>${stale ? `<div class="audience-update-banner">${icon('refresh', 15)} <span>Market research has been updated since this audience analysis.</span></div>` : ''}<form id="audience-form" class="audience-setup-layout" novalidate><div class="audience-setup-main"><section class="form-card">${sectionEyebrow('01', 'AUDIENCE SCOPE', 'Define the people and situation this analysis should consider.')}
      <div class="field"><label for="audience-primary">Primary audience <span class="required">*</span></label><input id="audience-primary" name="primaryAudience" maxlength="180" value="${escapeHtml(scope.primaryAudience)}" placeholder="e.g. First-time founders in India"><div id="audience-primary-error" class="field-error" role="alert"></div></div>
      <div class="form-grid"><div class="field"><label for="audience-market">Market / geography <span class="required">*</span></label><input id="audience-market" name="market" maxlength="100" value="${escapeHtml(scope.market)}" placeholder="e.g. India"><div id="audience-market-error" class="field-error" role="alert"></div></div><div class="field"><label for="audience-relation">Purchase relationship</label><select id="audience-relation" name="purchaseRelationship">${PURCHASE_RELATIONSHIPS.map((option) => `<option value="${option.id}" ${scope.purchaseRelationship === option.id ? 'selected' : ''}>${option.label}</option>`).join('')}</select></div></div>
      <div class="form-grid"><div class="field"><label for="audience-age">Age range <span class="optional">OPTIONAL</span></label><input id="audience-age" name="ageRange" maxlength="60" value="${escapeHtml(scope.ageRange)}" placeholder="Only if relevant"></div><div class="field"><label for="audience-life-stage">Life stage <span class="optional">OPTIONAL</span></label><input id="audience-life-stage" name="lifeStage" maxlength="80" value="${escapeHtml(scope.lifeStage)}" placeholder="e.g. Early career"></div></div>
      <div class="form-grid"><div class="field"><label for="audience-occupation">Occupation / context <span class="optional">OPTIONAL</span></label><input id="audience-occupation" name="occupation" maxlength="100" value="${escapeHtml(scope.occupation)}" placeholder="e.g. Independent professionals"></div><div class="field"><label for="audience-context">Situation to understand <span class="optional">OPTIONAL</span></label><input id="audience-context" name="context" maxlength="160" value="${escapeHtml(scope.context)}" placeholder="e.g. Choosing a first tool"></div></div>
    </section><section class="form-card">${sectionEyebrow('02', 'ANALYSIS DEPTH', 'Choose how much audience context to map.') }<div class="audience-depth-options">${AUDIENCE_DEPTH_OPTIONS.map((option) => `<label class="audience-depth-option ${scope.analysisDepth === option.id ? 'selected' : ''}"><input type="radio" name="analysisDepth" value="${option.id}" ${scope.analysisDepth === option.id ? 'checked' : ''}><span class="depth-radio"></span><span><strong>${option.label}</strong><small>${option.description}</small></span></label>`).join('')}</div></section></div><aside class="audience-setup-aside"><div class="aside-card"><div class="aside-mark">${icon('radar', 18)}</div><div class="eyebrow">EVIDENCE MODEL</div><h3>Confidence has levels.</h3><p>MarketMind will show what the research supports, what is inferred, what is only worth testing, and what remains unknown.</p><div class="audience-legend"><span><i class="evidence-dot observed"></i>Observed</span><span><i class="evidence-dot inferred"></i>Inferred</span><span><i class="evidence-dot hypothesis"></i>Hypothesis</span><span><i class="evidence-dot unknown"></i>Unknown</span></div></div>${hasResearch ? `<div class="audience-research-ready"><span class="status-pulse"></span><div><strong>Research is ready</strong><p>${currentResearch().sources.length} source${currentResearch().sources.length === 1 ? '' : 's'} available for evidence mapping.</p></div><button class="text-button" type="button" data-route="research">Review research ${icon('arrow', 14)}</button></div>` : `<div class="audience-research-light"><div class="eyebrow">RESEARCH-LIGHT MODE</div><strong>Live market evidence is not attached.</strong><p>You can continue from strategy context, but results will be clearly labelled and will not contain fabricated evidence.</p><button class="text-button" type="button" data-route="research">Return to market intelligence ${icon('arrow', 14)}</button></div>`}<div class="form-actions"><button class="button button-primary button-wide" type="submit">${icon('message', 17)} Analyze Audience</button><button class="text-button centered" type="button" data-route="research">Back to market intelligence</button></div></aside></form></div>`;
}

const AUDIENCE_STAGES = [
  { id: 'reading', label: 'Reading market evidence' },
  { id: 'signals', label: 'Identifying behavioral signals' },
  { id: 'motivations', label: 'Mapping motivations and barriers' },
  { id: 'evidence', label: 'Separating evidence from hypotheses' },
  { id: 'model', label: 'Building audience model' },
];

function audienceLoadingPage() {
  const run = state.audienceRun || { current: 'reading', stages: [] };
  const activeIndex = Math.max(0, AUDIENCE_STAGES.findIndex((stage) => stage.id === run.current));
  return `<div class="audience-loading page-entrance"><div class="eyebrow">AUDIENCE INTELLIGENCE · ANALYSIS IN PROGRESS</div><h1>Understanding the<br><em>people behind it.</em></h1><p class="loading-context">${escapeHtml(state.strategy.idea)}</p><div class="loading-board audience-loading-board"><div class="loading-board-top"><span class="status-kicker"><span class="status-pulse"></span> AUDIENCE MODEL IN PROGRESS</span><span class="loading-depth">${escapeHtml(capitalize(currentAudienceScope().analysisDepth))} depth</span></div><div class="research-stage-list">${AUDIENCE_STAGES.map((stage, index) => `<div class="research-stage ${index < activeIndex ? 'complete' : ''} ${stage.id === run.current ? 'active' : ''}"><span class="stage-marker">${index < activeIndex ? icon('check', 13) : index + 1}</span><span>${stage.label}</span>${stage.id === run.current ? '<i class="stage-pending"></i>' : ''}</div>`).join('')}</div><div class="loading-detail">${run.detail ? escapeHtml(run.detail) : 'Keeping observations, interpretations, hypotheses, and unknowns separate.'}</div></div><button class="text-button" type="button" data-route="dashboard">Return to workspace</button></div>`;
}

function audienceReviewLabel(status) {
  return ({ pending: 'Pending review', approved: 'Approved', edited: 'Edited · validated', rejected: 'Rejected', 'needs-validation': 'Needs validation' })[status] || 'Pending review';
}

function audienceValidationEditor(item, sources) {
  const preferredType = ['observed', 'inferred'].includes(item.originalEvidenceType) ? item.originalEvidenceType : 'inferred';
  return `<form class="audience-validation-editor" data-audience-validation-id="${escapeHtml(item.id)}"><div class="audience-editor-heading"><strong>Revalidate with current research</strong><span>Select the excerpts that support this claim now.</span></div><div class="audience-source-checks">${sources.length ? sources.map((source) => `<label><input type="checkbox" name="sourceIds" value="${escapeHtml(source.id)}" ${item.sourceIds.includes(source.id) ? 'checked' : ''}><span><strong>${escapeHtml(source.domain || 'Source')}</strong><small>${escapeHtml(source.title || 'Current research source')}</small></span></label>`).join('') : '<span class="audience-no-evidence">No current research sources are available.</span>'}</div><div class="audience-validation-fields"><label>Evidence type<select name="evidenceType"><option value="observed" ${preferredType === 'observed' ? 'selected' : ''}>Observed</option><option value="inferred" ${preferredType === 'inferred' ? 'selected' : ''}>Inferred</option></select></label><label>Confidence<select name="confidence"><option value="low" ${item.confidence === 'low' ? 'selected' : ''}>Low</option><option value="medium" ${item.confidence !== 'low' && item.confidence !== 'high' ? 'selected' : ''}>Medium</option><option value="high" ${item.confidence === 'high' ? 'selected' : ''}>High</option></select></label></div><div class="audience-editor-actions"><button class="button button-primary" type="submit">Validate claim</button><button class="quiet-button" type="button" data-audience-review-cancel="validation">Cancel</button></div></form>`;
}

function audienceItemCard(item, sources, category) {
  const claim = ensureAudienceClaimMetadata(item, category);
  const evidence = (claim.sourceIds || []).map((id) => sources.find((source) => source.id === id)).filter(Boolean);
  const type = claim.evidenceType || 'unknown';
  const editing = state.audienceEditingClaimId === claim.id;
  const validating = state.audienceValidationClaimId === claim.id;
  const canApprove = claim.sourceIds?.length && ['observed', 'inferred'].includes(type);
  const editForm = editing ? `<form class="audience-claim-editor" data-audience-editor-id="${escapeHtml(claim.id)}"><label for="audience-edit-${escapeHtml(claim.id)}">Edit claim</label><textarea id="audience-edit-${escapeHtml(claim.id)}" name="statement" maxlength="500" required>${escapeHtml(claim.statement)}</textarea><small>The generated version stays in the audit trail. Editing clears active source mappings until you revalidate them.</small><div class="audience-editor-actions"><button class="button button-primary" type="submit">Save edit</button><button class="quiet-button" type="button" data-audience-review-cancel="edit">Cancel</button></div></form>` : '';
  const actions = [
    canApprove && claim.reviewStatus !== 'approved' ? `<button type="button" data-audience-review="approve" data-claim-id="${escapeHtml(claim.id)}">Approve</button>` : '',
    claim.reviewStatus === 'needs-validation' || claim.reviewStatus === 'edited' ? `<button type="button" data-audience-review="validate" data-claim-id="${escapeHtml(claim.id)}">${claim.reviewStatus === 'edited' ? 'Revalidate sources' : 'Validate sources'}</button>` : '',
    claim.reviewStatus !== 'rejected' ? `<button type="button" data-audience-review="edit" data-claim-id="${escapeHtml(claim.id)}">Edit</button>` : '',
    claim.reviewStatus !== 'needs-validation' && claim.reviewStatus !== 'rejected' ? `<button type="button" data-audience-review="needs-validation" data-claim-id="${escapeHtml(claim.id)}">Needs validation</button>` : '',
    claim.reviewStatus !== 'rejected' ? `<button type="button" data-audience-review="reject" data-claim-id="${escapeHtml(claim.id)}">Reject</button>` : '',
  ].filter(Boolean).join('');
  return `<article class="audience-item audience-item-${escapeHtml(type)} audience-review-${escapeHtml(claim.reviewStatus)}" data-audience-claim-id="${escapeHtml(claim.id)}"><div class="audience-item-top"><span class="evidence-badge evidence-${escapeHtml(type)}"><i></i>${escapeHtml(capitalize(type))}</span><span class="audience-review-status status-${escapeHtml(claim.reviewStatus)}">${escapeHtml(audienceReviewLabel(claim.reviewStatus))}</span><span class="audience-item-meta">${escapeHtml(capitalize(claim.confidence || 'low'))} confidence${claim.freshness && claim.freshness !== 'unknown' ? ` · ${escapeHtml(freshnessLabel(claim.freshness))}` : ''}</span></div>${claim.generatedStatement && claim.generatedStatement !== claim.statement ? `<div class="audience-generated-note">Generated: ${escapeHtml(claim.generatedStatement)}</div>` : ''}<p>${escapeHtml(claim.statement)}</p>${claim.reviewNote ? `<div class="audience-review-note"><span>Review note</span><strong>${escapeHtml(claim.reviewNote)}</strong></div>` : ''}${claim.whyItMatters ? `<div class="audience-why"><span>Why this matters</span><strong>${escapeHtml(claim.whyItMatters)}</strong></div>` : ''}${claim.validationMethod ? `<div class="audience-test"><span>Test or learn through</span><strong>${escapeHtml(claim.validationMethod)}</strong></div>` : ''}${evidence.length ? `<div class="audience-evidence">${evidence.map((source) => `<button type="button" data-audience-source-id="${escapeHtml(source.id)}">${escapeHtml(source.domain)} ${icon('external', 12)}</button>`).join('')}</div>` : `<div class="audience-no-evidence">No live source mapped</div>`}${actions ? `<div class="audience-review-actions" aria-label="Review controls">${actions}</div>` : ''}${editForm}${validating ? audienceValidationEditor(claim, sources) : ''}</article>`;
}

function audienceVisibleItems(items) {
  return (items || []).filter((item) => state.audienceReviewFilter === 'all' || ensureAudienceClaimMetadata(item).reviewStatus === state.audienceReviewFilter);
}

function audienceSection(number, eyebrow, title, items, sources, emptyCopy = 'No supported items in this analysis yet.', category = '') {
  const visible = audienceVisibleItems(items);
  const empty = state.audienceReviewFilter === 'all' ? emptyCopy : 'No claims match this review filter.';
  return `<section class="audience-results-section"><div class="audience-section-heading"><span class="section-number">${number}</span><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div><span class="signal-count">${visible.length} item${visible.length === 1 ? '' : 's'}</span></div>${visible.length ? `<div class="audience-item-list">${visible.map((item) => audienceItemCard(item, sources, category)).join('')}</div>` : `<div class="audience-empty-list">${empty}</div>`}</section>`;
}

function audienceCombinedSection(number, eyebrow, title, groups, sources) {
  const visibleGroups = groups.map((group) => ({ ...group, items: audienceVisibleItems(group.items) }));
  const items = visibleGroups.flatMap((group) => group.items);
  return `<section class="audience-results-section"><div class="audience-section-heading"><span class="section-number">${number}</span><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div><span class="signal-count">${items.length} item${items.length === 1 ? '' : 's'}</span></div><div class="audience-subgroups">${visibleGroups.map((group) => `<div class="audience-subgroup"><div class="audience-subgroup-label">${group.label}</div>${group.items.length ? `<div class="audience-item-list">${group.items.map((item) => audienceItemCard(item, sources, group.category)).join('')}</div>` : `<div class="audience-empty-list">${state.audienceReviewFilter === 'all' ? `No supported ${group.label.toLowerCase()} yet.` : 'No claims match this review filter.'}</div>`}</div>`).join('')}</div></section>`;
}

function audienceNeedsUpdate(profile) {
  const researchedAt = currentResearch().meta?.researchedAt;
  if (!researchedAt || !profile?.researchVersion) return false;
  return new Date(researchedAt).getTime() > new Date(profile.researchVersion).getTime();
}

function audienceResultsPage() {
  const profile = ensureAudienceReviewProfile(state.strategy.audienceInsights);
  state.strategy.audienceInsights = profile;
  const research = currentResearch();
  const sources = research.sources || [];
  const updateNeeded = audienceNeedsUpdate(profile);
  const summary = getAudienceReviewSummary(profile);
  const radarEligible = getRadarEligibleAudienceItems(profile, research).length;
  const allItems = AUDIENCE_ITEM_KEYS.flatMap((key) => profile[key] || []);
  const observed = allItems.filter((item) => item.evidenceType === 'observed').length;
  const hypotheses = (profile.hypotheses || []).length;
  const filters = [['all', 'All', summary.total], ['pending', 'Pending', summary.pending], ['approved', 'Approved', summary.approved], ['edited', 'Edited', summary.edited], ['rejected', 'Rejected', summary.rejected], ['needs-validation', 'Needs validation', summary['needs-validation']]];
  const filterMarkup = filters.map(([id, label, count]) => `<button class="audience-review-filter ${state.audienceReviewFilter === id ? 'selected' : ''}" type="button" data-audience-filter="${id}" aria-pressed="${state.audienceReviewFilter === id}">${label}<span>${count}</span></button>`).join('');
  const radarCta = radarEligible ? `<button class="button button-primary" type="button" data-route="radar">${icon('radar', 16)} Find opportunities</button>` : `<button class="button button-primary" type="button" data-route="audience" disabled title="Review at least one source-backed claim first">${icon('lock', 16)} Review audience first</button>`;
  return `<div class="audience-page page-entrance"><div class="page-header audience-header audience-results-header"><div><div class="eyebrow">AUDIENCE INTELLIGENCE · ${escapeHtml(capitalize(profile.meta?.mode || 'research-backed'))}</div><h1>The audience<br><em>comes into focus.</em></h1><p>${escapeHtml(state.strategy.idea)}</p></div><div class="research-header-actions"><button class="button button-secondary" type="button" data-action="reanalyze-audience">${icon('refresh', 16)} Re-analyze audience</button><button class="button button-secondary" type="button" data-action="save-audience">${icon('check', 16)} Save audience intelligence</button>${radarCta}</div></div>${profile.meta?.mode === 'research-light' ? `<div class="research-light-banner">${icon('lock', 15)} <span>Based primarily on strategy context and general reasoning, not live market evidence.</span></div>` : ''}${updateNeeded ? `<div class="audience-update-banner">${icon('refresh', 15)} <span>Market research has been updated since this audience analysis.</span><button class="text-button" type="button" data-action="update-audience">Update Audience Intelligence ${icon('arrow', 14)}</button></div>` : ''}<div class="research-meta-line"><span>${escapeHtml(profile.evidenceCoverage?.level || 'limited')} evidence coverage</span><span>·</span><span>${summary.reviewCoveragePercent}% review coverage</span><span>·</span><span>${radarEligible} Radar-ready</span><span>·</span><span>${observed} observed items</span><span>·</span><span>${hypotheses} hypotheses</span><span>·</span><span>${profile.createdAt ? `Analyzed ${formatDateTime(profile.createdAt)}` : 'Analysis ready'}</span></div><div class="audience-review-gate ${radarEligible ? 'ready' : ''}">${icon(radarEligible ? 'check' : 'lock', 15)}<span>${radarEligible ? `${radarEligible} reviewed claim${radarEligible === 1 ? '' : 's'} can feed Opportunity Radar.` : 'Review and validate source-backed audience claims before they can feed Opportunity Radar.'}</span></div><div class="audience-review-toolbar"><div><div class="eyebrow">CLAIM REVIEW</div><strong>${summary.reviewedCount} of ${summary.total} claims reviewed</strong><small>Reviewed claims survive regeneration. ${profile.reviewArchive?.length || 0} retained review${profile.reviewArchive?.length === 1 ? '' : 's'} are archived from older runs.</small></div><div class="audience-review-filters" role="group" aria-label="Filter audience claims">${filterMarkup}</div></div><section class="audience-snapshot"><div class="audience-snapshot-copy"><div class="eyebrow">AUDIENCE SNAPSHOT</div><h2>${escapeHtml(profile.summary || 'No summary was generated.')}</h2><div class="audience-scope-line"><span>${escapeHtml(currentAudienceScope().primaryAudience || state.strategy.audience || 'Audience not specified')}</span><span>·</span><span>${escapeHtml(currentAudienceScope().market || state.strategy.market || 'Market not specified')}</span><span>·</span><span>${escapeHtml(capitalize(currentAudienceScope().purchaseRelationship || 'prospect'))}</span></div>${profile.segments?.length ? `<div class="audience-segment-preview"><div class="eyebrow">SEGMENTS IN SCOPE</div><div>${profile.segments.map((item) => `<span class="segment-chip"><span class="evidence-dot ${escapeHtml(item.evidenceType)}"></span>${escapeHtml(item.statement)}</span>`).join('')}</div></div>` : ''}</div><div class="snapshot-metrics"><div class="snapshot-metric"><strong>${profile.segments?.length || 0}</strong><span>segments</span></div><div class="snapshot-metric"><strong>${observed}</strong><span>observed</span></div><div class="snapshot-metric"><strong>${hypotheses}</strong><span>hypotheses</span></div><div class="snapshot-metric"><strong>${sources.length}</strong><span>sources</span></div></div></section>${audienceSection('00', 'SEGMENTATION', 'Segments In Scope', profile.segments || [], sources, 'No segments were generated.', 'segments')}<section class="evidence-coverage-card"><div><div class="eyebrow">EVIDENCE COVERAGE</div><h3>${escapeHtml(capitalize(profile.evidenceCoverage?.level || 'limited'))}</h3><p>${escapeHtml(profile.evidenceCoverage?.reason || 'Coverage will improve as relevant evidence is added.')}</p></div><div><div class="eyebrow">REVIEW COVERAGE</div><h3>${summary.reviewCoveragePercent}%</h3><p>${summary.radarReadyCount} approved or validated claims are ready for Radar.</p></div></section>${audienceSection('01', 'OBSERVED BEHAVIOR', 'What We Can Observe', profile.observedBehaviors || [], sources, 'No source-mapped observations survived validation.', 'observedBehaviors')}${audienceSection('02', 'MOTIVATION', 'What Moves Them', profile.motivations || [], sources, undefined, 'motivations')}${audienceCombinedSection('03', 'FRICTION', 'What Gets In The Way', [{ label: 'Pains', category: 'pains', items: profile.pains || [] }, { label: 'Barriers', category: 'barriers', items: profile.barriers || [] }, { label: 'Objections', category: 'objections', items: profile.objections || [] }], sources)}${audienceSection('04', 'DESIRE', 'What They Want', profile.desires || [], sources, undefined, 'desires')}${audienceSection('05', 'TENSION', 'Audience Tensions', profile.tensions || [], sources, undefined, 'tensions')}${audienceSection('06', 'ACTION', 'What May Trigger Action', profile.triggers || [], sources, undefined, 'triggers')}${audienceSection('07', 'IDENTITY', 'Who They Want To Be', profile.identityDrivers || [], sources, undefined, 'identityDrivers')}${audienceSection('08', 'CONTENT', 'How They Engage With Content', profile.contentBehaviors || [], sources, undefined, 'contentBehaviors')}${audienceSection('09', 'CONTEXT', 'Moments That Matter', profile.momentsThatMatter || [], sources, undefined, 'momentsThatMatter')}${audienceSection('10', 'DECISION', 'What Shapes The Decision', profile.decisionFactors || [], sources, undefined, 'decisionFactors')}${audienceSection('11', 'TEST NEXT', 'Hypotheses Worth Testing', profile.hypotheses || [], sources, 'No hypotheses were generated. Keep the unknowns visible and gather more evidence before acting.', 'hypotheses')}${audienceSection('12', 'OPEN QUESTIONS', 'What We Don’t Know Yet', profile.uncertainties || [], sources, undefined, 'uncertainties')}${state.selectedSource ? sourceModal(state.selectedSource, sources) : ''}</div>`;
}

function audiencePage() {
  if (state.audienceRun?.loading) return audienceLoadingPage();
  if (!state.strategy?.idea) return `<div class="audience-empty research-empty page-entrance"><div class="research-empty-art">${icon('message', 28)}<span></span><span></span><span></span></div><div class="eyebrow">AUDIENCE INTELLIGENCE</div><h1>Start with a<br><em>strategy question.</em></h1><p>Audience Intelligence uses a strategy brief, brand context, and available market evidence to build a careful audience model.</p><button class="button button-primary" type="button" data-route="strategy">${icon('sparkles', 16)} Start a new strategy</button></div>`;
  if (!state.strategy.audienceInsights) return audienceSetupPage();
  return audienceResultsPage();
}

function currentOpportunityRadar() {
  return state.strategy?.opportunityRadar || createEmptyOpportunityRadar();
}

function currentOpportunityReadiness() {
  return assessIntelligence({ strategy: state.strategy, brand: state.brand, research: currentResearch(), audience: state.strategy?.audienceInsights });
}

function currentCampaignStrategy() {
  return state.strategy?.campaignStrategy || createEmptyCampaignStrategy();
}

function opportunityStatusCard(label, status, detail) {
  return `<div class="radar-status-card status-${escapeHtml(status)}"><span class="radar-status-dot"></span><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(capitalize(status))}</strong><small>${escapeHtml(detail)}</small></div></div>`;
}

function radarSetupPage() {
  const readiness = currentOpportunityReadiness();
  const radar = currentOpportunityRadar();
  const needsAudienceReview = readiness.audienceStatus === 'needs-review' || (!readiness.audienceEligibleCount && readiness.audienceStatus !== 'missing');
  const blocked = readiness.bothMissing || readiness.audienceEligibleCount === 0;
  const hasNotice = radar.meta?.status && radar.meta.status !== 'not-run';
  const notice = radar.meta?.warnings?.[0];
  const statusCopy = readiness.audienceStatus === 'needs-review' ? 'Audience claims exist, but at least one must be reviewed and mapped to current research before Radar can use it.' : readiness.audienceStatus === 'missing' ? 'Analyze the audience to add behavioral context.' : readiness.audienceStatus === 'limited' ? 'Some audience context is hypothetical or uncertain.' : 'Audience signals are available for intersection.';
  const blockedCopy = needsAudienceReview ? '<strong>Review audience intelligence before opening the radar.</strong><p>Approve a source-backed claim, or edit and explicitly revalidate it against a current research excerpt. Unreviewed and stale claims stay out of Radar.</p>' : '<strong>MarketMind needs more evidence before it can identify meaningful opportunities.</strong><p>Run Market Intelligence and Audience Intelligence first. The Radar will not invent missing signals.</p>';
  return `<div class="radar-page page-entrance"><div class="page-header radar-header"><div><div class="eyebrow">OPPORTUNITY RADAR · SETUP</div><h1>Find the<br><em>next opening.</em></h1><p>Where market signals, audience needs and brand strengths intersect. Opportunity Radar returns strategic hypotheses worth exploring, never promises.</p></div><div class="radar-header-mark">${icon('radar', 25)}<span>Strategy<br>territories.</span></div></div>${hasNotice ? `<div class="radar-notice ${escapeHtml(radar.meta.status)}"><div class="unavailable-icon">${icon(radar.meta.status === 'blocked' ? 'lock' : 'radar', 18)}</div><div><div class="eyebrow">${escapeHtml(capitalize(radar.meta.status))} INTELLIGENCE</div><p>${escapeHtml(notice || 'More evidence is needed before meaningful opportunities can be identified.')}</p></div></div>` : ''}<section class="radar-intelligence-status"><div class="eyebrow">INTELLIGENCE CHECK</div><h2>Start from what MarketMind knows.</h2><div class="radar-status-grid">${opportunityStatusCard('Market research', readiness.researchStatus, readiness.researchStatus === 'missing' ? 'Current market evidence is required.' : readiness.researchStatus === 'limited' ? 'Evidence is available, but coverage is limited.' : `${readiness.sources.length} mapped sources available.`)}${opportunityStatusCard('Audience intelligence', readiness.audienceStatus, statusCopy)}</div>${blocked ? `<div class="radar-blocked-copy">${blockedCopy}<div class="radar-blocked-actions"><button class="button button-secondary" type="button" data-action="research-market">${icon('radar', 16)} Research Market</button><button class="button button-secondary" type="button" data-route="audience">${icon('message', 16)} Review Audience</button></div></div>` : `<div class="radar-limited-copy"><span class="status-pulse"></span><p>${readiness.limited ? 'Limited intelligence: the resulting opportunities will carry lower confidence and make uncertainty visible.' : 'Both intelligence layers are available. Choose a strategic lens, then ask MarketMind to find potential opportunities.'}</p></div>`}</section><form id="radar-form" class="radar-controls" novalidate><div><div class="eyebrow">EXPLORE THROUGH</div><h2>Choose a strategic lens.</h2><p>Optional. This changes the emphasis of the next analysis.</p></div><div class="field"><label for="opportunity-lens">Strategic lens</label><select id="opportunity-lens" name="lens">${OPPORTUNITY_LENS_OPTIONS.map((option) => `<option value="${option.id}" ${(radar.lens || 'balanced') === option.id ? 'selected' : ''}>${option.label} — ${option.description}</option>`).join('')}</select></div><div class="form-actions"><button class="button button-primary" type="submit" ${blocked ? 'disabled' : ''}>${icon('radar', 17)} Find Opportunities</button><button class="text-button centered" type="button" data-route="audience">Review audience intelligence</button></div></form></div>`;
}

const OPPORTUNITY_STAGES = [
  { id: 'market', label: 'Reading market signals' },
  { id: 'audience', label: 'Connecting audience insights' },
  { id: 'brand', label: 'Evaluating brand fit' },
  { id: 'competition', label: 'Checking competitive context' },
  { id: 'whitespace', label: 'Identifying strategic whitespace' },
  { id: 'scoring', label: 'Scoring opportunities' },
];

function opportunityLoadingPage() {
  const run = state.opportunityRun || { current: 'market', stages: [] };
  const activeIndex = Math.max(0, OPPORTUNITY_STAGES.findIndex((stage) => stage.id === run.current));
  return `<div class="opportunity-loading page-entrance"><div class="eyebrow">OPPORTUNITY RADAR · ANALYSIS IN PROGRESS</div><h1>Finding the<br><em>next opening.</em></h1><p class="loading-context">${escapeHtml(state.strategy.idea)}</p><div class="loading-board opportunity-loading-board"><div class="loading-board-top"><span class="status-kicker"><span class="status-pulse"></span> RADAR IN PROGRESS</span><span class="loading-depth">${escapeHtml(capitalize(run.lens || 'balanced'))} lens</span></div><div class="research-stage-list">${OPPORTUNITY_STAGES.map((stage, index) => `<div class="research-stage ${index < activeIndex ? 'complete' : ''} ${stage.id === run.current ? 'active' : ''}"><span class="stage-marker">${index < activeIndex ? icon('check', 13) : index + 1}</span><span>${stage.label}</span>${stage.id === run.current ? '<i class="stage-pending"></i>' : ''}</div>`).join('')}</div><div class="loading-detail">${run.detail ? escapeHtml(run.detail) : 'Connecting only to the evidence already present in this strategy.'}</div></div><button class="text-button" type="button" data-route="dashboard">Return to workspace</button></div>`;
}

function opportunityEvidenceButtons(items, sources) {
  const ids = unique((items || []).flatMap((item) => item?.sourceIds || [])).map((id) => sources.find((source) => source.id === id)).filter(Boolean);
  return ids.length ? `<div class="opportunity-evidence-buttons">${ids.map((source) => `<button type="button" data-opportunity-source-id="${escapeHtml(source.id)}">${escapeHtml(source.domain)} ${icon('external', 12)}</button>`).join('')}</div>` : '';
}

function opportunityEvidenceRow(item, sources) {
  if (!item) return '';
  return `<div class="opportunity-evidence-row"><div class="opportunity-evidence-row-top"><span class="evidence-badge evidence-${escapeHtml(item.evidenceType || 'unknown')}"><i></i>${escapeHtml(capitalize(item.evidenceType || 'unknown'))}</span><span class="audience-item-meta">${escapeHtml(capitalize(item.confidence || 'low'))} confidence</span></div><p>${escapeHtml(item.statement || item.summary || '')}</p>${item.whyItMatters ? `<small>${escapeHtml(item.whyItMatters)}</small>` : ''}${opportunityEvidenceButtons([item], sources)}</div>`;
}

function opportunityCard(opportunity, rank, sources) {
  const selected = state.compareOpportunityIds.includes(opportunity.id);
  return `<article class="opportunity-card opportunity-status-${escapeHtml(opportunity.status || 'exploring')}"><div class="opportunity-card-top"><span class="opportunity-rank">${String(rank).padStart(2, '0')}</span><span class="opportunity-type">${escapeHtml(capitalize(opportunity.type))} opportunity</span><span class="opportunity-status-tag">${escapeHtml(capitalize(opportunity.status || 'exploring'))}</span></div><div class="opportunity-card-main"><div><h3>${escapeHtml(opportunity.title)}</h3><p class="opportunity-one-line">${escapeHtml(opportunity.oneLineDescription || opportunity.strategicThesis)}</p><div class="opportunity-thesis"><span>Strategic thesis</span><strong>${escapeHtml(opportunity.strategicThesis)}</strong></div></div><div class="opportunity-score"><strong>${opportunity.scores?.overall || 0}<small>/100</small></strong><span>Opportunity score</span><em>AI assessment</em></div></div><div class="opportunity-stat-grid"><div><span>Confidence</span><strong class="confidence-${escapeHtml(opportunity.confidence)}">${escapeHtml(capitalize(opportunity.confidence))}</strong></div><div><span>Timing</span><strong>${escapeHtml(capitalize(opportunity.timing?.level || 'unknown'))}</strong></div><div><span>Brand fit</span><strong>${escapeHtml(capitalize(opportunity.brandFit?.level || 'low'))}</strong></div><div><span>Audience relevance</span><strong>${opportunity.scores?.audienceRelevance || 0}/10</strong></div></div><div class="opportunity-card-reasoning"><div><span>Why now</span><p>${escapeHtml(opportunity.timing?.explanation || 'Timing remains uncertain from the available evidence.')}</p></div><div><span>Potential whitespace</span><p>${escapeHtml(opportunity.whitespace?.statement || 'No specific whitespace was supported.')}</p></div></div>${opportunityEvidenceButtons([...(opportunity.marketSignals || []), ...(opportunity.audienceSignals || []), ...(opportunity.evidence || [])], sources)}<div class="opportunity-card-actions"><button class="button button-secondary" type="button" data-action="view-opportunity" data-id="${escapeHtml(opportunity.id)}">Explore Opportunity ${icon('arrow', 15)}</button><button class="quiet-button compare-toggle ${selected ? 'selected' : ''}" type="button" data-action="toggle-compare" data-id="${escapeHtml(opportunity.id)}">${selected ? icon('check', 13) : ''}${selected ? 'Compared' : 'Compare'}</button></div></article>`;
}

function compareOpportunities(opportunities) {
  const selected = opportunities.filter((opportunity) => state.compareOpportunityIds.includes(opportunity.id));
  if (selected.length < 2) return '';
  const row = (label, render) => `<div class="compare-row"><span>${label}</span>${selected.map((opportunity) => `<div>${render(opportunity)}</div>`).join('')}</div>`;
  return `<section class="opportunity-compare"><div class="signals-heading"><div><div class="eyebrow">COMPARISON</div><h2>Where should attention go?</h2></div><button class="quiet-button" type="button" data-action="clear-compare">Clear comparison</button></div><div class="compare-grid" style="--compare-count:${selected.length}"><div class="compare-row compare-header"><span>Assessment</span>${selected.map((opportunity) => `<strong>${escapeHtml(opportunity.title)}</strong>`).join('')}</div>${row('Opportunity score', (item) => `<strong>${item.scores?.overall || 0}/100</strong>`)}${row('Confidence', (item) => `<strong class="confidence-${escapeHtml(item.confidence)}">${escapeHtml(capitalize(item.confidence))}</strong>`)}${row('Brand fit', (item) => escapeHtml(capitalize(item.brandFit?.level || 'low')))}${row('Audience relevance', (item) => `${item.scores?.audienceRelevance || 0}/10`)}${row('Timing', (item) => escapeHtml(capitalize(item.timing?.level || 'unknown')))}${row('Whitespace', (item) => escapeHtml(item.whitespace?.statement || 'Not specified'))}${row('Risk', (item) => escapeHtml(item.risks?.[0]?.statement || 'No risk specified'))}</div></section>`;
}

function opportunityResultsPage() {
  const radar = currentOpportunityRadar();
  const opportunities = radar.opportunities || [];
  const sources = currentResearch().sources || [];
  const high = opportunities.filter((opportunity) => opportunity.confidence === 'high').length;
  const medium = opportunities.filter((opportunity) => opportunity.confidence === 'medium').length;
  const exploratory = opportunities.filter((opportunity) => opportunity.confidence === 'low').length;
  const stale = Boolean(radar.meta?.stale || (radar.researchTimestamp && currentResearch().meta?.researchedAt && new Date(currentResearch().meta.researchedAt) > new Date(radar.researchTimestamp)) || researchIsStale(radar.researchTimestamp));
  const contradictionCount = radar.meta?.contradictionsConsidered?.length || 0;
  return `<div class="radar-page page-entrance"><div class="page-header radar-header radar-results-header"><div><div class="eyebrow">OPPORTUNITY RADAR · ${escapeHtml(capitalize(radar.lens || 'balanced'))} LENS</div><h1>Where the signal<br><em>becomes direction.</em></h1><p>Where market signals, audience needs and brand strengths intersect.</p></div><div class="research-header-actions"><button class="button button-secondary" type="button" data-action="find-more-opportunities">${icon('refresh', 16)} Find More Opportunities</button><button class="button button-primary" type="button" data-route="audience">${icon('message', 16)} Review audience</button></div></div>${stale ? `<div class="radar-stale-banner">${icon('clock', 15)} <span>Research may be stale. Refresh Market Intelligence before treating these assessments as current.</span><button class="text-button" type="button" data-route="research">Refresh Market Intelligence ${icon('arrow', 14)}</button></div>` : ''}<div class="research-meta-line"><span>${opportunities.length} potential opportunities</span><span>·</span><span>${high} high-confidence</span><span>·</span><span>${medium} medium-confidence</span><span>·</span><span>${exploratory} exploratory</span><span>·</span><span>${contradictionCount} contradictions considered</span></div><section class="radar-summary"><div class="radar-summary-lead"><div class="eyebrow">OPPORTUNITY SUMMARY</div><h2>${opportunities.length} potential opportunit${opportunities.length === 1 ? 'y' : 'ies'}<br><em>worth exploring.</em></h2><p>These are strategic hypotheses, not guarantees. Scores show a MarketMind assessment based on the available evidence.</p></div><div class="radar-summary-stats"><div><strong>${high}</strong><span>High confidence</span></div><div><strong>${medium}</strong><span>Medium confidence</span></div><div><strong>${exploratory}</strong><span>Exploratory</span></div><div><strong>${sources.length}</strong><span>Sources used</span></div></div></section><div class="opportunity-toolbar"><div><div class="eyebrow">STRATEGIC LENS</div><select id="results-opportunity-lens">${OPPORTUNITY_LENS_OPTIONS.map((option) => `<option value="${option.id}" ${(radar.lens || 'balanced') === option.id ? 'selected' : ''}>${option.label}</option>`).join('')}</select></div><div class="compare-help">${state.compareOpportunityIds.length >= 2 ? `<span>${state.compareOpportunityIds.length} selected for comparison</span>` : '<span>Select two or more to compare.</span>'}</div></div>${compareOpportunities(opportunities)}<section class="opportunity-list"><div class="signals-heading"><div><div class="eyebrow">RANKED TERRITORIES</div><h2>Potential opportunities.</h2></div><div class="signal-count">${opportunities.length} returned</div></div>${opportunities.map((opportunity, index) => opportunityCard(opportunity, index + 1, sources)).join('')}</section>${state.selectedSource ? sourceModal(state.selectedSource, sources) : ''}</div>`;
}

function opportunityDetailPage(opportunity) {
  const sources = currentResearch().sources || [];
  const status = opportunity.status || 'exploring';
  return `<div class="radar-page page-entrance"><div class="detail-back"><button class="text-button" type="button" data-action="back-to-radar">${icon('arrow', 16)} Back to Opportunity Radar</button></div><div class="opportunity-detail-header"><div><div class="eyebrow">OPPORTUNITY · ${escapeHtml(capitalize(opportunity.type))}</div><h1>${escapeHtml(opportunity.title)}</h1><p>${escapeHtml(opportunity.oneLineDescription || '')}</p></div><div class="opportunity-detail-actions"><span class="opportunity-status-tag">${escapeHtml(capitalize(status))}</span><button class="button button-secondary" type="button" data-action="set-opportunity-status" data-status="selected" data-id="${escapeHtml(opportunity.id)}">${icon('check', 15)} Select</button><button class="quiet-button" type="button" data-action="set-opportunity-status" data-status="rejected" data-id="${escapeHtml(opportunity.id)}">Reject</button><button class="button button-primary" type="button" data-action="develop-campaign" data-id="${escapeHtml(opportunity.id)}">${icon('layers', 15)} Develop Campaign</button></div></div><section class="detail-thesis"><div class="eyebrow">STRATEGIC THESIS · HYPOTHESIS</div><h2>${escapeHtml(opportunity.strategicThesis)}</h2><p>This is a strategic hypothesis to explore, not a prediction of success.</p></section><section class="detail-chain"><div class="eyebrow">WHY THIS OPPORTUNITY EXISTS</div><h2>Follow the evidence chain.</h2><div class="evidence-chain"><div class="chain-step"><span>01</span><div><div class="eyebrow">MARKET SIGNALS</div>${(opportunity.marketSignals || []).length ? opportunity.marketSignals.map((item) => opportunityEvidenceRow(item, sources)).join('') : '<p class="muted-copy">No market signal was mapped.</p>'}</div></div><div class="chain-arrow">↓</div><div class="chain-step"><span>02</span><div><div class="eyebrow">AUDIENCE SIGNALS</div>${(opportunity.audienceSignals || []).length ? opportunity.audienceSignals.map((item) => opportunityEvidenceRow(item, sources)).join('') : '<p class="muted-copy">No audience signal was mapped.</p>'}</div></div><div class="chain-arrow">↓</div><div class="chain-step"><span>03</span><div><div class="eyebrow">BRAND RELEVANCE</div><div class="detail-object"><span class="evidence-badge evidence-${escapeHtml(opportunity.brandFit?.evidenceType || 'unknown')}"><i></i>${escapeHtml(capitalize(opportunity.brandFit?.evidenceType || 'unknown'))}</span><p>${escapeHtml(opportunity.brandFit?.explanation || 'Brand fit remains uncertain.')}</p>${opportunityEvidenceButtons([opportunity.brandFit], sources)}</div></div></div><div class="chain-arrow">↓</div><div class="chain-step"><span>04</span><div><div class="eyebrow">OPPORTUNITY</div><div class="detail-object opportunity-object"><span class="evidence-badge evidence-hypothesis"><i></i>Hypothesis</span><p>${escapeHtml(opportunity.oneLineDescription || opportunity.strategicThesis)}</p></div></div></div></div></section><section class="detail-card competitive-detail"><div class="eyebrow">COMPETITIVE CONTEXT</div><h2>What the category appears to occupy.</h2><p>${escapeHtml(opportunity.competitiveContext?.summary || 'Competitive evidence is limited.')}</p>${opportunityEvidenceButtons([opportunity.competitiveContext], sources)}</section><div class="detail-two-column"><section class="detail-card"><div class="eyebrow">WHY NOW</div><h2>${escapeHtml(capitalize(opportunity.timing?.level || 'unknown'))}</h2><p>${escapeHtml(opportunity.timing?.explanation || 'Timing is unknown from the available evidence.')}</p>${opportunityEvidenceButtons([opportunity.timing], sources)}</section><section class="detail-card"><div class="eyebrow">POTENTIAL WHITESPACE</div><h2>Worth exploring</h2><p>${escapeHtml(opportunity.whitespace?.statement || 'No potential whitespace was supported by the current evidence.')}</p>${opportunityEvidenceButtons([opportunity.whitespace], sources)}</section></div>${opportunity.contradictions?.length ? `<section class="detail-card contradiction-detail"><div class="eyebrow">CONTRADICTIONS TO HOLD</div><h2>Evidence is mixed.</h2>${opportunity.contradictions.map((item) => opportunityEvidenceRow(item, sources)).join('')}</section>` : ''}<section class="assessment-card"><div><div class="eyebrow">MARKETMIND ASSESSMENT</div><h2>${opportunity.scores?.overall || 0}<small>/100</small></h2><p>AI assessment based on available evidence. Not a probability of success.</p></div><div class="score-breakdown">${[['Audience relevance','audienceRelevance'],['Brand fit','brandFit'],['Evidence strength','evidenceStrength'],['Timing','timing'],['Competitive whitespace','competitiveWhitespace'],['Actionability','actionability']].map(([label, key]) => `<div><span>${label}</span><strong>${opportunity.scores?.[key] || 0}/10</strong><i><b style="width:${(opportunity.scores?.[key] || 0) * 10}%"></b></i></div>`).join('')}</div><div class="assessment-confidence"><span>Confidence</span><strong class="confidence-${escapeHtml(opportunity.confidence)}">${escapeHtml(capitalize(opportunity.confidence))}</strong><p>Confidence is separate from the Opportunity Score.</p></div></section><div class="detail-two-column"><section class="detail-card"><div class="eyebrow">POTENTIAL RISKS</div><h2>What could weaken this?</h2>${opportunity.risks?.length ? opportunity.risks.map((item) => opportunityEvidenceRow(item, sources)).join('') : '<p class="muted-copy">No specific risks were returned; validate before acting.</p>'}</section><section class="detail-card"><div class="eyebrow">WHAT WOULD DISPROVE THIS?</div><h2>Falsification signals</h2>${opportunity.falsificationSignals?.length ? opportunity.falsificationSignals.map((item) => opportunityEvidenceRow(item, sources)).join('') : '<p class="muted-copy">Define disconfirming evidence before investing attention.</p>'}</section></div><section class="validation-card"><div><div class="eyebrow">HOW TO VALIDATE</div><h2>${escapeHtml(opportunity.validationPlan?.method || 'Research or experiment')}</h2><p>${escapeHtml(opportunity.validationPlan?.plan || 'Create a small, measurable test before building a campaign.')}</p></div><div><div class="eyebrow">RECOMMENDED NEXT STEP</div><h2>${escapeHtml(opportunity.recommendedNextStep || 'Validate the audience tension')}</h2><p>Phase 4 stops here. No campaign is created automatically.</p></div></section>${state.selectedSource ? sourceModal(state.selectedSource, sources) : ''}</div>`;
}

function opportunityPage() {
  if (state.opportunityRun?.loading) return opportunityLoadingPage();
  if (!state.strategy?.idea) return `<div class="radar-empty research-empty page-entrance"><div class="research-empty-art">${icon('radar', 28)}<span></span><span></span><span></span></div><div class="eyebrow">OPPORTUNITY RADAR</div><h1>Start with a<br><em>strategy question.</em></h1><p>Opportunity Radar connects market signals, audience understanding, and brand fit to find strategic territories worth exploring.</p><button class="button button-primary" type="button" data-route="strategy">${icon('sparkles', 16)} Start a new strategy</button></div>`;
  const radar = currentOpportunityRadar();
  if (!radar.opportunities?.length || radar.meta?.status !== 'ready' || currentOpportunityReadiness().audienceEligibleCount === 0) return radarSetupPage();
  const selected = radar.opportunities.find((opportunity) => opportunity.id === state.openOpportunityId);
  return selected ? opportunityDetailPage(selected) : opportunityResultsPage();
}

function selectedOpportunity() {
  const radar = currentOpportunityRadar();
  return radar.opportunities?.find((item) => item.id === state.strategy?.selectedOpportunityId) || radar.opportunities?.find((item) => item.status === 'selected') || null;
}

function campaignClaim(claim, fallback = 'Not defined yet.') {
  const object = typeof claim === 'string' ? { statement: claim } : claim || {};
  return escapeHtml(object.statement || fallback);
}

function campaignClaimBlock(label, claim, sources, fallback = 'Not defined yet.') {
  const object = typeof claim === 'string' ? { statement: claim } : claim || {};
  return `<div class="campaign-claim"><div class="campaign-claim-top"><span class="eyebrow">${escapeHtml(label)}</span><span class="evidence-badge evidence-${escapeHtml(object.evidenceType || 'unknown')}"><i></i>${escapeHtml(capitalize(object.evidenceType || 'unknown'))}</span></div><p>${campaignClaim(object, fallback)}</p>${opportunityEvidenceButtons([object], sources).replaceAll('data-opportunity-source-id', 'data-campaign-source-id')}</div>`;
}

function campaignSetupPage(opportunity) {
  const campaign = currentCampaignStrategy();
  const warning = campaign.meta?.warnings?.[0];
  return `<div class="campaign-page page-entrance"><div class="page-header campaign-header"><div><div class="eyebrow">CAMPAIGN STRATEGY STUDIO · SETUP</div><h1>Turn the opportunity<br><em>into a strategy.</em></h1><p>Build the why, what, who, how, where, and why now before creative production begins.</p></div><div class="campaign-header-mark">${icon('layers', 25)}<span>Strategy<br>before output.</span></div></div>${warning ? `<div class="campaign-notice ${escapeHtml(campaign.meta?.status || 'unavailable')}">${icon(campaign.meta?.status === 'blocked' ? 'lock' : 'layers', 16)}<span>${escapeHtml(warning)}</span></div>` : ''}<section class="campaign-confirmation"><div class="eyebrow">SELECTED OPPORTUNITY</div><h2>${escapeHtml(opportunity.title)}</h2><p>${escapeHtml(opportunity.strategicThesis || opportunity.oneLineDescription || '')}</p><div class="campaign-confirmation-grid"><div><span>Audience</span><strong>${escapeHtml(state.strategy.audience || state.brand.audience || 'Not specified')}</strong></div><div><span>Objective</span><strong>${escapeHtml(state.strategy.objective || 'Not specified')}</strong></div><div><span>Market</span><strong>${escapeHtml(state.strategy.market || 'Not specified')}</strong></div><div><span>Brand</span><strong>${escapeHtml(state.brand.name || 'Not specified')}</strong></div></div></section><form id="campaign-setup-form" class="campaign-setup-form" novalidate><div class="eyebrow">OPTIONAL REFINEMENT</div><h2>Give the strategy a working shape.</h2><div class="form-grid"><div class="field"><label for="campaign-name">Campaign name</label><input id="campaign-name" name="name" maxlength="120" value="${escapeHtml(campaign.name || '')}" placeholder="e.g. Run Together"></div><div class="field"><label for="campaign-duration">Campaign duration</label><input id="campaign-duration" name="duration" maxlength="80" value="${escapeHtml(campaign.duration || '')}" placeholder="e.g. 4 weeks"></div></div><div class="form-grid"><div class="field"><label for="campaign-primary-platform">Primary platform</label><select id="campaign-primary-platform" name="primaryPlatform"><option value="">Use strategy default</option>${CAMPAIGN_PLATFORMS.map((item) => `<option value="${escapeHtml(item)}" ${campaign.primaryPlatform === item || (!campaign.primaryPlatform && state.strategy.platforms?.[0] === item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div><div class="field"><label for="campaign-scale">Desired campaign scale</label><select id="campaign-scale" name="scale">${CAMPAIGN_SCALES.map((item) => `<option value="${item.id}" ${(campaign.scale || 'standard') === item.id ? 'selected' : ''}>${item.label} — ${item.description}</option>`).join('')}</select></div></div><div class="field"><label>Secondary platforms <span class="optional">OPTIONAL</span></label><div class="platform-check-grid">${CAMPAIGN_PLATFORMS.filter((item) => item !== 'Multi-platform').map((item) => `<label class="platform-check"><input type="checkbox" name="secondaryPlatforms" value="${escapeHtml(item)}" ${(campaign.secondaryPlatforms || []).includes(item) ? 'checked' : ''}><span>${escapeHtml(item)}</span></label>`).join('')}</div></div><div class="campaign-form-actions"><button class="button button-primary" type="submit">${icon('layers', 17)} Develop Campaign Strategy</button><button class="text-button" type="button" data-action="view-intelligence">View selected intelligence ${icon('arrow', 14)}</button></div></form></div>`;
}

const CAMPAIGN_UI_STAGES = [
  { id: 'opportunity', label: 'Reading selected opportunity' },
  { id: 'audience', label: 'Connecting audience insight' },
  { id: 'foundation', label: 'Building strategic foundation' },
  { id: 'territories', label: 'Exploring creative territories' },
  { id: 'concept', label: 'Developing campaign concept' },
  { id: 'channels', label: 'Building channel strategy' },
];

function campaignLoadingPage() {
  const run = state.campaignRun || { current: 'opportunity', stages: [] };
  const activeIndex = Math.max(0, CAMPAIGN_UI_STAGES.findIndex((stage) => stage.id === run.current));
  return `<div class="campaign-loading page-entrance"><div class="eyebrow">CAMPAIGN STRATEGY STUDIO · ANALYSIS IN PROGRESS</div><h1>Building the<br><em>strategic bridge.</em></h1><p class="loading-context">${escapeHtml(state.strategy.idea)}</p><div class="loading-board campaign-loading-board"><div class="loading-board-top"><span class="status-kicker"><span class="status-pulse"></span> STRATEGY IN PROGRESS</span><span class="loading-depth">${escapeHtml(capitalize(run.section || 'all'))} scope</span></div><div class="research-stage-list">${CAMPAIGN_UI_STAGES.map((stage, index) => `<div class="research-stage ${index < activeIndex ? 'complete' : ''} ${stage.id === run.current ? 'active' : ''}"><span class="stage-marker">${index < activeIndex ? icon('check', 13) : index + 1}</span><span>${stage.label}</span>${stage.id === run.current ? '<i class="stage-pending"></i>' : ''}</div>`).join('')}</div><div class="loading-detail">${escapeHtml(run.detail || 'Connecting only to the intelligence already selected for this strategy.')}</div></div><button class="text-button" type="button" data-route="dashboard">Return to workspace</button></div>`;
}

function campaignProgress(campaign) {
  const hasTerritories = Boolean(campaign.creativeTerritories?.length);
  const hasConcept = Boolean(campaign.campaignConcept?.bigIdea);
  return `<div class="campaign-progress"><div class="campaign-progress-step complete"><span>01</span><strong>Opportunity</strong></div><div class="campaign-progress-line"></div><div class="campaign-progress-step complete"><span>02</span><strong>Strategy</strong></div><div class="campaign-progress-line"></div><div class="campaign-progress-step ${hasTerritories ? 'complete' : ''}"><span>03</span><strong>Territory</strong></div><div class="campaign-progress-line"></div><div class="campaign-progress-step ${hasConcept ? 'complete' : ''}"><span>04</span><strong>Concept</strong></div><div class="campaign-progress-line"></div><div class="campaign-progress-step ${hasConcept ? 'ready' : ''}"><span>05</span><strong>Ready for creative</strong></div></div>`;
}

function territoryCard(territory, index, campaign) {
  const selected = campaign.selectedCreativeTerritoryId === territory.id;
  const compared = state.compareTerritoryIds.includes(territory.id);
  const score = territory.scores || {};
  return `<article class="territory-card ${selected ? 'territory-selected' : ''}"><div class="territory-card-top"><span class="territory-number">0${index + 1}</span><span class="territory-confidence confidence-${escapeHtml(territory.confidence || 'medium')}">${escapeHtml(capitalize(territory.confidence || 'medium'))} confidence</span></div><h3>${escapeHtml(territory.name)}</h3><p class="territory-thought">${escapeHtml(territory.coreThought)}</p><div class="territory-detail"><div><span>Emotional direction</span><strong>${escapeHtml(territory.emotionalDirection || 'To explore')}</strong></div><div><span>Audience relevance</span><p>${escapeHtml(territory.audienceRelevance || 'Evidence is limited.')}</p></div><div><span>Brand relevance</span><p>${escapeHtml(territory.brandRelevance || 'Evidence is limited.')}</p></div></div><div class="territory-score-grid"><div><span>Resonance</span><strong>${score.audienceResonance || 0}/10</strong></div><div><span>Brand fit</span><strong>${score.brandFit || 0}/10</strong></div><div><span>Distinctive</span><strong>${score.distinctiveness || 0}/10</strong></div><div><span>Execution</span><strong>${score.executionPotential || 0}/10</strong></div></div>${territory.creativePossibilities?.length ? `<div class="territory-possibilities"><span>Creative possibilities</span><p>${territory.creativePossibilities.map(escapeHtml).join(' · ')}</p></div>` : ''}${territory.risks?.length ? `<div class="territory-risk"><span>Risk</span><p>${escapeHtml(territory.risks[0].statement || '')}</p></div>` : ''}<div class="territory-actions"><button class="button ${selected ? 'button-primary' : 'button-secondary'}" type="button" data-action="select-territory" data-id="${escapeHtml(territory.id)}">${selected ? icon('check', 15) + ' Territory selected' : 'Develop this territory'}</button><button class="quiet-button ${compared ? 'selected' : ''}" type="button" data-action="toggle-territory-compare" data-id="${escapeHtml(territory.id)}">${compared ? icon('check', 13) + ' Compared' : 'Compare'}</button></div></article>`;
}

function territoryComparison(campaign) {
  const selected = campaign.creativeTerritories.filter((item) => state.compareTerritoryIds.includes(item.id));
  if (selected.length < 2) return '';
  const row = (label, key, lowerIsBetter = false) => `<div class="territory-compare-row"><span>${label}</span>${selected.map((item) => `<div><strong class="${lowerIsBetter ? 'risk-score' : ''}">${item.scores?.[key] || 0}/10</strong></div>`).join('')}</div>`;
  return `<section class="territory-comparison"><div class="signals-heading"><div><div class="eyebrow">TERRITORY COMPARISON · MARKETMIND ASSESSMENT</div><h2>Where should the idea go?</h2></div><button class="quiet-button" type="button" data-action="clear-territory-compare">Clear comparison</button></div><div class="territory-compare-grid" style="--territory-count:${selected.length}"><div class="territory-compare-row territory-compare-header"><span>Assessment</span>${selected.map((item) => `<strong>${escapeHtml(item.name)}</strong>`).join('')}</div>${row('Audience resonance', 'audienceResonance')}${row('Brand fit', 'brandFit')}${row('Distinctiveness', 'distinctiveness')}${row('Emotional potential', 'emotionalPotential')}${row('Execution potential', 'executionPotential')}${row('Risk', 'risk', true)}</div><p class="assessment-note">These are directional MarketMind assessments, not objective measurements.</p></section>`;
}

function platformRolesText(campaign) {
  return (campaign.platformStrategy || []).map((item) => `${item.platform || ''} — ${item.role || ''}`).filter(Boolean).join('\n');
}

function contentPillarsText(campaign) {
  return (campaign.contentPillars || []).map((item) => `${item.name || ''} — ${item.purpose || item.message || ''}`).filter(Boolean).join('\n');
}

function campaignEditor(campaign) {
  if (!state.campaignEditorOpen) return `<button class="quiet-button campaign-edit-toggle" type="button" data-action="toggle-campaign-editor">${icon('layers', 14)} Edit strategy</button>`;
  return `<form id="campaign-editor-form" class="campaign-editor"><div class="campaign-editor-top"><div><div class="eyebrow">USER OVERRIDE</div><h2>Keep the strategist in control.</h2><p>Your version becomes the source of truth for future regeneration.</p></div><button class="quiet-button" type="button" data-action="toggle-campaign-editor">Close</button></div><div class="form-grid"><div class="field"><label for="editor-campaign-name">Campaign name</label><input id="editor-campaign-name" value="${escapeHtml(campaign.name)}"></div><div class="field"><label for="editor-objective">Objective</label><select id="editor-objective">${CAMPAIGN_OBJECTIVES.map((item) => `<option ${campaign.objective === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div></div><div class="field"><label for="editor-thesis">Campaign thesis</label><textarea id="editor-thesis" rows="3">${escapeHtml(campaign.campaignThesis?.statement || '')}</textarea></div><div class="field"><label for="editor-core-message">Core message</label><textarea id="editor-core-message" rows="2">${escapeHtml(campaign.coreMessage?.statement || '')}</textarea></div><div class="field"><label for="editor-primary-cta">Primary CTA</label><input id="editor-primary-cta" value="${escapeHtml(campaign.ctaStrategy?.primary || '')}"></div><div class="form-grid"><div class="field"><label for="editor-platform-roles">Platform roles</label><textarea id="editor-platform-roles" rows="4" placeholder="Instagram — Discovery and participation">${escapeHtml(platformRolesText(campaign))}</textarea><div class="field-meta"><span>One per line: Platform — Role</span></div></div><div class="field"><label for="editor-content-pillars">Content pillars</label><textarea id="editor-content-pillars" rows="4" placeholder="The community — Make belonging tangible">${escapeHtml(contentPillarsText(campaign))}</textarea><div class="field-meta"><span>One per line: Name — Purpose</span></div></div></div><div class="campaign-form-actions"><button class="button button-primary" type="submit">${icon('check', 15)} Use my version</button><span class="editor-note">Edited sections stay intact during regeneration.</span></div></form>`;
}

function campaignOverviewPage(opportunity) {
  const campaign = currentCampaignStrategy();
  const sources = currentResearch().sources || [];
  const selectedTerritory = campaign.creativeTerritories?.find((item) => item.id === campaign.selectedCreativeTerritoryId);
  const limited = campaign.confidence === 'low' || opportunity.confidence === 'low' || campaign.meta?.status === 'limited';
  const concept = campaign.campaignConcept;
  return `<div class="campaign-page page-entrance"><div class="page-header campaign-header campaign-overview-header"><div><div class="eyebrow">CAMPAIGN STRATEGY STUDIO · ${escapeHtml(capitalize(campaign.scale || 'standard'))} SCALE</div><h1>${escapeHtml(campaign.name || 'Campaign strategy')}<br><em>with a point of view.</em></h1><p>${campaignClaim(campaign.campaignThesis, 'A campaign thesis will appear here once the strategy is developed.')}</p></div><div class="campaign-overview-actions"><button class="button button-secondary" type="button" data-action="view-intelligence">${icon('radar', 16)} View intelligence</button><button class="button button-primary" type="button" data-action="regenerate-campaign" data-section="all">${icon('refresh', 16)} Regenerate strategy</button></div></div>${limited ? `<div class="campaign-limited-banner">${icon('lock', 15)} <span>This strategy is exploratory because the underlying evidence is limited.</span></div>` : ''}<section class="campaign-overview-strip"><div><span>Selected opportunity</span><strong>${escapeHtml(opportunity.title)}</strong></div><div><span>Audience</span><strong>${escapeHtml(state.strategy.audience || state.brand.audience || 'Not specified')}</strong></div><div><span>Objective</span><strong>${escapeHtml(campaign.objective || campaign.originalObjective || 'Not specified')}</strong>${campaign.objective !== campaign.originalObjective && campaign.objectiveRationale ? `<small>${escapeHtml(campaign.objectiveRationale)}</small>` : ''}</div><div><span>Confidence</span><strong class="confidence-${escapeHtml(campaign.confidence)}">${escapeHtml(capitalize(campaign.confidence))}</strong></div></section>${campaignProgress(campaign)}<section class="campaign-foundation"><div class="section-heading"><div class="section-number">01</div><div><div class="eyebrow">STRATEGIC FOUNDATION</div><h2>The reason to believe.</h2></div><button class="quiet-button" type="button" data-action="regenerate-campaign" data-section="foundation">Regenerate foundation</button></div><div class="campaign-foundation-grid">${campaignClaimBlock('THE PROBLEM WE ARE SOLVING', campaign.strategicProblem, sources, 'The strategic problem is not defined yet.')}${campaignClaimBlock('MARKETMIND INSIGHT · INTERPRETATION', campaign.audienceInsight, sources, 'The audience insight is not defined yet.')}${campaignClaimBlock('CAMPAIGN THESIS · HYPOTHESIS', campaign.campaignThesis, sources, 'The campaign thesis is not defined yet.')}${campaignClaimBlock('CURRENT PERCEPTION', campaign.currentPerception, sources, 'Current perception is not defined yet.')}${campaignClaimBlock('DESIRED PERCEPTION · HYPOTHESIS', campaign.desiredPerception, sources, 'Desired perception is not defined yet.')}${campaignClaimBlock('BRAND ROLE', campaign.brandRole, sources, 'Brand role is not defined yet.')}</div><div class="campaign-differentiation"><div><div class="eyebrow">WHAT WE WILL NOT DO</div><p>${escapeHtml(campaign.differentiation?.notDo || 'Not defined yet.')}</p></div><div><div class="eyebrow">WHAT WE WILL DO INSTEAD</div><p>${escapeHtml(campaign.differentiation?.doInstead || 'Not defined yet.')}</p></div></div><div class="campaign-message-row"><div>${campaignClaimBlock('ONE CORE MESSAGE · HYPOTHESIS', campaign.coreMessage, sources, 'Core message is not defined yet.')}</div><div class="campaign-supporting"><div class="eyebrow">SUPPORTING MESSAGES</div>${campaign.supportingMessages?.length ? campaign.supportingMessages.map((item) => `<div class="supporting-message"><span>${escapeHtml(item.category || 'Message')}</span><strong>${escapeHtml(item.message || item.statement)}</strong></div>`).join('') : '<p class="muted-copy">No supporting messages yet.</p>'}</div></div></section><section class="creative-territories-section"><div class="section-heading"><div class="section-number">02</div><div><div class="eyebrow">CREATIVE TERRITORIES</div><h2>Three ways into the idea.</h2><p>Meaningfully different strategic directions, not three versions of the same campaign.</p></div><button class="quiet-button" type="button" data-action="regenerate-campaign" data-section="territories">Regenerate territories</button></div><div class="territory-toolbar"><span>${campaign.creativeTerritories?.length || 0} territories returned</span><span>${state.compareTerritoryIds.length >= 2 ? `${state.compareTerritoryIds.length} selected for comparison` : 'Compare two or more territories'}</span></div><div class="territory-grid">${campaign.creativeTerritories?.length ? campaign.creativeTerritories.map((item, index) => territoryCard(item, index, campaign)).join('') : '<div class="campaign-empty-card">No creative territories are available yet. Regenerate this section when an AI provider is connected.</div>'}</div>${territoryComparison(campaign)}</section>${selectedTerritory ? `<section class="campaign-concept-section"><div class="section-heading"><div class="section-number">03</div><div><div class="eyebrow">CAMPAIGN CONCEPT · ${concept?.bigIdea ? 'DEVELOPED' : 'READY TO DEVELOP'}</div><h2>${escapeHtml(selectedTerritory.name)} becomes the foundation.</h2></div><div class="section-heading-actions">${concept?.bigIdea ? '<button class="quiet-button" type="button" data-action="regenerate-campaign" data-section="concept">Regenerate concept</button>' : `<button class="button button-primary" type="button" data-action="develop-campaign-concept">Develop Campaign Concept</button>`}</div></div>${concept?.bigIdea ? `<div class="concept-card"><div class="concept-hero"><div><div class="eyebrow">CAMPAIGN BIG IDEA</div><h3>${escapeHtml(concept.bigIdea)}</h3></div><span class="evidence-badge evidence-hypothesis"><i></i>Strategic concept</span></div><div class="concept-grid"><div><span>Campaign name</span><strong>${escapeHtml(concept.campaignName || campaign.name)}</strong></div><div><span>Campaign thought</span><strong>${escapeHtml(concept.campaignThought)}</strong></div><div><span>Emotional promise</span><strong>${escapeHtml(concept.emotionalPromise)}</strong></div><div><span>Brand role</span><strong>${escapeHtml(concept.brandRole)}</strong></div><div><span>Audience role</span><strong>${escapeHtml(concept.audienceRole)}</strong></div><div><span>CTA</span><strong>${escapeHtml(concept.cta || campaign.ctaStrategy?.primary)}</strong></div></div><div class="concept-narrative"><span>Core narrative</span><p>${escapeHtml(concept.coreNarrative)}</p></div></div><div class="campaign-support-row"><div>${campaignClaimBlock('CREATIVE PRINCIPLE', campaign.creativePrinciple, sources, 'Every creative execution should...')}</div><div><div class="eyebrow">EMOTIONAL TERRITORY</div><p class="emotion-list">${(campaign.emotionalTerritory?.include || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('') || '<span>To be defined</span>'}</p><small>Avoid: ${escapeHtml((campaign.emotionalTerritory?.avoid || []).join(', ') || 'No exclusions specified')}</small></div></div>` : '<div class="campaign-next-card">Select this territory as the strategic foundation, then develop the campaign concept.</div>'}</section>` : '<section class="campaign-next-card"><div class="eyebrow">NEXT DECISION</div><h2>Select a creative territory to continue.</h2><p>The selected territory becomes the foundation for the campaign concept.</p></section>'}<section class="campaign-channel-section"><div class="section-heading"><div class="section-number">04</div><div><div class="eyebrow">CHANNEL STRATEGY</div><h2>Give every platform a role.</h2><p>Define channel jobs and content roles before writing individual assets.</p></div><button class="quiet-button" type="button" data-action="regenerate-campaign" data-section="channels">Regenerate channels</button></div><div class="channel-role-grid">${campaign.platformStrategy?.length ? campaign.platformStrategy.map((item) => `<article class="channel-role-card"><div class="eyebrow">${escapeHtml(item.platform)}</div><h3>${escapeHtml(item.role || 'Platform role not defined')}</h3><p>${escapeHtml(item.contentType || 'Content type not defined')}</p><span>${escapeHtml(item.audienceBehavior || 'Audience behavior not defined')}</span><strong>Primary KPI · ${escapeHtml(item.primaryKpi || 'To define')}</strong></article>`).join('') : '<div class="campaign-empty-card">Channel roles will appear after strategy generation.</div>'}</div><div class="campaign-pillar-grid"><div><div class="eyebrow">CONTENT PILLARS</div>${campaign.contentPillars?.length ? campaign.contentPillars.map((item) => `<div class="pillar-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.purpose || item.message)}</span><small>${escapeHtml((item.contentForms || []).join(' · '))}</small></div>`).join('') : '<p class="muted-copy">No content pillars yet.</p>'}</div><div><div class="eyebrow">CTA STRATEGY</div><div class="cta-box"><strong>${escapeHtml(campaign.ctaStrategy?.primary || 'Primary CTA not defined')}</strong><span>Secondary · ${escapeHtml(campaign.ctaStrategy?.secondary || 'Not defined')}</span><p>${escapeHtml(campaign.ctaStrategy?.rationale || 'CTA rationale will appear here.')}</p></div></div></div>${campaign.campaignPhases?.length ? `<div class="campaign-phases"><div class="eyebrow">CAMPAIGN PHASES · ${escapeHtml(campaign.duration || 'HIGH-LEVEL')}</div>${campaign.campaignPhases.map((item) => `<div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.focus)}</span><p>${escapeHtml(item.description)}</p></div>`).join('')}</div>` : ''}</section><section class="campaign-measure-section"><div class="section-heading"><div class="section-number">05</div><div><div class="eyebrow">KPIS & EXPERIMENTS</div><h2>Know what to learn.</h2></div></div><div class="measure-grid"><div><div class="eyebrow">SUCCESS METRICS</div>${campaign.kpis?.length ? campaign.kpis.map((item) => `<div class="measure-row"><strong>${escapeHtml(item.name || item.message)}</strong><span>${escapeHtml(item.statement || item.message)}</span></div>`).join('') : '<p class="muted-copy">No benchmarks or predicted results are fabricated.</p>'}</div><div><div class="eyebrow">WHAT SHOULD WE TEST?</div>${campaign.experiments?.length ? campaign.experiments.map((item) => `<div class="measure-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.statement || item.message)} ${item.variants?.length ? `Variants: ${escapeHtml(item.variants.join(' vs '))}` : ''}</span></div>`).join('') : '<p class="muted-copy">No experiments yet.</p>'}</div></div></section><section class="campaign-risk-section"><div class="section-heading"><div class="section-number">06</div><div><div class="eyebrow">RISKS & DISCIPLINE</div><h2>Keep the strategy honest.</h2></div></div><div class="risk-grid"><div><div class="eyebrow">RISKS</div>${campaign.risks?.length ? campaign.risks.map((item) => `<div class="risk-row"><strong>${escapeHtml(item.category || 'Risk')}</strong><p>${escapeHtml(item.statement || item.message)}</p><small>${escapeHtml(item.mitigation || '')}</small></div>`).join('') : '<p class="muted-copy">No specific risks were returned.</p>'}</div><div><div class="eyebrow">KILL CRITERIA</div>${campaign.killCriteria?.length ? campaign.killCriteria.map((item) => `<div class="risk-row"><strong>Reconsider when</strong><p>${escapeHtml(item.statement || item.message)}</p></div>`).join('') : '<p class="muted-copy">Define when the strategy should be reconsidered.</p>'}</div></div></section><section class="campaign-edit-section">${campaignEditor(campaign)}</section><section class="campaign-ready-banner"><div><div class="eyebrow">CAMPAIGN STRATEGY READY</div><h2>Ready for creative development.</h2><p>The strategy is complete enough to hand off. Phase 6 will turn the selected territory into production.</p></div><button class="button button-primary" type="button" data-action="creative-coming">${icon('sparkles', 16)} Create Creative</button></section>${state.campaignHandoff ? '<div class="phase-handoff-note"><span class="status-pulse"></span><strong>Creative Development — Coming in Phase 6</strong><span>Campaign production is intentionally not included in this phase.</span></div>' : ''}${state.selectedSource ? sourceModal(state.selectedSource, sources) : ''}</div>`;
}

function campaignPage() {
  if (state.campaignRun?.loading) return campaignLoadingPage();
  if (!state.strategy?.idea) return `<div class="campaign-empty-page research-empty page-entrance"><div class="research-empty-art">${icon('layers', 28)}<span></span><span></span><span></span></div><div class="eyebrow">CAMPAIGN STRATEGY STUDIO</div><h1>Start with a<br><em>strategy question.</em></h1><p>Campaign Strategy Studio turns a selected opportunity into a clear strategic foundation for creative work.</p><button class="button button-primary" type="button" data-route="strategy">${icon('sparkles', 16)} Start a new strategy</button></div>`;
  const opportunity = selectedOpportunity();
  if (!opportunity) return `<div class="campaign-empty-page research-empty page-entrance"><div class="research-empty-art">${icon('layers', 28)}<span></span><span></span><span></span></div><div class="eyebrow">CAMPAIGN STRATEGY STUDIO</div><h1>Select the<br><em>opportunity first.</em></h1><p>Campaign Strategy Studio starts from the opportunity you selected in Opportunity Radar. Nothing will be invented without that handoff.</p><button class="button button-primary" type="button" data-route="radar">${icon('radar', 16)} Review Opportunity Radar</button></div>`;
  const campaign = currentCampaignStrategy();
  if (!campaign.strategicProblem?.statement && !campaign.creativeTerritories?.length && !campaign.campaignConcept?.bigIdea) return campaignSetupPage(opportunity);
  return campaignOverviewPage(opportunity);
}

function allResearchSignals(research) {
  return ['marketSignals', 'audienceSignals', 'industryDevelopments', 'culturalSignals', 'competitorSignals', 'events', 'technologySignals'].flatMap((key) => research[key] || []);
}

function filteredSignals(research) {
  const all = allResearchSignals(research);
  if (state.researchFilter === 'all') return all;
  return all.filter((signal) => signal.type === state.researchFilter);
}

function signalCard(signal, sources) {
  const evidence = (signal.sourceIds || []).map((id) => sources.find((source) => source.id === id)).filter(Boolean);
  return `<article class="signal-card importance-${escapeHtml(signal.importance)}"><div class="signal-card-top"><div class="signal-type"><span class="signal-type-dot"></span>${escapeHtml(labelForType(signal.type))}</div><div class="signal-tags"><span class="freshness-tag freshness-${escapeHtml(signal.freshness)}">${escapeHtml(freshnessLabel(signal.freshness))}</span><span class="confidence-tag confidence-${escapeHtml(signal.confidence)}">${escapeHtml(capitalize(signal.confidence))} confidence</span></div></div><h3>${escapeHtml(signal.title)}</h3><p class="signal-summary">${escapeHtml(signal.summary)}</p>${signal.interpretation ? `<div class="interpretation"><div class="interpretation-label">${icon('sparkles', 13)} MARKETMIND INTERPRETATION</div><p>${escapeHtml(signal.interpretation)}</p></div>` : ''}<div class="signal-bottom"><span class="why-label">Why this matters</span><span class="evidence-label">${evidence.length} evidence source${evidence.length === 1 ? '' : 's'}</span></div><div class="signal-evidence">${evidence.length ? evidence.map((source) => `<button type="button" data-source-id="${escapeHtml(source.id)}" aria-label="Review evidence from ${escapeHtml(source.domain || 'this source')}"><span>${escapeHtml(source.domain || 'Source')}</span><small>${escapeHtml(freshnessLabel(source.freshness))}</small>${icon('external', 13)}</button>`).join('') : '<span class="signal-no-evidence">No source mapping available</span>'}</div></article>`;
}

function themesSection(themes, sources) {
  return `<section class="themes-section"><div class="signals-heading"><div><div class="eyebrow">EMERGING THEMES</div><h2>Patterns across signals.</h2></div></div><div class="theme-grid">${themes.map((theme) => `<article class="theme-card"><div class="theme-card-top"><span class="theme-index">THEME</span><span class="confidence-tag confidence-${escapeHtml(theme.confidence)}">${escapeHtml(capitalize(theme.confidence))}</span></div><h3>${escapeHtml(theme.title)}</h3><p>${escapeHtml(theme.summary)}</p><div class="theme-sources">${(theme.sourceIds || []).length} supporting sources ${icon('arrow', 13)}</div></article>`).join('')}</div></section>`;
}

function contradictionsSection(items) {
  return `<section class="contradictions-section"><div class="contradictions-mark">!</div><div><div class="eyebrow">CONFLICTING SIGNALS</div><h2>Where the evidence disagrees.</h2><div class="contradiction-list">${items.map((item) => `<div class="contradiction-item"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p><span>${escapeHtml(capitalize(item.confidence))} confidence · ${(item.sourceIds || []).length} sources</span></div>`).join('')}</div></div></section>`;
}

function sourceRow(source) {
  const reasonCount = Array.isArray(source.quality?.reasons) ? source.quality.reasons.length : 0;
  return `<button class="source-row" type="button" data-source-id="${escapeHtml(source.id)}" aria-label="Review source details for ${escapeHtml(source.title)}"><span class="source-domain">${escapeHtml(source.domain || 'unknown')}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><span>${escapeHtml(source.sourceType)} · ${escapeHtml(freshnessLabel(source.freshness))}</span></span><span class="source-quality">${escapeHtml(capitalize(source.quality?.confidence || 'low'))}${reasonCount ? `<small>${reasonCount} checks</small>` : ''}</span>${icon('arrow', 14)}</button>`;
}

function sourceModal(source, sources) {
  const actual = sources.find((item) => item.id === (source.id || source)) || source;
  const reasons = Array.isArray(actual.quality?.reasons) ? actual.quality.reasons : [];
  const reasonMarkup = reasons.length ? `<div class="source-trust-grid">${reasons.map((reason) => `<div class="source-trust-check"><span class="trust-check-dot trust-${escapeHtml(reason.level)}"></span><div><strong>${escapeHtml(reason.label)}</strong><span>${escapeHtml(capitalize(reason.level))}</span><p>${escapeHtml(reason.detail)}</p></div></div>`).join('')}</div>` : '';
  return `<div class="modal-backdrop" data-action="close-source"><div class="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-title"><button class="modal-close" type="button" data-action="close-source" aria-label="Close source details">${icon('close', 17)}</button><div class="eyebrow">SOURCE DETAIL · ${escapeHtml(actual.sourceType || 'unknown')}</div><h2 id="source-title">${escapeHtml(actual.title)}</h2><div class="source-modal-domain">${escapeHtml(actual.domain || 'Unknown publisher')} <span>·</span> ${escapeHtml(actual.quality?.confidence || 'low')} confidence</div><div class="modal-detail-grid"><div><span>Published</span><strong>${actual.publishedAt ? formatDateTime(actual.publishedAt) : 'Date not available'}</strong></div><div><span>Retrieved</span><strong>${actual.retrievedAt ? formatDateTime(actual.retrievedAt) : 'Unknown'}</strong></div><div><span>Research angle</span><strong>${escapeHtml(actual.query || 'Market signal')}</strong></div></div><div class="source-snippet"><div class="eyebrow">PROVIDER-SUPPLIED EXCERPT</div><p>${escapeHtml(actual.snippet || 'No excerpt was supplied for this source.')}</p></div>${reasonMarkup}<div class="source-boundary">${icon('lock', 13)} <span>This is a provider excerpt and a quality heuristic, not independent verification. Open the original source before treating it as final evidence.</span></div><a class="source-link" href="${escapeHtml(actual.url)}" target="_blank" rel="noreferrer">Open original source ${icon('external', 14)}</a></div></div>`;
}

function researchIntegrityNote(research) {
  const dated = research.sources.filter((source) => source.publishedAt).length;
  const excerpted = research.sources.filter((source) => source.excerptType === 'provider-excerpt' && source.snippet).length;
  return `<div class="research-integrity-note" role="note">${icon('lock', 14)}<span>Evidence trail records the search angle, retrieval time, publication date, and provider excerpt for each source. ${dated} of ${research.sources.length} sources have a publication date; ${excerpted} include an excerpt. Quality labels are review aids, not proof.</span></div>`;
}

function researchRunHistorySection(research) {
  const runs = Array.isArray(research.runs) ? [...research.runs].reverse() : [];
  if (!runs.length) return '';
  return `<section class="research-run-history"><div class="signals-heading"><div><div class="eyebrow">RESEARCH RUNS</div><h2>Keep the trail.</h2></div><div class="signal-count">${runs.length} retained</div></div><p class="research-run-note">Previous snapshots stay attached to this strategy so a rerun can be reviewed against the moment it was captured.</p><div class="research-run-list">${runs.map((run) => `<article class="research-run ${researchRunIsCurrent(run, research) ? 'current' : ''}"><div><strong>${researchRunIsCurrent(run, research) ? 'Active snapshot' : 'Archived snapshot'}</strong><span>${run.researchedAt ? escapeHtml(formatDateTime(run.researchedAt)) : 'Timestamp unavailable'} · ${escapeHtml(capitalize(run.depth || 'balanced'))} depth</span></div><div><span>${Number(run.sourceCount || 0)} sources · ${Number(run.signalCount || 0)} signals</span><small>${escapeHtml(capitalize(run.aiStatus || 'unknown'))} synthesis · ${escapeHtml(capitalize(run.providerStatus || 'unknown'))} provider</small></div></article>`).join('')}</div></section>`;
}

function researchHistorySection() {
  const history = state.strategies.filter((strategy) => strategy.research?.meta?.researchedAt).slice(0, 4);
  if (!history.length) return '';
  return `<section class="research-history"><div class="eyebrow">RESEARCH HISTORY</div><div class="history-list">${history.map((strategy) => `<button class="history-row" type="button" data-action="open-strategy" data-id="${escapeHtml(strategy.id)}"><span class="history-date">${formatDate(strategy.research.meta.researchedAt)}</span><span><strong>${escapeHtml(strategy.idea)}</strong><small>${escapeHtml(strategy.market || 'Market not specified')} · ${strategy.research.sources.length} sources</small></span>${icon('arrow', 14)}</button>`).join('')}</div></section>`;
}

function labelForType(type) { return ({ news: 'News', audience: 'Audience signal', industry: 'Industry development', culture: 'Cultural signal', competitor: 'Competitor signal', technology: 'Technology signal', events: 'Relevant event' })[type] || 'Market signal'; }
function freshnessLabel(value) { return ({ 'very-recent': 'Very recent', recent: 'Recent', older: 'Older', unknown: 'Date unknown' })[value] || 'Date unknown'; }
function capitalize(value) { return String(value || '').replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDateTime(value) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

function workspacePage() {
  const workspace = state.workspace;
  const brand = state.brand;
  return `
    <div class="workspace-page page-entrance">
      <div class="page-header workspace-header">
        <div><div class="eyebrow">WORKSPACE</div><h1>Set the context<br><em>for better work.</em></h1><p>Keep the defaults and brand context that travel with every strategy you create.</p></div>
        <button class="button button-primary" type="submit" form="workspace-form">${icon("check", 17)} Save workspace</button>
      </div>
      <div class="workspace-layout">
        <main class="workspace-main">
          <form id="workspace-form" class="workspace-form">
            <section class="form-card workspace-defaults">
              ${sectionEyebrow("01", "STRATEGY DEFAULTS", "Optional defaults pre-populate new strategy briefs.")}
              <div class="form-grid"><div class="field"><label for="workspace-name">Workspace name</label><input id="workspace-name" name="workspaceName" maxlength="100" value="${escapeHtml(workspace.workspaceName || "")}" placeholder="e.g. Stride"></div><div class="field"><label for="workspace-market">Default market</label><input id="workspace-market" name="defaultMarket" maxlength="100" value="${escapeHtml(workspace.defaultMarket || "")}" placeholder="e.g. India"></div></div>
              <div class="form-grid"><div class="field"><label for="workspace-audience">Default audience</label><input id="workspace-audience" name="defaultAudience" maxlength="180" value="${escapeHtml(workspace.defaultAudience || "")}" placeholder="e.g. First-time founders"></div><div class="field"><label for="workspace-platform">Default platform</label><select id="workspace-platform" name="defaultPlatform"><option value="">No default</option>${["Instagram", "LinkedIn", "YouTube", "TikTok", "Website", "Multi-platform"].map((item) => `<option ${workspace.defaultPlatform === item ? "selected" : ""}>${item}</option>`).join("")}</select></div></div>
              <div class="field"><label for="workspace-objective">Default objective</label><select id="workspace-objective" name="defaultObjective"><option value="">No default</option>${["Awareness", "Engagement", "Consideration", "Conversion", "Retention", "Launch", "Community Building"].map((item) => `<option ${workspace.defaultObjective === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
            </section>
            <section class="form-card workspace-brand">
              ${sectionEyebrow("02", "BRAND PROFILE", "Your brand context stays separate, reusable, and close at hand.")}
              <div class="workspace-brand-summary"><div class="context-avatar">${escapeHtml(initials(brand.name || workspace.workspaceName))}</div><div><strong>${escapeHtml(brand.name || "Brand profile not set")}</strong><span>${escapeHtml(brand.industry || "Add an industry and description in Brand Voice")}</span></div><span class="workspace-ready">${brand.name || brand.description ? "Active context" : "Needs attention"}</span></div>
              <p class="workspace-brand-copy">${brand.name || brand.description ? "Brand Voice Studio is ready to shape the tone and context of your next strategy." : "Add your brand context once and let it travel with your research, audience, opportunity, and campaign work."}</p>
              <button class="button button-secondary" type="button" data-route="brand">${icon("message", 16)} Manage Brand Voice</button>
            </section>
          </form>
        </main>
        <aside class="workspace-aside"><div class="aside-card workspace-principle"><div class="aside-mark">${icon("settings", 18)}</div><div class="eyebrow">A QUIETER WORKSPACE</div><h3>Set once.<br>Think further.</h3><p>Workspace defaults guide new briefs. They never override a specific strategy you enter.</p></div><div class="aside-card workspace-status"><div class="eyebrow">YOUR WORKSPACE</div><div><span>Strategies saved</span><strong>${state.strategies.length}</strong></div><div><span>Brand context</span><strong>${brand.name || brand.description ? "Ready" : "To set up"}</strong></div></div></aside>
      </div>
    </div>`;
}

function researchPage() {
  if (state.researchRun?.loading) return researchLoadingPage();
  if (!state.strategy?.idea) return researchEmptyPage();
  const research = currentResearch();
  if (!research.meta?.researchedAt && !research.sources?.length) return researchUnavailablePage(research);
  return researchResultsPage();
}

function updateResearchProgress(stage) {
  if (!state.researchRun) return;
  const index = RESEARCH_STAGES.findIndex((item) => item.id === stage.id);
  state.researchRun.current = stage.id;
  state.researchRun.detail = stage.queryCount ? `${stage.queryCount} research angles generated.` : stage.sources ? `${stage.sources} normalized sources ready for synthesis.` : stage.reviewed ? `${stage.reviewed} sources reviewed.` : '';
  state.researchRun.stages = RESEARCH_STAGES.slice(0, Math.max(index, 0));
  render();
}

async function startResearch() {
  if (!state.strategy?.idea) { navigate('strategy'); return; }
  state.selectedSource = null;
  state.researchFilter = 'all';
  state.researchRun = { loading: true, current: 'understanding', detail: '', stages: [] };
  navigate('research');
  const requestController = beginRequest('research');
  try {
    const response = await authenticatedFetch('/api/research/stream', { method: 'POST', signal: requestController.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: buildStrategyContext({ strategy: state.strategy, brand: state.brand, workspace: state.workspace }) }) });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'MarketMind could not start the research service.'));
    if (!response.body) throw new Error('The research stream is unavailable right now. Try again shortly.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    let streamError = null;
    const consume = (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split('\n\n'); buffer = blocks.pop() || '';
      for (const block of blocks) {
        const event = block.match(/event:\s*(\w+)\ndata:\s*(.+)/s);
        if (!event) continue;
        const payload = JSON.parse(event[2]);
        if (event[1] === 'stage') updateResearchProgress(payload);
        if (event[1] === 'result') result = payload;
        if (event[1] === 'error') streamError = payload.message;
      }
    };
    while (true) { const { value, done } = await reader.read(); if (done) break; consume(value); }
    if (buffer.trim()) consume(new Uint8Array());
    if (streamError) throw new Error(streamError);
    if (!result) throw new Error('MarketMind received no research result.');
    state.strategy.research = appendResearchRun(state.strategy.research, result);
    state.strategy.status = result.sources?.length ? 'researched' : 'draft';
    persistStrategy(state.strategy);
    state.researchRun = null;
    render();
    showToast(result.sources?.length ? 'Research completed. Review the evidence trail.' : result.meta?.warnings?.[0] || 'Live market research is temporarily unavailable. Try again shortly.', result.sources?.length ? 'success' : 'info');
  } catch (error) {
    if (isAbortError(error)) return;
    const failed = createEmptyResearch();
    failed.meta = { ...failed.meta, depth: state.strategy.researchDepth || 'balanced', warnings: ['Live market research is temporarily unavailable. Try again shortly.'], providerStatus: 'failed' };
    state.strategy.research = appendResearchRun(state.strategy.research, failed, { preservePrevious: Boolean(state.strategy.research?.sources?.length || state.strategy.research?.meta?.researchedAt) });
    persistStrategy(state.strategy);
    state.researchRun = null;
    render();
    showToast(error.message || 'Market research failed.', 'error');
  } finally {
    finishRequest('research', requestController);
  }
}

function updateAudienceProgress(stage) {
  if (!state.audienceRun) return;
  const index = AUDIENCE_STAGES.findIndex((item) => item.id === stage.id);
  state.audienceRun.current = stage.id;
  state.audienceRun.detail = stage.detail || '';
  state.audienceRun.stages = AUDIENCE_STAGES.slice(0, Math.max(index, 0));
  render();
}

function collectAudienceScope() {
  const form = document.querySelector('#audience-form');
  if (!form) return currentAudienceScope();
  const data = new FormData(form);
  return {
    ...currentAudienceScope(),
    primaryAudience: String(data.get('primaryAudience') || '').trim(),
    market: String(data.get('market') || '').trim(),
    ageRange: String(data.get('ageRange') || '').trim(),
    lifeStage: String(data.get('lifeStage') || '').trim(),
    occupation: String(data.get('occupation') || '').trim(),
    context: String(data.get('context') || '').trim(),
    purchaseRelationship: String(data.get('purchaseRelationship') || 'prospect'),
    analysisDepth: String(data.get('analysisDepth') || 'balanced'),
  };
}

async function responseErrorMessage(response, fallback) {
  let serverMessage = '';
  try {
    const payload = await response.clone().json();
    serverMessage = typeof payload?.error === 'string' ? payload.error.trim() : typeof payload?.message === 'string' ? payload.message.trim() : '';
  } catch { /* Some edge failures return an empty body. */ }
  if (response.status === 401) return serverMessage || 'Your session expired. Refresh the page and sign in again.';
  if (response.status === 403) return serverMessage || 'Verify your email before using this intelligence stage.';
  if (response.status === 503) return serverMessage || 'The intelligence service is temporarily unavailable. Try again shortly.';
  return serverMessage || fallback;
}

async function startAudienceAnalysis() {
  if (!state.strategy?.idea) { navigate('strategy'); return; }
  const scope = collectAudienceScope();
  if (!scope.primaryAudience || !scope.market) {
    navigate('audience');
    if (!scope.primaryAudience) document.querySelector('#audience-primary-error').textContent = 'Add the primary audience so the analysis has a clear scope.';
    if (!scope.market) document.querySelector('#audience-market-error').textContent = 'Add a market or geography so the analysis stays relevant.';
    return;
  }
  state.strategy.audience = scope.primaryAudience;
  state.strategy.market = scope.market;
  state.strategy.audienceScope = scope;
  state.selectedSource = null;
  state.audienceRun = { loading: true, current: 'reading', detail: '', stages: [] };
  navigate('audience');
  const requestController = beginRequest('audience');
  try {
    const base = buildStrategyContext({ strategy: state.strategy, brand: state.brand, workspace: state.workspace });
    const context = { ...base, strategy: { ...base.strategy, id: state.strategy.id }, audienceScope: scope, research: researchForStream(currentResearch()) };
    const response = await authenticatedFetch('/api/audience/stream', { method: 'POST', signal: requestController.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context }) });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'MarketMind could not start the audience analysis service.'));
    if (!response.body) throw new Error('The audience analysis stream is unavailable right now. Refresh the page and try again.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    let streamError = null;
    const consume = (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split('\n\n'); buffer = blocks.pop() || '';
      for (const block of blocks) {
        const event = block.match(/event:\s*(\w+)\ndata:\s*(.+)/s);
        if (!event) continue;
        const payload = JSON.parse(event[2]);
        if (event[1] === 'stage') updateAudienceProgress(payload);
        if (event[1] === 'result') result = payload;
        if (event[1] === 'error') streamError = payload.message;
      }
    };
    while (true) { const { value, done } = await reader.read(); if (done) break; consume(value); }
    if (buffer.trim()) consume(new Uint8Array());
    if (streamError) throw new Error(streamError);
    if (!result) throw new Error('MarketMind received no audience analysis result.');
    state.strategy.audienceInsights = mergeAudienceReviewState(state.strategy.audienceInsights, result);
    state.strategy.status = 'audience-analyzed';
    persistStrategy(state.strategy);
    state.audienceRun = null;
    render();
    showToast(result.meta?.mode === 'research-light' ? 'Research-light audience intelligence is ready.' : 'Audience intelligence is ready. Review the evidence trail.', 'success');
  } catch (error) {
    if (isAbortError(error)) return;
    state.audienceRun = null;
    render();
    showToast(error.message || 'Audience analysis failed.', 'error');
  } finally {
    finishRequest('audience', requestController);
  }
}

function updateOpportunityProgress(stage) {
  if (!state.opportunityRun) return;
  const index = OPPORTUNITY_STAGES.findIndex((item) => item.id === stage.id);
  state.opportunityRun.current = stage.id;
  state.opportunityRun.detail = stage.detail || '';
  state.opportunityRun.stages = OPPORTUNITY_STAGES.slice(0, Math.max(index, 0));
  render();
}

function selectedOpportunityLens() {
  return document.querySelector('#radar-form #opportunity-lens')?.value || document.querySelector('#results-opportunity-lens')?.value || currentOpportunityRadar().lens || 'balanced';
}

async function startOpportunityAnalysis(lens = selectedOpportunityLens()) {
  if (!state.strategy?.idea) { navigate('strategy'); return; }
  const readiness = currentOpportunityReadiness();
  if (readiness.bothMissing) { navigate('radar'); showToast('Research Market and Analyze Audience before opening the radar.', 'info'); return; }
  if (readiness.audienceEligibleCount === 0) { navigate('audience'); showToast('Review and validate at least one audience claim before opening the radar.', 'info'); return; }
  state.openOpportunityId = null;
  state.selectedSource = null;
  state.compareOpportunityIds = [];
  state.opportunityRun = { loading: true, current: 'market', detail: '', stages: [], lens };
  navigate('radar');
  const requestController = beginRequest('radar');
  try {
    const previousRadar = currentOpportunityRadar();
    const variation = (Number(previousRadar.meta?.variation) || 0) + 1;
    const previousOpportunities = (previousRadar.opportunities || []).map((item) => ({ title: item.title, strategicThesis: item.strategicThesis }));
    const base = buildStrategyContext({ strategy: state.strategy, brand: state.brand, workspace: state.workspace });
    const context = { ...base, strategy: { ...base.strategy, id: state.strategy.id }, research: currentResearch(), audience: state.strategy.audienceInsights, previousOpportunities, intelligenceStatus: { research: readiness.researchStatus, audience: readiness.audienceStatus } };
    const response = await authenticatedFetch('/api/opportunities/stream', { method: 'POST', signal: requestController.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, lens, variation }) });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'MarketMind could not start Opportunity Radar.'));
    if (!response.body) throw new Error('The Opportunity Radar stream is unavailable right now. Try again shortly.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    let streamError = null;
    const consume = (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split('\n\n'); buffer = blocks.pop() || '';
      for (const block of blocks) {
        const event = block.match(/event:\s*(\w+)\ndata:\s*(.+)/s);
        if (!event) continue;
        const payload = JSON.parse(event[2]);
        if (event[1] === 'stage') updateOpportunityProgress(payload);
        if (event[1] === 'result') result = payload;
        if (event[1] === 'error') streamError = payload.message;
      }
    };
    while (true) { const { value, done } = await reader.read(); if (done) break; consume(value); }
    if (buffer.trim()) consume(new Uint8Array());
    if (streamError) throw new Error(streamError);
    if (!result) throw new Error('MarketMind received no Opportunity Radar result.');
    state.strategy.opportunityRadar = result;
    state.strategy.selectedOpportunityId = null;
    state.strategy.status = result.opportunities?.length ? 'opportunities-found' : state.strategy.status;
    persistStrategy(state.strategy);
    state.opportunityRun = null;
    render();
    showToast(result.opportunities?.length ? 'Potential opportunities are ready to explore.' : result.meta?.warnings?.[0] || 'More intelligence is needed before opportunities can be identified.', result.opportunities?.length ? 'success' : 'info');
  } catch (error) {
    if (isAbortError(error)) return;
    state.opportunityRun = null;
    render();
    showToast(error.message || 'Opportunity Radar failed.', 'error');
  } finally {
    finishRequest('radar', requestController);
  }
}

function updateCampaignProgress(stage) {
  if (!state.campaignRun) return;
  const index = CAMPAIGN_UI_STAGES.findIndex((item) => item.id === stage.id);
  state.campaignRun.current = stage.id;
  state.campaignRun.detail = stage.detail || '';
  state.campaignRun.stages = CAMPAIGN_UI_STAGES.slice(0, Math.max(index, 0));
  render();
}

async function startCampaignStrategy(section = 'all') {
  if (!state.strategy?.idea) { navigate('strategy'); return; }
  const opportunity = selectedOpportunity();
  if (!opportunity) { navigate('radar'); showToast('Select an opportunity before developing a campaign strategy.', 'info'); return; }
  state.selectedSource = null;
  state.campaignHandoff = false;
  state.campaignRun = { loading: true, current: 'opportunity', detail: '', stages: [], section };
  navigate('campaigns');
  const requestController = beginRequest('campaigns');
  try {
    const base = buildStrategyContext({ strategy: state.strategy, brand: state.brand, workspace: state.workspace });
    const existing = currentCampaignStrategy();
    const context = { ...base, strategy: { ...base.strategy, id: state.strategy.id }, research: currentResearch(), audience: state.strategy.audienceInsights, opportunity, campaignStrategy: existing };
    const response = await authenticatedFetch('/api/campaign/stream', { method: 'POST', signal: requestController.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, existing, section }) });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'MarketMind could not start Campaign Strategy Studio.'));
    if (!response.body) throw new Error('The Campaign Strategy stream is unavailable right now. Try again shortly.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    let streamError = null;
    const consume = (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split('\n\n'); buffer = blocks.pop() || '';
      for (const block of blocks) {
        const event = block.match(/event:\s*(\w+)\ndata:\s*(.+)/s);
        if (!event) continue;
        const payload = JSON.parse(event[2]);
        if (event[1] === 'stage') updateCampaignProgress(payload);
        if (event[1] === 'result') result = payload;
        if (event[1] === 'error') streamError = payload.message;
      }
    };
    while (true) { const { value, done } = await reader.read(); if (done) break; consume(value); }
    if (buffer.trim()) consume(new Uint8Array());
    if (streamError) throw new Error(streamError);
    if (!result) throw new Error('MarketMind received no Campaign Strategy result.');
    state.strategy.campaignStrategy = result;
    state.strategy.status = result.meta?.status === 'ready' ? 'campaign-strategy-ready' : state.strategy.status;
    persistStrategy(state.strategy);
    state.campaignRun = null;
    render();
    showToast(result.meta?.status === 'ready' ? 'Campaign strategy is ready to review.' : result.meta?.warnings?.[0] || 'Campaign strategy needs more intelligence.', result.meta?.status === 'ready' ? 'success' : 'info');
  } catch (error) {
    if (isAbortError(error)) return;
    state.campaignRun = null;
    render();
    showToast(error.message || 'Campaign strategy failed.', 'error');
  } finally {
    finishRequest('campaigns', requestController);
  }
}

function parseEditorLines(value, existing = []) {
  return String(value || '').split('\n').map((line, index) => {
    const [left, ...rest] = line.split('—');
    const name = left.trim();
    const right = rest.join('—').trim();
    const old = existing[index] || {};
    return { ...old, name: name || old.name || '', purpose: right || old.purpose || '', message: right || old.message || '', platform: name || old.platform || '', role: right || old.role || '', sourceIds: [] };
  }).filter((item) => item.name || item.platform || item.purpose || item.role);
}

function saveCampaignEdits() {
  const campaign = currentCampaignStrategy();
  const platformLines = parseEditorLines(document.querySelector('#editor-platform-roles')?.value, campaign.platformStrategy);
  const pillarLines = parseEditorLines(document.querySelector('#editor-content-pillars')?.value, campaign.contentPillars);
  const overrides = {
    name: document.querySelector('#editor-campaign-name')?.value || '',
    objective: document.querySelector('#editor-objective')?.value || campaign.objective,
    campaignThesis: document.querySelector('#editor-thesis')?.value || '',
    coreMessage: document.querySelector('#editor-core-message')?.value || '',
    primaryCta: document.querySelector('#editor-primary-cta')?.value || '',
    platformRoles: platformLines.map((item) => ({ platform: item.platform, role: item.role, contentType: item.contentType || '', audienceBehavior: item.audienceBehavior || '', primaryKpi: item.primaryKpi || '', sourceIds: [] })),
    contentPillars: pillarLines.map((item) => ({ name: item.name, purpose: item.purpose, message: item.message, audienceNeed: item.audienceNeed || '', contentForms: item.contentForms || [], evidenceType: 'hypothesis', confidence: 'low', sourceIds: [] })),
  };
  const next = applyCampaignOverrides(campaign, overrides);
  next.updatedAt = new Date().toISOString();
  state.strategy.campaignStrategy = next;
  persistStrategy(state.strategy);
  state.campaignEditorOpen = false;
  showToast('Your version is now the source of truth.', 'success');
  render();
}

function attachCampaignEvents() {
  document.querySelector('#campaign-setup-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existing = currentCampaignStrategy();
    const selectedSecondary = [...document.querySelectorAll('input[name="secondaryPlatforms"]:checked')].map((input) => input.value);
    state.strategy.campaignStrategy = { ...existing, name: String(form.get('name') || '').trim(), duration: String(form.get('duration') || '').trim(), primaryPlatform: String(form.get('primaryPlatform') || '').trim(), secondaryPlatforms: selectedSecondary, scale: String(form.get('scale') || 'standard'), originalObjective: state.strategy.objective || existing.originalObjective || '', objective: state.strategy.objective || existing.objective || '' };
    startCampaignStrategy('all');
  });
  document.querySelectorAll('[data-action="regenerate-campaign"]').forEach((button) => button.addEventListener('click', () => startCampaignStrategy(button.dataset.section || 'all')));
  document.querySelector('[data-action="develop-campaign-concept"]')?.addEventListener('click', () => startCampaignStrategy('concept'));
  document.querySelectorAll('[data-action="select-territory"]').forEach((button) => button.addEventListener('click', () => {
    const campaign = currentCampaignStrategy();
    if (!campaign.creativeTerritories?.some((item) => item.id === button.dataset.id)) return;
    if (campaign.selectedCreativeTerritoryId !== button.dataset.id) campaign.campaignConcept = null;
    campaign.selectedCreativeTerritoryId = button.dataset.id;
    campaign.updatedAt = new Date().toISOString();
    state.strategy.campaignStrategy = campaign;
    persistStrategy(state.strategy);
    showToast('Creative territory selected as the strategy foundation.', 'success');
    render();
  }));
  document.querySelectorAll('[data-action="toggle-territory-compare"]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.id;
    state.compareTerritoryIds = state.compareTerritoryIds.includes(id) ? state.compareTerritoryIds.filter((item) => item !== id) : [...state.compareTerritoryIds, id].slice(-3);
    render();
  }));
  document.querySelector('[data-action="clear-territory-compare"]')?.addEventListener('click', () => { state.compareTerritoryIds = []; render(); });
  document.querySelector('[data-action="toggle-campaign-editor"]')?.addEventListener('click', () => { state.campaignEditorOpen = !state.campaignEditorOpen; render(); });
  document.querySelector('#campaign-editor-form')?.addEventListener('submit', (event) => { event.preventDefault(); saveCampaignEdits(); });
  document.querySelector('[data-action="view-intelligence"]')?.addEventListener('click', () => { const opportunity = selectedOpportunity(); if (opportunity) { state.openOpportunityId = opportunity.id; navigate('radar'); } });
  document.querySelector('[data-action="creative-coming"]')?.addEventListener('click', () => { state.campaignHandoff = true; render(); });
  document.querySelectorAll('[data-campaign-source-id]').forEach((button) => button.addEventListener('click', () => { const source = currentResearch().sources.find((item) => item.id === button.dataset.campaignSourceId); if (source) { state.selectedSource = source; render(); } }));
  document.querySelectorAll('[data-action="close-source"]').forEach((button) => button.addEventListener('click', (event) => { if (event.target === button || button.classList.contains('modal-close')) { state.selectedSource = null; render(); } }));
}

function attachResearchEvents() {
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.researchFilter = button.dataset.filter; render(); }));
  document.querySelectorAll('[data-source-id]').forEach((button) => button.addEventListener('click', () => { const source = currentResearch().sources.find((item) => item.id === button.dataset.sourceId); if (source) { state.selectedSource = source; render(); } }));
  document.querySelectorAll('[data-action="close-source"]').forEach((button) => button.addEventListener('click', (event) => { if (event.target === button || button.classList.contains('modal-close')) { state.selectedSource = null; render(); } }));
  document.querySelectorAll('[data-action="save-research"]').forEach((button) => button.addEventListener('click', () => { state.strategy.status = 'researched'; persistStrategy(state.strategy); showToast('Research saved to this strategy.', 'success'); render(); }));
  document.querySelectorAll('[data-action="refresh-research"]').forEach((button) => button.addEventListener('click', startResearch));
}

function attachAudienceEvents() {
  document.querySelector('#audience-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const scope = collectAudienceScope();
    if (!scope.primaryAudience) { document.querySelector('#audience-primary-error').textContent = 'Add the primary audience so the analysis has a clear scope.'; return; }
    if (!scope.market) { document.querySelector('#audience-market-error').textContent = 'Add a market or geography so the analysis stays relevant.'; return; }
    document.querySelector('#audience-primary-error').textContent = '';
    document.querySelector('#audience-market-error').textContent = '';
    startAudienceAnalysis();
  });
  document.querySelectorAll('input[name="analysisDepth"]').forEach((input) => input.addEventListener('change', () => document.querySelectorAll('.audience-depth-option').forEach((option) => option.classList.toggle('selected', option.querySelector('input').checked))));
  document.querySelectorAll('[data-audience-source-id]').forEach((button) => button.addEventListener('click', () => { const source = currentResearch().sources.find((item) => item.id === button.dataset.audienceSourceId); if (source) { state.selectedSource = source; render(); } }));
  document.querySelectorAll('[data-action="close-source"]').forEach((button) => button.addEventListener('click', (event) => { if (event.target === button || button.classList.contains('modal-close')) { state.selectedSource = null; render(); } }));
  document.querySelectorAll('[data-action="save-audience"]').forEach((button) => button.addEventListener('click', () => { state.strategy.status = 'audience-analyzed'; persistStrategy(state.strategy); showToast('Audience intelligence saved to this strategy.', 'success'); render(); }));
  document.querySelectorAll('[data-action="reanalyze-audience"], [data-action="update-audience"]').forEach((button) => button.addEventListener('click', startAudienceAnalysis));
  document.querySelectorAll('[data-audience-filter]').forEach((button) => button.addEventListener('click', () => { state.audienceReviewFilter = button.dataset.audienceFilter || 'all'; state.audienceEditingClaimId = null; state.audienceValidationClaimId = null; render(); }));
  document.querySelectorAll('[data-audience-review]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.audienceReview;
    const claimId = button.dataset.claimId;
    if (!claimId) return;
    if (action === 'edit') { state.audienceEditingClaimId = claimId; state.audienceValidationClaimId = null; render(); document.querySelector(`[data-audience-editor-id="${CSS.escape(claimId)}"] textarea`)?.focus(); return; }
    if (action === 'validate') { state.audienceValidationClaimId = claimId; state.audienceEditingClaimId = null; render(); document.querySelector(`[data-audience-validation-id="${CSS.escape(claimId)}"] input`)?.focus(); return; }
    try {
      state.strategy.audienceInsights = applyAudienceClaimReview(state.strategy.audienceInsights, claimId, action);
      persistStrategy(state.strategy);
      state.audienceEditingClaimId = null;
      state.audienceValidationClaimId = null;
      render();
      showToast(action === 'approve' ? 'Claim approved for downstream intelligence.' : action === 'reject' ? 'Claim rejected and retained for audit.' : 'Claim marked for validation.', 'success');
    } catch (error) { showToast(error.message || 'The audience claim could not be updated.', 'error'); }
  }));
  document.querySelectorAll('[data-audience-review-cancel]').forEach((button) => button.addEventListener('click', () => { state.audienceEditingClaimId = null; state.audienceValidationClaimId = null; render(); }));
  document.querySelectorAll('[data-audience-editor-id]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault();
    const claimId = form.dataset.audienceEditorId;
    try {
      state.strategy.audienceInsights = applyAudienceClaimReview(state.strategy.audienceInsights, claimId, 'edit', { statement: new FormData(form).get('statement') });
      persistStrategy(state.strategy);
      state.audienceEditingClaimId = null;
      render();
      showToast('Edited claim saved. Revalidate its source before using it in Radar.', 'success');
    } catch (error) { showToast(error.message || 'The edited claim could not be saved.', 'error'); }
  }));
  document.querySelectorAll('[data-audience-validation-id]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const research = currentResearch();
    try {
      state.strategy.audienceInsights = applyAudienceClaimReview(state.strategy.audienceInsights, form.dataset.audienceValidationId, 'validate', {
        sourceIds: data.getAll('sourceIds'),
        allowedSourceIds: (research.sources || []).map((source) => source.id),
        evidenceType: data.get('evidenceType'),
        confidence: data.get('confidence'),
      });
      persistStrategy(state.strategy);
      state.audienceValidationClaimId = null;
      render();
      showToast('Source mapping revalidated. This claim can now contribute to Radar.', 'success');
    } catch (error) { showToast(error.message || 'The claim could not be validated.', 'error'); }
  }));
}

function attachRadarEvents() {
  document.querySelector('#radar-form')?.addEventListener('submit', (event) => { event.preventDefault(); startOpportunityAnalysis(document.querySelector('#opportunity-lens').value); });
  document.querySelector('#results-opportunity-lens')?.addEventListener('change', (event) => { const radar = currentOpportunityRadar(); radar.lens = event.target.value; });
  document.querySelectorAll('[data-action="find-more-opportunities"]').forEach((button) => button.addEventListener('click', () => startOpportunityAnalysis(selectedOpportunityLens())));
  document.querySelectorAll('[data-action="research-market"]').forEach((button) => button.addEventListener('click', startResearch));
  document.querySelectorAll('[data-action="view-opportunity"]').forEach((button) => button.addEventListener('click', () => { state.openOpportunityId = button.dataset.id; state.selectedSource = null; render(); }));
  document.querySelectorAll('[data-action="back-to-radar"]').forEach((button) => button.addEventListener('click', () => { state.openOpportunityId = null; state.selectedSource = null; render(); }));
  document.querySelectorAll('[data-action="toggle-compare"]').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.id; state.compareOpportunityIds = state.compareOpportunityIds.includes(id) ? state.compareOpportunityIds.filter((item) => item !== id) : [...state.compareOpportunityIds, id]; render(); }));
  document.querySelectorAll('[data-action="clear-compare"]').forEach((button) => button.addEventListener('click', () => { state.compareOpportunityIds = []; render(); }));
  document.querySelectorAll('[data-opportunity-source-id]').forEach((button) => button.addEventListener('click', () => { const source = currentResearch().sources.find((item) => item.id === button.dataset.opportunitySourceId); if (source) { state.selectedSource = source; render(); } }));
  document.querySelectorAll('[data-action="close-source"]').forEach((button) => button.addEventListener('click', (event) => { if (event.target === button || button.classList.contains('modal-close')) { state.selectedSource = null; render(); } }));
  document.querySelectorAll('[data-action="set-opportunity-status"]').forEach((button) => button.addEventListener('click', () => { const radar = currentOpportunityRadar(); const opportunity = radar.opportunities?.find((item) => item.id === button.dataset.id); if (!opportunity) return; opportunity.status = button.dataset.status; state.strategy.selectedOpportunityId = button.dataset.status === 'selected' ? opportunity.id : state.strategy.selectedOpportunityId === opportunity.id ? null : state.strategy.selectedOpportunityId; state.strategy.opportunityRadar = radar; persistStrategy(state.strategy); showToast(button.dataset.status === 'selected' ? 'Opportunity selected for future campaign strategy.' : 'Opportunity marked as rejected.', 'success'); render(); }));
  document.querySelectorAll('[data-action="develop-campaign"]').forEach((button) => button.addEventListener('click', () => { const radar = currentOpportunityRadar(); const opportunity = radar.opportunities?.find((item) => item.id === button.dataset.id); if (!opportunity) return; opportunity.status = 'selected'; state.strategy.selectedOpportunityId = opportunity.id; state.strategy.opportunityRadar = radar; persistStrategy(state.strategy); navigate('campaigns'); }));
}

function render() {
  if (state.auth.status === 'loading') {
    root.innerHTML = loadingPage();
    return;
  }
  if (!state.auth.session || !isVerifiedUser(state.auth.user)) {
    if (state.auth.status === 'signed-in-unverified') state.page = 'verify-email';
    if (!PUBLIC_ROUTES.has(state.page)) state.page = state.auth.session ? 'verify-email' : 'landing';
    renderPublic();
    return;
  }
  if (!WORKSPACE_ROUTES.has(state.page)) state.page = 'dashboard';
  if (state.migration.status === 'pending') {
    root.innerHTML = migrationPage();
    attachMigrationEvents();
    return;
  }
  if (state.page === 'reset-password') {
    renderPublic();
    return;
  }
  const page = { dashboard: dashboardPage, strategy: strategyPage, research: researchPage, audience: audiencePage, brand: brandPage, radar: opportunityPage, campaigns: campaignPage, workspace: workspacePage }[state.page];
  if (!page) { state.page = 'dashboard'; return render(); }
  renderShell(page());
  if (state.page === 'strategy') attachStrategyEvents();
  if (state.page === 'research') attachResearchEvents();
  if (state.page === 'audience') attachAudienceEvents();
  if (state.page === 'radar') attachRadarEvents();
  if (state.page === 'campaigns') attachCampaignEvents();
  if (state.page === 'brand') attachBrandEvents();
  if (state.page === 'workspace') attachWorkspaceEvents();
}

function navigate(page) {
  const requested = mapHashRoute(page);
  ['research', 'audience', 'radar', 'campaigns'].forEach((key) => {
    if (key !== requested) {
      activeRequests.get(key)?.abort();
      const runKey = { research: 'researchRun', audience: 'audienceRun', radar: 'opportunityRun', campaigns: 'campaignRun' }[key];
      state[runKey] = null;
    }
  });
  if (requested !== state.page && requested !== 'verify-email') state.auth.feedback = null;
  if (isProtectedRoute(requested) && !state.auth.session) {
    state.auth.redirectTo = requested;
    state.page = 'sign-in';
    window.location.hash = 'sign-in';
    render();
    return;
  }
  if (isProtectedRoute(requested) && !isVerifiedUser(state.auth.user)) {
    state.auth.redirectTo = requested;
    state.page = 'verify-email';
    window.location.hash = 'verify-email';
    render();
    return;
  }
  state.page = requested;
  window.location.hash = requested;
  render();
  window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function attachGlobalEvents() {
  attachThemeEvents();
  document.querySelectorAll('[data-route]').forEach((element) => element.addEventListener('click', (event) => { if (element.tagName === 'A') event.preventDefault(); document.body.classList.remove('menu-open'); if (element.dataset.newStrategy === 'true') state.strategy = createDefaultStrategy(); navigate(element.dataset.route); }));
  document.querySelectorAll('[data-action="open-menu"]').forEach((element) => element.addEventListener('click', () => document.body.classList.add('menu-open')));
  document.querySelectorAll('[data-action="close-menu"]').forEach((element) => element.addEventListener('click', () => document.body.classList.remove('menu-open')));
  document.querySelectorAll('[data-action="help"]').forEach((element) => element.addEventListener('click', () => showToast('The product guide will be available as the workspace expands.', 'info')));
  document.querySelectorAll('[data-action="open-feedback"]').forEach((element) => element.addEventListener('click', () => {
    state.betaFeedback = { open: true, sending: false, error: null };
    document.body.classList.remove('menu-open');
    render();
    document.querySelector('#feedback-message')?.focus();
  }));
  document.querySelectorAll('[data-action="close-feedback"]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.currentTarget === event.target || event.target.closest('.modal-close')) {
      state.betaFeedback = { open: false, sending: false, error: null };
      render();
    }
  }));
  document.querySelector('#beta-feedback-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.betaFeedback = { ...state.betaFeedback, sending: true, error: null };
    render();
    try {
      const response = await authenticatedFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: data.get('category'), message: data.get('message'), route: window.location.hash, clientTimestamp: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, 'Feedback could not be sent. Try again shortly.'));
      state.betaFeedback = { open: false, sending: false, error: null };
      render();
      showToast('Thanks — your beta feedback was sent.', 'success');
    } catch (error) {
      state.betaFeedback = { ...state.betaFeedback, sending: false, error: isAbortError(error) ? 'Feedback was cancelled. Try again when ready.' : error.message || 'Feedback could not be sent. Try again shortly.' };
      render();
    }
  });
  document.querySelector('[data-action="retry-cloud"]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    state.cloud = { ...state.cloud, status: 'idle', error: null };
    await loadCloudWorkspace();
  });
  document.querySelectorAll('[data-auth-action="sign-out"]').forEach((element) => element.addEventListener('click', async () => {
    try {
      const { error } = await authService.signOut();
      if (error) throw error;
      await applyAuthState(null, null);
    } catch (error) {
      showToast(authErrorMessage(error), 'error');
    }
  }));
  document.querySelectorAll('[data-action="open-strategy"]').forEach((element) => element.addEventListener('click', () => {
    const found = state.strategies.find((item) => item.id === element.dataset.id);
    if (found) { state.strategy = { ...createDefaultStrategy(), ...normalizeStrategyAudience(found) }; navigate(found.campaignStrategy ? 'campaigns' : found.opportunityRadar ? 'radar' : found.audienceInsights ? 'audience' : found.research ? 'research' : 'strategy'); }
  }));
}

function attachStrategyEvents() {
  const form = document.querySelector('#strategy-form');
  const idea = document.querySelector('#strategy-idea');
  const market = document.querySelector('#strategy-market');
  const updateCount = () => { document.querySelector('#idea-count').textContent = `${idea.value.length} / 600`; form.querySelector('[type="submit"]').disabled = !idea.value.trim() || !market.value.trim(); };
  idea.addEventListener('input', updateCount);
  market.addEventListener('input', updateCount);
  document.querySelector('[data-action="use-example"]').addEventListener('click', () => { idea.value = 'I want to make running more exciting for Gen Z in India.'; updateCount(); idea.focus(); });
  document.querySelector('#strategy-depth').addEventListener('change', (event) => { const option = RESEARCH_DEPTH_OPTIONS.find((item) => item.id === event.target.value); document.querySelector('#depth-description').textContent = option?.description || ''; });
  const competitorEntry = document.querySelector('#competitor-entry');
  const addCompetitors = () => {
    const values = competitorEntry.value.split(',').map((value) => value.trim()).filter(Boolean);
    if (!values.length) return;
    state.strategy.competitors = [...new Set([...(state.strategy.competitors || []), ...values])].slice(0, 8);
    competitorEntry.value = '';
    document.querySelector('#competitor-tags').innerHTML = state.strategy.competitors.map(competitorTag).join('');
    attachCompetitorRemoveEvents();
  };
  competitorEntry.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addCompetitors(); } });
  competitorEntry.addEventListener('blur', addCompetitors);
  attachCompetitorRemoveEvents();
  document.querySelector('[data-action="save-strategy-draft"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    addCompetitors();
    state.strategy = collectStrategyBrief(state.strategy, new FormData(form));
    button.disabled = true;
    const saved = await persistStrategy(state.strategy);
    button.disabled = false;
    if (!saved.localSaved && !saved.cloudSaved) {
      showToast('Draft could not be saved. Keep this page open and try again.', 'error');
      return;
    }
    navigate('dashboard');
    showToast(saved.cloudSaved ? 'Draft saved to your workspace.' : 'Draft saved on this device only. Cloud sync is unavailable; try saving again when connected.', saved.cloudSaved ? 'success' : 'info');
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const ideaValue = String(data.get('idea') || '').trim();
    const marketValue = String(data.get('market') || '').trim();
    if (!ideaValue) { document.querySelector('#idea-error').textContent = 'Add a question or goal before researching.'; idea.focus(); return; }
    if (!marketValue) { document.querySelector('#market-error').textContent = 'Add a market or region so the research stays geographically relevant.'; market.focus(); return; }
    document.querySelector('#idea-error').textContent = '';
    document.querySelector('#market-error').textContent = '';
    addCompetitors();
    state.strategy = { ...collectStrategyBrief(state.strategy, data), status: 'draft', research: null };
    persistStrategy(state.strategy);
    startResearch();
  });
}

function attachCompetitorRemoveEvents() {
  document.querySelectorAll('[data-action="remove-competitor"]').forEach((button) => button.addEventListener('click', () => { state.strategy.competitors = (state.strategy.competitors || []).filter((item) => item !== button.dataset.competitor); document.querySelector('#competitor-tags').innerHTML = state.strategy.competitors.map(competitorTag).join(''); attachCompetitorRemoveEvents(); }));
}

function collectBrandForm() {
  const form = document.querySelector('#brand-form');
  const data = new FormData(form);
  const examples = [...document.querySelectorAll('[data-example-index]')].map((field) => field.value.trim()).filter(Boolean);
  return { ...state.brand, name: String(data.get('name') || '').trim(), industry: String(data.get('industry') || '').trim(), description: String(data.get('description') || '').trim(), website: String(data.get('website') || '').trim(), audience: String(data.get('audience') || '').trim(), voice: { ...state.brand.voice, tone: document.querySelector('[data-tone].selected')?.dataset.tone || state.brand.voice.tone, personality: [...document.querySelectorAll('[data-trait].selected')].map((button) => button.dataset.trait), communicationStyle: String(data.get('communicationStyle') || '').trim(), preferredWords: String(data.get('preferredWords') || '').trim(), avoidWords: String(data.get('avoidWords') || '').trim(), examples, strictness: document.querySelector('[data-strictness].selected')?.dataset.strictness || state.brand.voice.strictness, additionalGuidelines: String(data.get('additionalGuidelines') || '').trim() } };
}

function attachBrandEvents() {
  document.querySelectorAll('[data-tone]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-tone]').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); updateVoicePreview(); }));
  document.querySelectorAll('[data-trait]').forEach((button) => button.addEventListener('click', () => { const selected = document.querySelectorAll('[data-trait].selected'); if (!button.classList.contains('selected') && selected.length >= 4) { showToast('Choose up to four personality traits.', 'info'); return; } button.classList.toggle('selected'); button.innerHTML = `${button.classList.contains('selected') ? icon('check', 13) : ''}${button.dataset.trait}`; updateVoicePreview(); }));
  document.querySelectorAll('[data-strictness]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-strictness]').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); }));
  document.querySelector('[data-action="add-example"]').addEventListener('click', () => { state.brand.voice.examples.push(''); document.querySelector('#examples-list').innerHTML = state.brand.voice.examples.map(exampleField).join(''); attachExampleEvents(); });
  attachExampleEvents();
  const description = document.querySelector('#brand-description'); description.addEventListener('input', () => { document.querySelector('#description-count').textContent = `${description.value.length} / 400`; });
  document.querySelector('[data-action="save-brand"]').addEventListener('click', saveBrand);
  document.querySelector('#brand-form').addEventListener('submit', (event) => { event.preventDefault(); saveBrand(); });
}

function attachExampleEvents() {
  document.querySelectorAll('[data-action="remove-example"]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.index); state.brand.voice.examples.splice(index, 1); if (!state.brand.voice.examples.length) state.brand.voice.examples = ['']; document.querySelector('#examples-list').innerHTML = state.brand.voice.examples.map(exampleField).join(''); attachExampleEvents(); }));
}

function updateVoicePreview() {
  const brandName = document.querySelector('#brand-name')?.value || state.brand.name || 'your brand';
  const trait = document.querySelector('[data-trait].selected')?.dataset.trait || 'Distinctive';
  const quote = document.querySelector('.preview-quote'); if (quote) quote.textContent = `“${trait} ideas for ${brandName}.“`;
}

function saveBrand() {
  const nextBrand = collectBrandForm();
  if (!nextBrand.name && !nextBrand.description) { showToast('Add a brand name or description before saving.', 'error'); document.querySelector('#brand-name').focus(); return; }
  state.brand = nextBrand; storage.saveBrand(state.brand); persistWorkspace(); showToast('Brand voice saved.', 'success'); render();
}

async function persistStrategy(strategy = state.strategy) {
  storage.saveStrategy(strategy);
  const localStrategies = storage.getStrategies();
  const localSaved = localStrategies.some((item) => item.id === strategy.id && JSON.stringify(item) === JSON.stringify(strategy));
  // Keep the current session usable even when browser storage is unavailable.
  state.strategies = [strategy, ...state.strategies.filter((item) => item.id !== strategy.id)];
  if (!state.cloud.repository) return { localSaved, cloudSaved: false };
  try {
    await state.cloud.repository.saveStrategy(strategy);
    return { localSaved, cloudSaved: true };
  } catch {
    if (state.page !== 'strategy') showToast(localSaved ? 'Saved on this device only. Cloud sync is unavailable; try saving again when connected.' : 'Changes could not be saved. Keep this page open and try again.', localSaved ? 'info' : 'error');
    return { localSaved, cloudSaved: false };
  }
}

function persistWorkspace() {
  storage.saveWorkspace(state.workspace);
  if (state.cloud.repository) state.cloud.repository.saveWorkspace({ ...state.workspace, brandProfile: state.brand }).catch(() => showToast('Saved locally. Cloud sync will retry when the workspace is available.', 'info'));
}

function attachWorkspaceEvents() {
  document.querySelector("#workspace-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.workspace = { ...state.workspace, workspaceName: String(data.get("workspaceName") || "").trim(), defaultMarket: String(data.get("defaultMarket") || "").trim(), defaultAudience: String(data.get("defaultAudience") || "").trim(), defaultPlatform: String(data.get("defaultPlatform") || "").trim(), defaultObjective: String(data.get("defaultObjective") || "").trim() };
    persistWorkspace();
    showToast("Workspace defaults saved.", "success");
    render();
  });
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'GOOD MORNING' : hour < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
}

function showToast(message, type = 'info') {
  const region = document.querySelector('#toast-region');
  if (!region) return;
  const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = `${type === 'success' ? icon('check', 15) : icon('sparkles', 15)}<span>${escapeHtml(message)}</span>`; region.append(toast); window.setTimeout(() => toast.remove(), 3200);
}

window.addEventListener('hashchange', () => {
  if (['how-it-works', 'capabilities', 'evidence'].includes(window.location.hash.slice(1))) return;
  const requested = routeFromHash();
  // navigate() already rendered this route. Avoid wiping its save feedback.
  if (requested === state.page) return;
  if (requested !== state.page) abortActiveRequests();
  if (state.auth.status === 'loading') return;
  if (isProtectedRoute(requested) && !state.auth.session) {
    state.auth.redirectTo = requested;
    state.page = 'landing';
    window.history.replaceState(null, '', '#landing');
    render();
    return;
  }
  if (isProtectedRoute(requested) && state.auth.session && !isVerifiedUser(state.auth.user)) {
    state.auth.redirectTo = requested;
    state.page = 'verify-email';
    window.history.replaceState(null, '', '#verify-email');
    render();
    return;
  }
  if (requested !== state.page && requested !== 'verify-email') state.auth.feedback = null;
  state.page = requested;
  render();
});

async function bootstrap() {
  if (isProtectedRoute(state.page)) {
    state.auth.redirectTo = state.page;
    state.page = 'landing';
    window.history.replaceState(null, '', '#landing');
  }
  render();
  const initial = await authService.init();
  state.auth.configured = initial.configured;
  state.auth.error = initial.error || null;
  const subscription = await authService.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      state.auth.session = session;
      state.auth.user = session?.user || null;
      state.page = 'reset-password';
      window.location.hash = 'reset-password';
      render();
      return;
    }
    if (event === 'SIGNED_OUT') applyAuthState(null, null);
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') applyAuthState(session, session?.user || null);
  });
  state.auth.subscription = subscription?.data?.subscription || subscription?.subscription || null;
  await applyAuthState(initial.session, initial.user);
}

bootstrap();
