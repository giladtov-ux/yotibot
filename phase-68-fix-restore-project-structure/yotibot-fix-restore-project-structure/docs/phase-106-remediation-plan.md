# Phase 106 — Production Readiness Remediation

**Scope:** Staging and code-level changes only. No Production environment variables, database, provider account, webhook, or deployment were changed. No cutover was initiated.

## Remediation items and acceptance criteria

### 1. Telegram STOP and resume

- **Implemented:** `STOP`, `/stop`, and `/stop@botname` persist a per-user message opt-out. `/start` or `/start@botname` opts back in.
- **Behavior selected:** suppress all bot messages to that user except the STOP confirmation and resume confirmation. Preserve account access, subscription status, reminders, and stored data. The command does not cancel Whop.
- **Coverage:** incoming updates, reminder eligibility, access notifications, and payment-confirmation delivery honor the persisted setting. Pending payment confirmations remain pending while opted out and may be delivered after the user resumes.
- **Schema:** additive `messages_opted_out BOOLEAN NOT NULL DEFAULT false`. The dev-only Drizzle push was attempted but stopped at an interactive column-conflict prompt before applying changes. No database DDL was applied. Do not use `push-force`; resolve the existing diff safely, then apply to Development only. Until then, Staging keeps normal bot processing available but explicitly refuses to claim that a STOP request was saved; durable STOP behavior is not runtime-verified.
- **Acceptance:** tests prove opt-out blocks messages while leaving subscription/data intact and `/start` restores messaging.

### 2. Billing switch and Whop Staging sandbox

- **Implemented:** `BILLING_CHECKOUTS_ENABLED=false` blocks new checkout creation. Verified incoming paid events and reconciliation remain active so completed charges can still be fulfilled.
- **Implemented:** all non-Production runtime modes are forced to Whop sandbox endpoints. Staging never falls back to a live `WHOP_API_KEY` or Replit Whop connector.
- **Staging prerequisites:** dedicated `WHOP_SANDBOX_API_KEY`, `WHOP_SANDBOX_COMPANY_ID`, `WHOP_SANDBOX_PRO_PLAN_ID`, and `WHOP_SANDBOX_UNLIMITED_PLAN_ID`. Until all are configured, Whop initialization and checkout remain unavailable; no provider calls are made. This prevents accidental live charges.
- **Acceptance:** automated tests verify sandbox endpoint selection, live-key isolation, fail-closed behavior without sandbox configuration, and the new-checkout kill switch. A real sandbox payment is not run by this code-only remediation.

### 3. Production database recovery evidence

- **Prepared:** `docs/production-db-backup-restore-verification.md` specifies how an authorized operator can verify backup retention and restore a backup into an isolated recovery instance, measure RPO/RTO, and retain evidence without sending messages or processing payments.
- **Pending:** actual Production provider, backup policy, retention, and restore drill. The Production database was not accessible from this Staging/code-only work.

### 4. Release tag and build identity

- **Tag target:** annotated tag `phase-106-baseline-6bd4a6b2` points to commit `6bd4a6b2b6baa56570f95476e7df2adeb096dc6f`. This is a local reference tag; it is not pushed or deployed.
- **Implemented:** builds derive an ID from the nearest Git tag, commit distance, source SHA, and—when dirty—a content fingerprint. The API health response reports build ID, full commit SHA, exact release tag (when the built commit is tagged), and dirty status.
- **Acceptance:** build and health check show the expected identifier; the baseline tag remains attached to the exact Phase 105 candidate commit.

## Verification performed

- Bot STOP/reminder/access-notification/interrupted-request tests: 45 passed.
- Full bot suite: 527 passed, 4 skipped, 9 existing DST tests remain marked TODO. Those DST cases were not changed; the suite returns non-zero because those TODO assertions still fail.
- API suite: 45 passed.
- API TypeScript typecheck and production bundle build: passed.
- Staging `/api/healthz` returned HTTP 200 and reported the full source commit, build ID, exact release tag, and dirty status. The running Staging build is dirty and based on an untagged commit after the baseline; it is not a clean release artifact. Read the endpoint for the current build ID.
- Staging workflow started the API and Telegram worker, acquired the Development database lock, and reported its HTTPS webhook active. No Telegram message was sent during verification.
- Whop sandbox test coverage is simulated/config-level only; no Whop provider checkout or payment was performed.
- Production database backup/restore was not accessed or executed.

## Order of remaining work before any cutover

1. Review the Drizzle column-conflict prompt and apply the additive user-preference schema to Development/Staging only; then test STOP/resume against the Staging bot. Do not bypass the prompt with a force push.
2. Add a dedicated Whop **sandbox** key and sandbox company/plan IDs through Staging Secrets/Configuration, then verify the API base URL and checkout domain remain sandbox-only. Do not use production Whop credentials or live cards.
3. Complete a sandbox checkout/webhook/reconciliation test with provider test cards. Confirm real Production account IDs and credentials are never selected by the Staging process.
4. Have the Production database owner execute the documented isolated backup/restore drill and approve the evidence.
5. Before any later release, review and apply the additive schema change through the appropriate Production database process; do not start the new code against a Production schema that lacks `messages_opted_out`.
6. Build a clean tagged candidate and record the build metadata. Identify and verify the actual Production service/build separately.
7. Re-run the Phase 105 readiness review. A new human approval and a separate cutover request are required; Phase 106 does not authorize cutover.

## Current gate

**NO CUTOVER.** Staging remains forced to Whop sandbox mode, and is fail-closed until dedicated sandbox credentials/IDs are present. Production settings and secrets remain unchanged.
