---
name: Targeted change control
description: User-required preservation of working features and safe test isolation
---

Do not change working code, functionality, layout or colors without explicit,
targeted authorization. Fix only the named bug; preserve previous corrections.
Validate the affected behavior before claiming completion or preparing release.
Changes to any surrounding mechanism, table or software require separate,
explicit approval; permission to repair one target is not permission to refactor
or overwrite the rest of the system.

**Why:** the user repeatedly rejected regressions between today/tomorrow,
reminder timing, SQL-backed facts and branding during prelaunch testing.

**How to apply:** use focused regressions and real SQL readback with synthetic
isolated records. Keep deployment activation separate from source verification;
do not promise 100% stability or native Telegram appearance from a browser test.

Test-only compatibility repairs must distinguish compact presentation from
the information needed to resolve an authorized target. Do not turn an old
sample-size assertion into a product limit on semantic access.

**Why:** the user requires alignment with verified behavior while protecting
owner-bound targets, separate appointment actions and existing safety checks.

**How to apply:** deliberately select an owned record outside the ordinary
context sample, verify its identity independently, and retain cross-owner and
stale-target rejection. Assert action IDs and occurrence deadlines rather than
requiring record titles on generic action-button labels.

SQL persistence tests must isolate the whole session search path, not just
substitute one primary table with a temporary table.

**Why:** saving a synthetic state can also run cleanup against auxiliary tables.
A temporary state table alone does not isolate those other mutations.

**How to apply:** use an isolated schema or a pg_temp-only search path on the
test connection; never let a synthetic snapshot clean up real shared data.

Set the temporary test data directory before importing any bot intent module,
including parsers: transitive imports can initialize storage paths before the
test imports the storage module directly.

**Why:** a parser's static import initialized the file fallback too early while
a new test expected its later temporary-directory setting to isolate storage.

**How to apply:** create the test directory and set its environment variable
first, then dynamically import the entire bot dependency graph. Database tests
must use session-local temporary tables on a single connection, never real
owner records.

Keep unsolicited background diagnostics out of the Telegram conversation.
The user explicitly rejected connection-delay banners and interrupted-delivery
counts in the chat. Preserve private server diagnostics and uncertain-delivery
protections; never replace a failed operation with a success claim.

**Why:** the user repeatedly requested a clean, human conversation rather than
technical announcements and also forbids confirmations unsupported by saved data.

**How to apply:** recover ordinary requests from current saved data when safe;
keep diagnostic reasons in logs. If an action genuinely did not complete,
communicate that fact briefly without a technical explanation or invented result.

Private, aggregated Whop payment-processing alerts to the verified administrator
are explicitly authorized; this does not authorize diagnostic banners in member
conversations or changes to access for unverified payments.

**Why:** the user requested proactive payment-failure notification before a
customer reports a problem, while forbidding secrets and customer details.

**How to apply:** treat payment operations alerts as a narrow exception to the
quiet-chat rule, not permission for general technical messages or public alerts.

A multi-item deletion is an all-or-nothing user request. A single-record
selection or a contextual reminder edit must not consume it and discard its
other targets. Ask about an unresolved target before deleting anything.

**Why:** the user reported a two-item request removing only one item and
explicitly rejected partial work, stale counts and residual linked reminders.

**How to apply:** preserve plural intent through routing and persistence; verify
the whole requested set and the fresh menu together, including associated
one-off timers. Do not automatically replay historical deletion requests.

Historical test remediation is closed. Do not reopen historical test fixes
unless a new, proven regression occurs. Keep deferred skipped and TODO cases
documented separately. New feature implementation requires explicit approval.

**Why:** the user formally closed the historical remediation phase and requested
feature recommendations without authorizing implementation or production changes.

**How to apply:** distinguish the deferred-test backlog from approved work.
Do not use planning or backlog review as permission to alter production code,
configuration or webhook settings.

When the user explicitly approves an isolated Development task, execute its
routine steps through completion without repeating completed investigations or
asking for approval at every internal step. Stop only at a real safety boundary
or an action outside the approved scope.

**Why:** the user repeatedly asked to replace recurring plans and approval loops
with practical execution inside the already-approved isolated scope.

**How to apply:** verify the boundary once, do the approved work and its tests,
then report the measured outcome. Keep Production, live Telegram delivery and
other explicitly excluded actions behind their separate approval boundary.
