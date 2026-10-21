# External cloud deployment preparation

No external service, database, webhook or DNS setting has been changed.

## Runtime

Use the repository root and Node 22.18 or newer. `render.yaml` is a template
for a **paid, always-on** single-instance service; do not provision it or change
the current service plan without explicit approval. Automatic deployment is disabled.
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

Start: `node index.js`. Keep Render's Root Directory empty.
The root launcher validates the production configuration before importing the
built API. The API serves the existing website and Mini App and supervises one
worker on port 18081. Never run a second bot command alongside it.

## Telegram webhook diagnosis and repair

The approved Render Telegram endpoint is
`https://yotibot-azbu.onrender.com/telegram/webhook`, not `/`.
An HTTP 200 response containing `Yotibot is running!` is a placeholder response,
not proof that this project's Telegram worker is processing messages.

Read-only check (uses the bot credential without printing it):

```sh
node scripts/telegram-render-webhook.mjs --check
```

The complete service exposes `/healthz` with the worker's ready status and
`/telegram/webhook` through the authenticated worker relay. Existing API-prefixed
aliases remain supported. Both health routes refuse to declare Production
ready while the worker is unavailable. The helper's `--direct` option checks
the root health endpoint; it does not require launching a separate worker:

```sh
node scripts/telegram-render-webhook.mjs --check --direct
node scripts/telegram-render-webhook.mjs --apply --direct
```

For direct repair, set `TELEGRAM_WEBHOOK_URL` to
`https://yotibot-azbu.onrender.com/telegram/webhook` in the receiver's production
environment. The repair still requires explicit cutover approval, a ready native
worker and proof that the SQL secret matches the receiver. Always run the
complete service with `node index.js`, not the worker entry file alone.

After stopping the previous worker and launching the real API/worker, run from
the Render runtime with its production environment and database:

```sh
node scripts/telegram-render-webhook.mjs --apply
```

The repair requires `NODE_ENV=production`, `CLOUD_CUTOVER_APPROVED=1`, the exact
`TELEGRAM_WEBHOOK_URL` above, and `DATABASE_URL`. It reads the existing SQL
webhook secret, checks that Render accepts it, registers the authenticated
webhook without dropping pending updates, and verifies Telegram's readback.
It refuses placeholder servers, unavailable workers, wrong bot identities,
and mismatching database secrets. It does not start another worker, recreate
secrets, send user messages, or execute synthetic task updates.

Normal worker startup already registers the webhook automatically. Registration
readback does not establish an end-to-end conversation test: a real Telegram
message and the bot's reply must also be verified after the receiver is ready.

The cloud entry point refuses activation unless `CLOUD_CUTOVER_APPROVED=1` and
required configuration exists. Import `.env.example` values into the platform's
environment/secret manager. Never commit a populated `.env`. Render prompts for
required keys; optional Whop/storage/provider settings must be added separately.
Use the SAME production DB and SESSION_SECRET to preserve ownership, account
links, reminders and encrypted Google tokens. Do not run schema/data-copy
commands automatically or point this service at development data.

## Public domain and authentication

The approved external origin is `https://yotibot-azbu.onrender.com`. The pinned
origins in server, browser and Telegram code now target it. This branch prepares
the complete API, website, Mini App and supervised worker together. It does not
activate the deployment or alter provider accounts.

Before cutover, configure Google Cloud's authorized redirect URI, an external
Clerk application, Whop return/webhook settings and TELEGRAM_WEBHOOK_URL together.
Replit-managed Clerk cannot be carried to external hosting by copying its keys.
Verify preservation of existing SQL account links before replacing authentication
keys. No tenant/user migration is performed by this branch. Keep the existing
service active and CLOUD_CUTOVER_APPROVED=0 until all cutover checks pass.
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
