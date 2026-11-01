---
name: Native tool conversation policy
description: User-authorized replacement of ordinary intent routing with native tools and model-written replies
---
Social replies should be warm, brief and contextual, not echoes of the user's
words. Thanks is not permission to change records. "מה זה" and "לא הבנתי" refer
to the preceding exchange, not to the date; ask for clarification if needed.
Unsolicited bare clock/date prefixes are also unwanted in ordinary conversation,
not just explicit "הזמן עכשיו" announcements. Capacity notices should be warm
but must not promise a later reply when no retry is scheduled.

**Why:** the user rejected robotic echoes and unsolicited dates and requested
Botivation-like first/second-person Hebrew conversation, without changing identity.

**How to apply:** keep this in native model policy and preserve recent history.
Do not replace the model with fixed social-response templates or claim it is human.

Ordinary text and successful voice transcripts use native function calls and
one model-written final response, not local scripts or a model JSON intent
followed by a canned renderer. No second confirmation for a clear authorized
change. Preserve authorization, target validation and transaction verification;
missing required information is not permission to guess a destructive write.

**Why:** the user explicitly authorized a message-engine refactor, replacing
the earlier instruction to make only narrow prompt fixes. They rejected
Confirm State and coded conversational/error responses, not data protection,
SQL schema preservation, exclusive OpenRouter speech or scheduled delivery.

**How to apply:** keep tools structured and owner-scoped, all changes in one
verified batch, and let the model phrase failures and final results when the
write outcome is known. Do not restore legacy intent/confirmation routing as an
automatic fallback. Legacy callbacks and nonconversational administration are
compatibility boundaries, not reasons to reactivate scripted ordinary replies.
A provider failure must never authorize guessed writes or replay an uncertain
commit.

Explicit day/date-only questions are a narrow exception: return calendar facts
computed in code for Asia/Jerusalem at the original Telegram message's send
instant, including voice, rather than model-written weekday guesses.
Calculate tomorrow as the next local calendar date, not a 24-hour duration.

**Why:** the user repeatedly received changing, incorrect weekdays and explicitly
demanded accurate dates independent of model guesses or prior conversation.

**How to apply:** keep this exception confined to explicit calendar questions.
Do not route agenda queries, reminder instructions, "מה זה" or ordinary social
conversation through it. Repeated questions must not advance a stored day counter.

Exact, fully named list-read requests may use the saved-list renderer directly,
without an AI round trip. Contextual questions and all mutations still use
native tools; a failed provider request never enables guessed actions.

**Why:** the user specifically requested quick handling of list commands during
an incident with minute-long delays. A fully specified read needs no inferred
intent and must not depend on provider availability.

**How to apply:** authorize first, refresh the owner's committed lists, render
only the requested list, and deliver before appending conversation history.
Do not extend this exception to agenda interpretation or writes.

If a mutation reaches persistence and its outcome is uncertain, do not ask the
model to author a user-facing success/failure claim. Suppress the final reply
and do not retry automatically.

**Why:** the model can contradict an `ok:false` tool result; an unconfirmed
transaction must never produce a false success message.

**How to apply:** keep this guard at the native-tool response boundary. Allow
model-authored clarification only for validated input problems that did not
reach persistence.

Tool entity names must distinguish individual tasks from a whole-task-list
operation; make special scopes explicit rather than using an ambiguous plural
label for an unrelated operation.

**Why:** a live model chose a plural task entity for ordinary task additions
even though it was intended only for deferral, then repeated the rejected call.
Schema validity alone did not establish semantic compatibility.

**How to apply:** verify new tool contracts against actual model calls using
synthetic records and a nonpersistent writer, in addition to deterministic
SQL tests. Keep real user data and Telegram sends out of those probes.

For successful reminder and task mutations, never surface a generic system or
model phrase such as "changes saved," even as a preface to the actual action
confirmation. Build the confirmation and updated list from the verified mutation
receipt, and keep that same user-visible result in conversation history.
Explicit day-agenda questions must use the saved agenda rather than being
shortened into a next-action status or replaced by a reminder-button gallery.

**Why:** the user repeatedly requested clear, natural, non-technical replies and
the screenshots showed that generic acknowledgements and the wrong schedule
view obscured whether the requested action was actually completed.

**How to apply:** remove generic save-status wording from model prose; separate
factual mutation receipts from free-form replies and only confirm actions after
their verified write. Route explicit agenda requests to owner-scoped saved
records, without altering data.

״נקה את הלו״ז״ means deleting tasks only, not reminders or the recurring routine.

**Why:** the user explicitly selected ״משימות בלבד״ when asked to define this
bulk-deletion command.

**How to apply:** keep this scope in both tool authorization and confirmations.
Clearing tasks must not indirectly cancel their existing reminder timers.
