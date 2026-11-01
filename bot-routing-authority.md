---
name: Bot routing and conversational context
description: Authority for list deletion, readable AI output and unfinished conversational requests.
---

The user's standing requirement is continuous, natural understanding: retain
already supplied days, targets and missing-detail answers; do not restart a
request, ask unnecessary questions or repeat approval loops. Match the user's
tone with brief, warm replies without sacrificing any saved information.
Every claim that a new action was performed must have a real successful
persistence operation behind it, never just conversational text.

Do not volunteer the current clock or date as a standalone chat message. The
user explicitly rejects repeated time/date status announcements and wants
contextual, direct Hebrew replies like their reference assistant.

**Why:** those announcements displaced ordinary conversation while the user
was waiting for a relevant answer.

**How to apply:** keep Israel time available for reminder calculations and
explicit time questions; do not remove the due time from a saved reminder
confirmation. Provider failures and queued updates need separate handling;
styling a reply is not evidence that they are fixed.

The user confirmed the fixed weekly schedule display works well. Preserve that
rendering while fixing conversational intent; do not redesign it.

Conversational corrections such as “זה לא וכן שעון נוכחות אלא רק שעון נוכחות”
are edits to the erroneous title, not general conversation. Distinguish that
title from another reminder already named correctly. Reply “הבנתי, תוקן!”
only after durable correction and show the corrected interactive button.
Title-only corrections must preserve the time, weekdays and recurrence.

**Why:** the user explicitly rejected capability disclaimers after an ordinary
correction and required a short acknowledgment backed by a real update.

**How to apply:** prefer an explicit old title or quoted row over stale selection;
ask a short target question only when the saved data genuinely leaves ambiguity.

Interpret a contextual edit before any heuristic that can create a schedule.
Semantic plans must refer to a current owner-owned stable identity, not add a
new row with a similar title. Include the complete owned reminder overview;
short fixed windows can hide the actual target. Preserve omitted fields and
refresh the active Telegram menu only after the committed update.

**Why:** the user showed an apparently successful correction that left the old
entry and a new duplicate in both the schedule and buttons. They explicitly
require a general intent-and-context fix, not product-name-specific patches.

**How to apply:** route renames and combined edits through the same verified
mutation boundary. Coalesce only identical owner-local occurrences/series,
never same-title entries at other times or on other days. Retain an ambiguous
edit's intended patch through a short target clarification, consume it once,
and discard it on a new topic. Native clock parsing remains authoritative over
model-invented time fields.

**Why:** the user explicitly reinforced these requirements after repeated
context mistakes and confirmations that did not match the database.

**How to apply:** preserve current user-owned data and working architecture.
Use saved state as authority and history for meaning, not permission to repeat
old writes. A genuine ambiguity or failed save must remain explicit rather than
being hidden by a confident reply.

Inside a native Telegram record detail view, “מחק” / “למחוק” means that
user's displayed item, not an unspecified item or a target inferred from old
AI conversation. A required confirmation is single-use and bound to the same
selection; “כן” executes it and returns a short receipt plus the updated list.
Returning to a list, changing selection, or an unrelated turn after the
confirmation question must not leave old deletion consent actionable.

**Why:** the user reported repeated target questions, confirmation loops, and
items remaining visible after purported deletion.

**How to apply:** resolve stable identities, not display positions or repeated
titles. Commit the deletion and consumed context together using authoritative
persistence. For recurring reminders disclose series cancellation before consent.
Clear the previous target before changing displayed details so a failed context
save cannot delete the old item behind a different visible selection.

Cleanup confirmations are not an ongoing conversation topic. Only explicit
“כן” / “לא” answers them; a new message cancels the approval and is processed
immediately. Do not repeat “סגור?” after a topic change. Keep the archive intact
while removing obsolete cleanup questions from the active conversational context.

**Why:** the user reported that asking for a shopping list re-triggered an old
cleanup question, and that agreeing did not actually clear the saved list.

**How to apply:** bind cleanup approval to a user-owned list and commit its
consumption with clearing the list. Retain a consumed receipt so old history
cannot revive it after restart or a conversation-history save failure. This
confirmation rule does not discard supplied reminder details or pending list
additions, which are separate unfinished-data contexts.

Clear owner instructions to delete a list or numbered item range must act only on that list, without asking for dates or unnecessary confirmation. Interpret natural Hebrew and unambiguous contextual references through the AI, not just literal command patterns. Do not infer an unrelated target or replay a historical request.

A copied schedule row identifies a record, but is not deletion permission by
itself. It may complete a currently pending, owner-bound deletion selection.
Consume that selection with the saved mutation, and cancel it on a topic change.
A quoted bot reply can identify the target of the user's new explicit command;
it cannot authorize an old command. Ask only about a real ambiguity, using
ordinary language rather than requiring a date/time format.

**Why:** the user explicitly requested natural deletion/update references and
copied schedule rows, while earlier requirements prohibit unintended deletion,
historical action replay and confirmations unsupported by saved data.

**How to apply:** distinguish selection from consent and preserve recurring
series disclosure. Never treat an ordinary copied row or a new reminder request
as permission to delete. Unresolved explicit dates must not silently become today.

All mutation receipts, including additions and edits, must come from a successful
authoritative write and verified database readback, never from free-text AI claims
such as “ניקיתי” or “הוספתי”. A known target in the current request can be routed
to the real writer; an unbound model claim cannot authorize deletion. Repair a
current explicit addition that produces prose at most once, without replaying history.

Native Telegram lists and mutation replies should use clean interactive item
menus, not repeat a technical numbered inventory below the buttons. Keep
receipts short and human, and keep full item details accessible.

**Why:** the user provided comparison screenshots and explicitly rejected
technical text lists and false lookup failures for natural instructions such as
“תוריד לאסוף ועד”. Minor Hebrew spelling differences must not block a clearly
identified task.

**How to apply:** search the current owner's complete saved data, account for
common spelling variants without guessing between different targets, and keep
completed history out of open-item matching. Render success from confirmed
saved data only. A genuinely ambiguous target or failed save must not become
a fabricated success just to avoid an error message.

Task additions must not send holding messages such as “אני מוסיף עכשיו... רגע”.
Return the updated open list from the database readback only after its transaction
commits. Bare activity phrases such as “לאסוף ועד”, “ללכת לספר”, “לקנות חלב”
and “לדבר עם עורך הדין” are tasks by default, without “תוסיף” or a list name.
Ordinary product names in shopping context remain shopping items. Natural
completion, removal and editing must resolve the current user's saved target
from context, without demanding a command format or an unnecessary confirmation.

**Why:** the user explicitly rejected waiting-message loops, required natural
CRUD without artificial command words, and requires command → committed save →
updated list, without a dialogue about the insertion.

**How to apply:** keep Telegram delivery after the awaited writer, suppress
model progress promises, and retain completed tasks only in history. A genuine
database or interpretation failure must be reported as not saved, never hidden.

**Why:** the user repeatedly reported completion and addition messages while saved items
remained unchanged, and explicitly requires database persistence before any success
message. A real PostgreSQL reload also exposed that deleting a list
can leave conversational references that make the saved state invalid.

**How to apply:** verify database readback before acknowledging success and
validate a full reload, not just the changed array. Invalidate references to a
deleted target in the same persisted state. SQL failure or a readback mismatch
must not produce a success reply or expose a successful in-memory deletion.

Provide a bounded, user-scoped saved-record overview to semantic interpretation even when the message has no recognized keywords. A partial overview supports intent resolution, never a claim that all records were inspected; full list and schedule reads remain code-owned.

**Why:** the user requested contextual understanding of free phrasing and fragments while preserving the current architecture. Keyword-gated context can hide the very records needed to understand a reference.

**How to apply:** retain deterministic fast paths and validated writes; let failed local interpretation reach the AI, preserve current-user isolation, and clarify genuine ambiguity rather than guessing a truncated word or a destructive target.

**Why:** the user explicitly rejected rigid keyword routing and requested immediate execution of clearly understood free-form instructions, including "שמנת" as shopping input, without shopping/task confusion or reminder questions.

**How to apply:** deterministic patterns are a fast path, not a permission gate for semantic AI actions. Validate ownership, the entire target and range before changing anything; acknowledge only a confirmed durable change. Ask only when an essential destination or time really cannot be inferred. Keep lists and reminders distinct.

Readable completed AI conversation is not required to be action JSON. A format mismatch is not evidence of a connectivity outage and must not automatically switch the conversation to a reported local-only mode. Invalid action fields must never be repaired from the model's prose; a safe replacement may use only a clear current user instruction. Retain the disclosed, conservative original-text schedule backup.

Partial conversation envelopes may provide a readable reply, including token-limited conversation-only output; partial action envelopes and refusal responses must never authorize writes. General knowledge questions belong to the assistant's normal scope, not only reminders.

**Why:** the user explicitly requested safe recovery of partial `reply` JSON for small talk and free answers to general questions.

**How to apply:** recover only unambiguous conversation fields and decode quoted text safely. Keep duplicate fields, mixed action fields, and unsupported structures out of this recovery path; never substitute raw malformed JSON as the visible reply.

**Why:** the user reported legitimate natural replies being rejected as JSON failures and triggering unnecessary fallback messages.

**How to apply:** separate tolerating conversational output from granting mutation authority. An unconfirmed model save claim is not a saved action. Reinterpret the current user message and confirmed context, rather than copying bad model fields or demanding a fixed user format. Incomplete/refused responses are not completed actions, and genuine authentication/network failures must still be reported honestly without branding a separate local mode.

Keep supplied clarification details and items available across informational turns. Ask only for information genuinely missing; an acknowledgement or unrelated chat must not replay an older write.

**Why:** the user explicitly requested that the bot stop re-asking answered questions or demanding data already provided in the thread.

**How to apply:** use confirmed pending context ahead of AI reconstruction. A new explicit write may supersede an obsolete request, but read-only queries and conversation must not discard its saved data. Bound AI history without dropping the current request anchor and its user clarifications.

Keep semantic instructions concise and provide minimal concrete action JSON examples. Validate new provider behavior with sequential probes rather than several simultaneous full-context calls.

**Why:** enlarging the Hebrew prompt produced format recovery and rate-limit failures during native Groq checks. Compact instructions with concrete string-item examples restored a completed semantic shopping action in one call.

**How to apply:** preserve the same conversational and scheduling requirements while removing repeated explanation. Interpretation repair is bounded and reuses the original user message and confirmed context, never the failed model's fields. Do not repeatedly probe through a provider's stated cooldown.

Do not infer a malformed message array solely from Groq HTTP 400.

**Why:** a native request containing valid roles and string contents was rejected once, while the same full-context request later completed successfully. Message-schema checks cannot prove that every provider rejection has been resolved.

**How to apply:** validate the outgoing text-message schema, then distinguish local validation failure from provider failure. When inspecting provider errors, expose only allowlisted codes or field names, never raw error bodies, failed generations, credentials or conversation content.

Provider-side JSON enforcement is optional; internal validation of every saved action remains mandatory. Keep technical diagnostics out of normal Telegram conversation.

**Why:** the user repeatedly asked for natural replies instead of provider/format errors. API-level JSON enforcement can reject a generation before the tolerant parser sees it. A friendly reply must not falsely imply a saved reminder or list change.

**How to apply:** retain action JSON instructions and bounded semantic repair, but allow completed natural text through the parser. Use conversational failure replies without key names or raw errors, suppress error banners on deterministically answered greetings, and keep genuine failure codes in server logs. Do not substitute a Lovable credential at the Groq endpoint.

OpenRouter is the requested primary provider. Conversation should be prompted as free text; structured action data is required only when a list, task, or reminder actually needs management.

Named-record discovery must use current owner-scoped saved records, include
custom lists, and match names inside longer titles rather than exact titles only.
Never treat a model's negative answer, an old transcript, or a failed SQL read
as evidence that a saved record does not exist.

**Why:** the owner repeatedly reported contradictory inventories and false
absence answers for records previously acknowledged by the bot.

**How to apply:** separate verified reads from model prose. When production
records really are absent, report that limitation honestly; do not silently
recreate potentially deleted reminders from chat history or screenshots.

Search repairs must not reset, reseed or restore records. The owner explicitly
said: "אל תעצור ואל תאפס שום דבר" and requested broad SQL `ILIKE` keyword
search across reminders and saved lists instead of exact-title matching.

**Why:** proposing recreation did not address the requested lookup defect and
would risk duplicating or reviving existing records.

**How to apply:** preserve data and identity, search all authorized storage
sources with bound partial-match patterns, and carry SQL matches through to the
reply without reapplying a stricter whole-word filter.

Inventory reads and named search must agree with the keyboard's verified data,
not a separately cached or model-written inventory. Do not weaken stale-write
protection to make a rejected list addition appear successful.

**Why:** the owner repeatedly reported ignored free-text additions and false
empty-list answers while the same records were visible in buttons.

**How to apply:** complete authorized additions in the same request, require
durable save evidence, preserve custom lists in consistency checks, and render
from the current owned read. Keep one outgoing keyboard card, not a second
model-written inventory.

Named free-text removal and updates must resolve real owned IDs before writing;
a conversational absence or success claim is not evidence that this happened.
Verify the actual incoming phrases through persistence and fresh reads, not only
the search helper with a clean keyword supplied by a test.

**Why:** the owner supplied repeated screenshots where a newly added item was
visible in a keyboard but a subsequent ordinary removal denied its existence.

**How to apply:** cover incoming add → remove and named lookup → rename → clock
edit → delete against the real shared transaction writer. Hebrew prefix aliases
can conflate distinct nouns: prefer literal substring evidence, preserve genuine
ambiguity, and require explicit selection for alias-only destructive matches.

Authoritative SQL read projections must preserve saved ordering and optional
metadata shape when the underlying reminder is unchanged.

**Why:** representation-only differences can make a strict stale-state check
reject a legitimate save. Weakening that check or silently rebasing a worker
would instead risk overwriting concurrent changes.

**How to apply:** keep canonical discovery and inventory reads consistent,
preserve unchanged metadata, and verify read/write round trips with custom
lists and differently ordered reminders in an isolated database.

**Why:** the user explicitly requested OpenRouter and rejected JSON requirements for every conversational response. Provider credentials are not interchangeable, and setup must not disable the already working bot.

**How to apply:** use only the provider's own credential at its endpoint. Retain the legacy connection only during missing-credential setup, explain that state honestly, and do not silently switch providers after an authenticated request fails. Verify configured secret existence safely rather than relying on statements from another environment.
