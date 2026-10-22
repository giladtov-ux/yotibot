# Phase 105 — Production Readiness Review

**Review date:** 2026-10-22  
**Mode:** Read-only  
**Decision:** **NO-GO — do not cut over until the blocking evidence gaps below are resolved and a human approves.**

This review did not deploy code, change Production settings or Secrets, send user messages, or create/process payments. No automatic cutover was executed. The only live external probes in this review were read-only health `GET` requests. Secret values were not read.

## 1. Release identity and intended source

| Item | Finding |
|---|---|
| Candidate commit | `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f` |
| Candidate source tree | `a9ec88e51c8e4a6cda0674db420a457ea4d1bc05` |
| Branch / commit time | `main` / `2026-10-21T20:56:56Z` |
| Working tree | Clean at review time |
| Build ID | **Unavailable.** No active Replit deployment/build was reported, and no build ID is defined in the tracked source. The commit hash is not a build ID. |
| Intended deployment source | The candidate source is the clean `main` commit above. `render.yaml` describes a single Render web service, built from this repository with `pnpm --filter @workspace/api-server run build` and started with `node index.js`. This is a preparation template, not proof that Render built or is serving this commit. |

Replit deployment metadata returned `isDeployed: false` and `hasSuccessfulBuild: false`. The public Render health paths were reachable, but both returned the text `Yotibot is running!` rather than this app's documented worker/API readiness JSON. `CLOUD_DEPLOYMENT.md` explicitly says this 200 response is a placeholder and is not evidence that the Telegram worker is processing messages. Therefore, **the source and build currently serving the external Render URL are not verified**.

Relevant evidence: `render.yaml:1-12,20-45`; `index.js:17-22`; `scripts/cloud-start.mjs:5-55`; `CLOUD_DEPLOYMENT.md:31-46,78-104`.

## 2. Staging/Production Secrets and database isolation

### Secrets

- Replit's Development and Production secret inventories each showed the names `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, and `VITE_CLERK_PUBLISHABLE_KEY`.
- Only secret-name/presence metadata was inspected. **The values were not accessed or compared**, so this does not establish that the Staging and Production Telegram bot tokens, session secrets, or Clerk credentials are distinct.
- The Staging workflow explicitly starts with `NODE_ENV=development`, `TELEGRAM_STAGING_ENABLED=true`, a webhook URL derived from `REPLIT_DEV_DOMAIN`, and `CLOUD_CUTOVER_APPROVED` unset. The staging webhook previously read back as the development test-bot webhook. These are useful staging guards, not proof about the external Production runtime.
- `TELEGRAM_ALLOWED_CHAT_ID` was not present in the inspected Replit Secrets inventory. The Staging bot's internal readiness response previously reported `ownerConfigured: false`; owner configuration and owner commands are therefore not verified in Staging.
- The Render template requires external `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET`, `GROQ_API_KEY`, Clerk, and Google Calendar credentials. Render's actual environment was not inspected. `CLOUD_DEPLOYMENT.md` says Replit-managed Clerk and connector credentials do not transfer to external hosting.

### Databases

- Read-only access to the Development database succeeded; it contains the app's `ah_sheli_*` tables.
- A read-only Production database lookup returned: **“This project has no production database.”**
- The Render template expects a separately supplied `DATABASE_URL`; the intended external Production database, its credentials, backup policy, and its separation from Development could not be inspected.
- The deployment notes require the cloud service to use the existing Production database and `SESSION_SECRET`, and explicitly prohibit pointing it at Development data. No database copy or migration was performed in this review.

**Assessment:** Replit documents separation of Development and Production secrets/databases, but the actual Production database is expected to be external. Isolation of the live external DB and actual secret *values* remains unverified.

## 3. Outbound integration and business-operation audit

| Channel | Source behavior and risk | Readiness evidence |
|---|---|---|
| **Telegram Bot API** | The bot receives webhook updates and can send messages, fetch files, and register a webhook using `TELEGRAM_BOT_TOKEN`. The API also sends payment/access confirmations directly to Telegram. | Staging uses a development-domain webhook and test bot. Production token value/identity and live webhook were not checked. No user message was sent. |
| **AI providers** | The assistant selects OpenRouter when `OPENROUTER_API_KEY` is set; otherwise it uses Groq. Groq is also used for audio transcription. These calls send user prompts/audio to the selected provider. `OPENAI_API_KEY` is a legacy alias for Groq, not evidence of a direct OpenAI integration. | The Render template requires `GROQ_API_KEY`; actual Render credentials/provider configuration were not inspected. No AI request was run during this review. |
| **Whop billing** | Checkout creates a Whop checkout URL that can collect real payment. Signed `payment.succeeded` webhooks trigger provider-side reconciliation; startup also initializes billing and periodic reconciliation can grant access and send Telegram confirmations. Grants are keyed by provider invoice/payment ID. | `BILLING.md` states there is no sandbox checkout, and `billingStatus()` reports live mode. Replit's Whop integration was not ready/connected (`connect` status); external Whop credentials and Production plan/webhook configuration were not verified. No checkout, payment, webhook, or refund was run. |
| **Google Calendar** | OAuth exchanges and stores tokens, then reads calendar events. The reviewed scope is read-only events access. The callback URL is pinned to the Render origin. | Replit's Calendar integration was not ready/connected (`connect` status). Render credentials, Google redirect registration, and token/data isolation were not inspected or exercised. |
| **Authentication** | Replit development auth and the external Clerk mode are separate paths. The Render template selects `CLERK_AUTH_MODE=external`. | A Production external Clerk tenant, callbacks, and existing account-link preservation were not verified. The deployment notes warn that Replit-managed Clerk keys cannot simply be copied to external hosting. |
| **Other payment/email channels** | The reviewed billing documentation identifies Whop as the payment provider. No direct Stripe API or separate SMTP integration was identified in the reviewed source. | No provider checkout or email delivery was tested. |

Key references: `artifacts/ah-sheli-bot/src/lib/assistant.server.ts:9-15`; `artifacts/api-server/src/lib/billing-runtime.ts:109-178,180-200`; `artifacts/api-server/src/lib/mini-app-calendar.ts:28-82`; `artifacts/api-server/src/lib/billing-config.ts:1-6`; `render.yaml:28-45`; `CLOUD_DEPLOYMENT.md:93-104`; `BILLING.md:12-56`.

## 4. STOP handling and duplicate prevention

### STOP / opt-out handling — **not implemented**

- No user-facing `STOP` or `/stop` opt-out command was found in the reviewed bot source.
- `/revoke` is an owner-only access-control action. It disables bot access but is not a user opt-out and does **not** cancel a Whop subscription; the billing documentation directs customers to cancel through Whop.
- Operational shutdown is different: the bot has `SIGINT`/`SIGTERM` handling that drains/stops its worker, scheduler, HTTP server, and lock. `CLOUD_CUTOVER_APPROVED=0` prevents the cloud launcher from activating, and `render.yaml` has automatic deployment disabled. These are operator controls, not a Telegram STOP command or a billing kill switch.

Evidence: `artifacts/ah-sheli-bot/src/user-access.js:10-24,91-156`; `artifacts/ah-sheli-bot/index.js:343-361`; `scripts/cloud-start.mjs:5-55`; `render.yaml:1-2,9,20-21`; `BILLING.md:42`.

### Duplicate message/update prevention — **implemented for inbound update claims; not exactly-once outbound delivery**

- `ah_sheli_updates.update_id` is a database primary key.
- `claimUpdate()` inserts with `ON CONFLICT (update_id) DO NOTHING` and reports whether it claimed the update. The update-processing path checks the claim before handling the update, so a previously claimed update is not handled again.
- A simulated unit test uses a fake database to assert that a repeated update ID is rejected. Another restart simulation checks that an uncertain reminder delivery is not sent again after its marker is persisted.
- This is not an exactly-once guarantee for Telegram delivery. Telegram sends do not carry a provider idempotency key; an ambiguous network result can leave delivery unknown. The source intentionally avoids automatic replay in some uncertain-send paths.

Evidence: `lib/db/src/schema/ah-sheli-runtime.ts:8-15`; `artifacts/ah-sheli-bot/src/conversation-repository.js:16-30`; `artifacts/ah-sheli-bot/index.js:252-265`; `artifacts/ah-sheli-bot/test/interrupted-requests.test.js:115-123`; `artifacts/ah-sheli-bot/test/worker-recovery.test.js:56-68`; `artifacts/ah-sheli-bot/src/telegram.js:156-184`.

### Payment duplicate prevention — code-reviewed, not live-tested

The payment reconciler validates provider-side payment and membership data, locks the registration row, and inserts the grant with `ON CONFLICT(invoice_id) DO NOTHING`. It processes signed webhook events by re-reading provider state rather than trusting the webhook body as a grant. These are code-level safeguards only: no payment was processed, and no dedicated billing/payment test file or matching billing test reference was found under `artifacts/api-server/tests`.

Evidence: `artifacts/api-server/src/lib/billing-runtime.ts:109-178`; `artifacts/api-server/src/lib/payment-policy.ts`; `BILLING.md:12-56`.

## 5. Backup, restore, and rollback capability

### Database backup and restore

- The bot persists authoritative runtime state in PostgreSQL. It also writes a `state.json` file snapshot, but the code treats PostgreSQL as the authoritative commit boundary when a database is configured. **This local JSON snapshot is not a full PostgreSQL backup or a verified Production restore mechanism.**
- Replit's official documentation describes Development database recovery through checkpoints and Production database daily backups/point-in-time recovery, with retention depending on plan (documented range: 7–28 days). These facilities do not currently establish recovery for this app: Replit reports no Production database for this project.
- The external Render `DATABASE_URL` provider, backup schedule, retention, point-in-time restore capability, and a successful restore drill were not verified. The deployment notes call for a Production backup before cutover, but there is no evidence in this review that one exists.

References: `artifacts/ah-sheli-bot/src/store.js:1-22,337-355`; `CLOUD_DEPLOYMENT.md:108-122`; Replit docs: [Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery), [Development and production databases](https://docs.replit.com/features/data-and-storage/development-and-production).

### Code/configuration rollback

- The cloud deployment notes prescribe stopping the new cloud worker first, then restoring the previous worker/webhook/domain configuration against the **same** Production database. They warn not to restore an old database snapshot over newer user data.
- Replit's documented app rollback path is to restore a project checkpoint and republish; code rollback and database restore are separate operations. Replit has no active Production deployment for this project, and the current external Render build/source and rollback target were not verified.
- No automatic rollback was executed, and no previous known-good Render build ID was available to validate.

References: `CLOUD_DEPLOYMENT.md:106-122`; [Replit checkpoints and rollbacks](https://docs.replit.com/features/version-control/checkpoints-and-rollbacks); [Publishing overview](https://docs.replit.com/features/publishing/overview).

## 6. Evidence classification

### Live checks performed during this review (read-only)

- Staging `GET /healthz` → HTTP 200, `{"ok":true,"service":"ah-sheli-bot","ready":true}`.
- Staging `GET /api/healthz` → HTTP 200, `{"status":"ok"}`.
- Staging workflow logs showed the API listening, worker lock acquired, Telegram webhook active, and worker heartbeat. They also logged `Billing unavailable; existing bot remains running`. A successful health response does not prove owner setup, billing readiness, or end-to-end user messaging.
- Render `GET /healthz` and `GET /api/healthz` → HTTP 200 with `Yotibot is running!`, the placeholder explicitly called out by `CLOUD_DEPLOYMENT.md`.
- Replit deployment metadata: no deployed app/successful build. Production DB query: no Replit Production database.
- Secret checks returned presence/name metadata only; no values were read. Connector discovery showed Whop and Google Calendar in `connect` status, not ready/connected.
- A prior Staging-only `getWebhookInfo` check read the development test bot's webhook metadata; it was not a Production bot check.

### Simulated or previously executed checks

- During the earlier Staging setup, the bot suite reported **510 passed, 0 failed, 11 skipped, 9 TODO** (530 total), and the API suite reported **56 passed, 0 failed**. API typecheck/build also passed in that earlier work.
- These results are historical and were **not rerun for this Phase 105 review**. They are not Production tests and do not cover a real payment, Production DB restore, or user-facing STOP behavior.
- Dedup and restart tests use simulated/fake state, as described above.

### Unverified assumptions / gaps

- Which source/build is currently running at Render; its build ID and rollback target.
- Whether Production and Staging contain different Telegram tokens, databases, session secrets, Clerk identities, and provider credentials.
- External Production database ownership, TLS, backup/restore procedures, retention, and successful restore.
- A real Production worker/webhook identity and readiness check.
- A user-facing STOP/opt-out flow and an independent billing kill switch.
- Production Whop live mode, plan IDs, webhook signature setup, refund handling, and reconciliation under duplicate/out-of-order events.
- External Clerk account linkage and Google Calendar OAuth configuration.
- End-to-end Telegram receipt and reply, reminder delivery, payment grant, or refund behavior. None was exercised here.

## 7. Cutover plan (proposed only; not executed)

1. **Hold and identify:** Keep `CLOUD_CUTOVER_APPROVED=0`. An operator with access to the actual hosting account should identify the currently serving commit/build, service, bot identity, webhook, and external Production database. Record a real immutable build ID and rollback target.
2. **Prove isolation and recoverability:** Verify, without exposing values, that Staging and Production use distinct intended bot credentials and databases. Confirm the external Production DB and run a documented backup/restore drill against an isolated restore target. Record RPO/RTO and retention.
3. **Close integration and safety gaps:** Verify the external Clerk tenant/account mappings, direct Whop credentials and webhook settings, Google OAuth redirect/credentials, and AI provider credentials. Decide and implement the required STOP/opt-out and billing-disable procedures before accepting live traffic. Do not use real customer checkout as a test.
4. **Staging acceptance:** Use only the separate test bot and isolated Development database. Verify worker readiness/lock, webhook delivery, duplicate update handling, restart recovery, access boundaries, and non-payment flows. Keep real billing disabled; test payment policy with provider-approved test facilities only if available.
5. **Human-approved cutover:** After documented sign-off, schedule a single-worker transition. Stop the old worker before enabling the new one; verify it uses the intended Production database and obtains the exclusive lock. Only then may an authorized operator set `CLOUD_CUTOVER_APPROVED=1`, with automatic deploy still off.
6. **Observe before expanding:** Monitor health, lock ownership, webhook errors/pending updates, DB failures, billing reconciliation, access grants, and notification uncertainty. Expand only after the agreed observation window and human approval.

## 8. Stop-loss triggers, kill switches, and rollback plan

### Stop-loss triggers

Stop before cutover, or begin rollback if already approved, for any of these conditions:

- Health still returns the Render placeholder, or the app/worker readiness or exclusive DB lock is missing.
- The serving build/commit, bot identity, Production database, or rollback target cannot be identified.
- A Staging/Production token or database is shared unintentionally, or credential separation cannot be demonstrated.
- No verified Production backup/restore path, or a restore drill fails.
- Telegram webhook errors/pending updates rise, duplicate actions occur, or a send result is ambiguous and customer impact cannot be bounded.
- Payment configuration is not confirmed, a payment cannot be reconciled to the correct verified user/plan/amount/currency, or any unauthorized/duplicate grant or charge is observed.
- Authentication/account links fail, or Calendar/Whop callbacks point to the wrong environment.
- Any unexpected live user notification or charge occurs.

### Available controls and limitations

- `CLOUD_CUTOVER_APPROVED=0` blocks the cloud launcher; the template sets it to `0`.
- `render.yaml` has `autoDeployTrigger: "off"`.
- The root launcher forwards termination to the worker; graceful SIGTERM is the documented operational stop. The operator must still verify lock release and webhook ownership before restoring traffic.
- There is **no user-facing STOP command** and no reviewed dedicated billing kill-switch flag. `/revoke` only revokes app access and does not cancel a subscription.
- Staging's `TELEGRAM_STAGING_ENABLED` guard is for Development; it is not a Production kill switch.

### Rollback sequence

1. Stop the newly started cloud service/worker first and confirm it released the exclusive database lock.
2. Restore the previously verified worker, webhook, domain, and authentication configuration. Ensure exactly one worker owns the Production bot token; do not point the old worker at a separate or stale database.
3. Keep the same Production database during an application rollback. Do not restore an old snapshot merely to undo a code change.
4. If data corruption requires DB recovery, preserve current data first, then use the external provider's verified point-in-time recovery process with human approval and an agreed recovery point. Treat writes after that point as potentially lost and reconcile them before reopening traffic.
5. Re-verify worker readiness, webhook delivery, auth, and billing state before resuming. Replit checkpoint rollback/republication applies only if the affected deployment is a Replit deployment; no such Production deployment was reported here.

## Final assessment

**NO-GO for Production cutover.** The immediate blockers are the unverified serving Render build (with the public endpoint returning the documented placeholder), absence of an identified Production build ID and Replit Production database, unverified external DB backup/restore, inability to prove secret-value separation, live-capable Whop billing without a sandbox, and missing user-facing STOP handling.

No cutover was performed. No Production settings or Secrets were changed. No messages or payments were sent or processed. This report is submitted for human review and approval only.
