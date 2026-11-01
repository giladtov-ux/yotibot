---
name: Google OAuth retry limits
description: Why database rollback does not make an exchanged Google authorization code reusable.
---

A PostgreSQL rollback cannot undo Google's consumption of a one-use authorization code. Keep OAuth state until credentials are durably saved, but request fresh consent after an uncertain exchange or persistence failure rather than promising that reloading an old callback will recover it.

**Why:** an external token exchange and a database transaction are not a distributed atomic operation. Premature state consumption disguises network or storage failures as expiration; a failed commit acknowledgement may also leave the final database outcome uncertain.

**How to apply:** distinguish cancellation, genuinely invalid/expired state, provider rejection and persistence uncertainty. Do not claim success before commit or claim that nothing was saved after an uncertain commit. Never expose codes, states or tokens in diagnostic logs.

The Google connection is optional to the core Mini App: calendar-provider failures must not prevent tasks and lists from loading. This is not permission to swallow platform identity or membership failures.

**Why:** Google outages and expired Google grants are distinct from loss of authorization to the user's Ah Sheli account. Treating both as the same failure either blocks unrelated work or bypasses access controls.

**How to apply:** preserve stored Google grants during transient failures; require fresh consent for definitively rejected grants. Keep core-account authentication failures blocking. Serialize refreshes across server instances and never let a stale refresh recreate a disconnected account.
