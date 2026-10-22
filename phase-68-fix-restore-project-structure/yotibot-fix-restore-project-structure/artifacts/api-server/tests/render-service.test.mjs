import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
function compile(name, mocks, env = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source(name), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, process: { env }, AbortSignal,
    require(name) {
      if (!(name in mocks)) throw Error('Unexpected dependency: ' + name);
      return mocks[name];
    },
    ...globals,
  });
  return module.exports;
}
function handler(name, ready, env = {}, selectedPath = "/healthz") {
  let callback;
  compile(name, {
    express: { Router: () => ({ get: (path, cb) => { if (path === selectedPath) callback = cb; } }) },
    '@workspace/api-zod': { HealthCheckResponse: { parse: x => x } },
    '../lib/telegram.functions': {
      telegramWorkerReady: async () => typeof ready === 'function' ? ready() : ready,
    },
    '../lib/build-info': { buildInfo: { id: 'test-build', commit: 'test-commit', releaseTag: null, dirty: false } },
  }, env);
  if (!callback) throw Error(`No handler registered for ${selectedPath} in ${name}`);
  return async () => {
    const res = {
      code: 200, body: null,
      status(code) { this.code = code; return this; },
      json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
    };
    await callback({}, res);
    return res;
  };
}

test('Render service health is healthy with Telegram worker disabled and never probes it', async () => {
  let workerProbes = 0;
  const probe = async () => { workerProbes++; return false; };
  const rootHealth = await handler('routes/bot-health.ts', probe, { NODE_ENV: 'production' })();
  const apiHealth = await handler('routes/health.ts', probe, { NODE_ENV: 'production' })();
  assert.equal(rootHealth.code, 200);
  assert.deepEqual(rootHealth.body, { status: 'ok', service: 'ah-sheli-api' });
  assert.equal(apiHealth.code, 200);
  assert.equal(apiHealth.body.status, 'ok');
  assert.equal(workerProbes, 0);
});
test('separate worker health reports status without starting the worker', async () => {
  let workerProbes = 0;
  const workerHealth = await handler(
    'routes/bot-health.ts', async () => { workerProbes++; return false; }, {}, '/worker-healthz',
  )();
  assert.equal(workerHealth.code, 503);
  assert.deepEqual(workerHealth.body, { ok: false, service: 'ah-sheli-bot', ready: false });
  assert.equal(workerProbes, 1);
});
test('API health is service liveness in production, staging, and development', async () => {
  let workerProbes = 0;
  const probe = async () => { workerProbes++; return false; };
  for (const env of [
    { NODE_ENV: 'production', DEPLOYMENT_ENV: 'staging', TELEGRAM_WORKER_ENABLED: 'false' },
    { NODE_ENV: 'production' },
    { NODE_ENV: 'development' },
  ]) {
    const response = await handler('routes/health.ts', probe, env)();
    assert.equal(response.code, 200);
    assert.equal(response.body.status, 'ok');
  }
  assert.equal(workerProbes, 0);
});
test('worker readiness validates the internal service identity and active state', async () => {
  const { telegramWorkerReady } = compile('lib/telegram.functions.ts', {});
  for (const [ok, identity, expected] of [
    [true, { service: 'ah-sheli-bot', ready: true }, true],
    [true, { service: 'ah-sheli-bot', ready: false }, false],
    [true, { service: 'another-service', ready: true }, false],
    [false, { service: 'ah-sheli-bot', ready: true }, false],
    [true, null, false],
  ]) {
    assert.equal(await telegramWorkerReady(async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:18081/healthz');
      assert.ok(options.signal);
      return { ok, json: async () => identity };
    }), expected);
  }
  assert.equal(await telegramWorkerReady(async () => { throw Error('offline'); }), false);
});
test('Staging Telegram worker requires an explicit switch and the current HTTPS dev host for Development', () => {
  const staging = compile('lib/telegram-staging.ts', {}, {}, { URL });
  const { shouldStartTelegramWorker, isDevelopmentTelegramWebhook } = staging;
  assert.equal(shouldStartTelegramWorker({ NODE_ENV: 'development' }), false);
  assert.equal(shouldStartTelegramWorker({
    NODE_ENV: 'development', TELEGRAM_STAGING_ENABLED: 'false',
  }), false);
  assert.equal(shouldStartTelegramWorker({
    NODE_ENV: 'development', TELEGRAM_STAGING_ENABLED: 'true',
  }), true);
  assert.equal(shouldStartTelegramWorker({ NODE_ENV: 'production' }), true);
  assert.equal(shouldStartTelegramWorker({
    NODE_ENV: 'production', DEPLOYMENT_ENV: 'staging',
  }), false);
  assert.equal(shouldStartTelegramWorker({
    NODE_ENV: 'production', DEPLOYMENT_ENV: 'staging', TELEGRAM_STAGING_ENABLED: 'true',
  }), false);
  assert.equal(shouldStartTelegramWorker({
    NODE_ENV: 'production', DEPLOYMENT_ENV: 'staging', TELEGRAM_WORKER_ENABLED: 'false',
  }), false);
  assert.equal(shouldStartTelegramWorker({
    NODE_ENV: 'production', DEPLOYMENT_ENV: 'staging', TELEGRAM_WORKER_ENABLED: 'true',
  }), true);
  assert.equal(shouldStartTelegramWorker({
    NODE_ENV: 'production', DEPLOYMENT_ENV: 'production',
  }), true);
  assert.equal(isDevelopmentTelegramWebhook(
    'https://staging.replit.dev/telegram/webhook', 'staging.replit.dev',
  ), true);
  assert.equal(isDevelopmentTelegramWebhook(
    'https://production.example/telegram/webhook', 'staging.replit.dev',
  ), false);
  assert.equal(isDevelopmentTelegramWebhook(
    'http://staging.replit.dev/telegram/webhook', 'staging.replit.dev',
  ), false);
  assert.equal(isDevelopmentTelegramWebhook(
    'https://staging.replit.dev/api/telegram/webhook', 'staging.replit.dev',
  ), false);
  assert.equal(isDevelopmentTelegramWebhook(
    'https://staging.replit.dev/telegram/webhook?redirect=1', 'staging.replit.dev',
  ), false);
  assert.match(
    source('index.ts'),
    /if\s*\(shouldStartTelegramWorker\(process\.env\)\)\s*startTelegramWorker\(\)/u,
  );
});
test('root receiver remains public while external email auth uses the configured tenant', () => {
  const app = source('app.ts');
  assert.ok(app.indexOf('app.use(telegramRouter)') < app.indexOf('const emailSessionMiddleware'));
  assert.ok(app.includes('app.use(botHealthRouter)'));
  assert.match(app, /CLERK_AUTH_MODE === "external"[\s\S]*publishableKey: process\.env\.CLERK_PUBLISHABLE_KEY/);
  assert.match(app, /authorizedParties: \[websiteOrigin\(\)\]/);
  assert.match(source('index.ts'), /"\/telegram\/webhook", "\/api\/telegram\/webhook"/);
});
test('browser auth and session persistence select an external key without a Replit proxy', () => {
  for (const file of ['auth-entry.tsx', 'session-keeper.tsx']) {
    const code = readFileSync(new URL('../client/' + file, import.meta.url), 'utf8');
    assert.match(code, /VITE_CLERK_AUTH_MODE === "external"\s*\? import\.meta\.env\.VITE_CLERK_PUBLISHABLE_KEY/);
    assert.match(code, /VITE_CLERK_AUTH_MODE === "external"\s*\? undefined : import\.meta\.env\.VITE_CLERK_PROXY_URL/);
  }
});
