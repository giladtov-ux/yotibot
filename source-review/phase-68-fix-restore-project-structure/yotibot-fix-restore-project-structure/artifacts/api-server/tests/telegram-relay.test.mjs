import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/lib/telegram.functions.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { relayTelegramRequest } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

for (const health of [
  { service: "ah-sheli-bot" },
  { service: "ah-sheli-bot", ready: false },
  { service: "another-service", ready: true },
]) {
  test(`relay refuses unready/wrong worker: ${JSON.stringify(health)}`, async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, json: async () => health };
    };
    const response = {
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
    };
    try {
      await relayTelegramRequest({ body: {}, get() { return ""; } }, response, "/telegram/webhook");
      assert.equal(calls, 1);
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.error, "bot_unavailable");
    } finally { globalThis.fetch = original; }
  });
}

test("ready worker receives the unchanged webhook payload and authentication headers", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? { ok: true, json: async () => ({ service: "ah-sheli-bot", ready: true }) }
      : { status: 202, text: async () => '{"ok":true}' };
  };
  const request = {
    body: { update_id: 123, message: { text: "synthetic test" } },
    get(name) { return name === "authorization" ? "synthetic-auth" : "synthetic-webhook-secret"; },
  };
  const response = {
    status(value) { this.statusCode = value; return this; },
    type(value) { this.contentType = value; return this; },
    send(value) { this.body = value; return this; },
  };
  try {
    await relayTelegramRequest(request, response, "/telegram/webhook");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "http://127.0.0.1:18081/telegram/webhook");
    assert.equal(calls[1].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].options.body), request.body);
    assert.equal(calls[1].options.headers.authorization, "synthetic-auth");
    assert.equal(calls[1].options.headers["x-telegram-bot-api-secret-token"], "synthetic-webhook-secret");
    assert.equal(response.statusCode, 202);
    assert.equal(response.body, '{"ok":true}');
  } finally { globalThis.fetch = original; }
});
