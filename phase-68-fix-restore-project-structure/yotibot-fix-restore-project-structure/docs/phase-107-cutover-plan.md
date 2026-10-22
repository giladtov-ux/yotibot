# Phase 107 — Phased Production Cutover Plan & Readiness Checklist

**Status:** Planning only. No Production access, configuration change, deployment, webhook change, payment, or cutover was performed while preparing this document.
**Decision:** Phase 107 does not approve a cutover. Each forward gate below requires a recorded human approval.

## 1. Known state and hard preconditions

- Phase 106 verified durable STOP behavior in Development/Staging and completed an isolated local PostgreSQL restore simulation.
- Phase 106 did **not** verify the Production database provider, backup policy, actual restore capability, or live serving service/build.
- Staging has no Whop sandbox credentials or plan IDs. Code-level sandbox isolation passed tests, but a real Sandbox checkout/webhook/reconciliation test remains pending.
- The repository contains a Render deployment template and pins the candidate origin to `https://yotibot-azbu.onrender.com`; Phase 106 did not verify that this is still the service serving Production. Treat this as a code reference, not proof of the live target.
- The Phase 106 health evidence was build `phase-106-baseline-6bd4a6b2-2-g5566584`, source commit `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`, `dirty: false`. It is evidence only, not a release approval or selected Phase 107 candidate.
- A Phase 107 candidate must be selected by exact full commit SHA and clean build ID at Gate 3. Do not move the baseline tag to identify a later release.

**No-go until resolved:** identify the actual Production service and owner; verify a real isolated Production restore; complete the Whop Sandbox test; prepare and review a clean release candidate; verify Production auth/account continuity; and prepare the kill switches below.

## 2. Approval rule for every gate

No gate advances automatically. The gate owner records:

| Approval record | Required value |
|---|---|
| Gate and decision | `GO` or `NO-GO` |
| Approver | Named person with authority over the affected service/data |
| Timestamp | UTC |
| Evidence | Build SHA/ID, health checks, backup/restore evidence, provider status, and relevant metrics |
| Scope | Exact service, database, bot identity, and action authorized |
| Stop owner | Named incident commander and backup |

A missing approver, ambiguous Production target, missing evidence, or disagreement is **NO-GO**. Approval for one gate does not authorize a later gate.

## 3. Required Production credentials and configuration

Store sensitive values only in the verified Production provider's secret manager. Never copy Development/Staging values into Production, put values in source control, or paste them into chat or logs. The actual service must be confirmed at Gate 0 before choosing a secret store.

### Required runtime secrets

| Name | Required purpose and constraint |
|---|---|
| `DATABASE_URL` | TLS-enabled connection to the authoritative Production PostgreSQL database. The API and its supervised bot worker must use the same existing Production database. Do not point either process at `heliumdb` or another Development database. Use the provider-generated value; do not print it. |
| `TELEGRAM_BOT_TOKEN` | Token for the existing Production bot only. Never use the Staging/test bot token in Production or register the Production token against a Development URL. |
| `SESSION_SECRET` | Preserve the existing Production value to keep session/link validation and encrypted Google Calendar tokens readable. Do not rotate it as part of a routine cutover. |
| `CLERK_SECRET_KEY` | Secret key for the separately configured external Clerk application when `CLERK_AUTH_MODE=external`. Replit-managed Clerk credentials are not portable to external hosting. |
| One AI provider credential | `GROQ_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` is required by the cloud startup validator. Choose the provider already validated for the release; `GROQ_API_KEY` is specifically used for voice transcription. |
| `WHOP_API_KEY` **or** Production Whop connection | For the Render/external-host path, provide a Production live API key. For a confirmed Replit-hosted deployment, use its authorized Production Whop connection instead. Do not mix identities or rely on Replit connector credentials from an external host. |

### Required identifiers and conditional credentials

| Name | Requirement |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | External Clerk application's publishable key. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Build-time public key; if set, it must match `CLERK_PUBLISHABLE_KEY`. Publishable keys are identifiers, not secret credentials. |
| `WHOP_COMPANY_ID` | Must identify the same Production Whop account as the selected live credential/connection. |
| `WHOP_PRO_PLAN_ID`, `WHOP_UNLIMITED_PLAN_ID` | Production plan IDs, reviewed for currency, price, renewal interval, and account ownership before sales are enabled. Never use Sandbox IDs. |
| `TELEGRAM_ALLOWED_CHAT_ID` | Production owner chat ID if there is no verified `ah_sheli_config.allowed_chat_id` in the Production database. Check for an existing owner first; do not replace it with a Staging/test ID. Treat the value as confidential configuration. |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Required if Calendar is enabled. The OAuth client must allow the verified Production callback URI. |

### Required non-secret runtime configuration

- `NODE_ENV=production`
- `CLERK_AUTH_MODE=external`
- `PUBLIC_APP_URL` set to the verified Production origin
- `TELEGRAM_WEBHOOK_URL` set to that origin plus `/telegram/webhook` (HTTPS only)
- `GOOGLE_CALENDAR_REDIRECT_URI` set to the verified Production callback if Calendar is enabled
- `WHOP_MODE=live` only after Production Whop identity/plan checks pass
- `BILLING_CHECKOUTS_ENABLED=false` during deployment and the initial canary
- `CLOUD_CUTOVER_APPROVED=0` until the final activation gate; the cloud launcher refuses Production startup unless it is explicitly `1`
- `PORT` provided by the serving platform; `TZ=Asia/Jerusalem` as specified by the deployment template

For this repository's current Render template, the expected values are pinned to `https://yotibot-azbu.onrender.com` and `https://yotibot-azbu.onrender.com/telegram/webhook`. Use them only if Gate 0 confirms that Render and this origin are still the approved live target. A target or domain change requires a reviewed code/config update before cutover.

If Replit is confirmed as the Production host, Production secrets are managed separately from Development in **Publishing → Adjust settings → Production app secrets**. Publishing/republishing syncs those Production values to the deployment. Do not infer that Replit is the live host from the Development workspace.

## 4. Phased cutover gates

### Gate 0 — Confirm authority, target, and rollback owner

1. Identify the currently serving Production provider/service, public origin, current full commit/build ID, deployment owner, database provider/identifier/region, current bot identity, and current webhook endpoint using read-only evidence.
2. Compare that evidence with the repository's Render template and pinned origin. Resolve any mismatch; do not switch a webhook or start a second service while uncertain.
3. Name the incident commander, database owner, release operator, and approver for each later gate.
4. Record the provider-specific last-known-good rollback procedure and confirm who can execute it.

**Pass evidence:** service and database identities independently confirmed; one rollback owner and exact known-good build documented.
**Approval required:** Production owner and release approver sign Gate 0.

### Gate 1 — Complete recovery and data-integrity readiness

1. The Production database owner verifies backup cadence, retention, PITR range, encryption, access, and restore authorization.
2. Complete a restore from a real Production backup/PITR point into a separate, access-restricted recovery instance. Do not restore over Production or Development.
3. Validate expected schemas, constraints/indexes, and bounded row counts without exporting records. Record observed RPO/RTO; the Phase 106 local simulation is not a substitute.
4. Review the Production schema diff for the additive `messages_opted_out BOOLEAN NOT NULL DEFAULT false` change. Confirm there are no drops, renames, type rewrites, or unrelated data changes. For Replit-managed Production DB, use the Publish schema review; for an external DB, use its approved migration process. Never use Drizzle `push-force` or startup-time DDL.

**Pass evidence:** provider restore record, measured RPO/RTO within owner-approved limits, and reviewed additive-only schema plan.
**Approval required:** database owner and Production owner sign Gate 1.

### Gate 2 — Verify Production identity and secrets

1. Add the required Production-only secrets/configuration from Section 3 to the verified Production provider. Keep `CLOUD_CUTOVER_APPROVED=0` and `BILLING_CHECKOUTS_ENABLED=false`.
2. Verify the Production database URL resolves to the authoritative existing Production database; never disclose the URL.
3. Verify the production bot token belongs to the intended bot, the owner identity is correct, and no Staging/test bot or webhook is involved.
4. Verify external Clerk tenant, production domain allow-list, publishable-key match, and existing account-link continuity. Do not assume that copying Replit-managed Clerk keys migrates users.
5. Verify Whop live credential/connection, company ID, and both plan IDs against the intended account and prices. Keep checkout disabled.
6. Verify Google OAuth redirect and Calendar credential if the feature will be enabled. Verify App Storage compatibility if user data depends on Replit App Storage.

**Pass evidence:** secret-name inventory and provider screenshots/status references with values redacted; key/account/plan identities and redirects match.
**Approval required:** auth, billing, and Production owners sign Gate 2.

### Gate 3 — Select and validate the release candidate

1. Select an exact full commit SHA; build from a clean tree and record `/api/healthz` build ID, `commit`, `releaseTag`, and `dirty=false`.
2. Verify the approved source is the code intended for the confirmed Production service. Ensure the baseline tag remains attached to its original commit.
3. Run the bot/API suites, typecheck, build, schema-diff review, and security checks. Resolve all blocking failures; document accepted non-blocking items.
4. Complete Staging verification, including a real Whop Sandbox checkout/webhook/reconciliation test with test credentials only, STOP/resume against the Staging database, and a verified backup/restore drill.

**Pass evidence:** signed release record and test output linked to the exact SHA/build ID; no live billing calls from Staging.
**Approval required:** release approver signs Gate 3.

### Gate 4 — Production preflight and maintenance window

1. Announce the approved maintenance window and freeze unrelated releases/schema changes.
2. Take or verify a fresh completed Production backup and confirm the isolated recovery path is still available.
3. Confirm the candidate's Production secrets are present by name only; never print values.
4. Confirm `BILLING_CHECKOUTS_ENABLED=false`, `CLOUD_CUTOVER_APPROVED=0`, correct public origin/webhook, no active duplicate worker, and a tested operator access path to the kill switches.
5. Confirm rollback trigger thresholds in Section 5 and that telemetry can measure them. Missing telemetry is not a passing result.

**Pass evidence:** timestamped preflight checklist, backup ID/status, and rollback operator on call.
**Approval required:** incident commander and Production owner sign Gate 4.

### Gate 5 — Apply only the reviewed Production schema change

1. With an explicit Gate 5 approval, apply the reviewed additive column migration to the authoritative Production database using that provider's supported mechanism.
2. Verify the column type, `NOT NULL`, and `false` default; compare row counts and confirm no existing records were deleted or rewritten.
3. If the schema review shows any rename/drop/other destructive action, stop and return to Gate 1. Do not force the diff.

**Pass evidence:** migration result, before/after row counts, and read-only schema verification.
**Approval required:** Production database owner and incident commander sign Gate 5.

### Gate 6 — Single-worker service switch, sales still disabled

1. With a separate approval, stop the old Production bot worker gracefully and confirm its database lock is released. Never run two workers with the same bot token.
2. Start the approved candidate on the confirmed Production service with Production-only credentials, `BILLING_CHECKOUTS_ENABLED=false`, and—only for this authorized gate—`CLOUD_CUTOVER_APPROVED=1`.
3. Allow the candidate to register only the verified Production HTTPS Telegram webhook. Do not drop pending Telegram updates.
4. Confirm one active worker/lock, `/healthz` and `/api/healthz`, exact webhook URL, correct bot identity, and no duplicate process.

**Pass evidence:** live health/readiness, worker lock, webhook readback, and matching build SHA/ID.
**Approval required:** incident commander approves the webhook/service switch before it occurs.

### Gate 7 — Restricted canary with checkout disabled

1. Monitor service and webhook health for at least 30 minutes; keep new checkout disabled.
2. Using only a pre-approved internal Production test account, verify `/stop` persists and suppresses normal messages and `/start` resumes them. Record the test and account authorization without exposing personal data.
3. Verify account isolation, registration/login, reminder persistence, and verified-payment reconciliation without initiating a payment.
4. Verify no duplicate worker, webhook replay, unexpected message, or account/plan mismatch.

**Pass evidence:** agreed telemetry window and test checklist, with no hard-stop event.
**Approval required:** business owner and incident commander approve moving to sales enablement.

### Gate 8 — Enable new sales

1. Confirm all open/old checkout URLs have been assessed; the application switch blocks new checkout creation but does **not** invalidate already-issued Whop purchase URLs.
2. With explicit billing-owner approval, set `WHOP_MODE=live` and then `BILLING_CHECKOUTS_ENABLED=true` in the verified Production environment. Never enable sales from Staging.
3. Verify the authorized Production status reflects the live account and checkout-enabled state. Monitor checkout, webhook, and fulfillment metrics continuously.

**Pass evidence:** verified live account/plan selection, switch state, and active monitoring.
**Approval required:** named billing owner approves sales enablement; this is a separate decision from Gate 6.

### Gate 9 — Stabilize and close

1. Maintain active monitoring for 24 hours, with a documented on-call owner.
2. Reconcile all verified payments and pending confirmations; investigate every duplicate, missing grant, or unexpected message.
3. Record final build SHA/ID, schema version, provider IDs (non-secret identifiers only), all approvals, and incidents.
4. Close only after the Production owner signs the evidence. Otherwise roll back or keep sales disabled.

## 5. Stop-loss criteria, kill switches, and rollback

### Immediate stop-loss criteria

Any one of these is a hard stop; do not wait for a window or an additional forward-gate approval:

- Wrong Production service, database, bot identity, Whop account/plan, public origin, or release SHA/build ID.
- Any Production credential or user data appears in logs, source control, or a Staging environment.
- Any message is sent after the approved test account has persisted STOP, or to an unauthorized recipient.
- Any duplicate payment grant, wrong amount/plan/account, unverified payment fulfillment, or unrecognized live checkout.
- A destructive/unreviewed database diff, row loss, unexpected schema mutation, or database integrity error.
- More than one active bot worker/lock or a webhook pointing at the wrong service.
- `/healthz`/`/api/healthz` fails for three consecutive 60-second checks after the 2-minute startup allowance, or worker readiness/lock is absent after 120 seconds.
- Telegram webhook has five consecutive server failures or more than 1% failures in a rolling 5-minute window with at least 20 deliveries.
- After sales are enabled: checkout failures exceed 5% of at least 20 attempts in a rolling 10-minute window, or any verified payment is not reconciled within 5 minutes.
- API 5xx exceeds 1% of at least 100 requests in a rolling 5-minute window, or p95 latency exceeds 2× the agreed baseline for 10 consecutive minutes.

At Gate 4, the owners must approve these thresholds or replace them with stricter measured values. If the necessary metrics cannot be observed, the gate fails.

### Immediate kill-switch sequence

The named incident commander is pre-authorized to stop forward progress and invoke these actions immediately after a trigger; notify the Production owner as soon as the service is contained.

1. **Block new sales:** set `BILLING_CHECKOUTS_ENABLED=false` in the actual Production environment. Verify the running service reports checkout disabled; if the platform requires a restart/redeploy for the value to take effect, do so using the approved service procedure. This switch blocks new checkout creation while verified completed payments can still be fulfilled; keep webhook/reconciliation processing active when safe.
2. **Handle existing checkout links:** the code switch does not invalidate previously issued Whop URLs. Through the approved Whop account procedure, disable/revoke affected open checkout configurations and verify they cannot be used. Keep a record of pending/verified payments for later reconciliation.
3. **Stop unsafe Telegram delivery:** there is no global `TELEGRAM_OUTBOUND_ENABLED` switch in the current code. If any unauthorized or post-STOP messages occur, stop/scale to zero the complete Production service that hosts both API and supervised bot worker; stopping only the child bot worker is insufficient because the API can also send payment confirmations. This also pauses webhook handling and payment reconciliation, so preserve pending events and reconcile them before reopening.
4. **Prevent duplicate execution:** confirm the candidate process stopped and its worker lock released before starting any previous version. Keep exactly one active worker for the Production bot token.
5. **Restore the last-known-good code:** use the provider-specific rollback approved at Gate 0 and record the exact restored SHA/build. Keep the same authoritative Production database and existing `SESSION_SECRET`; the additive `messages_opted_out` column should remain in place.
6. **Database incident:** halt writes if integrity is uncertain, preserve a fresh copy of the current Production state, and restore only into an isolated recovery database for diagnosis. Never overwrite Production from an old snapshot as a code rollback. A live Production data restore requires a separate explicit approval and loss estimate.
7. **Token compromise:** if a Production token is compromised, revoke/rotate it only under the security incident process, then verify the bot identity and re-register the webhook at the approved Production URL. Never use token rotation as a routine rollback step.

### Provider-specific rollback constraint

- **Render/external service:** the repository template uses one always-on service, `autoDeployTrigger: off`, and one supervised bot worker. At Gate 0, record the exact last-good deployment/commit rollback action in the serving provider and test access to it. Do not assume the template proves which service is currently live.
- **Replit Deployment, if Gate 0 confirms it is the actual Production host:** Replit does not provide an in-place deployment rollback; rollback requires restoring the project to the approved earlier checkpoint and publishing again. This is a separate approved operation.
- Never restore an old database snapshot merely to roll back application code.

## 6. Current authorization boundary

This file is a plan only. No gate has been approved by it. No Production secrets were inspected, requested, or changed; no Production database, deployment, webhook, checkout, or Telegram user was touched. The Phase 106 NO-GO remains in effect until the required evidence and explicit gate approvals are recorded.

## References

- `docs/phase-106-final-readiness-report.md`
- `docs/production-db-backup-restore-verification.md`
- `docs/release-tracking.md`
- `CLOUD_DEPLOYMENT.md` and `render.yaml` (deployment preparation references; verify against the actual live target)
- Replit Production secrets: https://docs.replit.com/core-concepts/project-editor/app-setup/secrets
- Replit rollback guidance: https://docs.replit.com/help/troubleshooting/deployments
