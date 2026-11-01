---
name: Reminder button semantics
description: Safety and recurrence decisions for native Telegram reminder actions.
---

After reminder actions, update only the card that was clicked. Do not sweep
historical copies or edit old cards in response to a text-only acknowledgement.
Old buttons must remain safely idempotent even when their markup is still visible.

Shopping-list and reminder-list requests must produce a single inline-keyboard
message. Put products, reminder titles and dates in buttons, not a duplicate
plain-text inventory or a separate model acknowledgement. A short heading and
an empty-state notice are allowed. Mixed requests still use one card.

**Why:** the owner repeatedly rejected parallel text/keyboard inventories and
explicitly extended the one-card requirement to reminders.

**How to apply:** enforce this at the final delivery boundary as well as list
renderers. Preserve owner-bound callbacks, pagination and saved records. This
list-display rule does not change unsolicited scheduled reminder notifications.

**Why:** the user explicitly selected clicked-card-only updates to reduce
Telegram edit/delete traffic during severe flood-control incidents.

**How to apply:** preserve saved completion/deletion and occurrence/owner checks;
do not resume legacy bulk UI-cleanup queues after publishing.

New individual reminder notifications must be plain messages, without standalone
Done/Delete buttons. Keep actions accessible through the central reminder list.
Do not remove historical callback handlers or their owner/occurrence safeguards.

**Why:** the user explicitly changed the requested presentation to match
Botivation: only the central list should expose reminder controls.

**How to apply:** omit keyboards from new worker sends without changing delivery
receipts, scheduling or idempotency. Existing Telegram messages are not
retroactively edited by this local change. Test old callbacks as compatibility
fixtures rather than expecting new notifications to generate those buttons.

Per-appointment action receipts and shared reminder galleries have separate
lifecycles. A later appointment must never rebind an older receipt's actions.

**Why:** gallery refreshes replace keyboard markup; treating an action receipt
as a gallery can silently make its buttons act on a different appointment.

**How to apply:** track only actual galleries for shared selector refreshes.
Keep each action receipt bound to its original owner, appointment and occurrence,
and verify an older button after creating a later appointment.

After a verified reminder addition or edit in native-tool conversation, include
the updated owner-scoped reminder gallery with its detailed confirmation,
recurring/one-off navigation, ordered records and expansion. This supersedes
the earlier no-gallery rule only for reminder mutations, not ordinary chat.
Send the saved-value confirmation first ("רשמתי לך", full Israel-local date
and clock), followed by a separate current gallery, not a combined list-first reply.

**Why:** the user explicitly requested the Botivation screenshot's reminder
list and confirmation rather than a standalone acknowledgement or receipt buttons.
The user clarified that the confirmation must precede the reminder list.

**How to apply:** use only the current transaction's applied reminder IDs to
trigger the display; never infer a mutation from background state changes.
Keep the Ah Sheli identity and existing occurrence action safeguards.

Reminder action buttons act on saved reminders, never on shopping or task lists.
Completion applies to the selected occurrence only; it must not stop a weekly
or interval series, advance the next deadline again, or decrement its count again.
Deletion cancels the selected reminder, including its future occurrences, and
recurring messages must disclose this before the user presses the button.

**Why:** the user requested real completion/deletion buttons matching the demo,
while existing weekly schedules and exact recurrence intervals must remain intact.

**How to apply:** authorize the callback sender and private chat, bind actions to
the delivered occurrence/message, persist before acknowledging success, and keep
duplicate or outdated clicks from changing a different occurrence. Serialize
button mutations with reminder sends, without blocking them on AI requests.

Occurrence receipts live in the existing authoritative state JSON, committed
atomically with the reminder table. Restore those receipts when rebuilding
reminders from the table, but only for the same reminder ID and owner.

Telegram reminder additions and edits should show a short Botivation-style
confirmation followed by the current native reminder buttons. Use 🔄 for recurring
reminders, 👆 for one-time reminders, compact day/month dates and chronological
clocks. Keep a just-added reminder visible even when the short menu is crowded.
The user's example "תזכיר לי עוד 2 לכבות את הגז" means two minutes; an explicit
time unit takes precedence. Do not borrow Botivation's identity or replace the
official Ah Sheli branding.

**Why:** the user explicitly requested the behavior and reminder-list presentation
in the attached Botivation screenshots, including the two-minute example.

**How to apply:** generate confirmation only from successful writes belonging to
the current request. A background reminder advancing while the assistant responds
must not be presented as an update performed for the user. Green native button
styling depends on support in the Telegram client; do not claim control over the
client's entire chat theme.

**Why:** the existing transaction already stores both representations; extra
schema changes are unnecessary, but table-only reload would lose completion
and message-binding evidence.

**How to apply:** preserve receipt metadata during reload/merge and verify this
with synthetic restart and transaction tests. Do not start a second development
worker against the production bot or mistake source changes for a live rollout.

After a completion button or task-completion command, send a warm, encouraging,
varied reply in the chat rather than always the same fixed wording.
For a button, a temporary callback toast alone is not the chat reply.

**Why:** the user explicitly requested immediate human encouragement on completion
while keeping the rest of the system exactly as it is.

**How to apply:** acknowledge only after durable completion; do not encourage on
failed saves, deletion or reopening a task. Preserve occurrence idempotency and
do not automatically replay an encouragement send with an uncertain outcome.

Button delivery verification must include the serialized Telegram transport,
not only arguments captured by a mocked `sendMessage`.

**Why:** presentation filtering can remove action markup after the reminder
worker has supplied it, so worker-only mocks cannot prove button delivery.

**How to apply:** check the outgoing JSON and completion's empty keyboard as
well as persisted callback effects. These checks do not establish live Telegram
delivery or a real user's button click.

The chat encouragement after pressing Done must also include the next queued
reminder's text and Israel-local date/time in that same message, or a short
statement that no next reminder exists.

**Why:** the user requested next-reminder details alongside encouragement while
keeping the rest of the system unchanged.

**How to apply:** read the owner's queue after durable completion, including the
already-advanced next occurrence of a recurring series. Never expose another
owner's reminders or change a deadline merely to display it.

Follow the [quiet check-in policy](reminder-checkins.md) for proactive hints.
The older repeating five-minute follow-up policy is superseded.

**Why:** the user explicitly replaced intrusive repeating reminders with quiet,
emoji-only presence.

**How to apply:** preserve the single-hint limit, silence windows and chat-wide
cooldown. Keep the delivered occurrence and uncertain-outcome protections intact;
do not restore the obsolete repeating schedule to satisfy legacy assertions.

Typed “בוצע” in a record detail view is a direct action, just like its Done
button, not material to send to the AI for interpretation. List tasks use their
existing checked state. Reminder details must bind the selected occurrence's
deadline; an already-advanced series must not complete its next occurrence
instead of the outstanding delivered one. A selected future occurrence can be
completed once before delivery without cancelling the rest of its series.

**Why:** the user reported “בוצע” being classified as technical information and
required an immediate real Done update with a visible check mark.

**How to apply:** use stable owner-bound identities and the existing durable
writer. A stale or repeated button must not act on another occurrence. Preserve
the successful database result even if a toast, chat reply or menu refresh fails.

Completed tasks remain saved for history but must disappear from the open-task
buttons and counters, just as deleted tasks disappear. Filter before pagination;
do not remove completed records from identity lookup or historical data.

**Why:** the user explicitly requested identical immediate removal from the
open list after either “בוצע” or “מחק”, without losing the saved task history.

**How to apply:** treat the existing checked state as inactive. Active API
results, display counts and buttons exclude it; history and explicit reopening
still use the saved record. Do not introduce a competing status writer.

Completion through any follow-up must durably close the same occurrence and
retire the buttons on its other copies. Keep older follow-ups actionable while
their occurrence remains open; do not expire them merely after many nudges.

**Why:** the user explicitly required Done on any copy to behave like Done on the
original, without leaving it open or sending that occurrence again.

**How to apply:** a clicked bot-authored follow-up can prove an uncertain
delivery only with an unguessable proof persisted before its send. Keep owner,
private-chat and occurrence checks; never accept an arbitrary message ID merely
because its text resembles a reminder. Preserve future series occurrences.

Retrying an idempotent Telegram edit/delete is different from replaying a send
or a reminder action. UI recovery may retry within a durable budget; uncertain
action commits still require fresh exclusive ownership and authoritative reload.
Keep deleted-message cleanup evidence outside schedulable reminders.

**Why:** transient Telegram failures can leave working-looking buttons after a
saved action. Replaying completion or delivery to fix the display would change
recurrence or send duplicate messages; retaining a deleted reminder as an active
record could resurrect it during database initialization.

**How to apply:** commit UI intent with the original action, spend each attempt
before Telegram I/O, and run recovery through the same operation queue. Preserve
pending cleanup evidence during receipt rotation. Never replay encouragements
or send new reminders as part of UI recovery.
