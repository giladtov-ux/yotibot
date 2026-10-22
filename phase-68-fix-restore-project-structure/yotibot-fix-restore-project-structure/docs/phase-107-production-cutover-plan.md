# Phase 107 — Production Cutover Preparation (No Deployment)

**Decision:** **NO-GO.** This is a preparation plan, not authorization to deploy, change the Render commit pin, enable the Production launcher, migrate Production data, or switch traffic.

**Scope and safety:** No environment values or Secrets were read. No Production database was accessed. No settings, webhooks, or databases were changed. No service was started, no build was run, and no Telegram or billing calls were made while preparing this plan.

## 1. Evidence labels and current baseline

This document distinguishes:

- **Verified locally:** Git history, checked-in code, configuration templates, and prior Phase 106 test/report evidence.
- **Provided by account owner:** Render Dashboard details relayed in chat; not independently retrieved from Render.
- **Unknown:** Requires private Render/provider evidence or an authorized Production-owner verification.
- **Proposed gate:** A control or threshold that must be approved by the named human owners before any Production activation.

### Staging source identity

**Verified locally and in the Phase 106 report:**

- Full source commit: `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`
- Staging build ID: `phase-106-baseline-6bd4a6b2-2-g5566584`
- Build `releaseTag`: none; `dirty`: `false`
- Commit date: `2026-10-22T05:32:25Z`
- Parent commit: `a4c7dbb80139e198cc4bb0c970b0238f81b52b70`
- Commit subject: `Update agent metadata and fix project structure restore logic`
- The commit is contained in local `main`. `git describe` identifies it as two commits after the fixed local tag `phase-106-baseline-6bd4a6b2`, which points to `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f`. That tag is provenance, not the tested runtime commit or release approval.
- The account owner cites `72e8ac6626be510926986b4a4b0d1761ffa5b817` as the latest `main` commit. The diff from the tested `55665848...` baseline through that commit contains documentation/agent metadata changes only; no application source, package manifests/lockfile, start/build configuration, or `lib/db` schema/migration changes were found.

### Staging test evidence and limits

The Phase 106 final report records 45 API tests, 25 bot access/STOP tests, and 4 Whop configuration tests passing. The `messages_opted_out` migration was applied and checked in Development/Staging database `heliumdb`. A synthetic PostgreSQL 16 backup/restore drill passed locally.

These are **not** evidence of a Production database restore, a real Whop Sandbox transaction, or a live Production deployment. Staging had no Whop Sandbox credentials/plan IDs, so no real Sandbox checkout/webhook/reconciliation flow was run. The local restore simulation is not a Production RPO/RTO measurement.

### Render facts currently available

**Provided by account owner:** Render service `yotbot` (Web Service), repository `gladkov-ux/yotbot`, branch `main`, pinned abbreviated SHA `5d10871`, Auto-Deploy disabled. The owner reports this is older than the tested Staging baseline.

**Unknown:** The full 40-character Render SHA, deployment ID/status/date, effective service settings, current environment-variable inventory, database identity/isolation, and redacted Render build/runtime logs. The local Git object database does not contain `5d10871`, so this plan does not claim an exact diff against it.

The local `render.yaml` names its prepared service `ah-sheli`, while the Dashboard details say `yotbot`. A Render service can be renamed; this discrepancy must be reconciled against its actual connected repository and settings.

## 2. Code, dependency, command, and schema comparison

### Code and dependencies

The checked-in application code, root/API package manifests, `pnpm-lock.yaml`, workspace configuration, build/start files, and `lib/db` schema/migration files are unchanged between the verified Staging commit `55665848...` and the account-cited `main` commit `72e8ac...`. Subsequent local commits add documentation/agent metadata only.

This verifies source-tree equivalence for those tracked paths, not that Render built or is running either commit. The actual Render pin remains an abbreviated, locally unresolved `5d10871`.

### Build and start commands

**Local Render template:**

```sh
npm install --global pnpm@10.26.1 \
  && pnpm install --frozen-lockfile --prod=false \
  && pnpm --filter @workspace/api-server run build
```

Render start command: `node index.js`

`Procfile`: `web: node index.js`

Root `package.json` start script: `node index.js`
Minimum Node version: `>=22.18`; the template specifies major version `22`, while the effective Render patch version is unknown.

The root launcher validates Production settings before importing the built API. The API serves the website and supervises one Telegram worker on internal port `18081`; do not add a separate worker service. The configured Render build invokes the API bundle build but does **not** run the root typecheck or bot/API test suites. Those checks must be run and recorded separately before any authorized release.

These are local template values, not confirmation of the live `yotbot` service's effective Build/Start settings.

### Database schema

The verified Staging change is additive:

```sql
ALTER TABLE public.ah_sheli_telegram_users
  ADD COLUMN IF NOT EXISTS messages_opted_out boolean NOT NULL DEFAULT false;
```

It is stored in `lib/db/migrations/ah-sheli-messaging-preferences.sql` and represented in the Drizzle schema with a non-null Boolean default of `false`. The migration expects the existing `public.ah_sheli_telegram_users` table; it does not create the base user table. The bot also requires `public.ah_sheli_access_notifications`.

At worker initialization, code checks for these tables and checks whether `messages_opted_out` exists. If the column is absent, the worker marks messaging-preference persistence unavailable; STOP cannot be accepted as verified protection until the migration is applied. Production schema presence and migration status are **unknown**.

The Render build/start commands contain no explicit migration step. Do not use `push-force`. The Production database owner must review the exact schema diff and approve an additive migration separately.

**Important startup-DDL finding:** API startup calls `initializeBilling()`. In Production's default live mode, this code attempts `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and index creation for billing tables, then contacts Whop, may create/reuse a Whop webhook, persists its encrypted webhook secret, and starts payment reconciliation. This happens independently of the checkout-creation switch. Other feature paths also contain lazy `CREATE TABLE IF NOT EXISTS` statements. This is a real schema/provider side effect of starting the app, not a migration performed by the Render build command; the DB owner must review it before activation.

## 3. Production environment-variable names

Names below come from the local startup validator, Render template, and feature code. **This is not a list verified in the live Render environment. No values are included.**

### Required by the cloud startup validator

- `CLOUD_CUTOVER_APPROVED`
- `NODE_ENV`
- `CLERK_AUTH_MODE`
- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `SESSION_SECRET`
- `TELEGRAM_WEBHOOK_URL`
- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- One AI provider key: `GROQ_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY`
- `PUBLIC_APP_URL`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `PORT`

If supplied, `VITE_CLERK_PUBLISHABLE_KEY` must match `CLERK_PUBLISHABLE_KEY`.

### Additional names in the Render template or required for enabled features

- Runtime/template configuration: `NODE_VERSION`, `TZ`
- Calendar, if enabled: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`
- Whop billing, if enabled on external Render: `WHOP_API_KEY`, `WHOP_COMPANY_ID`, `WHOP_PRO_PLAN_ID`, `WHOP_UNLIMITED_PLAN_ID`, `WHOP_MODE`, `BILLING_CHECKOUTS_ENABLED`
- Telegram owner fallback, only if no verified owner ID is already stored in the Production database: `TELEGRAM_ALLOWED_CHAT_ID`

The Whop sandbox names—`WHOP_SANDBOX_API_KEY`, `WHOP_SANDBOX_COMPANY_ID`, `WHOP_SANDBOX_PRO_PLAN_ID`, `WHOP_SANDBOX_UNLIMITED_PLAN_ID`—belong only in non-Production testing. Never copy Staging bot or billing credentials into Production.

The actual Production key-name inventory and presence are **unknown**. An authorized operator should check names/presence in Render without copying or displaying values.

## 4. Dedicated Production database requirements and verification

### Required design

1. Use the authoritative Production PostgreSQL database, isolated from Development/Staging `heliumdb` by separate database/cluster identity and credentials.
2. The Production API and its single supervised Telegram worker must use the same Production database. Do not run the Production bot against Staging, or run two workers with the Production bot token.
3. Require TLS, least-privilege service credentials, encrypted backups, a documented retention/PITR window, and a named database owner/operator.
4. Preserve the existing Production database and `SESSION_SECRET` if user accounts, reminders, access state, or encrypted tokens already exist. Do not create an empty replacement or copy Staging data without a separately approved data plan.
5. Ensure the base tables needed by the app exist before worker readiness; review all runtime DDL from the API/billing startup path. Apply the additive `messages_opted_out` migration through an approved DB-owner process before relying on STOP in Production.

### Read-only verification before any change

1. In Render/provider metadata, record the Production database/cluster identifier, provider, region, engine/version, owner, and app-to-database attachment. Do not expose a connection string.
2. Confirm the Staging `heliumdb` identifier is different from the Production database identifier. Confirm the Production API and worker resolve to the same Production database without printing `DATABASE_URL`.
3. Confirm backup policy, retention, encryption, available recovery points, and restore permissions from provider metadata.
4. Review schema/table/column metadata and the migration diff through an authorized read-only method. Do not read user records.
5. Before any future Production migration, the database owner must restore a Production backup to a separate restricted recovery database, validate schema/constraints and bounded counts, and record approved/measured RPO and RTO. Phase 106's synthetic local restore does not satisfy this gate.
6. Record `GO`/`NO-GO`, evidence, operator, and timestamp. Any ambiguity in database identity or isolation is NO-GO.

No Production database identity, backup, schema, or isolation was verified for this plan.

## 5. `CLOUD_CUTOVER_APPROVED`: authorization and exact runtime effect

### Verified code behavior

- The root launcher checks this variable only when the process starts. If `NODE_ENV` is Production and the value is not exactly `1`, startup throws before importing the API.
- `scripts/cloud-start.mjs` independently requires the value to be `1` and validates the required environment names/configuration.
- The local Render template sets it to `0`. The actual Render value was not provided or inspected.
- The code does not identify or authenticate an approver; this is an environment flag, not an authorization system.
- Changing the value does not alter an already-running process. The new value takes effect only when a process starts/restarts. Setting it to `0` is not a runtime stop switch: an already-running process continues until the service is stopped.

### What starting with the flag approved can do

On the next Production startup with the flag set to `1` and the other required configuration valid:

1. The API loads and binds to platform `PORT`.
2. API startup calls billing initialization. In Production this can mutate billing schema, make live Whop API requests, create/reuse a Whop webhook, persist webhook configuration, and run immediate/periodic payment reconciliation. `BILLING_CHECKOUTS_ENABLED=false` blocks new checkout creation only; it does not prevent billing initialization or verified-payment fulfillment.
3. The API starts the bot worker when Production configuration allows it. The worker connects to the Production database, acquires its exclusive worker lock, loads and persists state/reminders, and writes or reads the Telegram webhook secret.
4. With `TELEGRAM_WEBHOOK_URL` configured, the worker calls Telegram `setWebhook` and does not request dropping pending updates. It also may update bot commands/profile settings and run due reminders or an interrupted-delivery owner notice.

Therefore, setting the flag and restarting is an activation with database, Telegram, and possibly live billing side effects—not a harmless health check. This plan did not set it or start the service.

### Proposed authorization control

Before a future toggle, require recorded approval from the named Production owner and release approver; require database-owner signoff for schema/backup gates and a named incident commander for the activation window. The names/roles are not encoded in the application and must be supplied in the change record. The exact approved service, full candidate SHA/build ID, database identity, bot identity, webhook URL, checkout-switch state, rollback SHA, and time window must be recorded.

Keep the flag at its current configured value throughout preparation. The Render template's `0` is a local template default, not proof of the actual service value. Do not set it to `1` in this phase.

## 6. Controlled preparation and acceptance gates

Each gate is a separate human decision. A missing item, unclear service identity, or missing measurement means NO-GO. No gate below was executed against Production.

### Gate A — Source and Render identity

- Obtain the full 40-character deployed SHA behind Dashboard pin `5d10871`, deployment ID/status/date, and latest redacted Build/Runtime logs.
- Confirm Render service `yotbot`, repository `gladkov-ux/yotbot`, branch `main`, Root Directory, effective build/start commands, resolved Node version, health path, instance count, auto-deploy status, and effective environment-variable names.
- Compare the exact deployed SHA with `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069` and the selected candidate. Review source, dependency/lockfile, build/start, and schema differences. Do not infer from a short SHA.
- **Pass:** full source provenance is known and the candidate is explicitly selected; no Render pin or deploy is changed during this gate.

### Gate B — Build and tests

- Build from a clean checkout of the exact full candidate SHA; record build ID, full commit, release tag, and `dirty=false`.
- Run root typecheck, API tests, bot tests, and the production build separately; the Render template build command alone does not run typecheck/test suites.
- Verify manifests and `pnpm-lock.yaml` match the reviewed source. No dependency drift or unreviewed code changes.
- **Pass:** all required checks pass with evidence tied to the same full SHA/build. Failure or untracked modifications are NO-GO.

### Gate C — Database and recovery

- Confirm database isolation and service wiring using Section 4.
- Complete the isolated Production backup/restore drill and get database-owner signoff.
- Review runtime DDL and apply the additive messaging-preference migration only through a separately approved database change.
- Confirm base tables and `messages_opted_out` exist with the expected non-null/false default; confirm no destructive schema diff.
- **Pass:** Production restore evidence and schema verification meet owner-approved RPO/RTO. Missing restore evidence, destructive changes, or schema uncertainty are NO-GO.

### Gate D — Runtime identity and safety controls

- Confirm Production-only secrets/configuration by name and presence in Render; never print values.
- Confirm the Production bot token belongs to the intended bot and is not used by Staging; confirm the webhook host is the verified Production origin.
- Confirm `BILLING_CHECKOUTS_ENABLED` is explicitly false before any future app start/canary. Confirm live Whop account/plan identifiers privately if billing is in scope.
- Confirm exactly one supervised Production worker and an operator ready to stop the service. Record the known-good rollback SHA; do not assume the placeholder-serving `5d10871` is safe to roll back to until its behavior and full SHA are verified.
- **Pass:** configuration identities match; no missing, shared, or mismatched environments.

### Gate E — Post-activation acceptance tests (future, only after separate approval)

These tests are specified for a future authorized window only; they were not run here:

1. Startup succeeds on the approved full SHA; `/` returns application HTML; `/healthz` returns ready worker JSON; `/api/healthz` returns HTTP 200 JSON whose `build.commit` exactly matches the approved SHA and whose `dirty` is `false`.
2. Worker readiness and the exclusive database lock are confirmed within 120 seconds; exactly one Production worker is active.
3. Webhook readback matches the verified Production origin/path and correct bot identity; pending updates are not dropped.
4. In an explicitly approved internal Production test account, verify STOP persists across restart, suppresses bot messages, and preserves access/subscription/data; verify START resumes messaging. Do not use a real customer as the canary.
5. Keep checkout creation disabled during the canary. Verify signed/verified payment reconciliation only if authorized; no test payment or live checkout is implied by this plan.
6. Observe at least a 30-minute canary before any separate decision to enable new sales. Monitor webhook, API errors, worker readiness, message delivery, and billing reconciliation.

**Proposed numeric stop-loss thresholds** (not measured SLOs; owners must approve or replace them before activation):

- Health fails three consecutive checks 60 seconds apart after a 2-minute startup allowance, or worker/lock is absent after 120 seconds.
- Five consecutive Telegram webhook server failures, or more than 1% failures in a rolling 5-minute window with at least 20 deliveries.
- API 5xx exceeds 1% of at least 100 requests in 5 minutes, or p95 latency exceeds 2× the agreed baseline for 10 continuous minutes.
- After sales are separately enabled, checkout failures exceed 5% of at least 20 attempts in 10 minutes, or a verified payment remains unreconciled for more than 5 minutes.
- **Immediate stop** for any post-STOP message, unauthorized recipient, duplicate/misapplied payment grant, wrong bot/database/account/plan, credential exposure, duplicate worker, or unexpected/destructive database change.

If required telemetry is unavailable, do not treat missing data as zero; the acceptance gate fails.

## 7. NO-GO criteria

Remain NO-GO if any of these hold:

- Render's deployed SHA is still abbreviated/unresolved; service/repository/source/build settings do not match; placeholder continues to be served; or redacted deploy logs are unavailable.
- Required environment names/presence, Production database identity/isolation, owner/approver, or rollback target is unknown.
- `CLOUD_CUTOVER_APPROVED` state or its approved operator is unclear; any unauthorized attempt to set it to `1`.
- Production backup/isolated restore, RPO/RTO, schema review, or `messages_opted_out` migration is incomplete.
- Staging Sandbox end-to-end checkout/webhook/reconciliation remains untested when billing behavior is part of the release.
- Build identity does not match the approved full SHA, build is dirty, typecheck/tests fail, or dependency/schema drift is unexplained.
- The global outbound-message containment procedure, single-worker plan, monitoring, or approved rollback operator is unavailable.
- Any acceptance test or proposed stop-loss threshold fails.

## 8. Rollback runbook (future authorized activation only)

The exact last-known-good Render release and full SHA must be confirmed before any activation. The currently reported `5d10871` is not presumed to be a good rollback target because it serves the placeholder.

1. **Stop new sales:** set `BILLING_CHECKOUTS_ENABLED=false` in the authorized Production environment and verify it is effective. This blocks new checkout creation, not already-issued Whop links; disable/revoke affected open links through the approved Whop procedure. Continue fulfillment/reconciliation for verified completed payments when safe.
2. **Contain unsafe messaging:** the current code has no global Telegram outbound-off switch. For any post-STOP or unauthorized message, stop/scale down the complete Production Web Service that hosts both API and supervised worker. Stopping only the child bot is insufficient. This also pauses webhook handling and payment reconciliation; preserve pending events for later reconciliation.
3. **Prevent duplicate workers:** wait for the candidate process to stop and its database lock to release before starting any previous version. Keep one worker for the Production bot token.
4. **Roll back code only:** manually select/redeploy the previously verified good full SHA through the authorized Render procedure; use the same authoritative Production database and existing `SESSION_SECRET`. Keep the additive `messages_opted_out` column. Do not restore an old database snapshot as an application rollback.
5. **Database integrity incident:** halt writes if integrity is uncertain, preserve the current Production state, and restore only to an isolated recovery database for diagnosis. Replacing live Production data requires separate explicit approval and an estimate of lost writes/RPO.
6. **Recheck before reopening:** verify build identity, health, worker lock, webhook endpoint, STOP persistence, and payment reconciliation. Keep sales disabled until a separately approved billing gate.

`CLOUD_CUTOVER_APPROVED` is not a runtime kill switch. Setting it to `0` will not stop a currently running process; it only prevents the next startup. Do not toggle it as an improvised incident action. Any flag change/restart is a separately authorized Production operation.

## 9. Human approval boundary

This artifact is a preparation plan only. Phase 106's **NO-GO** remains in force. No commit was pushed or pinned, no Render setting or environment value was changed, no migration/backup/restore was run against Production, and no service, Telegram webhook, payment flow, or cutover was started. Stop here for human review and explicit approval before any operational action.
