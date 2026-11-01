---
name: Mini App integration boundaries
description: Preserve the live bot and per-user isolation while extending the Telegram management interface.
---
The user approved a connected management interface with additive secured APIs,
not a replacement of the existing bot, storage, permission system or scheduler.
Keep the five tabs in physical left-to-right order: profile, lists, calendar,
reminders, tasks/goals; use Hebrew RTL within each screen.

**Why:** the user explicitly requested preservation of existing functionality
and data, then selected the connected-interface scope after clarification.

**How to apply:** extend the existing product rather than introducing a second
bot or a new independent database. Keep marketing and paid onboarding reachable.

Telegram Mini App entry must open the management interface directly, not the
marketing landing page; marketing is only for ordinary web visitors or an
explicit registration action.

**Why:** the user corrected the entry behavior and explicitly rejected opening
the marketing page instead of the five-tab application.

**How to apply:** point native menu links directly to management. Preserve signed
Telegram launch data when handling legacy landing-page links; URL hints must
never substitute for verified API authentication.

The in-app brand icon must open the external marketing website, not refresh the
management interface or act as a profile-tab button.

**Why:** the user explicitly clarified that the logo should open the landing
page outside the Mini App, superseding the earlier internal-refresh request.
Only this link behavior may change; server logic stays untouched.

**How to apply:** use Telegram's external-link opening with a native new-tab
fallback, select explicit website entry so it cannot redirect back to management,
and never copy signed Telegram launch data into the external URL. Keep native
bot-menu entry and the five tabs' navigation unchanged.

Do not add an independent writer for bot records in the website API. Mutations
must run through the authoritative bot worker's existing serialization and
durable commit boundary.

**Why:** an independent web writer can have its changes overwritten by the
worker's cached whole-state commit, or resurrect a reminder the user deleted.

**How to apply:** distinguish additive settings/OAuth metadata from existing
bot state. Keep recurrence counts and delivery receipts when editing a reminder.
Display timezone preferences must not silently change Israel scheduling.

Google Calendar connections require individual user consent and identity-bound
credentials; a project owner's connector is not a shared calendar for all users.

**Why:** the Mini App exposes private user data, and a global connector would
expose the owner's calendar or another user's events.

**How to apply:** keep account links separate by verified Telegram identity.
An AI Google API key is not Google Calendar OAuth configuration.

Keep Calendar OAuth callbacks specific to the environment that started consent.
Do not globally send Preview OAuth returns to production.

**Why:** development and production have separate databases, including the
single-use consent state. A successful Google redirect to the wrong environment
still cannot validate the originating user's state.

**How to apply:** configure the published callback for production only; preserve
the development callback in Preview. Google's authorized redirect registration
must exactly match the URI used for both authorization and code exchange. Local
tests do not prove that registration or real-user consent has succeeded.
