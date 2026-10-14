import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("native email-cookie status and Telegram data use separate authentication proofs", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.window = { Telegram: { WebApp: { initData: "signed-native-fixture" } } };
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ signedIn: false }) };
    };
    const { api } = await import("../../api-server/public/app-api.js");
    await api.emailAuth();
    await api.emailLink();
    await api.data();
    assert.equal(requests[0].options.headers.Authorization, undefined);
    assert.equal(requests[1].options.headers.Authorization, undefined);
    assert.equal(requests[2].options.headers.Authorization, "tma signed-native-fixture");
    assert.ok(requests.every(({ options }) => options.credentials === "same-origin"));
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("losing email session clears browser data but never signs a native Telegram user out", async () => {
  const source = await readFile(new URL("../../api-server/public/app.js", import.meta.url), "utf8");
  const keeper = source.slice(source.indexOf("function ensureClerkSessionKeeper()"), source.indexOf("function hasActiveDraft()"));
  for (const native of [false, true]) {
    let listener;
    const state = { loaded: true, loadGeneration: 0, data: { privateFixture: "retained-native-only" }, shares: [1] };
    const context = {
      state, Promise, clearTimeout() {},
      window: { Telegram: native ? { WebApp: { initData: "signed-native-fixture" } } : undefined,
        setTimeout: () => 1, addEventListener: (_name, callback) => { listener = callback; } },
      document: { createElement: () => ({}), head: { append() {} } },
      enterLocked() {}, queueRefresh() {}, drainQueuedRefresh() {},
    };
    vm.runInNewContext(`${keeper};ensureClerkSessionKeeper();`, context);
    listener({ detail: { signedIn: false } });
    assert.equal(state.loaded, native);
    assert.equal(state.data === null, !native);
    assert.equal(state.loadGeneration, native ? 0 : 1);
  }
  assert.match(source, /Email is optional for a signed native Telegram launch/);
});
