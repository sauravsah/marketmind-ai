# MarketMind AI

MarketMind is a public landing page and authenticated workspace for turning a focused strategy question into grounded market intelligence, audience context, opportunity direction, and campaign strategy. It keeps evidence, interpretation, hypotheses, and unknowns visibly separate. When live intelligence or synthesis is unavailable, the product stays honest and never invents output.

## Run locally

```text
node server.mjs
```

Then open [http://localhost:4173](http://localhost:4173).

## Architecture

- `index.html` — document shell
- `styles.css` — dark editorial design system, responsive layout, focus states, and reduced-motion support
- `js/models.js` — structured BrandProfile, BrandVoice, Strategy, AudienceProfile, OpportunityRadar, and CampaignStrategy contracts
- `js/storage.js` — local-only persistence for brand context, strategy drafts, and Workspace defaults
- `js/auth.js` — browser Firebase Auth adapter with session persistence, verification, password recovery, and friendly error states
- `js/auth-routes.js` — public/protected route decisions and legacy hash mapping
- `js/repository.js` — user-owned Firestore workspace/strategy repository, JSON-safe serialization, and conflict-safe local migration
- `js/research-history.js` — bounded per-strategy research snapshots and run audit metadata
- `js/audience-review.js` — stable audience claim identity, review state, regeneration merge rules, review coverage, and Radar eligibility
- `firebase/firestore.rules` — Firebase ownership rules for each user workspace and its strategy subcollection
- `js/client/` — browser-safe context and presentation helpers; no credential or provider configuration code
- `js/services/ai.js` — server-only synthesis adapter and structured response parsing
- `js/services/research.js` — server-only research planning, provider adapters, normalization, quality, freshness, deduplication, and evidence validation
- `js/services/audience.js` — evidence preparation, audience synthesis, coverage calculation, unsupported-claim rejection, and research-light fallback
- `js/services/opportunity.js` — readiness checks, evidence preparation, normalization, weighted scoring, confidence, contradictions, freshness, and diversification
- `js/services/campaign.js` — selected-opportunity preparation, campaign normalization, evidence linkage, confidence downgrades, territory deduplication, regeneration merging, and user overrides
- `server/config.mjs` — server-only environment configuration boundary for internal adapters plus the public Firebase runtime config
- `server/firebase-auth.mjs` — dependency-free Firebase ID-token signature and claim verification for server requests
- `server/feedback.mjs` — bounded, sanitized beta-feedback payloads
- `server.mjs` — local HTTP/SSE boundary; intelligence streams require a verified Firebase bearer token
- `functions/` — Firebase Auth blocking function for the invited-beta email allowlist
- `scripts/check.mjs` — source presence and obvious-secret checks
- `tests/` — model, evidence, opportunity, campaign, and integration contract tests

## Product surface

Public entry: landing, sign in, sign up, verify email, forgot password, and reset password. After verification, the protected workspace uses a guided progression rail: Strategy → Market Intelligence → Audience Intelligence → Opportunity Radar → Campaign Strategy. Brand Voice and Workspace settings live in the account menu. Completed stages remain available for review, while future stages expose their prerequisites.

Available in the workspace: Dashboard, New Strategy, Market Intelligence, Audience Intelligence with claim-level approve/edit/reject/needs-validation review, review filters and coverage, Opportunity Radar gated to current reviewed audience claims, Campaign Strategy Studio, Brand Voice Studio, Workspace settings, local backup migration, research history, source inspection, evidence-aware audience sections, strategic radar lenses, ranked opportunities, comparison, selection state, validation plans, stale-research notices, selected-opportunity campaign handoff, campaign foundations, creative territories, concept development, channel roles, content pillars, measurement questions, risks, kill criteria, editable strategic overrides, source-quality reasons, provider-excerpt boundaries, and retained research-run snapshots.

Production execution remains intentionally out of scope. Caption writing, social posts, scripts, image prompts, shot lists, storyboards, content calendars, publishing, analytics, and learning loops are not seeded or generated.

## Firebase and internal environment configuration

The public app reads only the Firebase web configuration from `GET /api/public-runtime-config` (with `/api/public-config` retained as an alias). These values identify the browser app and are safe to expose; Firebase security rules protect the user-owned data. Enable Email/Password in Firebase Authentication, create a Cloud Firestore database, deploy `firebase/firestore.rules`, add the app origin to Firebase’s authorized domains, and set the Firebase email templates’ custom action URL to the app origin so its web action handler can receive `mode` and `oobCode`. Copy `.env.example` to `.env` or provide the same variables through the process environment. Firebase Admin service-account credentials are not used by this browser app and must never be sent to the client.

Provider credentials are server-side only. Set environment variables in the process that runs `node server.mjs`; never put them in Workspace fields, browser storage, request bodies, or client bundles. Intelligence requests carry only the Firebase ID token to the server; the server verifies its signature, issuer, audience, expiry, and email-verification claim before calling internal providers. Firebase signing certificates are cached server-side and no Firebase Admin credential is sent to the browser.

Research evidence uses provider-supplied excerpts only. Each source retains its search angle, retrieval time, publication date when available, freshness, and heuristic quality reasons. Quality labels help a reviewer decide what to inspect; they are never presented as independent verification. A strategy retains the latest research snapshot plus up to five prior run snapshots, including unavailable attempts, for auditability without unbounded JSON growth.

Audience claims are normalized with stable IDs and review keys. New and legacy claims start as pending; reviewed decisions carry across regeneration by review key, while unmatched reviewed claims are retained in a bounded review archive. Opportunity Radar accepts only approved or explicitly revalidated edits that remain observed or inferred, map to valid current source IDs, and match the current research version. No additional database migration is required for these JSONB fields.

Supported internal variables are:

- `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`
- `SEARCH_PROVIDER`, `SEARCH_API_KEY`

The browser sends strategy context plus its Firebase ID token to the local server. The server authenticates the request, reads internal provider variables, calls internal adapters, and returns only normalized product results or the friendly fallback messages shown in the UI.

After the first verified sign-in, MarketMind checks for existing local data. It shows a migration summary, fills empty remote workspace/brand fields from local values, imports local strategies only when their IDs do not conflict, and retains the local browser copy as a backup. The per-user migration marker is stored locally; choosing Skip records the decision without deleting local data.

## Optional invited beta access

Public signup is enabled for the current release. The repository also contains an optional Firebase Auth `beforeUserCreated` blocking function for a future invited beta. It fails closed in `invite-only` mode when the allowlist is empty or malformed, and it normalizes email addresses before matching. The function is not deployed for the public-signup release, and the allowlist is never committed to GitHub or sent to the browser.

From an authenticated Firebase CLI session, configure the Firebase project and secret outside the repository:

```text
firebase use <your-firebase-project>
firebase functions:secrets:set BETA_ALLOWED_EMAILS
firebase deploy --only functions,firestore:rules
```

When Firebase asks for the `BETA_ALLOWED_EMAILS` value, enter comma- or newline-separated email addresses. Deploy the Functions parameter `BETA_ACCESS_MODE` as `invite-only` only when private beta access is intentionally enabled. To keep signup public, do not deploy the blocking function. Firebase Auth blocking functions require the Blaze plan.

The workspace account menu includes a lightweight beta-feedback form. `POST /api/feedback` requires a verified Firebase session, accepts only bounded category/message/route fields, and emits a feedback ID plus a sanitized structured log entry. It does not persist tokens, provider responses, or full strategy payloads.

## Release checks

Before promoting a Vercel deployment, run:

```text
npm test
npm run lint
npm run build
```

Then verify the preview flow with an allowlisted Firebase test account: signup, verification, workspace initialization, local migration, all five intelligence stages, feedback submission, sign-out, and password reset. Promote the preview only after unauthenticated, unverified, and verified API checks return the expected `401`, `403`, and successful responses.
