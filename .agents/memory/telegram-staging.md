---
name: Telegram staging isolation
description: Safety constraint for manually testing the Telegram bot in Replit Development.
---

Use a separate Telegram test bot token in Replit Development Secrets. Keep the Production bot token and webhook isolated from staging.

**Why:** The user requested manual testing in Staging with a test bot; registering a webhook replaces that bot's existing webhook target.

**How to apply:** Use the development-only worker gate and current Replit Development host. Never copy the test token into Production or point the Production bot at a staging endpoint.
