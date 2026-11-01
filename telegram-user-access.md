---
name: Telegram membership policy
description: Manual registration, owner approval, feature gating and owner-context privacy.
---

The bot may serve registered users beyond the original owner. New users should
be directed to website registration and payment, without a manual registration
button in the bot menu. Basic and the owner's manual approval tools remain
available. All assistant capabilities require active permission or an unexpired
subscription; registration and checking one's own access remain available.

**Why:** the user first chose manual approval and gating all assistant features,
then explicitly requested website-first paid onboarding while preserving the
existing permission model and administrator-only management.

Paid website registration should activate access automatically for 30 fixed days
from verified payment, without requiring manual approval. Preserve any existing
longer or lifetime permission; do not retroactively shorten saved access.

**Why:** the user explicitly requested a 30-day Auto-Grant after authorized payment,
not a variable-length monthly entitlement.

**How to apply:** accept payment confirmation only from the payment provider's
verified server-side flow, never a browser-supplied success flag. Production paid
onboarding still requires live provider mode.

Keep the verified owner as the sole administrator with uninterrupted access.
Manual membership approval is not proof of payment.
Treat each member's private Telegram identity as a separate data boundary for
text, voice, history, lists, summaries, reminder buttons and proactive delivery.
Do not include the owner's personal facts or background routine in another
member's AI prompt. Expiration or revocation pauses access, never deletes saved
data. Preserve the existing human style and scheduling behavior.
