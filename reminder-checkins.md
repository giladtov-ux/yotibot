---
name: One-off reminder check-ins
description: One done/delete prompt five minutes after a one-off, with unresolved reminders retained.
---

For each confirmed one-off reminder, send one question at its scheduled deadline
plus five minutes, with owner-bound “✅ בוצע!” and “🗑️ מחק” actions. A typed “בוצע”
or “מחק” may resolve the focused prompt. Completion removes the reminder and marks
its linked task done; deletion removes only the reminder. If unanswered, retain the
reminder indefinitely and keep it available for manual deletion. Do not repeat the
question or turn it into an emoji nudge.

**Why:** the user explicitly requested a single five-minute resolution prompt and
that unanswered one-off reminders remain saved until they are manually removed.

**How to apply:** measure the five minutes from the scheduled deadline, persist
delivery attempts and confirmed message IDs, and never replay an uncertain send.
Keep a small scheduler-jitter/retry window; do not create a stale backlog after a
long outage. Manual deletion must also clear the pending check-in. Recurring
reminders keep their separate quiet, emoji-only follow-up policy and schedule.
Preserve owner checks and task semantics: “done” completes a linked task, while
“delete” leaves the task unchanged.

The separately approved wake-coffee pilot remains restricted to its explicit
test-user opt-in. An active one-off check-in takes precedence; never send both.

**Why:** the user approved a narrow wake-coffee experiment, not a general
five-minute nudge rollout.

**How to apply:** preserve its existing authorization, deadline and uncertain-send
fences without extending it to other users or overriding a pending one-off prompt.
