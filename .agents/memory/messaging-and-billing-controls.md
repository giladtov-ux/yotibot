---
name: Messaging and billing controls
description: User-selected safety semantics for Telegram opt-out and suspending new checkout sales.
---

For this app, STOP must stop all bot messages while preserving user access, subscriptions, and data. The billing kill switch must block new checkouts while continuing fulfillment for verified completed payments.

**Why:** the user selected these behaviors as the Phase 106 safety requirements.

**How to apply:** preserve these boundaries in future changes to Telegram messaging preferences, billing controls, webhook handling, and payment reconciliation.
