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
function handler(name, ready, env = {}) {
  let callback;
  compile(name, {
    express: { Router: () => ({ get: (_path, cb) => { callback = cb; } }) },
    '@workspace/api-zod': { HealthCheckResponse: { parse: x => x } },
    '../lib/telegram.functions': { telegramWorkerReady: async () => ready },
  }, env);
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

test('Render root health never declares a missing worker ready', async () => {
  const cold = await handler('routes/bot-health.ts', false)();
  assert.equal(cold.code, 503);
  assert.deepEqual(cold.body, { ok: false, service: 'ah-sheli-bot', ready: false });
  const warm = await handler('routes/bot-health.ts', true)();
  assert.equal(warm.code, 200);
  assert.equal(warm.body.ready, true);
});
test('production API health waits for its worker; development health stays compatible', async () => {
  assert.equal((await handler('routes/health.ts', false, { NODE_ENV: 'production' })()).code, 503);
  assert.equal((await handler('routes/health.ts', true, { NODE_ENV: 'production' })()).body.status, 'ok');
  assert.equal((await handler('routes/health.ts', false, { NODE_ENV: 'development' })()).body.status, 'ok');
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
