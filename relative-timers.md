---
name: Relative reminder deadlines
description: Preserve elapsed durations independently of Israel wall-clock ambiguity.
---

Relative reminders must retain the absolute future instant calculated from the
original Telegram message's send time, including seconds, for both text and
voice. Receipt, queue, transcription and model-processing delays must not shift
that reference. Do not round down the current minute or rebuild that instant
from a local date and a displayed clock.

**Why:** a relative duration is elapsed time. Minute rounding shortens it, and
the repeated Israel clock at autumn DST can resolve to an earlier occurrence.
The user requires real timed reminders, not an approximate display, and
repeatedly specified Telegram send time rather than the server processing clock.

**How to apply:** preserve the absolute deadline through durable saving and
reload, using local date/hour only for display. Keep the existing persistent
worker rather than introducing process-local timers that disappear on restart.
Questions about planning must not create timers or save the question as a
schedule; only an actual scheduling request authorizes that write.
