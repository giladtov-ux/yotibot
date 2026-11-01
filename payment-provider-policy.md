---
name: Payment provider policy
description: The user's decision to use Whop exclusively and stop requesting Stripe credentials.
---

Use Whop only for this project's payment integration. Do not request Stripe keys
or restore Stripe as a fallback.

**Why:** the user explicitly requested removing the project's and landing page's
Stripe dependency and switching exclusively to Whop to enable republishing.

**How to apply:** preserve existing Telegram ownership, permissions and user data
during the payment-provider transition. Treat old billing records as historical
data, not permission to continue calling the previous provider. Removing local
integration code does not cancel subscriptions at the previous provider or detach
a platform integration that may still block publishing.

Verify the availability of the claimed Whop credential without displaying it.
Never claim the provider transition or republishing is complete before the
actual connection and payment flow have been verified.
