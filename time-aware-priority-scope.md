---
name: Time-aware priority scope
description: Approved recommendation-only boundaries and separately approved production activation.
---

Time-aware priorities are recommendations, never scheduling instructions.
Do not turn them into automatic task, appointment or reminder mutations or
require database schema changes.

**Why:** the user explicitly approved a recommendation-only feature while
protecting the completed historical fixes and existing production behavior.

**How to apply:** keep planning separate from the state writer; retain the
existing morning button and authorization fences. Label estimates, do not
invent appointment ends or user working hours, and distinguish saved-schedule
coverage from full calendar availability. Live Google integration must not
silently add connection writes through token refresh/invalidation. Production
activation and selection of default availability hours require separate approval.

Daily routine exclusions are virtual availability constraints, not calendar
appointments. Combine them with existing commitments rather than replacing
the committed schedule or inserting routine appointments into SQL or a live calendar.

**Why:** the approved daily-routine configuration and subsequent per-user
database settings are isolated-dev-only and must retain the feature's
recommendation-only, no-rescheduling scope. Settings persistence is authorized;
calendar or task mutations are not.

**How to apply:** pass dated, owner-scoped exclusions through the existing
busy-input contract. Dev profile approval does not authorize production
activation or permanent changes to working hours.
Stored-routine mode must use the authenticated caller's own settings and
fail closed when they are missing, never borrow another user's routine.

The user approved preparing a single-test-user rollout gate in Dev and a new
commit for review, not deploying that revision or enabling it in Production.

**Why:** approval to deploy the earlier exact revision was conditional on
single-user isolation, and that prerequisite was not met.

**How to apply:** obtain separate approval for the replacement commit and live
test identity. Reverting to pre-gate code must leave the global feature switch
off; code rollback alone does not restore hosting environment settings.
