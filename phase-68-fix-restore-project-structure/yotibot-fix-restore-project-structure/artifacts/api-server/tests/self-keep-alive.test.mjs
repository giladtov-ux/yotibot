import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/lib/self-keep-alive.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const { startSelfKeepAlive } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const logger = { info() {}, warn() {} };
const settle = () => new Promise(setImmediate);

test('Telegram keep-alive uses one four-minute health-only pulse, no action endpoint or credentials', async () => {
  let tick, interval, cancelled = 0, requests = [];
  const timer = { unref() {} };
  const stop = startSelfKeepAlive({ logger, production: true, publicUrl: 'https://example.test/',
    schedule: (callback, milliseconds) => { tick = callback; interval = milliseconds; return timer; },
    cancel: handle => { assert.equal(handle, timer); cancelled++; },
    request: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, body: { cancel: async () => {} } };
    } });
  assert.equal(interval, 240000);
  tick(); await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.test/api/healthz');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.body, undefined);
  stop(); stop(); tick(); await settle();
  assert.equal(cancelled, 1);
  assert.equal(requests.length, 1);
});

test('overlapping pulses never pile up and shutdown aborts an in-flight health request', async () => {
  let tick, signal;
  const stop = startSelfKeepAlive({ logger, production: true, publicUrl: 'https://example.test/',
    schedule: callback => { tick = callback; return { unref() {} }; }, cancel() {},
    request: (_url, options) => {
      assert.equal(signal, undefined, 'only one request may be in flight');
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } });
  tick(); tick();
  assert.equal(signal.aborted, false);
  stop(); await settle();
  assert.equal(signal.aborted, true);
});

test('development and invalid public URL never schedule keep-alive traffic', () => {
  const schedule = () => { throw new Error('must not schedule'); };
  startSelfKeepAlive({ logger, production: false, schedule })();
  startSelfKeepAlive({ logger, production: true, publicUrl: 'http://example.test/', schedule })();
});

test('Staging never schedules self-keep-alive traffic even with a public URL', () => {
  let schedules = 0, requests = 0;
  const stop = startSelfKeepAlive({
    logger,
    production: true,
    deploymentEnvironment: 'staging',
    dataEnvironment: 'staging',
    publicUrl: 'https://staging.example.invalid',
    schedule: () => { schedules++; throw new Error('Staging must not schedule outbound traffic'); },
    request: async () => { requests++; throw new Error('Staging must not make outbound requests'); },
  });
  stop();
  assert.equal(schedules, 0);
  assert.equal(requests, 0);
});
