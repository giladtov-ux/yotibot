---
name: External cloud transition
description: Render authentication alternatives, preserved live identity and safe full-system cutover gates.
---

The user has superseded the Render migration: "אנחנו מורדים את הפרויקט מ-Render
וחוזרים לעבוד בצורה פשוטה וישירה מתוך Replit." Do not resume external Clerk or
Render setup under earlier approvals. Preserve existing authentication and data.

**Why:** the user explicitly changed the hosting direction back to Replit.

**How to apply:** prepare Replit startup without Render cutover-policy gates.
This does not authorize deleting an active webhook, bypassing exclusive worker
ownership, or claiming a local worker is live while it exits on webhook protection.
Coordinate the active message receiver before enabling a replacement worker.

The user cancelled Firebase: "ביטלתי את Firebase. אל תבקש מפתחות אימות יותר."
Do not request authentication keys or resume Firebase setup. The current scope
remains Telegram UX only, without background technical tests. Keep active
authentication and the Telegram webhook unchanged.

**Why:** the user explicitly cancelled Firebase and repeated the instruction
not to request authentication keys, after redirecting work exclusively to
natural Telegram replies, grouped schedules and reminder/list controls.

**How to apply:** leave the prepared authentication code inactive rather than
rewriting the working login. Make targeted Telegram changes only; do not start
background tests. Earlier approvals for authentication preparation do not
override this cancellation. Reconsider authentication only if the user explicitly
changes this instruction; any future migration must preserve SQL identity links
and prove ownership rather than match email alone.

The user renewed the Render migration request and previously approved preparing
an independently owned external Clerk application. Preserve the running
Replit-managed authentication until external login, identity/data preservation
and the full-system cutover have been verified. This is not approval to delete
the managed tenant or abandon the full-system migration.

**Why:** the user selected external Clerk preparation after the earlier
managed-authentication pause. The new approval resolves the provider choice,
not the external credentials, ownership proofs or data migration.

**How to apply:** prepare the external configuration without overwriting active
Replit credentials. Do not automatically rebind accounts by matching emails,
or move the webhook to an unready receiver. Verify identity links and SQL data,
coordinate the old worker shutdown, and verify the external receiver before cutover.

The user selected Render as the external host and provided
`https://yotibot-azbu.onrender.com` as the server address. This is the approved
external target domain, not proof that the Telegram worker or database is ready.

**Why:** the user stated that the server was deployed on Render and requested
diagnosis of the Telegram webhook. Preserve production ownership and data during
the transition; do not create simultaneous live Telegram workers.

**How to apply:** use the provided Render domain when configuring the external
service. Coordinate Telegram, Google, email-auth and billing URL changes without
overwriting unrelated working features. Stop the
old worker before activating the new one and preserve production ownership,
database data and encryption secrets. Do not promise the Replit-owned hostname
can be transferred to an external host.

Verify the external service's configured repository, branch and directory
structure before diagnosing its entry point from the workspace source alone.
An upload containing all files can still have discarded the folder paths.
Also verify live build/start commands and automatic-deployment settings;
the repository's deployment template does not prove that an existing manually
configured service uses those settings.

**Why:** migration diagnosis repeatedly targeted the local bot's routes while
the connected repository contained a flattened upload and a catch-all test
server. HTTP 200 responses did not establish Telegram processing.

**How to apply:** inspect the connected repository tree and actual entry file
early when startup logs or health responses differ from the workspace code.
Restore source paths through a reviewed branch, preserve production data and
secrets, and do not solve a missing receiver by repeatedly changing webhooks.
Before a deployed-branch merge, check whether it can trigger deployment.
Check linked environment groups before declaring a secret absent: Render's
service-variable listing excludes group-provided variables. Keep configuration
updates and deployment activation separate when readiness is incomplete.

Keep a repository-root launch interface when restoring the source layout for
this Render service; do not flatten or duplicate the bot implementation just
to fit its launch settings.

**Why:** the user requested that Render's Root Directory stay empty and that
the actual bot be runnable from the repository root, after the flattened
upload made the original bot directory unavailable.

**How to apply:** preserve the existing worker behind the root launcher and
document root-level dependency installation. Keep production cutover approval
and stopping the previous worker separate from preparing or uploading code.

The user selected moving the website, Mini App and bot together to Render,
rather than retaining the website on Replit with a remote worker. Do not
activate a bot-only cutover while the Mini App backend still depends on a
colocated worker.

**Why:** the user chose the complete-service migration after the readiness
review found that the website's mutation relay targets
the local worker, and its production supervisor automatically restarts that
worker. Merely moving Telegram to Render could break Mini App updates or cause
the old process to reclaim the shared database lock.

**How to apply:** include API-to-worker routing and process supervision in
cutover checks, not just the public webhook and health endpoint. Keep one
authoritative writer and preserve the existing authentication and SQL data.

Check Clerk tenancy and external-hosting support before treating authentication
keys as portable. Preparing external mode does not migrate user accounts.

**Why:** Replit's official documentation says its managed Clerk instances are
for Replit-hosted apps and external hosting requires an independently managed
Clerk application. Copying managed keys is not a valid authentication cutover.

**How to apply:** follow the Clerk skill's management check, configure external
authentication separately, and verify preservation of SQL account links before
replacing any keys or activating the new service. Keep the current Replit
authentication intact during preparation.

External Clerk production requires an owned domain and DNS control. The
Render-provided onrender.com hostname alone does not supply that control.

**Why:** Clerk's production deployment requirements were checked during this
migration; using development credentials would bypass launch readiness, not
solve production domain setup.

**How to apply:** obtain the user's approved owned domain, finish Clerk DNS and
production setup, and verify real login before activation. Do not silently
substitute test keys or change the active Replit hostname.
