---
name: Bot worker reliability
description: Safety decisions for session ownership, reconnects, and ambiguous Telegram deliveries.
---

Validate the separately executed bot's import graph during API builds; a successful API bundle does not prove that the bot can start.

**Why:** production accepted the API build while the unbundled bot contained TypeScript syntax in a JavaScript module and had lost its handler exports. The API stayed online but Telegram requests failed because the worker could not load.

**How to apply:** keep the existing JavaScript worker interface and configured AI provider. Build validation must load the side-effect-free handlers and background scheduler, not only the API bundle or message handler: a scheduler-only import failure can leave the website online while the worker crash-loops and webhooks return 503. Never load the live entry point or start jobs as a build check. Do not paste the old Lovable/TypeScript brain over the active module or introduce unconfigured server aliases.

Proactive reminders must run independently of incoming messages using one continuously hosted worker and a scheduling library, not a second Telegram polling process.

**Why:** the user explicitly requested automatic timed delivery without a new user message and repeated the requirement for a scheduling library after a native-timer implementation. The live deployment was found using Autoscale, which can scale to zero despite a correct in-process timer.

**How to apply:** keep the scheduling library compatible with the existing JavaScript bot rather than replacing it with a Python bot. Continuous reminder checking requires continuously running hosting, but do not change the user's selected hosting without approval. Retain persisted due times across restarts, and verify library-driven delivery rather than only a manually invoked reminder hook. Do not claim exact wall-clock delivery or that a workspace restart activates a production update.

The user chose to remain on Autoscale and explicitly declined a paid,
continuously hosted server.

**Why:** the user said "אנחנו נשארים במסלול החינמי (Autoscale) ולא עוברים לשרת בתשלום."

**How to apply:** preserve Autoscale; do not switch to Reserved VM. Explain that
Autoscale is usage-billed, not unconditionally free, and that an internal timer
cannot run while its instance is asleep. Never present self-pings as guaranteed
free, always-on hosting or guaranteed on-time reminder delivery.

The user explicitly approved a best-effort self-request every four minutes
after being informed of possible usage charges and lack of timing guarantees.

**Why:** the user selected "כן, להוסיף פעימה במאמץ מיטבי" after the cost and
sleeping-process limitations were explained.

**How to apply:** keep this separate from reminder scheduling and database
mutations; use only the verified public health endpoint in production. Do not
silently extend it to development, additional URLs or more frequent requests.
Do not describe prepared code as active in the published bot before publication.

Treat reminder recurrence intervals as elapsed time independently of scheduler polling frequency. Keep future deadlines anchored to the planned sequence rather than the completion of a send.

**Why:** the user reported that requested two-minute spacing could become minute-by-minute sending. Separate recurrence metadata and code-owned time arithmetic avoid AI arithmetic errors and timer-driven drift.

**How to apply:** retain recurrence and remaining-count metadata durably, apply user-specified spacing to complete batches, and verify boundaries and restart behavior. After downtime, send one overdue occurrence and skip missed slots rather than flooding the owner; count only confirmed actual sends. Uncertain deliveries remain blocked under the existing safety rule.

After loss of the worker's session lock, stop the process and reload authoritative
state only after a new exclusive acquisition. Do not reconnect and continue from
the old in-memory snapshot.

**Why:** another process may have acquired ownership or changed persisted records
while the connection was lost; continuing stale state can replay sends or
overwrite the owner's changes.

**How to apply:** retain session ownership checks and send fencing. Session locks
require a session-preserving database endpoint, not transaction pooling.

Treat an interrupted Telegram reminder attempt as uncertain, not as proof it
failed. Do not reset persisted attempt markers or automatically replay them.

**Why:** Telegram has no sendMessage idempotency key. A remote delivery followed
by a missing database confirmation is indistinguishable from some failed sends;
preventing duplicates requires owner verification rather than a blind resend.

**How to apply:** retry explicit API rejections only, surface uncertain attempts
to the owner, and preserve their markers across restarts. Explain the
at-most-once/uncertain-outcome limitation rather than promising exactly once.

Telegram flood control is not an AI limit or proof that the worker crashed.
Respect Telegram's full retry interval across outgoing mutations; switching a
failed delete to edit or restarting the process cannot bypass the provider's limit.
Do not hold a webhook open for a long cooldown or claim a reply can be sent
through Telegram while Telegram rejects sends.

**Why:** a live silent-bot incident had healthy worker heartbeats and immediate
queue processing, but Telegram rejected replies for hours. Message-update retry
diagnostics hid the cause, and generic retry timing was shorter than Telegram's.

**How to apply:** distinguish observed delivery rejection from uncertain writes,
leave new updates unclaimed during a known delivery cooldown, and retain durable
receipt retry deadlines without replaying already saved business actions.

Distinguish Telegram profile quotas from message-delivery quotas, and distinguish
one database-lock owner from one physical hosting instance.

**Why:** the last-known-working window already contained a profile-name 429
while webhooks succeeded. Later sendMessage rejections had a different expiry.
Heartbeats alone cannot rule out an external worker using another database.

**How to apply:** report method-specific evidence, not an assumed source of the
flood. Compare verified live revisions rather than blindly restoring old code.
Keep background catch-up bounded so user requests are not starved.

Distinguish a rejected database transaction from a missing COMMIT response.
Atomic storage prevents partial database snapshots, but a lost response does
not prove that the complete transaction was rolled back.

**Why:** the database can finish COMMIT before the connection drops. Treating
that as a definite failure can leave memory behind committed data and make a
retry repeat an already saved action.

**How to apply:** when changing retry or recovery behavior, explicitly account
for unknown commit outcomes; do not promise that every connection error leaves
the database unchanged. Verify recovery using synthetic fault injection, not
real owner records or Telegram delivery.

An unknown state COMMIT outcome requires a new process, not an in-process
reset or retry. Fence queued snapshot writes as well as new work, and keep
uncertain reminder-attempt markers until authoritative reload.

**Why:** rollback after a missing COMMIT response cannot undo a transaction
already committed. Even with the session lock still held, memory may lag behind
the database; queued stale snapshots can erase the completed action.

**How to apply:** fail closed on every missing COMMIT response, discard the
query connection, and reload only after fresh exclusive ownership. Preserve
ordinary retries for failures before COMMIT. Do not restart the live bot when
the requested verification is explicitly synthetic-only.

An interrupted-request report is evidence of incomplete processing bookkeeping,
not evidence that an action failed. Legacy records without chat metadata must
remain explicitly unattributed; never reconstruct their owner or original
request from nearby conversation history.

**Why:** an action can commit before its confirmation or final status is saved,
and the earlier update ledger did not record the sender or request text.
Guessing attribution or encouraging a blind retry can expose another chat's
content or duplicate an already completed owner action.

**How to apply:** keep inspection owner-only and read-only, explain uncertainty
for both processing and error statuses, and direct the owner to inspect saved
lists or reminders before resubmitting. Do not consume a pending clarification
or reset deduplication markers during inspection.

Manual review acknowledges the owner's check only; it is not evidence of saved
data or completed processing. Keep it separate from processing status and
deduplication, and keep legacy requests unattributed even after review.

**Why:** the owner needs to dismiss previously inspected uncertain requests
without either replaying their actions or turning uncertainty into a false
success claim.

**How to apply:** hide reviewed requests in the normal report but allow explicit
inspection including them. Review must not consume pending clarifications,
change saved lists/reminders, or remove the original update identifier.
