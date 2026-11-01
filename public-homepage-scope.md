---
name: Public homepage scope
description: Public marketing copy does not authorize bot access or real subscriptions
---

Do not change design, structure or theme colors without an explicit user instruction. The current authorized branding uses the official yellow/black “אח שלי” logo from the Library and yellow accents/indicators across the bot, Mini App and interface. Keep the existing layout, typography and dark backgrounds when applying these specifically requested replacements.

**Why:** after the earlier navy/turquoise restoration, the user explicitly requested a return to the Library's yellow/black logo and yellow indicators. That supersedes the prior turquoise logo/accent requirement, but does not authorize unrelated layout or behavioral changes.

**How to apply:** reuse the approved original palette rather than inventing shades or a new style. Preserve features, data, content and navigation when restoring appearance. Functional bot work never authorizes unrelated visual changes.

The user now wants the compact Telegram menu indicator yellow, matching the yellow/black logo.

**Why:** their latest instruction is “הפוך את הנקודה ... חזרה לצבע צהוב”.

**How to apply:** use the yellow symbol for the menu label and yellow for app-owned controls. The native menu's API exposes a text label and Web App target, not a custom background color; do not claim to recolor Telegram-owned chrome.

Execute only explicitly requested changes and verify the relevant appearance in Preview before reporting completion; never claim a native Telegram control was verified through a website screenshot.

**Why:** the user repeated the prohibition on independent changes and explicitly required self-verification before completion reports.

**How to apply:** keep unrelated working code, layout and behavior intact. Distinguish Preview checks, generated Telegram message checks and live Telegram verification in completion reports.

Check website onboarding navigation by the actual visible target, not just the
URL fragment.

**Why:** the existing tab routing and inherited smooth scrolling allowed the
registration fragment to look correct while its controls remained out of view.

**How to apply:** verify both direct entry and CTA clicks bring channel controls
into the viewport. Keep any adjustment scoped to website onboarding rather than
changing Telegram or Mini App routing.

Marketing-page changes alone do not authorize subscriptions or changes to bot access. The user subsequently explicitly requested website registration and automatic access after verified payment, and connected Stripe; that is separate authorization for the paid onboarding flow.

**Why:** the user requested integration of their complete HTML homepage, not subscriptions, public onboarding, payment processing or changes to the existing bot. When asked explicitly, the user confirmed the wake-up popup is part of the demo, not a real Telegram reminder.

**How to apply:** preserve Telegram ownership checks and private server endpoints when editing the public page. Paid onboarding must rely on verified identity and payment, not marketing text. Do not add tier-specific limits or change assistant capabilities just because plan descriptions exist; the user asked to preserve existing bot behavior.

The user explicitly replaced the old preview-only email scope with full email
registration and sign-in on the landing page and Mini App. Keep the product
Telegram-exclusive and preserve the existing yellow/black brand and layout.

**Why:** the user now requires “מנגנון הרשמה ואימות משתמשים מלא דרך דוא״ל”.

**How to apply:** use real verified email identities and SQL persistence.
Never let an email login or a typed Telegram ID alone claim another user's
existing data: native Telegram ownership must be explicitly confirmed.
Email verification and identity linking do not bypass the existing access or
subscription policy. Keep the existing signed native Mini App launch working.

Google sign-in on the managed email-auth screen and access to a user's Google
Calendar are separate authorizations. Missing calendar OAuth configuration is
not evidence that the Google sign-in button is broken.

**Why:** verification confused the managed sign-in provider with the separate,
per-user calendar connection; disabling sign-in would remove a working option.

**How to apply:** check calendar configuration in the calendar module, not on
the email sign-in screen. Never substitute the creator's connected calendar for
other users' individual calendar consent.

The original uploaded HTML contained corrupted Hebrew and spelling mistakes; those are not intentional product copy.

**Why:** the user subsequently supplied visual references and explicitly requested matching their design, headings and text with correct, orderly Hebrew.

**How to apply:** use the user's website reference images as the authority for the public page rather than restoring the earlier HTML's errors. Preserve readable RTL layout and isolate Latin product names and prices.

The conversation demo must run live in the page's own HTML, CSS and JavaScript
on loading and in a loop without clicks, with the exact wake-up request, bot reply
and visual popup. The video reference also calls for automatic visual completion
and a short follow-up acknowledgement before the sequence repeats.

**Why:** the user reported that the animation was still not visible and explicitly
asked for live code in the page, not verification alone, then supplied a video
to demonstrate the desired automatic sequence.

**How to apply:** changes to this demonstration must visibly work on page load;
passing timer tests or showing an early screenshot is not sufficient delivery.
Automatic completion in this demonstration is illustrative only and must not
complete, delete or send any real Telegram reminder.

The demo must autoplay even when the device requests reduced motion; do not
replace it with a static preview or disable the pause/resume control.

**Why:** the user explicitly asked to remove the static “ללא הנפשה” mode because
it prevented the demonstration from running.

**How to apply:** keep the progressive messages and wake-up popup running on
page load, with an available manual pause/resume button. Device motion settings
may reduce decorative movement, but must not stop the demonstration sequence.
