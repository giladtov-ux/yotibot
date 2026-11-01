---
name: Isolated test environment boundaries
description: The Telegram worker allowlist is not a complete environment for the full SQL and website test suites.
---

Keep the isolated bot's runtime environment narrow. Do not forward real website
signing credentials merely to make unrelated website fixtures run.

**Why:** the full suite includes website-link tests that require a signing key,
but the isolated Telegram launcher deliberately excludes that credential.
Temporary SQL fixture setup also needs a writable temporary schema; globally
read-only SQL sessions reject its temporary-table DDL and may strand setup.

**How to apply:** use a throwaway signing secret for the full test subprocess,
keep its SQL fixtures in temporary schemas, and compare persistent records before
and after. Use server-enforced read-only sessions for actual profile/snapshot
verification. Do not mistake missing harness inputs for historical regressions,
weaken production safeguards, or change closed legacy tests to accommodate them.

Preparing the isolated Telegram harness does not authorize live messages.
Present the intended recipient, reminder, timing and evidence first, then obtain
separate explicit approval before starting the live E2E.

**Why:** the user requires a distinct approval boundary between preparation and
real Telegram delivery, even when Dev-only changes have already been approved.

**How to apply:** leave the worker stopped after preparation. Do not treat
passing mock tests or approval to skip cosmetic setup as permission to send.

The managed Development database role was observed with superuser-level flags.
Production isolation therefore depends on Replit's separate Development and
Production databases, not on least-privilege credentials. Reverify the target
database marker before any test write; keep the search path limited to a unique
scratch schema and remove that schema afterward.

**Why:** a dedicated test database can still be accessed with a broadly
privileged Development role, so temporary schemas must not resolve shared
application tables.

**How to apply:** before PostgreSQL harness writes, confirm the exact test
database and marker, isolate all unqualified SQL in a disposable schema, and
verify cleanup. Never infer Production safety from the DB role alone.

Run API TypeScript tests with the workspace's package-resolution and runtime
loader conventions. A raw Node invocation can fail while resolving workspace
directories or logger transports before the test assertions execute.

**Why:** some workspace packages rely on bundler resolution, and Pino transports
may resolve relative to the test bundle rather than the project.

**How to apply:** distinguish assertion failures from loader/transport startup
errors; use the supported test harness or a local bundle layout that preserves
workspace package resolution, without connecting to live services.

Use Replit's `REPLIT_DEPLOYMENT=1` signal to reject launchers running in a published
deployment; do not rely on `REPLIT_ENVIRONMENT`, which Replit does not define as a
supported development/production discriminator.

**Why:** the supported deployment marker is explicit, while an assumed environment
variable can be absent and silently weaken a Development-only guard.

**How to apply:** keep the isolated worker fail-closed when `REPLIT_DEPLOYMENT`
is set, and gate any Development-only AI integration on an explicit opt-in and
`NODE_ENV=development`.

An isolated process in the same Repl is not a separate Replit workspace. Keep
live Dev tests scoped to the recovery source, a temporary localhost-only database,
and an explicit child-process allowlist containing Dev credentials only. Do not
reuse a launcher that points at the primary artifact.

**Why:** the parent workspace can access more secrets than the test worker needs,
and a process-level boundary does not prove account- or network-level isolation.

**How to apply:** distinguish ephemeral process/database isolation from a separate
project, block webhook changes and non-owner Telegram output, and clean temporary
resources when the staging process stops.
