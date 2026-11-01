---
name: Weekly schedule semantics
description: Source-preserving schedules, missing times and Israel calendar recurrence
---

Preserve the user's complete schedule text, including activities without a precise clock. Do not make them resend the schedule or automatically ask for missing fields merely to save the text.

**Why:** the user repeatedly rejected invented details, false missing-field replies, and technical announcements when supplying daily or weekly schedules.

**How to apply:** distinguish storing source text from enabling an alert. Missing or ambiguous dates/times may be retained as text without a guessed alert. Weekly alerts must use only the explicitly supplied weekday set and wall-clock time in Asia/Jerusalem. Recompute the next local occurrence rather than adding seven elapsed days, because Israel's DST changes the UTC offset. Preserve ownership and uncertain-delivery protections.

List add/remove responses outside Telegram's newer addition policy should show
the clean, renumbered resulting list rather than an additional technical
confirmation. Telegram additions follow the superseding short-receipt rule in
[Telegram reply format](daily-summary-format.md). Code-generated confirmations
follow the same style requirements as AI-generated conversation.

**Why:** the user explicitly requested direct updated list output without surrounding boilerplate.

**How to apply:** keep mutations durable before replying, retain the full item contents and order, and keep lists separate from timed events.

Treat everyday questions such as “מה הלו״ז של היום” as immediately understandable requests for saved information, not missing-field errors or requests to create reminders. Answer warmly and directly without asking for a day or hour; use Israel's current date and do not invent events.

**Why:** the user requested natural, immediate answers to everyday schedule questions and approved a narrowly scoped routing fix when prompt instructions alone could not prevent erroneous clarification. Other behavior must remain unchanged.

**How to apply:** preserve the information-versus-action distinction in both instructions and routing. Read-only questions must not consume pending writes or create reminders. Missing saved information calls for a short honest answer, not “חסר לי פרט”; actual writes still need valid required fields.

Accept a newly requested reminder for the current Israel clock minute, even if seconds within that minute have elapsed. Keep the original minute boundary and interval anchor; the existing worker should deliver the due reminder promptly. Earlier minutes remain past and must not silently move to tomorrow.

**Why:** the user reported current-minute reminders being falsely rejected as already past.

**How to apply:** use minute precision when validating creation of single, daily, explicit interval-start and initial weekly reminders. Advancing a recurring reminder after delivery must still choose a strictly later occurrence, so accepting the current minute cannot cause repeated sends.

Anchor creation validation and Israel-local date interpretation to one request
timestamp, preferring the actual Telegram message's UTC epoch seconds when
available. History/AI processing must not turn a valid current-minute request
into a past-minute rejection, including across local midnight.

**Why:** the user reported the same current-minute rejection again and required
only time-related changes; comparing against a fresh clock after asynchronous
work defeats minute-precision validation.

**How to apply:** isolate request clocks across concurrent messages, retain the
original due minute, and keep delivery/recurrence advancement on the live clock.
Do not add arbitrary grace periods, manual UTC offsets or tomorrow rollovers;
times already past when the user made the request remain past.

Explicitly configure the bot runtime for Asia/Jerusalem instead of inheriting
the host's default timezone; keep every local-time conversion on Israel's IANA
rules and preserve UTC epoch timestamps.

**Why:** the user repeated the timezone issue and explicitly required Israel
timezone configuration, with no unrelated changes.

**How to apply:** apply the timezone before date/time initialization, including
when loading the time helpers directly. Check actual startup from UTC and other
host zones in both summer and winter. Never compensate by adding a fixed number
of hours, changing the epoch clock, or rewriting saved reminder times.

A timezone incident is not resolved merely by setting the process timezone.
Check the actual request-to-tool calculation and the local time exposed for
confirmation, while retaining absolute timestamps for persistence.

**Why:** the user reported the two-hour discrepancy again after the startup
timezone setting and explicitly requested a correction in the calculation code.

**How to apply:** verify relative elapsed durations and explicit Israel wall
clocks separately; do not claim a live incident fixed from a startup check alone.

Changing only a reminder's clock preserves its saved Israel-local date. A new
explicit date overrides it; the last displayed schedule day can disambiguate
repeated titles, but old AI replies are not authoritative deadlines or receipts.
An individual weekly occurrence change must not silently change the whole series.

Scheduling an existing task into tomorrow's agenda adds a timed event only.
Do not remove, complete or move the original task unless explicitly asked.
An evening-summary follow-up such as "9:00 חזרה למשימות" uses the tomorrow
section, not the summary's today section. The user explicitly treats
"תוריד 9:00 למשימות למחר" as scheduling, not a deletion.

**Why:** the user required independent TASKS/EVENTS, direct scheduling without
false missing-detail questions, and preservation of the original task.

**How to apply:** use the explicit day or current conversation's dated agenda
context, commit the event before confirming, and prove the task records are
unchanged by SQL readback. Preserve the separate Telegram/WhatsApp behavior.

**Why:** the user repeatedly reported future-day changes being rejected as past
today, text-only change confirmations, and schedules still showing the old hour.

**How to apply:** validate the full destination date/time, commit through the
existing reminder SQL writer and verify readback before acknowledging. Read
schedules from current records. Keep original schedule text as historical source;
persist per-date weekly exceptions when changing one occurrence so the old
clock cannot reappear in views or be scheduled again on that day.

An agenda for a specific Israel calendar date must combine that owner's weekly
occurrences, one-off reminders, and open dated or timed tasks/goals. Do not send
a reminder-only gallery or claim the day is empty when any of these records exist.

**Why:** the user reported that date-specific agendas omitted active reminders
and requested one complete, accurate view.

**How to apply:** resolve the requested date in Asia/Jerusalem, read only
owner-scoped persisted records, deduplicate tasks linked to reminders, and keep
the read path mutation-free. Never fill missing agenda data from AI guesses.

When an incoming recurring schedule explicitly includes weekdays and valid
clock times, parse and save those records before asking a model to interpret the
message. Preserve the exact source text and do not ask again for supplied times.

**Why:** the user reported a complete Saturday schedule being treated as if its
times were missing.

**How to apply:** use the deterministic weekly parser and verified existing
writer only when it returns complete entries; otherwise retain the original
ambiguity handling and never invent a time or weekday.

Resolve a named weekday schedule question directly against that saved weekday,
before converting it into the next calendar occurrence. Explicit date questions
continue through the date-specific agenda path.

**Why:** converting a weekday name to a date first can conflate a recurring
weekday profile with a different occurrence or one-off agenda data.

**How to apply:** route exact weekday queries to an owner-scoped weekly read and
filter entries by the requested weekday index; preserve the combined agenda
behavior for today, tomorrow, and explicit calendar dates.
