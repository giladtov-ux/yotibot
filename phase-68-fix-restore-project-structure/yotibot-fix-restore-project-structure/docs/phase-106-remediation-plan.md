# Phase 106 — Production Readiness Remediation

**Scope:** Staging and code-level changes only. No Production environment variables, database, provider account, webhook, or deployment were changed. No cutover was initiated.

## Remediation items and acceptance criteria

### 1. Telegram STOP and resume

- **Implemented:** `STOP`, `/stop`, and `/stop@botname` persist a per-user message opt-out. `/start` or `/start@botname` opts back in.
- **Behavior selected:** suppress all bot messages to that user except the STOP confirmation and resume confirmation. Preserve account access, subscription status, reminders, and stored data. The command does not cancel Whop.
- **Coverage:** incoming updates, reminder eligibility, access notifications, and payment-confirmation delivery honor the persisted setting. Pending payment confirmations remain pending while opted out and may be delivered after the user resumes.
- **Schema:** additive `messages_opted_out BOOLEAN NOT NULL DEFAULT false` applied to Development/Staging database `heliumdb` with the committed idempotent `ADD COLUMN IF NOT EXISTS` statement. No force push, rename, drop, or other reconciliation was used. The table had zero user rows before and after. A synthetic STOP command was handled by the real repository/handler, persisted across independent database connections, and its temporary row was removed. No Telegram API message was sent.
- **Acceptance:** tests prove opt-out blocks messages while leaving subscription/data intact and `/start` restores messaging.

### 2. Billing switch and Whop Staging sandbox

- **Implemented:** `BILLING_CHECKOUTS_ENABLED=false` blocks new checkout creation. Verified incoming paid events and reconciliation remain active so completed charges can still be fulfilled.
- **Implemented:** all non-Production runtime modes are forced to Whop sandbox endpoints. Staging never falls back to a live `WHOP_API_KEY` or Replit Whop connector.
- **Staging prerequisites:** dedicated `WHOP_SANDBOX_API_KEY`, `WHOP_SANDBOX_COMPANY_ID`, `WHOP_SANDBOX_PRO_PLAN_ID`, and `WHOP_SANDBOX_UNLIMITED_PLAN_ID`. The Development environment inventory shows these are absent, as are the live key/company values. Whop initialization returns before provider setup and checkout remains disabled.
- **Acceptance:** API tests (45/45) and a mocked SDK request verified five non-Production `NODE_ENV` values select the sandbox host, ignore `WHOP_MODE=live`, reject before any request if sandbox configuration is missing, and use only the sandbox credential/host when configured. The actual Staging runtime has no sandbox credentials, so no real provider call or sandbox checkout was attempted.

### 3. Production database recovery evidence

- **Prepared:** `docs/production-db-backup-restore-verification.md` specifies how an authorized operator can verify backup retention and restore a backup into an isolated recovery instance, measure RPO/RTO, and retain evidence without sending messages or processing payments.
- **Simulated:** an ephemeral local PostgreSQL cluster performed `pg_dump` to a custom-format fixture and `pg_restore` into a separate local recovery database. Synthetic tables, two fake users, one reminder, two constraints, and an index were verified; temporary cluster and dump were removed. No Production connection, data, or credentials were used. See `docs/production-db-backup-restore-verification.md`.
- **Pending:** actual Production provider, backup policy, retention, and authorized isolated restore drill. Production RPO/RTO and recoverability remain unverified.

### 4. Release tag and build identity

- **Tag target:** annotated tag `phase-106-baseline-6bd4a6b2` points to commit `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f`. This is a local reference tag; it is not pushed or deployed.
- **Implemented:** builds derive an ID from the nearest Git tag, commit distance, source SHA, and—when dirty—a content fingerprint. The API health response reports build ID, full commit SHA, exact release tag (when the built commit is tagged), and dirty status.
- **Acceptance:** build and health check show the expected identifier; the baseline tag remains attached to the exact Phase 105 candidate commit.

## Verification performed

- Bot STOP/reminder/access-notification/interrupted-request tests: 45 passed.
- Full bot suite: 527 passed, 4 skipped, 9 existing DST tests remain marked TODO. Those DST cases were not changed; the suite returns non-zero because those TODO assertions still fail.
- API suite: 45 passed.
- API TypeScript typecheck and production bundle build: passed.
- Staging `/api/healthz` returned HTTP 200 with build ID `phase-106-baseline-6bd4a6b2-2-g5566584`, source commit `55665848ff6d43a08afc4c9ae8c6a6f1b41bf069`, `releaseTag: null`, and `dirty: false`. Subsequent repository changes are documentation-only and do not alter the running application code.
- Staging workflow started the API and Telegram worker, acquired the Development database lock, and reported its HTTPS webhook active. No Telegram message was sent during verification.
- Whop verification was mocked/config-level only; no Whop provider checkout or payment was performed. Development configuration is fail-closed because the dedicated sandbox values are absent.
- Production restore-runbook simulation passed with an ephemeral local fixture. Production backup/restore and provider policy were not accessed or verified.

## Order of remaining work before any cutover

1. Configure dedicated Whop **sandbox-only** credentials and IDs through Development Secrets/Configuration, then run an authorized sandbox checkout/webhook/reconciliation test. Never use live credentials or cards in Staging.
2. Have the Production database owner verify the actual provider backup policy and execute the documented isolated Production restore drill; record measured RPO/RTO.
3. Before a later release, apply the additive STOP schema through the approved Production database process; do not start code against a Production schema that lacks `messages_opted_out`.
4. Identify and verify the actual Production service/build, then rerun the Phase 105 readiness review. A new human approval and separate cutover request are required; Phase 106 does not authorize cutover.

## Current gate

**NO CUTOVER.** STOP is durable in Staging. Non-Production billing is forced to Sandbox and fail-closed, but actual Staging checkout is unavailable until dedicated sandbox configuration is supplied. Production restore capability remains unverified; Production settings and secrets were not inspected or changed.
