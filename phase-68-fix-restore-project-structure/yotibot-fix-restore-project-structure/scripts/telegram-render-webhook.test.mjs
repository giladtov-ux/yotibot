import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRenderWebhook, RENDER_WEBHOOK, DIRECT_RENDER_WEBHOOK } from './telegram-render-webhook.mjs';

function fixture({ placeholder = false, unavailable = false, wrongSecret = false, username = 'AhSheli_Reminder_bot' } = {}) {
  const calls = [];
  let registered = 'https://old.example/api/telegram/webhook?private=value';
  let reads = 0;
  return {
    calls,
    get reads() { return reads; },
    options: {
      env: { NODE_ENV: 'production', CLOUD_CUTOVER_APPROVED: '1', DATABASE_URL: 'fixture-only', TELEGRAM_WEBHOOK_URL: RENDER_WEBHOOK },
      telegram: { async call(method, payload) {
        calls.push({ method, payload });
        if (method === 'getMe') return { username };
        if (method === 'getWebhookInfo') return { url: registered, pending_update_count: 2 };
        if (method === 'setWebhook') { registered = payload.url; return true; }
        throw new Error('Unexpected method');
      } },
      readSecret: async () => { reads++; return 'fixture-secret'; },
      request: async (url, options) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(placeholder ? 'Yotibot is running!' : JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        const authenticated = options.headers['x-telegram-bot-api-secret-token'];
        const status = unavailable ? 503 : authenticated && !wrongSecret ? 400 : 403;
        return new Response(JSON.stringify({ ok: false }), { status });
      },
    },
  };
}

test('placeholder server blocks registration without reading a database secret', async () => {
  const f = fixture({ placeholder: true });
  const result = await configureRenderWebhook({ ...f.options, apply: true });
  assert.equal(result.blocked, 'render_is_not_serving_this_api');
  assert.equal(f.reads, 0);
  assert.ok(!f.calls.some(c => c.method === 'setWebhook'));
});
test('read-only check never updates Telegram or reads a secret', async () => {
  const f = fixture();
  const result = await configureRenderWebhook(f.options);
  assert.equal(result.ready, true);
  assert.equal(result.updated, false);
  assert.equal(f.reads, 0);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('unavailable worker blocks registration', async () => {
  const f = fixture({ unavailable: true });
  const result = await configureRenderWebhook({ ...f.options, apply: true });
  assert.equal(result.blocked, 'render_worker_not_ready_or_wrong_route');
  assert.equal(f.reads, 0);
});
test('wrong bot identity blocks all target probes and updates', async () => {
  const f = fixture({ username: 'different_bot' });
  const result = await configureRenderWebhook({ ...f.options, apply: true });
  assert.equal(result.blocked, 'unexpected_bot_identity');
  assert.equal(f.reads, 0);
});
test('unapproved cutover blocks registration', async () => {
  const f = fixture();
  f.options.env.CLOUD_CUTOVER_APPROVED = '0';
  const result = await configureRenderWebhook({ ...f.options, apply: true });
  assert.equal(result.blocked, 'approved_production_cutover_required');
  assert.equal(f.reads, 0);
});
test('mismatching database secret blocks registration', async () => {
  const f = fixture({ wrongSecret: true });
  const result = await configureRenderWebhook({ ...f.options, apply: true });
  assert.equal(result.blocked, 'database_secret_does_not_match_render_worker');
  assert.ok(!f.calls.some(c => c.method === 'setWebhook'));
});
test('approved ready runtime registers securely and verifies readback without dropping pending messages', async () => {
  const f = fixture();
  const result = await configureRenderWebhook({ ...f.options, apply: true });
  assert.equal(result.verified, true);
  const update = f.calls.find(c => c.method === 'setWebhook');
  assert.equal(update.payload.url, RENDER_WEBHOOK);
  assert.equal(update.payload.secret_token, 'fixture-secret');
  assert.equal(update.payload.drop_pending_updates, false);
  assert.deepEqual(update.payload.allowed_updates, ['message', 'callback_query']);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});
test('direct index.js receiver uses its native health and webhook paths', async () => {
  const f = fixture();
  const originalRequest = f.options.request;
  f.options.env.TELEGRAM_WEBHOOK_URL = DIRECT_RENDER_WEBHOOK;
  f.options.request = async (url, options) => {
    if (String(url).endsWith('/healthz')) {
      assert.equal(new URL(url).pathname, '/healthz');
      return new Response(JSON.stringify({ service: 'ah-sheli-bot', ready: true }), { status: 200 });
    }
    assert.equal(String(url), DIRECT_RENDER_WEBHOOK);
    return originalRequest(url, options);
  };
  const result = await configureRenderWebhook({ ...f.options, direct: true, apply: true });
  assert.equal(result.verified, true);
  assert.equal(f.calls.find(c => c.method === 'setWebhook').payload.url, DIRECT_RENDER_WEBHOOK);
});
test('direct mode refuses an unready native worker without changing Telegram', async () => {
  const f = fixture();
  f.options.request = async () => new Response(
    JSON.stringify({ service: 'ah-sheli-bot', ready: false }), { status: 200 },
  );
  const result = await configureRenderWebhook({ ...f.options, direct: true, apply: true });
  assert.equal(result.blocked, 'render_is_not_serving_this_bot');
  assert.equal(f.reads, 0);
  assert.ok(!f.calls.some(c => c.method === 'setWebhook'));
});
