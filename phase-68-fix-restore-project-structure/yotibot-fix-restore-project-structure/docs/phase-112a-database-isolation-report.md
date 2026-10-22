# Phase 112A: Database Isolation Verification and Containment

## Decision

**NO-GO for further database-backed testing. The exact database target used by the earlier test process is UNKNOWN, with strong evidence that it may have been Production.**

Read-only metadata collected in this review identifies the current Replit runtime as `production`; its `DATABASE_URL` metadata resolves to PostgreSQL host `helium` and database `heliumdb`. No URL, username, password, or other credential was displayed. The earlier test process had `DATABASE_URL` present and the test code consumes that variable directly. The test process did not save its own environment snapshot, so the exact historical target cannot be proven from the available evidence. Treat the earlier run as a possible Production database access until the system owner verifies it.

After that discovery, no database connection, database query, migration, application startup, full test suite, cleanup, or data correction was attempted. Only source inspection, an isolated guard test using synthetic values, typechecking, and a build were performed.

## Stage A — Halt and evidence preservation

### Previous test command and process

The earlier command was:

```text
pnpm --filter @workspace/ah-sheli-bot test
```

At the time, the bot package script invoked `node --test`. The pnpm script launched Node’s test runner and its test-file workers. No process IDs or historical process tree were captured, and no app workflow was started for that test run.

The recorded runner summary was:

```text
tests 541
pass 528
fail 0
cancelled 0
skipped 4
todo 9
```

The nine TODO cases were reminder/DST cases and were not changed. The available output excerpt also included a “failing tests” diagnostic section for reminder/DST cases after the zero-failure summary; the original full output was not available later to reconcile that runner formatting. A prior shell-output artifact’s metadata showed 97,161 bytes and a modification time of 2026-10-22 08:36:01 UTC, but its content could not be retrieved on follow-up. No output was intentionally deleted or edited.

### Read-only target evidence

| Evidence | Finding |
|---|---|
| Environment variable names in the current shell | `DATABASE_URL`, `REPLIT_DB_URL`, `REPLIT_ENVIRONMENT` were present; values were not printed |
| Current runtime classification | `REPLIT_ENVIRONMENT=production`; `NODE_ENV` and `DATA_ENVIRONMENT` were absent |
| Current `DATABASE_URL` metadata | PostgreSQL host `helium`, default port, database `heliumdb` |
| Historical test process target | **UNKNOWN**: its exact environment snapshot was not retained |
| Likely relationship | The test process inherited `DATABASE_URL`, and the current runtime’s URL metadata identifies `helium/heliumdb`; this is strong risk evidence, not proof that the historical process used the identical mapping |

No Replit database, Render account, provider dashboard, or database connection was accessed in this phase. The host/database metadata above was derived locally without printing the connection string. Host/database identity does not by itself prove which business environment owns that resource.

### Database connection source and test activity

The earlier bot tests were enabled by `skip: !process.env.DATABASE_URL` guards. The confirmed test `artifacts/ah-sheli-bot/test/appointment-flow.test.js` imports `getPool()`, opens a PostgreSQL client, creates a session-local `TEMP TABLE ah_sheli_state`, persists fixture state to that table, reads it back, then force-releases the client and closes the pool.

Other database-gated tests found in source use temporary tables or dynamically named schemas. The email-link and shared-list tests create schemas and include `DROP SCHEMA ... CASCADE` cleanup in `finally` blocks. This is evidence of database writes and catalog activity during test execution, even though the test fixtures are isolated from application tables by their SQL setup.

**Write evidence status:**

- Database connections and test-fixture writes are confirmed by the test source and the passing PostgreSQL integration result recorded for the earlier run.
- The appointment-flow test writes to a temporary table scoped to its database session; closing the session drops that table.
- Other database tests use temporary objects or generated schemas and include cleanup code.
- No evidence was found in the inspected test code of writes to persistent business tables.
- Whether all cleanup completed and whether any temporary-schema residue remains is **UNKNOWN**. This was not checked against the database, and no cleanup was attempted.

## Stage B — Configuration and isolation findings

### Verified source wiring

- `artifacts/ah-sheli-bot/src/database.js` supplies the bot query pool and worker-lock connection.
- `lib/db/src/index.ts` supplies the API PostgreSQL pool.
- `lib/db/drizzle.config.ts` supplies the Drizzle migration connection.
- The earlier implementation used the generic `DATABASE_URL` directly in those paths, without validating the declared environment or database identity.
- Bot SQL integration tests were conditional on `DATABASE_URL`; the optional worker-lock tests used it directly, and the opt-in lock test has now been changed to validate the environment before constructing a client.
- Replit runtime environment-name inventory from this review included `DATABASE_URL` and `REPLIT_DB_URL`. Presence of these names does not establish isolation or database ownership.
- Earlier Phase 110 findings recorded `DATABASE_URL` as runtime-managed/present in Shared, Development, and Production views, while the effective endpoint mapping remained unknown.

### Remaining infrastructure gaps

- The historical test process’s exact host/database mapping is not proven.
- The current `helium/heliumdb` resource’s owner and relationship to Production, Staging, or Lab are not independently confirmed by provider metadata.
- No verified, isolated Lab database URL is configured in this workspace.
- Staging database identity is not verified; application access to `DATA_ENVIRONMENT=staging` is therefore blocked by the new code.
- The code cannot independently prove that a future Production `DATABASE_URL` points to the owner-approved Production resource. That still requires owner-supplied provider metadata and review.

## Stage C — Lab-only isolation enforcement

### Code changes

- Added `scripts/database-isolation.mjs` as the centralized database identity gate.
- Lab database access requires `DATA_ENVIRONMENT=lab`, `NODE_ENV=test` or `development`, a matching explicit `LAB_DATABASE_URL` and `DATABASE_URL`, and a PostgreSQL URL whose host is loopback (`localhost`, `127.0.0.1`, or `::1`). A Production-classified Replit runtime is rejected for Lab access.
- Staging database connections fail closed until the target has been independently verified and an explicit safe configuration is designed.
- Production database access requires `DATA_ENVIRONMENT=production`, `NODE_ENV=production`, and `DATABASE_URL`; a development-classified Replit runtime is rejected.
- API pool creation, bot pool creation, bot worker-lock creation, the Drizzle config, and the optional direct worker-lock integration test now validate the identity before constructing a database client.
- Added `scripts/run-lab-tests.mjs`; both bot and API package test scripts now invoke it. The child test process receives only an allowlist of ordinary runtime variables, has `NODE_ENV=test` and `DATA_ENVIRONMENT=lab`, and never inherits generic `DATABASE_URL`, `REPLIT_DB_URL`, production Secrets, or `NODE_OPTIONS`. A `LAB_DATABASE_URL` is forwarded only after local-host validation.
- With no approved local Lab URL, the test process receives no database URL. Existing DB-gated tests then skip; an attempted pool/client creation fails before a PostgreSQL client is constructed.

This is an intentional fail-closed behavior. Development services and tests that previously relied on the generic `DATABASE_URL` will now stop until explicitly configured for Lab. Staging is blocked pending independent target verification. No Production setting was updated.

## Verification performed in this phase

All checks below were isolated from the inherited Replit environment. No database connection was made.

| Check | Result |
|---|---|
| `env -i ... node --test scripts/database-isolation.test.mjs` | **7 passed, 0 failed**. Tests cover filtered environment inheritance, local-only Lab URL acceptance, remote URL rejection, missing/mismatched/wrong-mode identity, pool-factory non-invocation on failure, and bot pool startup rejection before construction |
| Test-runner smoke command | **Passed**. Child reported `NODE_ENV=test`, `DATA_ENVIRONMENT=lab`, and `DATABASE_URL`, `REPLIT_DB_URL`, Clerk/Telegram secret names, and `REPLIT_ENVIRONMENT` absent |
| `pnpm --filter @workspace/api-server run typecheck` | **Passed** |
| `pnpm --filter @workspace/api-server run build` | **Passed** |
| `node --check` for the changed bot database module, worker-lock test, and isolation scripts | **Passed** |
| Full bot or API test suite after containment | **Not run**, as required |
| Database, migration, app workflow, external provider, or production action | **Not run** |

The unit test’s “Production” and remote database values are synthetic fixtures only. The smoke test prints booleans and environment classifications, not credentials or connection strings.

## Required owner review and next steps

1. Using authorized provider-side audit/connection metadata, determine whether the earlier test process connected to the `helium/heliumdb` resource and whether that resource is Production. Review the prior-run time window and the test account’s connection history; do not share a connection string or credential.
2. Confirm whether test-created temporary schemas were cleaned up. Do not attempt cleanup or data correction until the database owner confirms the target and approves the action.
3. Independently identify an isolated Lab database. The current code intentionally accepts only a local loopback PostgreSQL target for Lab; no Lab URL is configured.
4. Provide verified, non-secret Staging database resource identity before implementing any Staging connection path. Staging remains blocked.
5. Separately verify the Production resource identity before any later Production operation. This report does not authorize one.

## Final status

**NO-GO for further database-backed testing or claims of complete isolation.** The historical test target remains UNKNOWN and is a potential Production-access incident. The code now blocks unverified Lab/test access before client construction, strips inherited Production database settings from package test runs, and blocks Staging database access pending verification. Human review is required before any further database access or testing.

No database query, cleanup, migration, Secret change, Render change, Production flag change, workflow restart, deployment, or cutover was performed in Phase 112A.
