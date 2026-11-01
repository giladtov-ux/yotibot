---
name: Disaster recovery safety
description: Restoring an older database can lose delivery fences; isolated DR must not reuse broad application credentials.
---

A successful database restore is not sufficient evidence that restarting reminder delivery is safe. Keep restored workers inactive until delivery activity after the backup's recovery point has been reconciled.

**Why:** an isolated native PostgreSQL backup/restore drill reproduced duplicate synthetic reminders when the original simulated sends occurred after the exported snapshot. The old snapshot correctly lacked the newer attempt and delivery receipts. This is distinct from reloading the latest committed state, which the existing recovery fences protect.

**How to apply:** preserve all saved uncertain-attempt markers. For older backups, require delivery/attempt evidence that survives the database rollback, or explicit owner review when evidence is unavailable. Never promise exactly-once Telegram delivery or silently clear fences. Adding a permanent restore quarantine or delivery journal requires separate user approval; the user approved only the temporary Dev drill.

Database-name validation is not a database-role permission boundary.

**Why:** the isolated Dev connection used a superuser role with access to the application database during the read-only diagnosis. This did not establish the published Production database's target or credentials, but it invalidated claims that the existing Dev credentials were restricted to one test database.

**How to apply:** recheck actual privileges rather than assuming they remain unchanged. Use restricted credentials or a separate local PostgreSQL cluster without application/Telegram secrets for destructive DR exercises. Do not change existing roles, production configuration or webhooks to facilitate a test.

Tiny synthetic fixtures prove logical restoration and failure handling, not production-scale recovery times, off-host durability, backup retention or PITR.

**Why:** the approved drill restored the public application schema and synthetic records only, with manually invoked worker functions and simulated time; temporary archives were deleted during cleanup.

**How to apply:** distinguish measured dump/restore duration from service RTO and distinguish a demonstrated snapshot recovery point from an established production RPO or a retained operational backup.
