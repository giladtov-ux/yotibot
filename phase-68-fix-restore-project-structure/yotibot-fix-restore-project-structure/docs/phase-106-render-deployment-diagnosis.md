# Phase 106 — Render Production Deployment Diagnosis

**Mode:** Read-only diagnosis
**Status:** **NO-GO** — the Render dashboard details identify a pinned deployment, but its full deployed SHA, latest deployment result/date, runtime logs, and effective environment/database wiring remain unverified.
**Assessment date:** 2026-10-22
**Scope:** Local repository/configuration inspection, unauthenticated public HTTP observations, and Render Dashboard details supplied by the account owner. Dashboard details were not independently retrieved. No secret values were read or printed. No Production database, environment, webhook, or provider configuration was accessed or changed. No deployment, live service launch, or Telegram message was initiated.

## Executive finding

The account owner reports that Render is serving a Web Service named **`yotbot`**, connected to **`gladkov-ux/yotbot`**, branch **`main`**, pinned to abbreviated commit **`5d10871`** with auto-deploy disabled. The previously observed public host, `https://yotibot-azbu.onrender.com`, returned the same plain-text placeholder—**`Yotibot is running!`**—at its root, health, and webhook URLs. The current project source does not implement that response.

The placeholder is not evidence that this repository's API or bot worker is serving traffic. The dashboard's pinned `5d10871` differs from the Phase 106 verified runtime source `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069` and the account owner's cited latest `main` SHA `72e8ac6626be510926986b4a4b0d1761ffa5b817`. The service name also differs from the local Render template name (`yotbot` versus `ah-sheli`). These facts support a stale or mismatched deployment as a likely explanation, but the abbreviated SHA is not present in the local Git object database, so the exact code diff and cause cannot yet be confirmed.

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

### Render Dashboard details supplied by the account owner

- Service: `yotbot` — Web Service
- Connected repository: `gladkov-ux/yotbot`
- Branch: `main`
- Pinned deployed commit shown: `5d10871` (abbreviated SHA)
- Auto-deploy: disabled
- Latest deployment status and date: not included in the supplied details

These are owner-provided Dashboard findings, not independently read Render metadata. The local `render.yaml` names its prepared service `ah-sheli`; Render service names can be changed, so this mismatch needs confirmation against the service's repository/root/build settings rather than being treated alone as proof of a wrong repository.

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
- The account owner cites latest `main` as `72e8ac6626be510926986b4a4b0d1761ffa5b817`.
- The local workspace is now at `174b3c0307f6185e83d5e679854a5777a5feb757`, a documentation/agent-metadata-only follow-up on the cited `72e8ac...` state; it is not a new runtime candidate.
- The last verified Phase 106 runtime source remains `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`; the Phase 106 report records build ID `phase-106-baseline-6bd4a6b2-2-g5566584`, `releaseTag: none`, `dirty: false`.
- The current local checkout later received documentation/agent-metadata-only commits; no runtime application source changed after the verified `55665848...` build.
- The local repository has a `gitsafe-backup` remote and `gitsafe-backup/main` tracking ref. No Render account metadata or connected Render source ref is available locally.
- The fixed annotated tag `phase-106-baseline-6bd4a6b2` dereferences to `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f`. `docs/release-tracking.md` records this tag as local-only and says it must not be moved. It is an earlier provenance baseline, not the latest Phase 106 runtime build.
- The last verified Phase 106 application build recorded locally is:
  - **Build ID:** `phase-106-baseline-6bd4a6b2-2-g5566584`
  - **Source commit:** `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`
  - **Release tag:** none
  - **Dirty:** `false`
- Git comparison of current `HEAD` against `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069` shows only agent metadata, memory, and documentation changes; no runtime application source files changed after that verified build.
- The Dashboard's abbreviated `5d10871` cannot be resolved with the local Git object database (`git cat-file` finds no matching commit), so a safe, exact diff against that deployed revision cannot be calculated from this checkout.

**Exact target limitation:** The exact last verified runtime source baseline is `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`. The account owner identifies the pinned Render revision as `5d10871` and latest `main` as `72e8ac6626be510926986b4a4b0d1761ffa5b817`; the deployed value is only seven characters and is absent locally. Obtain its full 40-character SHA before claiming an exact source comparison or selecting a deployment target.

## 4. Diagnosis: expected versus observed

| Evidence | Interpretation |
|---|---|
| The expected project root route serves HTML; observed root is the same placeholder text as both health paths. | Traffic is not reaching the expected Express app, or an upstream/other service is replacing its responses. |
| The expected health responses are JSON and include worker readiness/build information; observed responses contain no application JSON or build identity. | The live response cannot establish API startup, bot readiness, or build provenance. |
| The literal placeholder is absent from runtime source and appears in test/documentation contexts. | The placeholder response is not emitted by the inspected application implementation. |
| `render.yaml` is marked preparation-only, auto-deploy is off, and the default cutover flag is `0`. | A code push alone is not expected to update Render. If the blueprint settings are applied unchanged, the launcher intentionally refuses to start the Production app. |
| Replit reports no deployment for this workspace, while the public hostname responds from Render. | The public host is external to the current Replit Published deployment; Replit deployment metadata cannot identify its Git source or current build. |
| The account owner reports Render is pinned to `5d10871`, with auto-deploy disabled, while the verified runtime build is from `55665848...` and the cited latest `main` is `72e8ac...`. | Render will not follow later commits automatically. The pin is a strong candidate for the stale-code explanation, but the exact source diff and deployed build remain unverified until the full SHA and deployment record are available. |
| The Dashboard service name is `yotbot`; the local prepared Blueprint names a service `ah-sheli`. | Confirm the service's connected repository, Root Directory, and effective settings. A service rename alone does not prove misconfiguration. |

**Most likely diagnosis (not confirmed):** Render is pinned to an older or otherwise mismatched revision and is serving a placeholder/stale deployment rather than the current full application. The account-provided pin and disabled auto-deploy explain why newer source would not have reached the service automatically. A wrong Root Directory/build/start setting or the unapproved launch guard could also prevent the intended API from starting. The exact cause still requires a full SHA, effective settings, and redacted logs.

## 5. Exact Render account-owner details needed

No direct Render provider metadata or runtime-log access is available in this workspace. The account owner has supplied service name, type, repository, branch, abbreviated pinned SHA, and auto-deploy status. To finish the diagnosis, provide read-only evidence for:

1. **Full deployed SHA and deployment record:** the complete 40-character SHA for `5d10871`, deployment ID, latest status, and deployment timestamp. The short SHA cannot be resolved from this local checkout.
2. **Service/source identity:** Render service ID, region, public URL/custom domain, connected Git provider/repository, and confirmation that the service is `gladkov-ux/yotbot` on `main`.
3. **Effective settings:** Root Directory, build command, start command, resolved Node version, health-check path, instance count, and whether Blueprint or Dashboard overrides determine them.
4. **Redacted logs:** latest build/deploy log and recent runtime/startup logs. Remove secret values, connection strings, authorization headers, and user data.
5. **Environment names/presence only:** configured variable names and whether `CLOUD_CUTOVER_APPROVED` is `0` or `1`. Do **not** send values.
6. **Database wiring:** database provider/service identifier and confirmation that Production is separate from Staging and the API and supervised worker share the intended Production database. Do not send a database URL or data.
7. **Deployment behavior:** confirm auto-deploy is disabled and identify the deployment that first began returning the placeholder.

Screenshots or copied settings with values redacted are sufficient; do not share secrets in chat.

## 6. Read-only preparation before any authorized Render update

These steps gather evidence only. They do not update the pinned commit, enable auto-deploy, change environment settings, or trigger a deployment.

1. In the Render Dashboard, capture the `yotbot` service summary, latest deployment ID/status/date, full deployed SHA, repository/branch, Root Directory, effective Build/Start commands, Node version, health-check path, and instance count.
2. Confirm the service is actually connected to `gladkov-ux/yotbot` branch `main`. Compare its effective settings with local `render.yaml` and `CLOUD_DEPLOYMENT.md`; record the `yotbot`/`ah-sheli` naming difference without assuming it is the cause.
3. Obtain the full SHA behind `5d10871`. Verify that exact commit in the source repository, then compare its tree with the candidate SHA using a read-only GitHub compare view or a disposable read-only clone. Do not fetch into or change this workspace, and do not infer the diff from the seven-character prefix.
4. Review the diff between the pinned deployed revision, the last verified runtime baseline `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`, and the account-cited latest `main` `72e8ac6626be510926986b4a4b0d1761ffa5b817`. Identify runtime, build, migration, and webhook changes separately. Confirm the candidate build is clean and its full SHA/build ID are recorded.
5. Inspect the latest Render build and startup logs in redacted form. Determine whether the service ran `node index.js`, whether the cloud start guard rejected startup, or whether another process/build served the placeholder.
6. Verify required environment-variable **names and presence only**, effective `CLOUD_CUTOVER_APPROVED` value, and Production/Staging database separation. Do not copy, print, or transmit any secret values.
7. Record findings and stop for explicit human approval. Until that approval, keep auto-deploy disabled, keep the Render commit pin unchanged, and do not change `CLOUD_CUTOVER_APPROVED`.

## 7. Minimum remediation after separate authorization — not executed

1. Select one reviewed exact full 40-character candidate SHA; do not treat `5d10871`, `55665848...`, and `72e8ac...` as interchangeable.
2. Correct any verified repository/branch/root/build/start/health mismatch only under an approved change plan. Run typecheck and relevant API/bot tests separately; the configured Render build command does not run them.
3. Preserve the current production bot/database safeguards and ensure only the single API service supervises one bot worker.
4. Change the pinned commit or trigger a manual deployment only after a separate explicit approval. Keep `CLOUD_CUTOVER_APPROVED` unchanged until the authorized cutover gate; setting it to `1` starts the Production app and may register the Telegram webhook.
5. After an approved deployment, verify `GET /` serves application HTML, `GET /healthz` returns ready bot-worker JSON, and `GET /api/healthz` returns the expected build ID/full commit with `dirty=false`. A generic HTTP 200 or placeholder body is not readiness evidence.

## 8. Authorization boundary

Only this report is being updated. No source, dependency, environment, database, webhook, or Render deployment setting was changed. No commit was pushed or pinned in Render; no deployment or live process was started; and no Telegram API or payment action was performed. The default decision remains **NO-GO** pending the missing evidence and explicit human approval.
