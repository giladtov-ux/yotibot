# External cloud deployment preparation

No external service, database, webhook or DNS setting has been changed.

## Runtime

Use the repository root and Node 22. `render.yaml` defines a **paid, always-on**
single-instance Node web service. Automatic deployment is disabled.
The API already supervises and restarts its Telegram worker in a child process;
do not deploy a second bot service. Both use the same PostgreSQL database.
The public server binds to the platform's `PORT`; the worker uses its existing
private internal port. `Procfile` provides the same start command for platforms
that support it; on Railway set the commands manually if it is not detected.

Build:

```sh
npm install --global pnpm@10.26.1
pnpm install --frozen-lockfile --prod=false
pnpm --filter @workspace/api-server run build
```

Start: `node scripts/cloud-start.mjs`

The cloud entry point refuses activation unless `CLOUD_CUTOVER_APPROVED=1` and
required configuration exists. Import `.env.example` values into the platform's
environment/secret manager. Never commit a populated `.env`. Render prompts for
required keys; optional Whop/storage/provider settings must be added separately.
Use the SAME production DB and SESSION_SECRET to preserve ownership, account
links, reminders and encrypted Google tokens. Do not run schema/data-copy
commands automatically or point this service at development data.

## Public domain and authentication

The current public origin and Google callback are intentionally pinned to
`https://ah-sheli-telegram-bot.replit.app`. Replit's hostname cannot simply be
assigned to a Render/Railway server. External hosting preparation does **not**
perform that domain migration.

Before an actual cutover, obtain approval for the external/custom public domain,
update the pinned origins in server, browser and Telegram code, Google Cloud's
authorized redirect URI, Clerk's allowed production origins/proxy configuration,
Whop return/webhook settings and TELEGRAM_WEBHOOK_URL together. Until then keep
the existing service active and CLOUD_CUTOVER_APPROVED=0.
Google OAuth starts from the published app, not the development database.

Clerk publishable keys must be available during the build. Whop needs its direct
API credentials externally; Replit connector credentials are not portable.
Replit App Storage identity also is not portable: validate upload/storage
features or provision a compatible adapter before moving them.

## Controlled cutover (not performed)

1. Back up production and verify remote DB connectivity/TLS and all secrets.
2. Complete the approved domain/auth/provider changes above.
3. Stop the old Telegram worker BEFORE enabling the cloud service. Never activate
   both against separate databases using the same bot token.
4. Set CLOUD_CUTOVER_APPROVED=1 and launch one instance. Startup registers the
   webhook without dropping pending updates and acquires the existing SQL lock.
5. Check `/api/healthz`, worker readiness/lock/webhook logs, the live
   `/api/mini-app/calendar/config` response and an authenticated OAuth link.
   An API health response alone does not establish worker readiness.
6. Test receiving a Telegram message, SQL-backed changes and a scheduled reminder,
   account separation, email auth, Calendar and billing before declaring success.

If rollback is needed, stop the cloud worker first, then restore the previous
worker/webhook/domain configuration using the same database. Do not restore an
old database snapshot over newly saved user data.
