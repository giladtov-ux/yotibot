# Phase 106 — Render Production Deployment Diagnosis

**Mode:** Read-only diagnosis
**Status:** **NO-GO** — the active Render deployment and its source revision are not verified.
**Assessment date:** 2026-10-22
**Scope:** Local repository/configuration inspection and unauthenticated public HTTP observations only. No secret values were read or printed. No Production database, environment, webhook, or provider configuration was accessed or changed. No deployment, live service launch, or Telegram message was initiated.

## Executive finding

The documented Render host, `https://yotibot-azbu.onrender.com`, resolved and answered requests, but its root, health, and webhook URLs returned the same plain-text placeholder: **`Yotibot is running!`**. The current project source does not implement that response. Its expected root is an HTML application, and its health routes return JSON including bot readiness and, at `/api/healthz`, build identity.

The response is therefore not evidence that this repository's API or bot worker is serving traffic. The most consistent explanations are a placeholder/stale Render deployment, a different Render service or connected repository/branch, or an incorrect deployment build/start configuration. Local evidence cannot distinguish among these causes because Render service metadata and runtime logs are not available.

The repository's Render configuration is explicitly **preparation-only**: automatic deployment is disabled, and `CLOUD_CUTOVER_APPROVED` defaults to `0`. The root launcher intentionally refuses to start a Production process unless that flag is explicitly `1`. Do not change this flag as part of diagnosis; activating the service requires a separate approval.

## 1. Observed live endpoint responses

Read-only GET requests were made to the documented Render origin on 2026-10-22:

| URL path | Observed response | Expected from this repository |
|---|---|---|
| `/` | HTTP 200, plain text `Yotibot is running!` | HTML from `artifacts/api-server/public/index.html` |
| `/healthz` | HTTP 200, plain text `Yotibot is running!` | JSON bot-worker readiness, e.g. `{ ok, service: "ah-sheli-bot", ready }`; 503 when not ready |
| `/api/healthz` | HTTP 200, plain text `Yotibot is running!` | JSON `{ status: "ok", build: { id, commit, releaseTag, dirty } }`; 503 while the Production worker is not ready |
| `/telegram/webhook` (GET probe) | HTTP 200, plain text `Yotibot is running!` | The project webhook is a **POST** route relayed to the bot worker. A GET response is not a webhook-processing test. |

The webhook response included `x-render-origin-server: Render`. DNS resolved and TLS verification succeeded. This confirms that a Render-hosted endpoint answered at that hostname, but not that it is the `ah-sheli` service, uses the intended Git source, or runs this application's build.

The repository's `CLOUD_DEPLOYMENT.md` explicitly warns that HTTP 200 with this placeholder body is **not** proof that the project's worker is processing messages. The literal placeholder string occurs in a test fixture and deployment documentation, not in the application runtime source found during this review.

Separately, Replit deployment metadata for this workspace reported `isDeployed=false` with no Replit Production URL. That describes the current Replit project only; it does not identify or verify the external Render service.

## 2. Local application entry points and expected behavior

### Build and start path

- Root `package.json` requires Node `>=22.18`; `pnpm start` runs `node index.js`.
- `Procfile` declares `web: node index.js`.
- `render.yaml` describes one Node web service named `ah-sheli`, one instance, `autoDeployTrigger: "off"`, and health-check path `/healthz`.
- The configured Render build command is:

  ```sh
  npm install --global pnpm@10.26.1 \
    && pnpm install --frozen-lockfile --prod=false \
    && pnpm --filter @workspace/api-server run build
  ```

- The configured start command is `node index.js`. The repository's cloud-deployment notes say to leave Render's Root Directory empty and run from the repository root.
- `artifacts/api-server/build.mjs` creates the API bundle at `artifacts/api-server/dist/index.mjs`, emits the browser bundles, and embeds build identity. The configured Render build command invokes this API build script.
- The Render build command does not invoke the root `pnpm build`/typecheck script or the package test scripts. A successful Render build alone would not establish that those checks passed.
- `index.js` checks Node `>=22.18`, validates the Production environment, and imports the built API. In Production it exits before starting the API unless `CLOUD_CUTOVER_APPROVED=1`.
- `render.yaml` currently sets `NODE_VERSION` to `"22"` and `CLOUD_CUTOVER_APPROVED` to `"0"`. The actual Node patch version and effective Production values are not visible locally.

### API routes and bot initialization

- `artifacts/api-server/src/app.ts` serves the site at `GET /` from `public/index.html` and serves the remaining public assets from that directory.
- `GET /healthz` is mounted from `src/routes/bot-health.ts`; it probes the internal worker and reports its service identity/readiness.
- `GET /api/healthz` is mounted from `src/routes/health.ts`; it returns the embedded build identity and reports 503 in Production if the worker is not ready.
- The API process in `artifacts/api-server/src/index.ts` listens on the platform-provided `PORT`, initializes billing, and supervises one child bot process. It starts the worker only when the runtime configuration allows it.
- The worker is `artifacts/ah-sheli-bot/index.js` and uses internal port `18081`. The API probes that port and relays webhook traffic only after it identifies a ready `ah-sheli-bot`.
- The worker requires `TELEGRAM_BOT_TOKEN`, database access, and a valid Production webhook URL. It loads persisted bot/reminder state and acquires its worker lock before declaring readiness. On Production startup it registers its webhook with Telegram. **This is why starting the live service during a read-only diagnosis would not be safe or read-only.**
- The API route accepts `POST /telegram/webhook`; compatibility aliases include `/api/telegram/webhook` and `/api/public/telegram/webhook`. It forwards requests to the internal worker. Do not add a second bot service alongside the API.

### Code-level Production environment requirements

`scripts/cloud-start.mjs` validates the following before serving:

- `CLOUD_CUTOVER_APPROVED=1`, `NODE_ENV=production`, and `CLERK_AUTH_MODE=external`
- `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET`, `TELEGRAM_WEBHOOK_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
- At least one AI-provider key: `GROQ_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY`
- A numeric `PORT`
- `PUBLIC_APP_URL=https://yotibot-azbu.onrender.com`
- An HTTPS `TELEGRAM_WEBHOOK_URL` on that origin with an allowed webhook path
- `GOOGLE_CALENDAR_REDIRECT_URI=https://yotibot-azbu.onrender.com/api/mini-app/calendar/callback`
- If `VITE_CLERK_PUBLISHABLE_KEY` is supplied, it must match `CLERK_PUBLISHABLE_KEY`.

These are requirements derived from local code, **not confirmation that any Production variable is present or correct**. The Render template contains secret placeholders for several of these names but does not reveal whether the active service uses that template. Whop and Calendar feature credentials/configuration also need separate verification if those features are expected to work.

## 3. Git provenance and exact source baseline

Local repository evidence:

- Current branch: `main`
- Commit at inspection time: `72e8ac6626be510926986b4a4b0d1761ffa5b817` (the working tree was clean before this report was added)
- The local repository has a `gitsafe-backup` remote and `gitsafe-backup/main` tracking ref. No Render account metadata or connected Render source ref is available locally.
- The fixed annotated tag `phase-106-baseline-6bd4a6b2` dereferences to `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f`. `docs/release-tracking.md` records this tag as local-only and says it must not be moved. It is an earlier provenance baseline, not the latest Phase 106 runtime build.
- The last verified Phase 106 application build recorded locally is:
  - **Build ID:** `phase-106-baseline-6bd4a6b2-2-g5566584`
  - **Source commit:** `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`
  - **Release tag:** none
  - **Dirty:** `false`
- Git comparison of current `HEAD` against `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069` shows only agent metadata, memory, and documentation changes; no runtime application source files changed after that verified build.

**Exact target limitation:** `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069` is the exact last verified runtime source baseline available in the local record. `72e8ac6626be510926986b4a4b0d1761ffa5b817` is the current clean checkout (documentation/metadata ahead). Neither local Git state nor the public endpoint proves which SHA Render actually deployed. The deployed source SHA/build remains **unknown** until Render's service/deploy metadata or runtime logs are provided.

## 4. Diagnosis: expected versus observed

| Evidence | Interpretation |
|---|---|
| The expected project root route serves HTML; observed root is the same placeholder text as both health paths. | Traffic is not reaching the expected Express app, or an upstream/other service is replacing its responses. |
| The expected health responses are JSON and include worker readiness/build information; observed responses contain no application JSON or build identity. | The live response cannot establish API startup, bot readiness, or build provenance. |
| The literal placeholder is absent from runtime source and appears in test/documentation contexts. | The placeholder response is not emitted by the inspected application implementation. |
| `render.yaml` is marked preparation-only, auto-deploy is off, and the default cutover flag is `0`. | A code push alone is not expected to update Render. If the blueprint settings are applied unchanged, the launcher intentionally refuses to start the Production app. |
| Replit reports no deployment for this workspace, while the public hostname responds from Render. | The public host is external to the current Replit Published deployment; Replit deployment metadata cannot identify its Git source or current build. |

**Most likely diagnosis (not confirmed):** Render is serving a placeholder/stale deployment or a different service/source than this repository's intended `ah-sheli` API. A wrong root/build/start setting or an unapproved launch guard could also prevent the intended API from starting. Since the observed placeholder is not in the app source, the exact cause requires Render's service configuration and logs.

## 5. Exact Render account-owner details needed

No direct Render provider metadata or runtime-log access is available in this workspace. To finish the diagnosis, the account owner should provide read-only evidence for:

1. **Service identity:** Render workspace/team, service name and service ID, service type/status, region, public service URL, and any custom domain attached to it.
2. **Source selection:** connected Git provider/repository (repository name is sufficient; redact any credentials), branch, currently deployed full commit SHA, deploy ID/status/time, and whether the connected source is the repository represented by local branch `main`.
3. **Effective build settings:** Root Directory, build command, start command, Node version resolved by the service, health-check path, instance count, and whether a Blueprint or Dashboard override supplies the effective values.
4. **Current deploy evidence:** the latest build/deploy log and recent runtime/startup logs, with all secret values, connection strings, authorization headers, and user data redacted.
5. **Environment readiness by name/presence only:** whether required variable names from Section 2 are configured, and whether `CLOUD_CUTOVER_APPROVED` is `0` or `1`. Do **not** send the values.
6. **Service/DB wiring:** whether the service points to the existing intended Production database and whether API and supervised worker share that same database. Provide identifiers/provider/region only—not a database URL or data dump.
7. **Deployment behavior:** confirm whether `autoDeployTrigger: off` is effective and identify the last successful deployment that produced the placeholder response.

Screenshots or copied settings with values redacted are sufficient; do not share secrets in chat.

## 6. Minimum remediation steps — not executed

1. Use the read-only owner evidence above to identify the exact Render service returning the placeholder and the currently deployed SHA. Do not change settings until that service/source relationship is established.
2. Compare the service's effective settings with `render.yaml` and `CLOUD_DEPLOYMENT.md`: repository root, Node `>=22.18`, build command, `node index.js` start command, `/healthz`, one service instance, and one supervised bot worker.
3. Confirm the deployment source SHA and build ID from Render logs or `/api/healthz` once the actual application is serving. The expected Phase 106 reference is build `phase-106-baseline-6bd4a6b2-2-g5566584` from source `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`; the current checkout is `72e8ac6626be510926986b4a4b0d1761ffa5b817`. Do not claim either is deployed without provider evidence.
4. Correct any wrong repository/branch, root directory, build command, start command, or health-check configuration only after a separate approved change plan. The repository template intentionally disables automatic deployment. Run typecheck and relevant API/bot tests separately; they are not part of the configured Render build command.
5. Before any future live activation, separately verify required Production environment-variable **presence and correctness in the provider**, preserving all secret values. Keep `CLOUD_CUTOVER_APPROVED=0` until an explicit cutover approval; setting it to `1` starts the real Production app and can register the Telegram webhook.
6. After an independently approved deployment, verify `GET /` returns the application HTML, `GET /healthz` returns ready bot-worker JSON, and `GET /api/healthz` returns JSON with the expected build ID/full commit and `dirty=false`. Do not use a generic HTTP 200 or the placeholder body as readiness evidence.

## Authorization boundary

This report is the only requested output. No source, dependency, environment, database, webhook, or deployment configuration was changed. No live process was started and no Telegram API or payment action was performed. The default decision remains **NO-GO** pending account-owner evidence and explicit human approval.
