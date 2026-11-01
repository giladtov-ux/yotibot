---
name: Telegram native colors
description: Distinguish the current yellow brand controls from Telegram-owned native chat menu chrome.
---
The user now requires the official yellow/black logo and yellow Mini App
indicators. This explicitly supersedes the previous turquoise requirement.
Use brand yellow **#FFD000** with black text for app-owned primary controls.

**Why:** the user requested a return to yellow/black branding. Earlier changes
confused the WebApp MainButton with the native
chat menu circle. Telegram's Bot API exposes no color setting for that circle;
changing a WebApp control or CSS does not recolor it.

**How to apply:** use yellow for controls actually owned by the app and the
yellow circle symbol for the native menu's text label.
Do not claim that the native chat circle was fixed, invent a Bot API parameter,
or replace branding/layout as a workaround. Explain the platform limitation.
