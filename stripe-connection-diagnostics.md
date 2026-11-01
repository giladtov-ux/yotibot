---
name: Stripe connection diagnostics
description: Avoid false credential failures and distinguish provider payment from webhook delivery.
---

A successful authenticated provider request is stronger evidence of a valid connection than a legacy credential template or an empty cached account object.

**Why:** the connected Stripe account worked through the official connector SDK, while an older credential template wrongly reported missing credentials. A separate warm database-cache lookup in the synchronization library returned an empty account object despite a valid account identity. Neither failure required a new API key.

**How to apply:** inspect metadata field names and types only, compare with the current connector setup, and verify through an authenticated request. Never print credentials or ask the user to re-enter them solely because an older template expected a different shape.

A paid checkout and successful return to the site do not establish webhook delivery.

**Why:** a genuine Stripe test checkout produced a paid invoice, but no signed callback reached the development server. Modern invoice responses also omitted a legacy payment boolean, so assuming that boolean was mandatory would have blocked fulfillment even after synchronization.

**How to apply:** investigate delivery, account/mode and current invoice shape separately. Validate provider payment status, settled amounts and the actual purchased period through trusted provider data; do not loosen access based on a browser success URL or manufacture paid events.

Following a Telegram deep link is not sufficient browser authentication.

**Why:** a malicious browser can generate a linking URL for another person's Telegram ID and send it to them. Automatically approving that browser after the person clicks would expose subscription management.

**How to apply:** require a private Telegram challenge returned to the original browser before allowing customer-specific checkout or portal access. Keep the bot's existing assistant permissions separate from website identity verification.

Sandbox payments must never grant production bot access.

**Why:** a public test checkout can be completed with a public test card and no real payment. Publishing that path without a live-mode guard would bypass the owner's paid-access policy.

**How to apply:** development fixtures may exercise activation in the isolated development database. Production checkout and automatic paid grants require live provider mode; preserve the existing manual approvals while merchant activation is incomplete.
