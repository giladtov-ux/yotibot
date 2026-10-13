# Ah Sheli Telegram Bot

בוט Telegram בעברית לניהול רשימות ותזכורות מתוזמנות.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/ah-sheli-bot run start` — start the Telegram bot worker
- `pnpm --filter @workspace/ah-sheli-bot run check` — check the bot's JavaScript syntax
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `TELEGRAM_BOT_TOKEN`
- Optional env: `AH_SHELI_DATA_DIR` — override the local JSON storage directory

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- The bot is dependency-free JavaScript.
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ah-sheli-bot/` — Telegram bot source, command handling, scheduler, and setup notes
- `artifacts/ah-sheli-bot/data/state.json` — generated local storage for per-chat lists and pending reminders (ignored by Git)
- `artifacts/api-server/` — shared Express API service

## Architecture decisions

- Telegram's Bot API is used directly with Node's built-in `fetch`; natural-language intent parsing is local and rule-based (no AI service or external model).
- List and reminder data is stored in a local JSON file and written atomically so it survives process restarts.
- The bot runs as a separate console workflow, not inside the unrelated shared API server.

## Product

- Hebrew Telegram bot “אח שלי” with per-chat lists and reminders, including proactive notifications.

## User preferences

- Keep the bot free of paid external AI services; use local persistence.

## Gotchas

- The bot requires the `TELEGRAM_BOT_TOKEN` secret; never put the token in source code, logs, or Git.
- The bot uses long polling, so only one active bot process should run for a token.
- Local file persistence survives process restarts on the same host; continuous reminder delivery requires the host process to stay running.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
