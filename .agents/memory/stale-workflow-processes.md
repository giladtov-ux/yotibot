---
name: Stale workflow processes
description: Handling an API server process that remains alive after its workflow reports a failed restart.
---

When the API workflow reports `EADDRINUSE` on port 5000 after a restart, check the listening process before retrying. The old API server and Telegram worker can remain alive even when the workflow state shows the new start failed. Gracefully stop only the identified project process tree, then restart once and confirm the health endpoint and worker logs.

**Why:** A Staging workflow restart failed because the previous API process still held port 5000 while the workflow status showed failure.

**How to apply:** On a failed restart with `EADDRINUSE`, inspect `lsof -iTCP:5000 -sTCP:LISTEN` and process ancestry; do not blindly retry or terminate an unidentified listener.
