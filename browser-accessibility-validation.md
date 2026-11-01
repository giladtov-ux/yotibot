---
name: Browser accessibility validation
description: Distinguish keyboard and accessible-tree evidence from real screen-reader speech
---

Report real-browser keyboard checks and browser-exposed accessible names separately
from audible screen-reader verification. Passing Playwright accessibility snapshots
does not establish what NVDA or VoiceOver announces when a focused button's name changes.

**Why:** the available browser tester can drive native keyboard interaction and
inspect accessible names but does not run an OS screen reader. Treating those
checks as listening to speech would overstate the evidence.

**How to apply:** verify the keyboard behavior and exposed names with the existing
browser suite, state the speech limitation explicitly, and use a compatible
assistive-technology environment when actual announcements need confirmation.
