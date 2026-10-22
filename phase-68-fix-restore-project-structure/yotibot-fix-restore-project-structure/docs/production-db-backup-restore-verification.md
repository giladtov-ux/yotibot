# Production Database Backup and Restore Verification Runbook

## Scope and safety boundary

This runbook is a verification procedure, not authorization to access or restore Production. Phase 106 did not inspect an external Production connection string, create a Production backup, restore Production data, or change database settings. The database owner/operator must execute the provider-console steps and record evidence. Never paste connection strings, credentials, customer data, or unredacted dumps into chat or logs.

Do not run a restore against the live Production database. Restore only to a provider-managed isolated recovery instance with separate credentials. Disable bot workers, Telegram webhook registration, checkout creation, and all outbound notifications on that recovery instance.

## 1. Identify the authoritative database

1. In the hosting/provider console, identify which database the currently serving Production app actually uses. Do not infer this from the Replit Development database.
2. Record provider, database/cluster identifier, region, engine/version, encryption-at-rest status, TLS requirement, owner, and the app release/build currently connected to it.
3. Confirm the Production application uses the intended Production database and that Staging uses a separate Development/test database.
4. Record the backup policy name, cadence, retention period, point-in-time recovery (PITR) window, and who can authorize restoration. Capture redacted screenshots or provider audit references, not secrets.

## 2. Verify a recoverable backup exists

1. Select a recent successful automatic backup or create a provider-native on-demand backup using the provider console.
2. Record the backup identifier, completion time in UTC, covered database/region, and earliest/latest supported recovery point.
3. Confirm the backup is encrypted and that the operator can access the recovery workflow. A successful “backup started” status is not enough; it must complete successfully.
4. Define the approved Recovery Point Objective (RPO) and Recovery Time Objective (RTO) before the restore drill.

## 3. Restore into an isolated recovery instance

1. Create a separate, access-restricted recovery instance in the provider console. Do not overwrite Production or Development.
2. Restore the chosen backup/PITR point into that instance. Record restore ID, selected timestamp, start/end times, and provider status.
3. Use a sanitized connection configuration to run read-only checks: database reachable over TLS, expected schemas/tables present, constraints/indexes valid, and bounded row counts for critical tables such as Telegram users, reminders, registrations, and payment grants. Do not export row contents.
4. Compare counts and schema/version to the backup point. Document expected changes, missing objects, and any recovery warnings.
5. If an app smoke check is needed, use an isolated build configured only for the recovery instance, with Telegram worker startup and webhook registration disabled, billing checkout disabled, and notification delivery disabled. Do not send messages or create payments.
6. Measure restore completion time against the approved RTO. The earliest recoverable timestamp and observed missing writes establish the measured RPO.

## 4. Close out and preserve evidence

Record provider, backup/restore IDs, UTC timestamps, RPO/RTO results, schema/check results, operator, and any gaps in the incident/change record. Keep the recovery instance only as long as approved; delete it through the provider console after evidence is saved and after confirming it is not receiving Production traffic.

## 5. Production restore authorization

A Production restore is a separate, high-impact operation. Before any such action, obtain explicit human approval, select the recovery point, preserve current Production data where feasible, estimate writes that would be lost, and coordinate a single-worker shutdown. Never restore an old snapshot merely to roll back application code. Code rollback and database recovery are separate procedures.

## Phase 106 status

- Runbook prepared.
- External Production provider and backup policy: not verified.
- Production backup or restore: not executed.
- Isolated restore drill: pending operator access and explicit approval.
