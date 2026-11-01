---
name: Telegram-only product scope
description: User cancelled WhatsApp and restricted the whole product to Telegram.
---
The user explicitly requires Ah Sheli to support Telegram only, using
@AhSheli_Reminder_bot. This supersedes all earlier WhatsApp setup, account-linking,
QR, channel parity and new channel-pricing requests. Do not restore WhatsApp
adapters, dependencies, UI, QR controls or workers without a new explicit request.

**Why:** the user requested immediate full cancellation of WhatsApp across the
landing page, Mini App, backend and notification infrastructure.

**How to apply:** retain the existing Telegram identity and canonical SQL data,
navy/turquoise branding, task/event separation, short receipts and reminder
scheduling authority. Remove unused channel processes rather than starting an
extra Telegram worker with the live credential. Keep the approved best-effort
self-ping; it is not a guarantee of uninterrupted Autoscale scheduling.

Preserve existing user data and subscription terms. Legacy inactive transport
tables need not be dropped to eliminate the integration.

**Why:** cancelling a delivery channel does not authorize wiping the user's
tasks, events, lists, payment records or silently repricing existing subscribers.

**How to apply:** remove runtime references and new sales of the cancelled
channel without destructive SQL migrations or changes to existing paid access.
