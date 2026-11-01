---
name: Access notification policy
description: Delivery guarantees for registration and manual access approval messages.
---

Keep membership changes independent of notification delivery. Prefer a missed
notification over an automatic duplicate when Telegram's result is uncertain;
even confirmed rejections do not automatically replay access notifications.
Repeated grant commands are real extensions, not a way to resend an approval.

**Why:** the requested membership notifications must not jeopardize a saved
permission, and Telegram cannot distinguish some timeouts from delivered messages.
The owner must verify an uncertain outcome with the recipient before resending.

**How to apply:** preserve this guarantee when adding onboarding or approval
paths. Do not retrofit automatic retry or historical-registration backfill
without explicit authorization. Report successful access changes separately
from the notification outcome.
