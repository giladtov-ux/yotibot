# Phase 112B: Read-Only Database Log Audit & Connection Provenance Evidence

## Executive finding

**Historical database target: UNKNOWN. Treat the Phase 111 run as possible Production access pending owner verification.**

The preserved Phase 111 test output confirms that seven tests labeled as real PostgreSQL/SQL tests completed successfully while `DATABASE_URL` was present. The current runtime metadata recorded during Phase 112A classifies the Replit runtime as `production` and the PostgreSQL target as host `helium`, database `heliumdb`. The Phase 111 test process did not record its own environment snapshot or connection details, so the historical connection cannot be conclusively tied to that target.

**Write trace conclusion: UNVERIFIED — INCONCLUSIVE LOG EVIDENCE.** The test log contains test results, not SQL or database audit records. Source code shows temporary-table writes and generated-schema fixtures, but the available logs cannot establish the exact statements executed, commit/cleanup outcomes, or whether any temporary schema remained.

No database connection, query, migration, test, cleanup, or configuration change was performed for this audit.

## Evidence reviewed

| Artifact | Read-only observation |
|---|---|
| Prior bot test output: `/tmp/shell-exec-output/BHSK37Y4OH73NA8PVNAQJ.txt` | 97,161 bytes; modified `2026-10-22T08:36:01.904Z`; test summary and test-title lines were extracted without displaying raw log contents |
| Existing app workflow log: `/tmp/logs/Start_application_20261022_090850_409_966b065a.log` | Start attempt failed at the egress authorization gate. The stack shows failure during API bootstrap before application database access; no database target or query is logged |
| Browser console log: `/tmp/logs/browser_console_20261022_090850_409_67b4274b.log` | Telegram WebView theme, viewport, and safe-area events only; no database activity |
| Deployment logs | No new deployment log was available |
| Local source and prior Phase 112A report | Database wiring, test guards, target metadata, and source-defined fixture/cleanup behavior |

The Phase 111 output artifact’s modification time is an output-file timestamp, **not** a database connection timestamp. The runner reports `duration_ms 9389.055834`; it does not record a start time or per-connection time.

## Timeline and process provenance

### Phase 111 bot test run

Command:

```text
pnpm --filter @workspace/ah-sheli-bot test
```

At that time the package script was `node --test`. The test runner summary was:

```text
tests 541
pass 528
fail 0
cancelled 0
skipped 4
todo 9
duration_ms 9389.055834
```

Seven completed test titles explicitly indicated real PostgreSQL/SQL activity:

1. `real SQL uses atomic new-user detection and durable unique attempts without changing user data`
2. `actual PostgreSQL commits the new event and task together, then returns both through SQL`
3. `real PostgreSQL commits scheduling to events while the SQL task rows remain identical`
4. `real SQL recap persists completion, deferred date, cancellation and durable callback session`
5. `real PostgreSQL executes the production reader SQL with an isolated read-only fixture`
6. `email identity proofs use isolated real SQL, explicit consent and atomic uniqueness`
7. `goal deadlines and shared-list deletion commit atomically in isolated real SQL`

The output also shows four skipped database integration cases: two opt-in temporary-table tests and two worker-lock tests. The nine TODO cases were reminder/DST cases. No bot tests were run in Phase 112B.

### Timestamps, process IDs, and identities

| Requested evidence | Finding |
|---|---|
| Exact database connection timestamp(s) | **Not present** in the saved test output, workflow log, or available local source |
| Test runner start/end time | Not recorded. The output file was modified at `2026-10-22T08:36:01.904Z`; this is not proof of connection time |
| Test runner duration | `9389.055834 ms`, as reported by Node’s test runner |
| Spawned OS process IDs | **Not present**. No PID/process-ID references were found in the test output; the workflow log also does not include a PID |
| Database role/user identity | **Not present** in available logs. It was not obtained from a connection string |
| Test account or end-user identity | **Not present** in available logs |
| Synthetic fixture timestamps | The test output contains four ISO timestamps on `2026-10-24`; they are test data, not connection times |

The command structure shows pnpm invoked Node’s test runner, which executed the suite. The historical process tree and worker PIDs were not captured; they cannot be reconstructed from the available output.

## Database target and environment provenance

### Current metadata recorded in Phase 112A

The connection string was not printed. A local metadata-only parse recorded:

- Replit runtime classification: `production`
- PostgreSQL host: `helium`
- Database name: `heliumdb`
- Port: default/not explicitly set in the URL metadata
- `NODE_ENV` and `DATA_ENVIRONMENT`: absent in the inspected shell environment

During Phase 112B, the test output confirms `DATABASE_URL`-guarded PostgreSQL cases ran. The test source passes `process.env.DATABASE_URL` to the bot database client. However, no historical copy of the test process environment or provider connection event is available. Therefore:

- **Current target metadata:** host `helium`, database `heliumdb`, runtime classified as Production.
- **Historical Phase 111 target:** **UNKNOWN**; it is a credible possibility that it was the same Production-classified target, but this cannot be proven from the test output alone.
- **Provider resource identity/owner:** not independently verified; no provider dashboard or database connection was accessed.
- **`CLOUD_CUTOVER_APPROVED`:** not read or changed in Phase 112B.

## DDL/DML and mutation evidence

### What the logs show

- The test runner records successful completion of seven real-SQL/PostgreSQL-labeled tests.
- The output contains **zero SQL statement log lines** beginning with `CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`.
- No database audit log, query log, transaction ID, schema-change record, or connection-authentication record was available.
- The log’s “passing” test status is evidence that those tests completed according to their assertions, but it is not a provider-side DDL/DML trace.

### What local source shows, separately from logs

- The appointment-flow test creates a session-local temporary table, persists synthetic fixture state, reads it back, then releases the connection and closes the pool.
- Access-notification, schedule, recap, and summary SQL tests use temporary tables or temporary transactions.
- Email-link and shared-list tests create generated schemas, write fixtures, and contain cleanup statements in `finally` blocks.
- The optional worker-lock and other isolated-table integration tests were skipped in the recorded run.

These source patterns suggest writes were confined to temporary fixtures and generated test schemas, rather than persistent application tables. They do **not** prove every statement ran as written, that all cleanup completed, or that no residue remained.

> **UNVERIFIED — INCONCLUSIVE LOG EVIDENCE:** Available logs cannot determine the complete DDL/DML execution trace or conclusively establish whether all test-created database objects were removed.

## Separate workflow event

The available `Start application` log is timestamped in its filename at approximately `2026-10-22 09:08:50 UTC`; its file modification time is `09:08:51.424Z`. It records an API startup failure with `EgressConfigurationError: Egress authorization is missing, invalid, or not approved.` The stack ends in the egress bootstrap path before application database access. It does not show a database connection, query, PID, or database user.

This log was already present when Phase 112B began. The workflow was not restarted or otherwise triggered during this audit.

## Owner recommendations

1. Use authorized Replit/provider-side connection or audit logs to establish whether the Phase 111 test process connected to `helium/heliumdb`, and identify the exact connection time, database role, client/application name, source process, and resource owner. Do not disclose credentials or connection strings.
2. Review provider-side DDL/audit records for the test interval to determine whether temporary schemas/tables were created and removed. Do not connect to the database or attempt cleanup based on this report.
3. Confirm whether `helium/heliumdb` is Production, Staging, or another environment using provider resource metadata—not the `DATABASE_URL` variable name alone.
4. Preserve provider logs and the original test output for the owner’s incident review. The test output artifact is in a temporary path and may not be durable.
5. Keep database-backed tests halted until the owner confirms an isolated Lab target and reviews this possible Production-access event.

## Final status

**NO-GO for further database-backed tests or claims that the Phase 111 run was isolated.** Connection target, exact connection timestamps, process IDs, database identity, and provider-side write/cleanup evidence remain unverified. Phase 112B used only existing local logs, source, and metadata; it made no database/provider connection, ran no tests, changed no settings, and did not alter `CLOUD_CUTOVER_APPROVED`.
