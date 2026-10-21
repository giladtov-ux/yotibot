# Database connection and worker reliability

## Findings and limits of the diagnosis

The original lock held a checked-out query-pool connection indefinitely, without
heartbeat, TCP keepalive configuration, a bounded liveness query, or backend
ownership verification. Its error listener immediately exited the process with
no diagnostic code. An idle data-pool error also had no listener and could crash
the process independently of the lock. These are verified lifecycle weaknesses;
they do not establish which transport event caused past production disconnects.

The deployment metadata obtained during this investigation reported a public,
successful **Autoscale** deployment. Autoscale does not provide a continuously
running singleton reminder scheduler. Database advisory locks apply only within
one database; they cannot fence development against a separate production DB.

The deployment-log query initially returned no logs, but the subsequent log
refresh supplied the live production timeline. On 2026-10-07, a new child was
rejected because another worker held the lock, followed by repeated webhook 503s
until the child became ready. Profile setup also received a Telegram rate-limit
rejection before readiness. A delivered message measured history=43 ms,
assistant=11,410 ms, conversation-save=265 ms, Telegram=489 ms, total=12,208 ms.
Gemini had a network failure and a 503 during that request. That sample's
latency was predominantly AI, not history or conversation persistence.

The lock-loss exit occurred independently later, at 15:00:32 UTC, followed by a
supervisor restart. The original log contains no driver error code and the
original connection has no heartbeat, so the exact upstream transport reason
cannot be reconstructed from this timeline. The competing-lock startup and
delayed readiness do explain observed 503s without removing the exclusive lock.
The patch addresses the verified unmonitored-idle-connection lifecycle and
startup/recovery weaknesses, and adds the diagnostics needed to distinguish any
remaining infrastructure disconnections after publication.

Production SQL was read-only. Settings on its read replica
reported `idle_session_timeout=0` and
`idle_in_transaction_session_timeout=300000`. Replica connection and lock
snapshots do **not** describe the primary's active worker sessions, so their
absence was not treated as evidence that the primary had lost its lock.

## Implemented behavior

- One dedicated PostgreSQL session owns the existing advisory lock key. It is
  separate from the five-connection data pool and has TCP keepalive enabled.
- Every ten seconds a five-second-bounded query checks both the original backend
  identity and that backend's granted advisory lock. Heartbeats never call
  `pg_try_advisory_lock` again. Reacquiring a session lock repeatedly would
  increase the acquisition count and hide ownership changes.
- EOF, socket error, missing lock, or heartbeat timeout fences the worker and
  exits it. No in-place reconnection continues using stale in-memory records.
  The API supervisor starts one new child after exit; the child first obtains
  the lock and reloads authoritative state. Initial recovery waits one second,
  repeated failures back off to thirty seconds, and stable uptime resets backoff.
- Query-pool idle errors evict a bad connection without crashing the worker.
  Queries and connection acquisition are bounded. Non-idempotent writes and
  ambiguous Telegram sends are never blindly retried.
- The HTTP listener starts after database/owner/token initialization, before
  external profile setup. Health includes readiness. Only the initialized
  lock owner receives forwarded work. Cosmetic Telegram calls no longer delay
  the webhook or scheduler. Registration preserves pending Telegram updates,
  authentication, the existing hook token, and the configured webhook URL.
- The development webhook guard runs before database initialization and again
  before polling. It never deletes an active webhook.
- Message timings retain history, assistant, conversation-save, and Telegram
  phases, including elapsed time in the failing phase. Heartbeats log duration
  and lock loss logs only a sanitized code, not driver messages or credentials.

Session advisory locks require a session-preserving PostgreSQL endpoint, not
transaction-mode PgBouncer. A `pg.Client` avoids local pool reuse but does not
convert a transaction-pooling proxy into a session endpoint. Ownership checks
fail closed if the backend changes; never bypass those checks to make such a
proxy appear healthy.

## Reminder delivery on disconnect

The persisted `lastAttemptAt` is an uncertainty marker until an outcome is
confirmed. A new process never automatically replays such an attempt. An
explicit Telegram `ok:false` rejection permits a retry after the usual delay.
A network error, timeout, unreadable response, interrupted multipart message,
or successful delivery followed by database failure does not prove rejection.
These stay blocked rather than generating duplicate notifications. Other
unattempted due reminders continue normally.

On restart, the owner receives a warning if reminders have uncertain delivery.
Existing markers are retained, not deleted or reset in bulk. The owner can
inspect the reminder list and the Telegram conversation, then cancel/recreate
the affected reminder explicitly. There is no claim of exactly-once delivery:
Telegram `sendMessage` has no idempotency key, and both guaranteed delivery and
guaranteed no duplicates cannot be achieved across an ambiguous remote outcome.

## Verification

- `pnpm --filter @workspace/ah-sheli-bot run check`
- `AH_SHELI_DB_LOCK_TEST=1 pnpm --filter @workspace/ah-sheli-bot test`
- `pnpm --filter @workspace/api-server run typecheck`

The PostgreSQL regression probe uses a separate advisory key and test sessions
only. It does not run a bot, call Telegram, change schema, read personal records,
or modify persistent data. It verifies exclusivity, ownership heartbeat,
connection-loss fencing, and fresh acquisition following disconnect. Unit
regressions cover stalled/failed heartbeats, acquisition cleanup, no overlapping
heartbeats, readiness forwarding, restart backoff, reply/reminder send fencing,
and confirmed versus uncertain delivery after reloading persisted markers.

## Apply to production (user action required)

1. Leave the development Telegram worker stopped. Do not run `connect-owner`,
   reset the existing owner, replace the DB, clear delivery markers, or delete
   the webhook as part of applying this patch.
2. Update the existing API deployment to a public **Reserved VM** / always-on
   singleton. Keep the same existing production database and webhook URL.
   Reserved VM is a paid publishing mode; review its price before confirming.
3. Publish the updated code yourself. There is no schema change required by
   this patch. Do not choose to overwrite production with development data.
4. Check live logs for one lock acquisition, periodic bounded heartbeat times,
   one active webhook, and any uncertain-delivery warning. Compare message phase
   timings to distinguish remaining database, AI, and Telegram latency.
5. Confirm one owner message and one new test reminder work, and that an already
   sent reminder is not replayed. Investigate any new lock-loss code against its
   heartbeat timing before assuming the original infrastructure trigger is
   resolved.

No production deployment, production write, or additional real Telegram worker
was performed during this task.
