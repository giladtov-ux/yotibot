# Phase 110: Secrets Segregation and Database Isolation Verification

## Executive result

**Complete Production/Staging data isolation is not verified. Status: NO-GO for claiming isolation.**

The source uses `DATABASE_URL` directly for both API and bot PostgreSQL pools, without checking that the URL belongs to the current environment or differs from Production. The read-only Secrets-existence audit reports the same sensitive names in Shared, Development, and Production. Their values and the runtime-managed database endpoints were not inspected, so this audit does not prove a credential leak or that both environments reach the same database; it does show that strict separation cannot be established from names alone.

No database connection, provider connection, or network request was made. No environment value, connection string, Secret value, Production setting, or cutover flag was read or changed.

## Production key-name inventory

Names below are taken from the local Production startup validator, Render environment-key names, and application feature configuration. **Only names are listed; no values are included.** A name being required by code does not establish that a value is configured or isolated.

### Required to pass the Production startup validator

- `DATABASE_URL` — runtime-managed PostgreSQL connection setting.
- `TELEGRAM_BOT_TOKEN`
- `SESSION_SECRET`
- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY` — public key/configuration, not a secret.
- `TELEGRAM_WEBHOOK_URL` — endpoint configuration, not a secret.
- At least one AI provider key: `GROQ_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY`.

### Production billing and optional integrations

- Whop direct credential: `WHOP_API_KEY`; source also supports a Replit connector fallback using `REPLIT_CONNECTORS_HOSTNAME` and runtime identity variables `REPL_IDENTITY` or `WEB_REPL_RENEWAL`.
- Optional Google Calendar credential: `GOOGLE_CALENDAR_CLIENT_SECRET`; `GOOGLE_CALENDAR_CLIENT_ID` is also required to enable that feature.

### Other required Production configuration names

- `NODE_ENV`
- `CLERK_AUTH_MODE`
- `PORT`
- `PUBLIC_APP_URL`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `CLOUD_CUTOVER_APPROVED`
- `VITE_CLERK_PUBLISHABLE_KEY` — optional build-time public key that must match the runtime publishable key when set.

The Phase 109 startup gate also requires the names `EGRESS_APPROVED`, `EGRESS_APPROVAL_ENV`, `EGRESS_APPROVAL_REF`, `EGRESS_APPROVED_BY`, and `EGRESS_ALLOWED_TARGETS`; `EGRESS_BROWSER_ALLOWED_ORIGINS` is optional. These are authorization/configuration fields, not provider credentials. Their effective values were not inspected.

The Whop configuration code also references `WHOP_MODE`, `WHOP_COMPANY_ID`, `WHOP_PRO_PLAN_ID`, and `WHOP_UNLIMITED_PLAN_ID`. The separate sandbox-only names are `WHOP_SANDBOX_API_KEY`, `WHOP_SANDBOX_COMPANY_ID`, `WHOP_SANDBOX_PRO_PLAN_ID`, and `WHOP_SANDBOX_UNLIMITED_PLAN_ID`.

## Read-only Secrets and environment audit

The Replit Secrets audit used `viewEnvVars` with `type: "secret"` for Shared, Development, and Production. It returned existence metadata only; no values were returned or inspected. Ordinary environment-variable values were not queried.

| Secret name | Shared | Development | Production | Notes |
|---|---:|---:|---:|---|
| `CLERK_SECRET_KEY` | Present | Present | Present | Same name is visible in Shared and both environment views; values/overrides unknown |
| `SESSION_SECRET` | Present | Present | Present | Same name is visible in Shared and both environment views; values/overrides unknown |
| `TELEGRAM_BOT_TOKEN` | Present | Present | Present | Same name is visible in Shared and both environment views; values/overrides unknown |
| `DATABASE_URL` | Runtime-managed/present | Runtime-managed/present | Runtime-managed/present | Endpoint, database name, and effective per-environment mapping are unknown |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Not found as a Replit Secret | Not found | Not found | Could exist in another configuration system; not checked |
| `GROQ_API_KEY` | Not found as a Replit Secret | Not found | Not found | Production validator requires one AI provider key; Render values were not inspected |
| `OPENAI_API_KEY` | Not found as a Replit Secret | Not found | Not found | Same limitation |
| `OPENROUTER_API_KEY` | Not found as a Replit Secret | Not found | Not found | Same limitation |
| `WHOP_API_KEY` | Not found as a Replit Secret | Not found | Not found | Connector fallback may supply billing credentials |
| `WHOP_SANDBOX_API_KEY` | Not found as a Replit Secret | Not found | Not found | Sandbox-specific; no values checked |
| `REPL_IDENTITY` | Not found as a Replit Secret | Not found | Not found | Runtime environment availability was not checked |
| `WEB_REPL_RENEWAL` | Not found as a Replit Secret | Not found | Not found | Runtime environment availability was not checked |

“Not found as a Replit Secret” means only that the name was absent from the Secret inventory for that scope. It does not establish absence from Render configuration, non-secret environment variables, or a connected-provider flow. `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` are public configuration keys and were not treated as secret values.

## Database wiring and isolation findings

### Verified from local source

- `lib/db/src/index.ts` creates the API PostgreSQL pool from `process.env.DATABASE_URL`.
- `artifacts/ah-sheli-bot/src/database.js` creates both the bot pool and worker-lock connection from the same `process.env.DATABASE_URL`.
- `lib/db/drizzle.config.ts` also uses `process.env.DATABASE_URL`; it has no local URL fallback.
- The Production startup validator checks that `DATABASE_URL` is present. It does not compare the host, database name, schema, or environment identity.
- The root Production cutover guard and `NODE_ENV` checks do not prevent a Development process from receiving a Production database URL.
- The Phase 109 egress allowlist can constrain destinations, but it does not identify which database is Staging versus Production. A Development allowlist could still approve a Production database host if configured that way.
- `render.yaml` lists `DATABASE_URL` as an environment variable name but declares no database resource and no `fromDatabase` mapping. It therefore does not provide local evidence of a distinct Production database instance.
- No environment-specific database schema or separate `PGHOST`/`PGDATABASE` selection was found in the inspected application wiring. API and bot use the same URL-selected PostgreSQL database.

### Not verified

- Whether the Development/Staging runtime-managed `DATABASE_URL` points to a distinct database host/name from Production.
- Whether Production has a separate PostgreSQL instance, separate credentials, or a separate schema.
- Whether environment-specific Secrets override or coexist with the names present in Shared.
- Which database resource Render currently uses. Render service settings and runtime values were not accessed.

**Isolation decision:** Application-level prevention is **FAIL** (there is no code check that rejects a Production database URL outside Production). Actual cross-environment connectivity and physical database separation are **UNKNOWN** because connection values and provider metadata were intentionally not inspected.

## Checked-in credentials and local fallbacks

Static local checks found:

- No tracked `.env` or `.env.*` files and no matching local `.env` files outside dependency/generated directories.
- No tracked matches for PostgreSQL connection-string literals, PEM private-key headers, or common provider-token prefixes in the checked source/configuration files. The scan printed filenames only and found no matches.
- The Render configuration contains environment variable names, including `DATABASE_URL`; its values were not printed or inspected.
- The database library and Drizzle configuration require `DATABASE_URL` from the process environment; no hardcoded connection-string fallback was found in those files.

**Result:** No checked-in live credentials or connection strings were detected by these scoped checks. This is not a full entropy-based secret scan and cannot prove that every possible encoded or novel credential pattern is absent.

## Verification boundary and remaining gaps

- **Static source analysis:** Completed for database pool creation, Production startup validation, Render environment-key names, and relevant environment references.
- **Environment audit:** Secret existence/status only across Shared, Development, and Production. No Secret values or ordinary environment-variable values were viewed.
- **Repository/config scan:** Tracked environment-file check and filename-only scan for common connection-string/private-key/provider-token patterns; no matches.
- **Database/provider tests:** None. No database connection, query, mutation, network request, or provider call was attempted.
- **Production/Render metadata:** Not accessed. The local `render.yaml` is not proof of live Render configuration.

The strongest unresolved issue is the shared `DATABASE_URL` name: until the owner verifies distinct effective endpoints through approved, redacted metadata and removes any inappropriate Shared scope, Staging/Development isolation cannot be certified. The same applies to shared secret names; name-only presence does not prove distinct values. This report does not authorize reading or changing those values.

## Required owner evidence before claiming isolation

1. Confirm—using a trusted environment/database metadata view that does not reveal credentials—that Development/Staging and Production resolve to different database instances (at minimum distinct provider resource identifiers and database names; host fingerprints may be redacted).
2. Confirm each environment’s effective `DATABASE_URL` source and scope without exposing the URL, username, or password.
3. Confirm Production-only credentials are not inherited from Shared and that Staging has its own Telegram bot token, database credential, Clerk secret, and any provider credentials.
4. Confirm the Production database is not reachable using the Development/Staging identity and that the Staging identity cannot read Production Secrets.
5. Record whether Render has a dedicated Production database and identify the non-secret resource name only.

No settings, Secrets, database records, webhooks, Production flags, or deployment state were changed. No live connections were made. Human review is required; no deployment or cutover was initiated.
