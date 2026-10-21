import test from "node:test";
import assert from "node:assert/strict";
import { AiServiceError, classifyAiError } from "../src/ai-errors.js";
import { analyzeMessage, createGroqClient } from "../src/groq-assistant.js";
import { replyToOwnerMessage } from "../src/message-handler.js";

const validRequest = { model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "test" }] };

test("quota exhaustion is distinguished from transient rate limiting", () => {
  for (const code of ["insufficient_quota", "billing_hard_limit_reached"]) {
    const error = classifyAiError({ status: 429, code });
    assert.equal(error.code, "quota_exhausted");
    assert.equal(error.retryable, false);
  }
  assert.equal(classifyAiError({ status: 429 }).code, "rate_limited");
  assert.equal(classifyAiError({ status: 429 }).retryable, true);
  assert.equal(classifyAiError({ status: 401, code: "invalid_api_key" }).code, "authentication_failed");
});
test("authentication errors never echo a rejected credential", () => {
  const error = classifyAiError({ status: 401, message: "Incorrect API key: sensitive-test-value" });
  assert.equal(error.code, "authentication_failed");
  assert.doesNotMatch(error.message, /sensitive-test-value/);
});
test("owner-facing AI errors are natural, with diagnostic details retained only as codes", () => {
  for (const code of ["quota_exhausted", "authentication_failed", "missing_configuration",
    "rate_limited", "unavailable", "invalid_response", "invalid_request", "model_unavailable"]) {
    const error = new AiServiceError(code);
    assert.equal(error.code, code);
    assert.match(error.message, /אחי/);
    assert.doesNotMatch(error.message, /API|Groq|Lovable|JSON|GROQ_API_KEY|LOVABLE_API_KEY|מבנה הבקשה/);
  }
});
test("Groq quota failure makes one request without automatic retries", async () => {
  let calls = 0;
  const client = { complete: async () => {
    calls++;
    throw { status: 429, code: "insufficient_quota" };
  } };
  await assert.rejects(analyzeMessage("היי", {}, client), error =>
    error instanceof AiServiceError && error.code === "quota_exhausted");
  assert.equal(calls, 1);
});
test("invalid AI JSON does not execute actions", async () => {
  const client = { complete: async () =>
    ({ choices: [{ finish_reason: "stop", message: { content: '{"type":"add-items","items":' } }] }) };
  const intent = await analyzeMessage("save", {}, client);
  assert.equal(intent.type, "clarify");
  assert.deepEqual(intent.items, []);
  assert.deepEqual(intent.reminders, []);
});
test("a Groq key is required", () => {
  assert.throws(() => createGroqClient({ apiKey: "" }), error => error.code === "missing_configuration");
});
test("Groq requests use only the direct endpoint, Bearer authentication and a timeout", async () => {
  const client = createGroqClient({
    apiKey: "synthetic-openai-key",
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).hostname, "api.groq.com");
      assert.equal(new URL(url).pathname, "/openai/v1/chat/completions");
      assert.equal(new URL(url).search, "");
      assert.equal(options.headers.authorization, "Bearer synthetic-openai-key");
      assert.equal(options.method, "POST");
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), validRequest);
      return { ok: true, json: async () => ({ choices: [] }) };
    },
  });
  await client.complete(validRequest);
});
test("client options cannot redirect credentials to another URL or model", async () => {
  const client = createGroqClient({
    apiKey: "synthetic-openai-key", model: "gpt-4o",
    requestOptions: { url: "https://invalid.example/steal", headers: {} },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(options.headers.authorization, "Bearer synthetic-openai-key");
      return { ok: true, json: async () => ({ choices: [] }) };
    },
  });
  assert.equal(client.model, "openai/gpt-oss-20b");
  await client.complete(validRequest);
});
test("Groq authentication errors are sanitized", async () => {
  const client = createGroqClient({
    apiKey: "synthetic-openai-key",
    fetchImpl: async () => ({
      ok: false, status: 401, json: async () => ({
        error: { code: "invalid_api_key", message: "rejected synthetic-openai-key" },
      }),
    }),
  });
  await assert.rejects(client.complete(validRequest), error =>
    error.code === "authentication_failed" && !error.message.includes("synthetic-openai-key"));
});
test("blocked, refused or truncated responses never produce a validated action", async () => {
  for (const choice of [
    { finish_reason: "content_filter" }, { finish_reason: "length" },
    { finish_reason: "tool_calls" }, { finish_reason: "stop", refusal: "blocked" },
  ]) {
    const client = { complete: async () => ({
      choices: [{ finish_reason: choice.finish_reason, message: {
        content: '{"type":"add-task","text":"must not save"}', refusal: choice.refusal,
      } }],
    }) };
    await assert.rejects(analyzeMessage("input", {}, client), error => error.code === "invalid_response");
  }
});
test("malformed choices and invalid dates are rejected safely", async () => {
  for (const completion of [
    { choices: [{ finish_reason: "stop", message: { content: {} } }] },
    { choices: [{ finish_reason: "stop", message: null }] },
  ]) {
    await assert.rejects(analyzeMessage("input", {}, {
      complete: async () => completion,
    }), error => error.code === "invalid_response");
  }
  const rejectedDate = await analyzeMessage("input", {}, {
    complete: async () => ({ choices: [{ finish_reason: "stop", message: {
      content: '{"type":"reminder","date":"2026-02-31"}',
    } }] }),
  });
  assert.equal(rejectedDate.type, "clarify");
  assert.equal(rejectedDate.date, null);
});
test("the incoming message pipeline preserves history and confirms Telegram delivery", async () => {
  const events = [];
  const history = [{ role: "user", content: "earlier" }];
  const result = await replyToOwnerMessage({}, {
    sendMessage: async () => { events.push("send"); },
  }, "owner", "היי", {
    readHistory: async () => history,
    assistant: async (_store, _chatId, _text, _unused, received) => {
      assert.deepEqual(received, history); events.push("analyze"); return "שלום";
    },
    saveConversation: async () => { events.push("save"); },
  });
  assert.equal(result.delivered, true);
  assert.deepEqual(events, ["analyze", "save", "send"]);
});
test("Telegram delivery failures are not reported as delivered", async () => {
  await assert.rejects(replyToOwnerMessage({}, {
    sendMessage: async () => { throw new Error("Telegram unavailable"); },
  }, "synthetic-owner", "input", {
    readHistory: async () => [],
    assistant: async () => "reply",
    saveConversation: async () => {},
  }), /Telegram unavailable/);
});
test("Groq JSON-mode failures are sanitized and do not retry malformed output", async () => {
  let calls = 0;
  const client = createGroqClient({ apiKey: "synthetic-key", fetchImpl: async () => {
    calls++;
    return { ok: false, status: 400, json: async () => ({
      error: { code: "json_validate_failed", failed_generation: "sensitive content" },
    }) };
  } });
  await assert.rejects(client.complete(validRequest), error =>
    error.code === "invalid_response" && !error.message.includes("sensitive content"));
  assert.equal(calls, 1);
});
