# Phase 117 — Render Staging Infrastructure Plan

**Status:** Planning only. No Render resources were created or changed. No service was deployed or started. No Telegram, Whop, or database connections were made. No migration or database write was performed.

## 1. Candidate identity and evidence

- **Repository:** `https://github.com/giladtov-ux/yotibot.git`
- **Candidate commit:** `61b3bc748177bf955764afe0adae974fa316cb0f`
- **Branch:** `main`
- **Source verification:** At report preparation, local `HEAD` and GitHub `origin/main` both resolved to the candidate SHA; the working tree was clean before this report was added.
- **Test evidence:** Phase 116 ran the isolated Lab suite on this exact commit: 54 passed, 0 failed. API TypeScript typecheck passed. The test runner strips inherited database/provider configuration and uses mocks; these results are not live Render or provider tests.
- **Not run:** No full Render build, service startup, health probe, database connection, migration, or provider request was run for this phase.

### Verified project configuration

The candidate's root `render.yaml` describes one Node Web Service named `ah-sheli`, with:

- Build: `npm install --global pnpm@10.26.1 && pnpm install --frozen-lockfile --prod=false && pnpm --filter @workspace/api-server run build`
- Start: `node index.js`
- Health check: `/healthz`
- Auto-deploy: disabled
- `CLOUD_CUTOVER_APPROVED`: `0`

The existing manifest is **not a Staging specification**: it contains the Production app, Telegram webhook, and Google Calendar callback URLs; it has no separate Staging Postgres resource or Staging database identity pins. Do not create Staging by reusing it unchanged or by editing the Production service.

## 2. Proposed isolated resources

### PostgreSQL

1. Create a new Render PostgreSQL resource for Staging only, for example `ah-sheli-staging-db`; do not fork, share, or connect the Production database or its credentials.
2. Use a dedicated database name in the code-accepted `ah_sheli_staging` namespace. If Render cannot provide such a name, stop and obtain a code/spec review; do not weaken the guard.
3. Keep it in the same Render region as the proposed Staging Web Service where possible, and use its private/internal connection URL.
4. Record the Staging resource's exact internal host, database name, and Render resource ID (`dpg-…`) as non-secret metadata. Store the full connection URL only in the Staging service's secret configuration.
5. Start with an empty Staging database. Do not copy Production data or reuse Production roles, connection URLs, backups, or environment groups.

### Web Service

1. Create a separate Render **Web Service**, for example `ah-sheli-staging`; do not create a second worker.
2. Select the verified repository and `main` branch at the candidate commit. Keep Auto-Deploy disabled. The service must remain pinned until a human separately approves a deployment.
3. Configure the build, start, and health values listed above. The application requires Node.js 22.18 or later.
4. Use a dedicated HTTPS Staging origin whose hostname contains a `staging` label. Do not use the Production origin.
5. Attach only a Staging-specific environment group. Do not attach or synchronize the Production environment group.

## 3. Environment variable inventory

No secret values are included in this report.

### Required Staging settings

| Variable | Required setting or source |
|---|---|
| `NODE_ENV` | `production` |
| `DEPLOYMENT_ENV` | `staging` |
| `DATA_ENVIRONMENT` | `staging` |
| `CLOUD_CUTOVER_APPROVED` | `0` |
| `TELEGRAM_WORKER_ENABLED` | `false` |
| `CLERK_AUTH_MODE` | `external` |
| `DATABASE_URL` | Staging Postgres internal connection URL; store as a secret |
| `STAGING_DATABASE_HOST` | Exact Staging Postgres internal host |
| `STAGING_DATABASE_NAME` | Exact Staging database name |
| `STAGING_DATABASE_RESOURCE_ID` | Exact Staging Render Postgres resource ID |
| `PUBLIC_APP_URL` | Staging HTTPS origin |
| `STAGING_PUBLIC_APP_URL` | Same Staging HTTPS origin |
| `SESSION_SECRET` | Staging-only secret |
| `CLERK_SECRET_KEY` | Staging Clerk application only |
| `CLERK_PUBLISHABLE_KEY` | Staging Clerk application only |
| `GROQ_API_KEY` or `OPENAI_API_KEY` or `OPENROUTER_API_KEY` | A Staging-only provider key; at least one is required by startup validation |
| `PORT` | Render-provided service port |
| `NODE_VERSION` | Pin/configure Node 22.18 or later |

The database guard fails closed unless `DEPLOYMENT_ENV` and `DATA_ENVIRONMENT` both identify Staging, the runtime is `NODE_ENV=production`, `CLOUD_CUTOVER_APPROVED=0`, and `DATABASE_URL`'s host/name exactly match the independent Staging host/name/resource-ID pins. The expected host must be a Render `.render.com` hostname, the database name must use the `ah_sheli_staging` namespace, and the resource ID must match the Render `dpg-…` format. Known Production identifiers are rejected. Validation does not itself connect to the database.

### Egress authorization

These names are distinct from the cutover flag:

- `EGRESS_APPROVED`
- `EGRESS_APPROVAL_ENV`
- `EGRESS_APPROVED_BY`
- `EGRESS_APPROVAL_REF`
- `EGRESS_ALLOWED_TARGETS`
- `EGRESS_BROWSER_ALLOWED_ORIGINS` (only if a reviewed browser-origin allowlist is needed)

**Default:** leave `EGRESS_APPROVED` unset or `0`. The egress bootstrap then refuses application startup; it does not start with unrestricted networking. A later, separately approved Staging activation would require `EGRESS_APPROVED=1`, `EGRESS_APPROVAL_ENV=staging`, an accountable approver/reference, and exact `host:port` entries only. No wildcards are allowed. The Staging database's internal host on port `5432` is a candidate target; other provider targets must be identified and approved before being added. The complete required outbound-host inventory is still a gap.

### Optional integrations — omit for the initial disabled-worker Staging setup

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`
- `WHOP_SANDBOX_API_KEY`, `WHOP_SANDBOX_COMPANY_ID`, `WHOP_SANDBOX_PRO_PLAN_ID`, `WHOP_SANDBOX_UNLIMITED_PLAN_ID`
- `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `SELF_KEEP_ALIVE_URL`
- `BILLING_CHECKOUTS_ENABLED`

If later approved, Telegram must use a dedicated test bot and a Staging webhook only; no Production bot token or webhook may be reused. Whop mode is forced to Sandbox by `DEPLOYMENT_ENV=staging`. `BILLING_CHECKOUTS_ENABLED=false` is not, by itself, a startup side-effect guard: when all Whop Sandbox settings are present, the current API startup path initializes billing, issues DDL, calls Whop, and starts reconciliation. Therefore omit all Whop Sandbox credentials during initial Staging preparation. Code-level gating is needed before enabling that integration safely.

## 4. Startup, health, and isolation checks

### Fail-closed startup evidence

- `index.js` requires `NODE_ENV=production` and `CLOUD_CUTOVER_APPROVED=0` for the explicit Staging deployment identity.
- The egress bootstrap rejects missing/invalid approval before application startup and blocks network targets not on the exact allowlist.
- The database guard checks identity pins before a pool is constructed and rejects mismatched, missing, known-Production, and non-Render targets.
- `TELEGRAM_WORKER_ENABLED=false` is explicitly required for Staging and prevents the API from starting the Telegram worker.
- Phase 116's 54/54 local test suite includes mock-based checks for Staging DB identity failures, unapproved Egress dispatch, the kill switch, worker gating, and Staging startup flags. No real database or provider was contacted.

### Health-check blocker — NO-GO

The manifest's `/healthz` handler returns `503` in `NODE_ENV=production` until `telegramWorkerReady()` reports a ready bot worker. With the required `TELEGRAM_WORKER_ENABLED=false`, no worker is started, so this health check cannot become healthy as currently written. Changing the health-check URL alone is not verified to fix the behavior.

Before a Staging service can pass Render health checks, add and test a Staging-safe API readiness rule: an explicitly disabled worker must not make the API unhealthy, while Production behavior must continue to require its worker when enabled. This report does not implement that code change.

### Billing/database side-effect blocker — NO-GO for enabling Whop

API startup invokes `initializeBilling()`. In Staging it returns early without database/provider activity when the complete Whop Sandbox configuration is absent. If all Sandbox settings are supplied, the current code performs `CREATE TABLE`, `ALTER TABLE`, and index DDL, then makes Whop calls and begins reconciliation. The checkout switch alone does not prevent this initialization. Keep Sandbox settings absent until an explicit schema and integration approval, or add a code-level initialization gate first.

Other feature paths can also create schema lazily when invoked. The initial plan therefore requires an empty dedicated database, no feature/migration requests before approval, and a reviewed schema-write policy.

## 5. Stop and emergency controls

1. Keep the Telegram worker disabled and do not configure a Telegram token/webhook for the initial setup.
2. Keep Egress unset/`0` until a human approves an exact Staging target list. This intentionally halts startup; it is not a mode for a running service.
3. The process-wide `SIGUSR2` kill switch trips the Egress gate, aborts guarded requests, and signals registered child workers. Local tests cover the simulated signal path; no signal was sent in this phase.
4. If a Staging service is later running and must be stopped, use the Render Dashboard's service stop/suspend control as the external stop action. Its availability and exact UI label were not verified because no Render account was accessed. Do not rely on changing an environment variable as the immediate stop mechanism.

## 6. Acceptance sequence before any later activation

1. Confirm the repository, full SHA, clean source, and disabled Auto-Deploy.
2. Confirm a separate Staging Postgres resource and exact host/name/resource ID; verify these pins without exposing the connection URL.
3. Review all environment variable names and sources. Reject Production credentials, shared groups, Production URLs, or Production DB identifiers.
4. Run local syntax/typecheck/unit tests in the isolated Lab runner; do not use a database-backed test or provider credential.
5. Verify fail-closed cases with mocks: absent/invalid Egress approval blocks startup; an unallowlisted target dispatches no request; invalid DB identity blocks before pool construction; worker false starts no bot process.
6. Resolve the `/healthz` readiness blocker and test the Stage worker-disabled health behavior before any Render activation.
7. Keep Whop Sandbox settings absent until billing initialization is gated and DDL/schema behavior has separate approval.
8. Only after a separate human approval, configure the reviewed Egress allowlist and manually activate Staging. Confirm `/healthz` returns `200`, the build reports the expected commit, and no worker/provider actions occurred. No such live acceptance test is authorized or performed here.

## 7. Rollback plan

1. On any unexpected outbound activity, wrong DB identity, unhealthy status, or unapproved side effect, stop the Staging Web Service in Render immediately; do not wait for a code rollback.
2. If process access is available, the in-process `SIGUSR2` kill switch is an additional containment step. It is not a substitute for stopping the Render service.
3. After containment, redeploy the last-known-good **Staging** commit from the deployment history only after confirming its full SHA, tests, and Staging-only configuration. Auto-Deploy remains disabled; no force push, history rewrite, or Production rollback is part of this plan.
4. An application rollback does not reverse database schema/data changes. If Staging data must be recovered, restore only a verified Staging backup into a separate isolated Staging database; never restore into or from Production as part of this plan.
5. Backup retention, restore target, and RPO/RTO are not verified or approved yet. Complete a Staging restore drill and set owner-approved targets before retaining meaningful Staging data.

## 8. GO / NO-GO decision and remaining gaps

**GO:** Continue human review of this plan and resolve the code/configuration blockers.

**NO-GO:** Creating/activating or deploying the Render Staging service is not recommended yet because:

- The Staging-disabled Telegram worker conflicts with the current production-mode `/healthz` readiness requirement.
- Whop Sandbox credentials would activate startup DDL and outbound provider activity despite the checkout switch; an initialization gate or explicit schema/integration approval is needed.
- The actual Render Staging Postgres resource identity, service origin, region, and exact outbound allowlist have not been verified.
- No Render account metadata, environment groups, backups, or restore settings were accessed.
- No full Render build or live health check has been performed.

`CLOUD_CUTOVER_APPROVED=0` remains the required Staging setting and the candidate manifest value. Production remains **NO-GO** and untouched. Stop here and wait for human approval before creating any Render resource or making any infrastructure change.
