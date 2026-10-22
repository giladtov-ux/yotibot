# Phase 109: Global Egress Kill-Switch Remediation

## Outcome

**Local code remediation implemented and verified; no live egress was authorized or tested.**

The application now fails before startup unless an explicit, environment-matched egress approval and exact destination allowlist are present. The API, bot, maintenance commands, and alternate cloud launcher are guarded. A one-way process kill switch blocks new requests, aborts tracked requests, stops billing retries, closes the API, and signals or terminates supervised workers.

This is an application-layer Node.js control, **not proof of a machine-wide network barrier**. Native add-ons, kernel-level networking, and some browser activity are outside the JavaScript gate; see [Remaining gaps](#remaining-gaps). The local app workflow was stopped before the implementation and was not restarted. No Production or Staging settings, flags, Secrets, databases, or provider services were accessed or changed.

## Startup and outbound-path inventory

| Entry point or task | Outbound or state-changing work identified | Enforcement |
|---|---|---|
| Repository root `index.js` | Loads the complete API after startup validation | Installs the gate before validation or API import; prints a generic failure without raw error details |
| `artifacts/api-server/src/index.ts` and built `dist/index.mjs` | Starts the HTTP server, initializes billing on listen, starts self-keep-alive in Production, and supervises the bot worker | Bootstrap is the first API import; the built bundle was verified to halt before listening when approval is absent |
| `scripts/cloud-start.mjs` | Alternate cloud launcher that starts the API child process | Imports the bootstrap before validation/spawn; passes the bootstrap to the child and registers the child with the parent gate |
| `artifacts/ah-sheli-bot/index.js` | Telegram webhook setup and profile commands, optional polling, reminders, voice handling, and database work | Bootstrap is the first bot import; API worker launch also preloads it. Bot shutdown is connected to the gate trip |
| `artifacts/ah-sheli-bot/src/connect-owner.js` | Owner-connection maintenance command that can access the database | Bootstrap is the first import |
| `scripts/telegram-render-webhook.mjs` | Read-only checks can call Render health and Telegram identity/webhook APIs; `--apply` can call Telegram `setWebhook` | Direct CLI execution imports the bootstrap before any check or update. Importing its functions for mocked tests does not perform the operation |
| API billing initialization and reconciliation | Database DDL, Whop plan reads, webhook discovery/creation, payment reconciliation, and Telegram payment notices | Gate protects Node transports; billing is disabled after a trip, including periodic and retry timers |
| Bot runtime | Telegram API calls for webhooks, polling, reminders, profile setup, voice-file retrieval, and messages; database pools/locks | Gate protects fetch, HTTP/TLS/TCP, DNS, and related transports. The worker receives the same approval and kill signal |
| Mini-app and calendar routes | Loopback API-to-bot calls; Google OAuth token exchange/revocation and Calendar API reads | Loopback requests require process approval and are tracked for abort; external calls must match the exact allowlist |
| AI features | Groq chat/transcription and OpenRouter completions | Their current HTTPS calls use guarded Node networking and require exact allowlist targets |
| Clerk | Server proxy uses `frontend-api.clerk.dev`; browser authentication may connect to Clerk origins | Server proxy is behind the Node gate. Browser `connect-src` is limited to explicitly approved `EGRESS_BROWSER_ALLOWED_ORIGINS` |
| Database clients | `@workspace/db` and bot PostgreSQL pools open TCP/DNS connections based on `DATABASE_URL` | TCP, TLS, and DNS are gated; active connections are tracked and destroyed on trip. The host/port is not known without reading the database URL, which was not accessed |
| Self-keep-alive | Optional health request to the configured canonical app origin | Standard Node HTTPS path is gated; its timer is stopped on trip |

Known service destinations visible in source include:

- Telegram: `api.telegram.org:443` (including Telegram file downloads).
- Whop: `sandbox-api.whop.com:443` and `api.whop.com:443`; the Replit connector fallback uses the runtime `REPLIT_CONNECTORS_HOSTNAME`.
- Groq: `api.groq.com:443`.
- OpenRouter: `openrouter.ai:443`.
- Clerk server proxy: `frontend-api.clerk.dev:443`; external Clerk/browser origins may vary by configured Clerk application.
- Google Calendar: `accounts.google.com:443`, `oauth2.googleapis.com:443`, and `www.googleapis.com:443`.
- The PostgreSQL host and port, connector hostname, and any Clerk-specific origins are runtime-dependent and were not read from environment values.
- API-to-bot requests use loopback. Loopback is permitted only after startup approval and is also stopped by the kill switch.

This is a source-code inventory, not evidence that any of these services were contacted. The incoming Telegram and Whop webhook routes are inbound; their handlers may trigger guarded outbound work.

## Implemented controls

### Fail-closed startup and target authorization

The process requires all of the following before application modules start:

- `EGRESS_APPROVED=1`.
- `EGRESS_APPROVAL_ENV` exactly matches `NODE_ENV`.
- A syntactically valid `EGRESS_APPROVAL_REF` and `EGRESS_APPROVED_BY`.
- A non-empty, comma-separated `EGRESS_ALLOWED_TARGETS` list of exact `hostname:port` entries. Wildcards and malformed targets are rejected.
- Optional `EGRESS_BROWSER_ALLOWED_ORIGINS`, restricted to exact origins already present in the target list. Without it, the API’s `connect-src` policy permits only `'self'`.

These are code-level requirements only. **No approval values were added to Secrets or environment variables.** Missing approval halts startup; malformed approval also halts startup. The approved policy cannot be changed in-process; a restart is required and revalidates it.

### Central transport gate and bypass resistance

The gate is installed before app imports and wraps or blocks:

- Global `fetch`; Node `http`/`https`; TCP sockets; TLS; HTTP/2; DNS lookups and resolution; and WebSocket connections.
- UDP sends, which are denied.
- Child-process APIs, which are denied except for the known guarded root entry and the API-supervised bot/API entries, each started with the gate preloaded.
- Worker threads, which preload the gate and are tracked by the parent.

Guarded transport properties are made non-writable/non-configurable after installation so application code cannot replace the wrappers through ordinary reassignment. Each request is checked before dispatch and checked again immediately before a queued fetch dispatches. Both external and approved loopback requests are tracked so a trip can abort them.

### Kill-switch behavior

Sending `SIGUSR2` to the guarded supervisor trips the gate once. The gate:

1. Latches the process into a blocked state; later requests and child starts are denied.
2. Aborts active fetches and destroys/closes tracked network resources.
3. Signals the supervised bot worker; worker threads receive the kill message and are terminated.
4. Stops billing retry/reconciliation timers, stops self-keep-alive, prevents bot-worker restarts, and closes the API server.
5. Requires a fresh process restart to resume, with full approval validation again.

`SIGUSR2` is irreversible for the running process. The test suite simulated the signal handler with `process.emit`; no live service was signaled. For an actual local lab process, the operator can send `SIGUSR2` to that local supervisor PID. This report does not authorize signaling any shared or Production process.

## Verification results

### Automated local tests

Command:

```text
node --test lib/egress/egress-gate.test.cjs scripts/render-root-start.test.mjs scripts/telegram-render-webhook.test.mjs
```

**30 passed, 0 failed.** The test cases cover:

- Missing, malformed, mismatched, wildcard, and unapproved configurations.
- Exact allowlist enforcement and browser-origin subset validation.
- Mock transport dispatch counts, proving denied requests do not reach the transport.
- Concurrent queued requests and in-flight request abortion, including loopback.
- Restart behavior with approval absent.
- Direct fetch, HTTP/HTTPS, TLS, HTTP/2, TCP, DNS, UDP, and WebSocket bypass attempts.
- Attempts to replace locked gate methods.
- Bot, owner-maintenance, webhook-maintenance, and cloud-launcher startup refusal before provider/database work.
- Denial of arbitrary child processes; guarded worker launch and worker-thread bootstrap/termination.
- The process-wide kill-switch handler and supervisor-to-worker propagation.
- Existing mocked Telegram webhook behavior. Telegram calls in those tests are fixture methods, not Telegram API requests.

These are **local automated tests with mocked transports or blocked startup**. They are not live provider tests.

### Build and startup checks

- `pnpm --filter @workspace/api-server run typecheck` — passed.
- `pnpm --filter @workspace/api-server run build` — passed.
- `node --check` on the gate, bootstrap, cloud launcher, Telegram maintenance script, bot entry, and owner-maintenance entry — passed.
- Sanitized direct execution of the built API with no egress approval — exited with status 1 and `EgressConfigurationError` before server startup. No credentials, database URL, or external service was supplied.

### Live versus simulated

| Category | Result |
|---|---|
| Live Telegram, Whop, Google, Clerk, AI-provider, Render, or database calls | **None** |
| Successful application startup with external egress enabled | **Not performed** |
| Simulated network dispatch | Mock transports only; denied cases recorded zero dispatches |
| Simulated kill signal | `process.emit("SIGUSR2")` in an isolated child process |
| Simulated worker behavior | Fake worker object; no production logger worker was launched |
| Built API startup check | Local sanitized process; it halted before listening |
| Production/Staging configuration or database verification | **Not performed** |

## Remaining gaps

1. **No machine-wide enforcement.** JavaScript hooks do not prove that a native add-on, direct Node binding, kernel socket, unrelated process, or infrastructure sidecar cannot egress. No OS firewall, network namespace, or egress proxy was configured or tested.
2. **Browser policy is partial.** The response sets `connect-src` from the approved browser-origin list, covering browser fetch/XHR/WebSocket-style connections. It does not fully control top-level navigation, every remote asset/form path, or an already-loaded page after a server-side kill.
3. **Runtime-specific destinations need owner approval.** Exact database, Replit connector, Clerk, and canonical app targets cannot be completed without reading their runtime configuration. No values were read. Until an owner supplies and approves exact targets through the environment configuration flow, the app intentionally will not start.
4. **No authorized integration test.** The real Whop/Groq/OpenRouter/Google/Clerk/Telegram SDKs were not exercised against network mocks at their adapter boundary, and no real database connection was attempted. The generic transport gate tests passed, but provider compatibility remains unverified.
5. **Worker integration is unit-tested, not end-to-end.** The worker preload/termination contract is tested with a fake worker; no application logger worker was started because the app must remain stopped without approval.

## Safety disposition

**Local code remediation: implemented. External-service readiness: unverified.**

The displayed Staging workflow command does not add egress-approval variables. This phase did not inspect inherited environment variables, so the effective egress configuration is **unverified**; the workflow was deliberately not restarted. If the required approval variables are absent or invalid, startup will fail closed. No `CLOUD_CUTOVER_APPROVED` value, Production configuration, Secret, webhook, or database was changed. No billing or user message was sent.

This phase is **not an authorization to enable egress, run a live integration, deploy, or cut over**. Human review is required before any later environment configuration or live validation.
