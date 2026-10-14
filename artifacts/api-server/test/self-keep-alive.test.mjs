import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { startSelfKeepAlive } from "../src/lib/self-keep-alive.ts";

function fixture(overrides = {}) {
  const calls = [];
  const logs = [];
  let tick;
  let interval;
  let unreferenced = false;
  let cancelled = 0;
  const timer = { unref() { unreferenced = true; } };
  const stop = startSelfKeepAlive({
    production: true,
    publicUrl: "https://example.test",
    logger: {
      info(fields) { logs.push(fields); },
      warn(fields) { logs.push(fields); },
    },
    request: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, body: { async cancel() {} } };
    },
    schedule(callback, ms) { tick = callback; interval = ms; return timer; },
    cancel(handle) { assert.equal(handle, timer); cancelled++; },
    ...overrides,
  });
  return {
    calls, logs, stop,
    tick: () => tick?.(),
    get interval() { return interval; },
    get unreferenced() { return unreferenced; },
    get cancelled() { return cancelled; },
  };
}

test("development never starts a timer or pings production", () => {
  const f = fixture({ production: false });
  f.tick();
  f.stop();
  assert.equal(f.interval, undefined);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.logs, []);
});

test("missing or invalid published origins fail explicitly without sending requests", () => {
  for (const publicUrl of ["", "http://example.test", "https://user:password@example.test", "not-a-url"]) {
    const f = fixture({ publicUrl });
    assert.equal(f.interval, undefined);
    assert.equal(f.logs[0].code, "self_keep_alive_not_configured");
    assert.deepEqual(f.calls, []);
    f.stop();
  }
});

test("production makes only health GET requests every four minutes", async () => {
  const f = fixture();
  assert.equal(f.interval, 240_000);
  assert.equal(f.unreferenced, true);
  assert.equal(f.calls.length, 0);
  f.tick();
  await wait(0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://example.test/api/healthz");
  assert.equal(f.calls[0].options.method, "GET");
  assert.equal(f.calls[0].options.redirect, "error");
  assert.equal(f.calls[0].options.credentials, "omit");
  assert.equal(f.calls[0].options.cache, "no-store");
  assert.equal(f.logs.at(-1).code, "self_keep_alive_ok");
  f.stop();
  f.tick();
  assert.equal(f.calls.length, 1);
});

test("overlapping ticks are skipped and shutdown aborts a pending request", async () => {
  let signal;
  let count = 0;
  const f = fixture({
    request: (_url, options) => {
      signal = options.signal;
      count++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  f.tick();
  f.tick();
  assert.equal(count, 1);
  f.stop();
  f.stop();
  await wait(0);
  assert.equal(signal.aborted, true);
  assert.equal(f.cancelled, 1);
  f.tick();
  assert.equal(count, 1);
  assert.equal(f.logs.length, 1, "intentional shutdown does not log a request failure");
});

test("a network failure retries only at the next scheduled tick", async () => {
  let count = 0;
  const f = fixture({
    request: async () => {
      count++;
      if (count === 1) throw new Error("Synthetic connection failure");
      return { ok: true, status: 200 };
    },
  });
  f.tick();
  await wait(0);
  assert.equal(count, 1);
  assert.equal(f.logs.at(-1).code, "self_keep_alive_request_failed");
  f.tick();
  await wait(0);
  assert.equal(count, 2);
  assert.equal(f.logs.at(-1).code, "self_keep_alive_ok");
  f.stop();
});

test("HTTP rejection is not logged as success and the body is released", async () => {
  let released = false;
  const f = fixture({
    request: async () => ({
      ok: false, status: 503,
      body: { async cancel() { released = true; } },
    }),
  });
  f.tick();
  await wait(0);
  assert.equal(released, true);
  assert.equal(f.logs.at(-1).code, "self_keep_alive_http_error");
  assert.equal(f.logs.at(-1).status, 503);
  f.stop();
});

test("request timeout aborts without stopping future heartbeat ticks", async () => {
  const f = fixture({
    requestTimeoutMs: 5,
    request: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  f.tick();
  await wait(20);
  assert.equal(f.logs.at(-1).code, "self_keep_alive_timeout");
  f.tick();
  await wait(20);
  assert.equal(f.logs.filter(row => row.code === "self_keep_alive_timeout").length, 2);
  f.stop();
});
