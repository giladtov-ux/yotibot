# Phase 114 — Rollback Strategy & Backup/Recovery Drill Design

**Status: NO-GO for Production rollback or data recovery.** This plan defines a proposed recovery objective and a local simulation. It does not verify a Production backup, identify a Production last-known-good release, or authorize any service or database change.

## 1. Proposed recovery objectives

These are exact proposed targets for owner approval, not measured Production capabilities:

| Scope | Proposed target | Meaning |
|---|---:|---|
| Production data RPO | **15 minutes maximum** | In a recovery incident, the latest usable recovery point should be no more than 15 minutes before the incident/data-loss boundary. |
| Code/service rollback RTO | **30 minutes maximum** | From incident declaration to the previously approved code release passing health/readiness checks, without restoring database data. |
| Database recovery RTO | **4 hours maximum** | From incident declaration to an isolated restored database completing schema, integrity, and bounded-count checks. |
| Full service recovery after database loss | **4 hours maximum** | Includes database recovery and service validation; the 30-minute code-only target does not apply if data recovery is required. |

Production backup cadence, PITR window, restore throughput, and operator access are unknown. An owner must approve these targets and verify provider capability before any cutover. If the provider cannot support a 15-minute RPO or a four-hour isolated restore, the targets must be explicitly revised and approved; do not silently relax them.

Measure RPO as the interval between the incident boundary and the latest successfully restored recovery timestamp. Measure RTO from the recorded incident declaration to successful restoration and verification. A local restore duration is not a Production measurement.

## 2. Fallback commit assessment

### Provisional Staging-tested candidate

| Evidence | Finding |
|---|---|
| Candidate SHA | `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069` |
| Git object | Present locally as a commit; exact full SHA verified |
| Relationship to current source | Ancestor of local `main` at `8700b93950099d55838ca6ba083d9c3a4df44a10` |
| Local description | `phase-106-baseline-6bd4a6b2-2-g5566584` |
| Tag state | Candidate itself is not tagged. `phase-106-baseline-6bd4a6b2` points to the earlier commit `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f`; do not move that tag. |
| Prior runtime evidence | `docs/phase-106-final-readiness-report.md` records build ID `phase-106-baseline-6bd4a6b2-2-g5566584`, `dirty=false`, 45 API tests, 25 STOP/access tests, and 4 Whop configuration tests passing. This is prior Staging evidence, not a test rerun in Phase 114. |
| Local archive simulation | `git archive` extracted this SHA to a temporary directory; expected root/API manifests and messaging-preference migration were present. The candidate tree is `51bc8dcae9aae5f6e7e7d2b405a0633306da5f48`. The temporary copy was removed. |

### Production fallback decision

**No Production fallback commit is verified or approved.** The candidate above is the best-evidenced Staging code checkpoint, but it is not proven to be the previous Production release. Previously supplied Render information identifies a pinned short SHA `5d10871`; that object is not resolvable in the local Git object database, and the reported service served placeholder behavior.

There is also a material compatibility concern: the Staging candidate predates later egress-gate and database-isolation code in the current source history. Rolling a newer build back to `55665848…` would remove those later controls. Therefore it is a **provisional fallback candidate for review only**, not a safe Production rollback target today.

Before approving a Production fallback, the release owner must:

1. Obtain the full SHA and build/deployment ID of the actual serving Production release from the provider’s read-only deployment history.
2. Identify which prior release is both known to have served the intended app and compatible with the current Production schema and required safety controls.
3. Confirm that exact full SHA exists in the source repository; verify its tree, parentage, tag (if any), build identity, and clean source state.
4. Build and test that SHA in an isolated environment; record passing typecheck, bot/API tests, build, schema compatibility, and STOP behavior against a disposable database.
5. Create a new immutable release tag only after approval; never move the existing Phase 106 baseline tag.

If any step fails, there is no approved code fallback. Keep the service stopped or contained and remain NO-GO.

## 3. Code-only rollback runbook

This runbook is for a future, explicitly authorized incident. No step below was performed against Production.

### Trigger and containment

1. The incident commander records the trigger, UTC time, current service/build identity, and decision. Preserve redacted logs and deployment metadata.
2. Stop further deployments and schema changes. Do not change `CLOUD_CUTOVER_APPROVED` as an improvised kill switch; it only affects a later process startup.
3. Block new checkout creation using the approved Production procedure. Remember this does not invalidate already-issued payment links; separately assess or revoke open links through the billing owner.
4. If unsafe Telegram messages, wrong identity, or data integrity issues are suspected, stop the entire service hosting both API and supervised bot worker. This also pauses webhook handling and payment reconciliation; preserve pending events for later reconciliation.
5. Confirm the process stopped and the exclusive worker lock was released before starting any other version. Never run two workers with the Production bot token.

### Restore the previously approved code

6. Select only the exact full SHA approved before the incident; do not use a short SHA, mutable branch name, or the unresolved `5d10871` pin.
7. Confirm the target’s full SHA/build ID, source tree, artifact, start command, and schema compatibility. Keep the existing Production database and `SESSION_SECRET`; do not restore an old database snapshot to roll back application code.
8. Use the authorized provider’s manual rollback/redeploy procedure to start the approved artifact. Do not change the database target or copy Staging data.
9. Verify the deployed build reports the exact approved full SHA and clean build state. Check health, API readiness, exactly one worker/lock, webhook identity/endpoint, STOP persistence, and payment reconciliation status.
10. Keep checkout creation disabled until a separate billing-owner approval. Reopen service traffic only after the incident commander accepts the checks. If checks fail, stop the service again; do not attempt repeated unreviewed releases.

## 4. Database recovery runbook

Database recovery is separate from code rollback. A live Production restore requires explicit approval from the Production owner and database owner, a recorded recovery point, an impact/lost-write estimate, and a maintenance window. Never restore directly over Production during a drill.

### Provider PITR into an isolated recovery instance

1. Identify and record the actual Production provider, cluster/database identifier, engine version, timezone, backup policy, PITR window, and restore permissions. These details are currently unknown.
2. Preserve the current Production state using the provider-approved backup/snapshot process before any live recovery decision. Record the completed backup ID and UTC completion time.
3. From the provider console, choose the latest valid point at or before the incident boundary that meets the proposed 15-minute RPO. Restore it to a **new, access-restricted recovery instance**, not the Production or Staging database.
4. Ensure the recovery instance has separate credentials, no application workers, no Telegram webhook registration, no checkout/billing initialization, and no external notification egress.
5. Record restore request/restore ID, selected timestamp, start/end UTC times, provider status, engine version, and warnings.
6. Run read-only checks against the isolated instance: expected schemas/tables/columns, migration version, primary/foreign/check constraints, valid indexes, and bounded row counts for critical tables. Do not export row contents or print connection strings.
7. Compare the restored schema and bounded counts with the selected recovery point. Record the measured RPO and RTO. Keep the instance isolated until the owner accepts the evidence; then remove it through the provider’s approved cleanup procedure.
8. A restore into live Production is a distinct action requiring a second explicit approval. First stop writes, preserve current state, state the estimated lost interval, and verify the recovery instance. If the approval or target is ambiguous, do not proceed.

### Authorized dump restoration into an isolated PostgreSQL instance

For a future drill using a provider-approved dump and an isolated PostgreSQL recovery instance, the operator should:

1. Store the encrypted dump in an access-restricted location; verify the provider checksum and expected engine/version without displaying data.
2. Inspect the archive catalog:

   ```sh
   pg_restore --list <protected-backup-file>
   ```

3. Create a **new empty recovery database** in the isolated instance; never point the command at Production.
4. Restore and fail on the first SQL error:

   ```sh
   pg_restore --exit-on-error --no-owner --no-privileges \
     --dbname=<isolated-recovery-database> <protected-backup-file>
   ```

5. Run the read-only schema, constraint, index, and bounded-count checks from step 6 above. Record restore timing and results; do not treat command success alone as data validation.

Credentials and connection parameters must be provided through the owner-approved secret mechanism, not embedded in commands, files, logs, or this report.

## 5. Phase 114 dry-run evidence

### Local code rollback simulation

- Verified the exact `55665848…` commit object, ancestry, `git describe`, tag relationship, and source tree.
- Extracted its Git archive to a temporary directory and confirmed expected project files were present.
- Removed the temporary extraction. The working tree remained clean; no checkout, branch move, tag change, or commit was performed.

### Local PostgreSQL dump/restore simulation

- Used the locally installed PostgreSQL **16.10** tools and an ephemeral cluster in a temporary directory.
- Disabled TCP listeners; the cluster was reachable only through a temporary Unix-domain socket.
- Created only synthetic fixtures: two fake user rows, one fake reminder, a foreign-key constraint, and an index.
- Created a PostgreSQL custom-format dump, restored it into a separate temporary recovery database, then verified both row counts, the foreign key, and index validity.
- Result: **PASS**. Local restore command elapsed time was **1 second**. The cluster, dump, socket, and recovery database were removed when the simulation ended.
- This was a dump/restore simulation, **not** a provider PITR test and **not** a Production backup. The one-second result is not an RTO measurement.

## 6. Verified, assumed, and unknown

**Verified locally:** the exact Staging candidate commit exists and is an ancestor of current `main`; the archive simulation passed; the synthetic local PostgreSQL dump/restore and integrity checks passed; the working tree was clean before this report.

**Documented from prior Staging evidence:** candidate build ID and prior test counts in the Phase 106 report. These were not rerun against the candidate in Phase 114.

**Proposed, not approved or measured:** RPO 15 minutes, code/service rollback RTO 30 minutes, database recovery RTO 4 hours.

**Unknown:** actual Production full commit/build, provider-specific rollback controls, Production database identity, backup cadence/retention/PITR window, restore permissions, achievable Production RPO/RTO, and a fallback that preserves the current egress/database safety controls.

## 7. Safety boundary and decision

- No Production or Staging database was contacted.
- No external API, Telegram, Whop, or provider request was made.
- No Render setting, Secret, database, deployment, branch, tag, or `CLOUD_CUTOVER_APPROVED` value was changed. The flag was not read.
- No live rollback, provider restore, migration, or cutover was executed.

**Final decision: NO-GO.** The local simulations passed, but no Production recovery capability or safe Production fallback is verified. Stop here for human review and owner approval.
