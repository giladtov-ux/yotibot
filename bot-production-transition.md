---
name: Bot production transition
description: Safely move the personally bound Telegram bot from workspace polling to production.
---

Preserve the verified owner binding when moving to production; never assume a schema migration copies application configuration or personal records.

**Why:** one-time enrollment stores ownership as private database configuration. Replit's initial production data copy is optional and can overwrite existing production data.

**How to apply:** for a genuinely new empty production database, use the initial copy only when development data is intended for production. For an existing production database, transfer the owner configuration selectively or perform verified enrollment again; do not overwrite the database to restore ownership.

Manual development testing must use an isolated bot identity and separate PostgreSQL database,
not take over the existing live webhook.

**Why:** the user chose isolated development testing for the closure phase.
Full worker startup assumes public-schema authorization tables, so changing only
the search path is not an adequate isolation strategy for this environment.
The user confirmed that this separate-bot, separate-database setup supports
real reminder and appointment workflows.

**How to apply:** require a distinct Telegram bot identity, not merely a rotated
token for the live bot. Use independent SQL state and local backups, verify the
test owner's identity, and leave live webhook, ownership and records unchanged.
Do not route isolated test links into production account or calendar flows.

A separate database is logical data isolation, not proof of restricted access.
Check database-role privileges and credentials retained by launcher/parent
processes before claiming that a test worker cannot access production.

**Why:** diagnostics distinguished the test child's separate identity and
database from broader SQL privileges and a live bot credential retained by
its launcher for identity verification.

**How to apply:** report observed connections separately from access capability.
Use read-only checks; permission hardening is separate work, not an excuse to
change production credentials or databases during a targeted feature.

Stop the development Telegram worker before activating the production worker and webhook.

**Why:** development and production use separate databases. Their advisory locks cannot prevent both workers from sending Telegram reminders using the same bot credential.

**How to apply:** obtain the verified published URL, confirm production ownership and other settings, stop development polling, activate the production worker, and verify its webhook and outbound delivery. A working workspace process is not evidence of 24/7 production operation.

Telegram menu and profile changes made from the workspace also affect the shared live bot. Point the public Mini App menu only at a verified published HTTPS origin, never at a development URL or test fixture.

**Why:** Telegram stores these settings for the bot credential, independently of the development/production databases. Updating a menu is a real external change even when no worker is running locally.

**How to apply:** verify the published URL before calling the Bot API; emulate the SDK for browser tests rather than redirecting the live bot's menu to a test host.

Menu updates can be acknowledged before a subsequent read reflects the new label.

**Why:** updating the compact menu label returned success while an immediate
getChatMenuButton still reported the previous text; a later read confirmed it.

**How to apply:** verify readback after a short delay rather than assuming an
immediate stale read means emoji labels are unsupported. Avoid repeated writes.

The user requires the published base URL to stay exactly
`https://ah-sheli-telegram-bot.replit.app`, without the obsolete hostname or
environment overrides changing generated production links.

**Why:** the user explicitly requested this restriction after old-domain links
continued appearing during Google Calendar connection.

**How to apply:** keep Telegram links and production OAuth/website links on this
origin until the user explicitly changes it. The user now requires this origin
in preview links too: start Google consent in the published application, not
against development SQL state that would return to production.

Source-level OAuth URL checks do not establish what the published server is
returning.

**Why:** the user continued reporting legacy-domain links after source-level
checks passed. Deployment success alone does not prove the active URL generator.

**How to apply:** distinguish local tests from live evidence. Inspect the live
calendar configuration and generated-callback logs after publication, never the
full authorization URL or private OAuth state. Do not claim a live fix from a
workspace restart.

Keep the original official `@AhSheli_Reminder_bot` identity and original token
for Production. The updated application is not a request to promote
`@AhSheliDev_bot` or move the isolated test account into Production.

**Why:** the user explicitly clarified that all existing infrastructure belongs
to the official bot after confusion between bot identity and application version.

**How to apply:** diagnose deployed code, webhook routing and worker readiness
without replacing the official bot credential. Any identity cutover needs a new,
explicit approval; the Dev bot remains separate.
