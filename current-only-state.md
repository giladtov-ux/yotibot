---
name: Current-only Telegram business state
description: Three fixed schedules, tasks and shopping; no accumulated dated reminder archives.
---

The user permits only weekday, Friday and Saturday schedules plus task and
shopping lists as the assistant's long-lived business structures. Preserve
recurring reminder identities and rules; raw old dated schedule sources are no
longer a required archive. Unanswered, delivered one-off reminders remain active
until the user resolves or manually deletes them.

**Why:** the user rejected accumulated historical dated reminders, then specified
that an unanswered one-off remains until manual deletion. These are active
reminders, not completed archives.

**How to apply:** prune completed/archive rows, but preserve a confirmed delivered
one-off while its five-minute check-in is unanswered, including across dates and
restarts. Keep future timers until delivery; uncertain delivery must never become
a blind resend. Preserve tasks independently. Collapse schedule sources into the
three canonical groups and preserve other list contents. Operational
authentication, Calendar consent and delivery-safety state are not reminder
archives; do not delete them.
