import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramClient } from '../artifacts/ah-sheli-bot/src/telegram.js';

export const RENDER_WEBHOOK = 'https://yotibot-azbu.onrender.com/api/telegram/webhook';
export const DIRECT_RENDER_WEBHOOK = 'https://yotibot-azbu.onrender.com/telegram/webhook';

function publicWebhookUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const knownPaths = ['/', '/telegram/webhook', '/api/telegram/webhook', '/api/public/telegram/webhook'];
    return url.origin + (knownPaths.includes(url.pathname) ? url.pathname : '/[route-redacted]');
  } catch {
    return '[invalid-url]';
  }
}

async function probe(request, url, options = {}) {
  try {
    const response = await request(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  } catch {
    return { status: null, json: null };
  }
}

async function readExistingSecret() {
  const { getPool, closeDatabase } = await import('../artifacts/ah-sheli-bot/src/database.js');
  try {
    const { rows } = await getPool().query(
      "SELECT value FROM ah_sheli_config WHERE key = 'hook_token'",
    );
    return rows[0]?.value;
  } finally {
    await closeDatabase();
  }
}

// Default operation is read-only. No polling, synthetic updates or user messages.
export async function configureRenderWebhook({
  env = process.env,
  apply = false,
  direct = false,
  request = fetch,
  telegram,
  readSecret = readExistingSecret,
} = {}) {
  const targetWebhook = direct ? DIRECT_RENDER_WEBHOOK : RENDER_WEBHOOK;
  if (!telegram && !env.TELEGRAM_BOT_TOKEN?.trim()) {
    throw new Error('TELEGRAM_BOT_TOKEN is required.');
  }
  const client = telegram ?? new TelegramClient(env.TELEGRAM_BOT_TOKEN.trim());
  const identity = await client.call('getMe');
  const current = await client.call('getWebhookInfo');
  const result = {
    bot: identity.username,
    currentWebhook: publicWebhookUrl(current.url),
    targetWebhook,
    pendingUpdates: current.pending_update_count ?? 0,
    telegramReportedDeliveryError: Boolean(current.last_error_date),
    updated: false,
    ready: false,
  };
  if (identity.username?.toLowerCase() !== 'ahsheli_reminder_bot') {
    return { ...result, blocked: 'unexpected_bot_identity' };
  }
  const health = await probe(request, new URL(direct ? '/healthz' : '/api/healthz', targetWebhook));
  const healthy = direct
    ? health.json?.service === 'ah-sheli-bot' && health.json?.ready === true
    : health.json?.status === 'ok';
  if (health.status !== 200 || !healthy) {
    return { ...result, blocked: direct ? 'render_is_not_serving_this_bot' : 'render_is_not_serving_this_api' };
  }
  // A ready worker rejects an unauthenticated empty request with 403.
  const unauthenticated = await probe(request, targetWebhook, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  if (unauthenticated.status !== 403 || unauthenticated.json?.ok !== false) {
    return { ...result, blocked: 'render_worker_not_ready_or_wrong_route' };
  }
  result.ready = true;
  if (!apply) return result;
  if (env.NODE_ENV !== 'production' || env.CLOUD_CUTOVER_APPROVED !== '1') {
    return { ...result, blocked: 'approved_production_cutover_required' };
  }
  if (env.TELEGRAM_WEBHOOK_URL !== targetWebhook || !env.DATABASE_URL?.trim()) {
    return { ...result, blocked: 'render_runtime_configuration_required' };
  }
  // Read, never generate, the secret used by the existing Render worker.
  const secret = await readSecret();
  if (typeof secret !== 'string' || !secret.trim()) {
    return { ...result, blocked: 'existing_database_webhook_secret_missing' };
  }
  // Invalid update body cannot execute an action. 400 proves the secret passed.
  const authenticated = await probe(request, targetWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: '{}',
  });
  if (authenticated.status !== 400 || authenticated.json?.ok !== false) {
    return { ...result, blocked: 'database_secret_does_not_match_render_worker' };
  }
  const accepted = await client.call('setWebhook', {
    url: targetWebhook,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
    max_connections: 1,
  });
  if (accepted !== true) return { ...result, blocked: 'telegram_did_not_confirm_registration' };
  const verified = await client.call('getWebhookInfo');
  if (verified.url !== targetWebhook) {
    return { ...result, updated: true, verified: false, blocked: 'webhook_readback_mismatch' };
  }
  return { ...result, currentWebhook: targetWebhook, updated: true, verified: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--apply', '--direct'].includes(arg))
    || new Set(args).size !== args.length || (args.includes('--check') && args.includes('--apply'))) {
    console.error('Usage: node scripts/telegram-render-webhook.mjs [--check|--apply] [--direct]');
    process.exitCode = 1;
  } else {
    configureRenderWebhook({ apply: args.includes('--apply'), direct: args.includes('--direct') }).then(result => {
      console.log(JSON.stringify(result, null, 2));
      if (result.blocked) process.exitCode = 1;
    }).catch(() => {
      // Network/database exceptions can contain credentials: never print them.
      console.error('Webhook check failed. Verify Telegram credentials, database access and connectivity. No secrets were logged.');
      process.exitCode = 1;
    });
  }
}
