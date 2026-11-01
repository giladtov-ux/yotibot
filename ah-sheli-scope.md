---
name: Ah Sheli assistant scope
description: Product constraints for the Hebrew Telegram assistant.
---

For style-only requests, change wording and tone instructions only; preserve
user management, architecture, storage, existing data, clocks and behavior.

**Why:** the user explicitly reiterated that warmer, shorter responses must not
change any other component or lose any information or lists.

**How to apply:** keep changes limited to response strings and stylistic prompt
paragraphs. Do not combine them with performance work or structural refactoring.

The reference chat style is short, direct and contextual: ordinary small talk
often needs just one sentence, not a motivational paragraph or a forced nickname.
Use occasional natural “אחי”; acknowledge actual mistakes simply without
defensiveness. Copy the conversational style, never a reference bot's mistaken
claims of deleting or saving data.

**Why:** the user supplied reference conversations with replies such as
“הבנתי”, “סע לשלום” and “ברכה לדרך” to specify the desired character.

**How to apply:** shorten the surrounding phrasing, not requested records or
schedule details. Keep all factual action confirmations code-verified.

The user wants a compact icon-style Mini App menu in the message composer,
not the wide “פתח את האפליקציה” label. Keep the existing Web App destination.
The user also explicitly rejected the text label “אח שלי” because it makes the
button wide. Do not substitute a written brand name for the requested icon.

**Why:** the user explicitly distinguished the compact Botivatzia reference
from the wide text button and restricted changes to this presentation and tone.

**How to apply:** use a short native menu label, not a replacement keyboard or
architecture change. Telegram controls its final shape, color and dimensions;
do not promise a pixel-identical circle on every client. If the exact uploaded
logo cannot be used, ask which supported single-symbol alternative the user
wants instead of silently substituting text.

The supplied “אח שלי” smiling chat-bubble logo is the user's chosen brand
symbol. The user replaced green-on-black with a yellow background and surround,
and black Hebrew lettering and chat bubbles.

**Why:** the user explicitly requested this yellow-and-black branding at both
touchpoints and limited changes to icons and colors, without behavior changes.

**How to apply:** reuse the supplied artwork rather than redesigning it. Telegram's
native Web App menu supports text and a URL, not an uploaded image; disclose that
limit instead of substituting a different keyboard or claiming complete uniformity.
The user explicitly rejected the target emoji for this menu; do not restore it.
After the custom-logo placement limitation was explained, the user explicitly
approved the single yellow-circle menu symbol: “טוב תעשה עיגול צהוב וזהו”.

**Why:** the user chose the supported yellow-circle alternative, without text.

**How to apply:** use 🟡 for this menu and preserve its existing destination.
Do not restore the target emoji or a written brand name, or describe this symbol
as a custom uploaded logo.

Ah Sheli is a Hebrew personal assistant supporting typed messages and transcribed voice messages through the same behavior. Only the allowlisted owner chat may access the owner's profile or saved records; onboarding allows `/id` and an administrator-issued, verified one-time connection command before the allowlist is configured. Use AI only to understand free-form messages and answer general questions. The model may suggest an action, but application code must validate and execute all list, task, and reminder changes. Use a warm, natural masculine voice, ask focused follow-up questions only when required details are missing, and do not invent personal records or live information. The fixed daily routine is context only and must never create reminders by itself. A personal daily schedule or work roster actively sent by the user must automatically produce reminders for all its timed activities as one batch, without requiring per-item reminder requests.

**Why:** on 2026-10-04 the user explicitly replaced the earlier local-only decision and requested an AI-powered conversational assistant with reliable saved actions. The assistant context includes personal details, so other chats must not be able to access it.

**How to apply:** handle typed and transcribed Hebrew through the same pipeline. Require a verified private-chat identity with access as described in telegram-user-access.md; use only that chat's saved data as personal context. Preserve Asia/Jerusalem scheduling and keep reminder delivery independent of incoming messages.

**Why (user-supplied schedules):** the user explicitly requested automatic reminders for a full daily schedule or work roster, including waking up, collection departures and returns, without defining each reminder separately.

**How to apply (user-supplied schedules):** distinguish an actively supplied personal schedule from background context or a request for analysis only. Process the whole schedule together; clarify missing details together, never guess times or silently move past events to tomorrow.

Keep lists and timed reminders strictly separate. Lists are saved text items; reminders and schedules are dated events that trigger proactive messages. A task-list query must not display schedules, and a schedule query must not display list items.

**Why:** the user explicitly required complete separation after seeing these concepts mixed together.

**How to apply:** resolve explicit record queries against the correct saved collection in code, including when AI misclassifies them. Never fill an absent list from reminders or background routine, and never make a timed list item into an alert merely because its text contains a clock.

The owner requires “אח שלי” to speak in warm, natural everyday Hebrew like a good friend and personal assistant, including short human confirmations for technical actions. Avoid dry, repetitive service-style language; vary expressions such as “בשמחה אחי” and “סגור” without forcing a nickname into every message.

**Why:** the user explicitly requested this speaking style for the bot, including list and reminder management.

**How to apply:** keep both AI replies and code-generated confirmations conversational. Warmth must preserve the list/reminder distinction, dates, times, and complete contents, and must never falsely imply successful saving or background work.

Message endings offering more help or availability are prohibited, even when
varied or personalized. Answer the request or confirm the actual action, then
stop. Do not append “אם יש משהו נוסף שתרצה…”, “אני כאן!” or courtesy questions.

**Why:** the user strengthened the rule to an absolute ban on these endings and
restricted the change to the bot's output instruction.

**How to apply:** preserve mechanisms, tables and full requested lists. Necessary
clarification is not a courtesy ending. Clean only conversational prose, not stored
list or schedule text.

The user also forbids unsolicited directories of websites or apps in place of
an answer. Give the verified answer briefly. If understanding is low-confidence
or there is no answer, use exactly: “לא הבנתי, מה תרצה לעשות?”. Sources are
appropriate when explicitly requested.

**Why:** prompt-only closing restrictions did not prevent the reported repeated
service endings and unwanted ESPN/Goal recommendations.

**How to apply:** the user authorized targeted output cleanup as well as prompt
changes. Keep cleanup separate from saved records and all persistence logic.
Remove banned courtesy examples from live prompts, not merely label them as
forbidden. Keep required questions about specific missing action details intact.

Retrospective summaries must inspect chat-bound saved records and dated
conversation history, not equate the short chat-context sample with an empty
archive. Distinguish planned events, sent reminders and confirmed completion;
disclose unavailable or partial history.

**Why:** the user reported false “nothing saved” answers to “מה הסיכום” and
“מה עשינו השבוע”, and asked for only summary retrieval and closing corrections.

**How to apply:** summary questions are read-only, including when pending actions
exist or the AI misclassifies the request. Never replay historical commands.

List and summary presentation should use native Telegram menus with an icon,
clear heading, short description, individually selectable records and Show all.
Group ongoing versus single entries only from existing recurrence or explicit
labels; presentation must not change scheduling, reminders or saved records.

**Why:** the user supplied a native Telegram menu reference and explicitly
limited the upgrade to list/summary appearance and navigation.

**How to apply:** keep menu navigation read-only and separate from reminder
completion/deletion, preserve the summary content, and do not invent recurrence
merely to match a visual group.

Keep user-supplied schedules usable when the chosen AI service is temporarily unavailable: use bounded retries with no alternate provider and a conservative original-text schedule backup rather than interpreting a whole roster as one local command.

**Why:** the user reported repeated generic AI connection failures and explicitly requested stronger retry/fallback protection for full work schedules.

**How to apply:** save confidently parsed events through the same validated batch path and retain the original schedule text when dates/times are missing. The user's later instruction rejects technical backup announcements and automatic schedule clarification questions; keep diagnostics in logs instead. Never reuse unsafe AI output, manufacture routine events, retry already-executed actions, or switch to another provider.

Adapt the uploaded Lovable server backup to the existing Express/PostgreSQL stack; do not migrate to TanStack, Lovable AI, or Supabase merely because the backup uses them.

**Why:** the user explicitly chose adaptation to the project's existing folder structure on 2026-10-07.

**How to apply:** port compatible behavior and security, preserve existing data and owner-only access, and prepare Reserved VM publishing without claiming a workspace workflow is a live 24/7 deployment.

The user's provider instruction is: "לעבור ל־Groq ולשמור על כל יכולות הבוט הקיים". The supplied script requested llama-3.1-8b-instant and read its Groq credential from OPENAI_API_KEY.

**Why:** the user explicitly confirmed Groq after providing a Groq script, replacing the earlier OpenAI choice while retaining all existing bot capabilities.

**How to apply:** use the user's Groq credential directly, not a Replit AI proxy or provider fallback. Preserve compatibility with the supplied secret name instead of requiring another credential entry unnecessarily; it does not authorize requests to OpenAI. Do not reconnect Google or silently change models. Preserve the existing Express/PostgreSQL bot and active webhook, not the supplied standalone Python polling implementation.

The user subsequently requested: "תחליף בבקשה את שם המודל בקוד ל-llama3-8b (או למודל פעיל אחר של Groq כמו llama-3.3-70b-versatile)", superseding the earlier choice to wait for Llama Instant.

**Why:** the user authorized another active Groq model to resolve the unavailable-model failure. The suggested Llama models were absent from the authenticated catalog, while a small GPT-OSS model through Groq had already passed live schedule generation.

**How to apply:** keep the chosen, live-verified small Groq model and low reasoning effort for responsiveness, with no alternate-provider fallback. Do not return to waiting for an unavailable Llama model based on the superseded instruction. Preserve the conservative schedule backup and existing records.

Keep bot credentials in Secrets. Prefer one-time verified private-chat enrollment for owner identification; a manually configured numeric owner identifier remains supported.

**Why:** the two Telegram configuration fields were confused during setup, placing credential-shaped input in an ordinary environment variable. The user then explicitly requested automatic identification from a message to the bot rather than repeating Chat ID entry.

**How to apply:** never authorize the latest arbitrary sender or open the bot to everyone. Require a one-time proof issued through the administrator workspace, then retain ownership privately in the server database; never replace existing ownership implicitly. Do not copy tokens or real owner identifiers into logs, memory, or repository files.