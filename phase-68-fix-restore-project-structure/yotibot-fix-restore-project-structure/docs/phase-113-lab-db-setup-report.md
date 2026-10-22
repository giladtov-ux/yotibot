# Phase 113 — Isolated Lab Database Setup & Guard Verification

## Status

**PASS — isolated mock/guard verification.** The standard bot/API test entry points now fail closed on known Production database identifiers, strip inherited credentials and connection configuration from child test processes, and run the local guard and in-memory teardown checks.

**NOT RUN — PostgreSQL connectivity or SQL integration tests.** This phase did not create or connect to any PostgreSQL instance. This report is not approval for Staging or Production database use, deployment, or cutover.

## Lab architecture and safeguards

- `scripts/database-isolation.mjs` is the shared database policy. It rejects the known `helium` host and `heliumdb` database, as well as delimited `prod`, `production`, and `live` identifiers. It checks URL targets and common `PGHOST` / `PGDATABASE` / service and host-name environment fields without printing their values.
- A test process is recognized by `NODE_ENV=test` or Node's `NODE_TEST_CONTEXT`. A database-backed test connection then requires `DATA_ENVIRONMENT=lab`, explicit `LAB_SQL_TESTS_ENABLED=1`, a non-Production runtime, identical `LAB_DATABASE_URL` and `DATABASE_URL`, a loopback host, and a database named in the `ah_sheli_lab` namespace.
- Staging database access remains blocked by the guard. Missing or mismatched Lab configuration fails before a pool/client is constructed.
- `scripts/run-lab-tests.mjs` builds a child environment from an allowlist rather than inheriting the parent environment. Secrets and database URLs are not passed to test processes. It aborts on known Production identifiers and refuses `LAB_DATABASE_URL` or the SQL opt-in in the standard test path; that path is mock-only.
- Both bot and API package test scripts use this runner. It includes the database guard and memory-harness tests with the package tests. SQL-backed bot tests remain separately gated and are not enabled by the standard runner.
- The in-memory Lab fixture in `scripts/lab-memory-database.mjs` stores test schemas/tables in per-instance maps. It registers `teardown()` with the Node test context, clears its data at test completion, and rejects later operations. It uses no PostgreSQL driver or sockets.
- The application database entry points inspected are `lib/db/src/index.ts`, `artifacts/ah-sheli-bot/src/database.js`, and the direct PostgreSQL client in `artifacts/ah-sheli-bot/test/worker-lock.test.js`; each uses the shared guard before constructing a database client. `lib/db/drizzle.config.ts` also validates its database target.
- Existing optional SQL fixtures use temporary tables or generated `qa_*` schemas with cleanup in `finally`; the worker-lock test uses a dedicated advisory key and closes its test clients. These tests were not executed in this phase.

## Verification performed

All checks below were local and offline. No database URL or secret value was displayed.

| Check | Result | Scope |
|---|---|---|
| Guard and in-memory test run through the sanitized Lab runner | **PASS — 15 passed, 0 failed, 0 skipped** | Used an empty inherited environment; no PostgreSQL or network calls |
| API TypeScript check | **PASS** | `pnpm --filter @workspace/api-server run typecheck`; compile-only |
| JavaScript syntax checks | **PASS** | Changed guard, runner, memory tests, and gated bot database test files |
| `git diff --check` | **PASS** | No whitespace errors |

The 15 passing tests cover:

- Secret and database-variable removal from the child test environment.
- Rejection of `helium`, `heliumdb`, and Production/live-like identifiers in URLs and database target variables.
- Rejection of remote, missing, mismatched, or wrong-mode Lab targets before pool construction.
- Startup failure before test execution when the inherited target is known to be Production.
- Three concurrent launcher processes failing closed, and repeated fresh-process attempts remaining denied.
- Per-instance memory isolation and automatic cleanup at the test boundary.

Test launchers used synthetic identifiers only for rejection tests. Those inputs were never passed to a database client.

## Not performed

- No PostgreSQL server or temporary PostgreSQL instance was created or started.
- No SQL-backed bot or API suite, migration, query, DDL, or DML operation was run.
- No network request, Telegram call, Whop call, provider connection, or application workflow restart was performed.
- No dependency installation, Production/Render setting, Secret, database, or deployment was changed.
- `CLOUD_CUTOVER_APPROVED` was not read or modified.

## Remaining gaps and owner actions

1. If PostgreSQL integration coverage is needed, provide an independently isolated, disposable **local-only** Lab PostgreSQL instance whose host is loopback and whose database name begins with `ah_sheli_lab`. Run the SQL tests only after verifying every fixture uses a temporary table or a unique disposable schema and reliably tears it down.
2. The current runner intentionally blocks SQL opt-in. Do not weaken it to run database tests. Any future SQL test runner should be separately reviewed and should clear inherited environment variables, validate the local target before test initialization, and guarantee cleanup.
3. Review and approve this report before enabling any further database-backed tests. This Phase 113 result does not certify Production isolation or authorize cutover.

The application workflow was already reported failed in the workspace. It was left untouched because this verification required no running service.
