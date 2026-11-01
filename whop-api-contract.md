---
name: Whop API contract compatibility
description: Avoid mixing legacy helper responses and the current typed Whop API contract.
---

Do not assume the Whop client and payload shapes in older examples still match
the installed SDK. Keep the intentional dated API contract when upgrading.

**Why:** the SDK changed from Stainless to Fern, while undated management-helper
responses still used legacy `company` fields. The dated API returns `account`
fields and payment amounts as Money objects, in major units rather than cents.
Mixing those shapes can silently reject valid purchases or validate wrong prices.

**How to apply:** inspect the installed declarations and verify a real plan
against the configured seller before changing SDK or API versions. Use the
current signing helper and exact raw payload; never grant from browser success
flags. Management-tool errors can be plain JSON rather than SSE, so check both
formats before diagnosing credentials or permissions.
