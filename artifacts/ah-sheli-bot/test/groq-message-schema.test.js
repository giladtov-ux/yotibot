import test from "node:test";
import assert from "node:assert/strict";
import { createGroqClient, analyzeMessage, GROQ_MODEL } from "../src/groq-assistant.js";
import { validateGroqBody } from "../src/groq-message-schema.js";
import { compactHistory } from "../src/assistant-performance.js";

const completion = {
  choices: [{ finish_reason: "stop", message: { content: '{"type":"answer","response":"סגור אחי"}' } }],
};
test("Groq text messages strip metadata without mutating source rows", () => {
  const row = { role: "user", content: "שלום\n\"אח שלי\"", text: "legacy", id: "row-id" };
  const body = { model: GROQ_MODEL, messages: [row] };
  assert.deepEqual(validateGroqBody(body), {
    model: GROQ_MODEL, messages: [{ role: "user", content: row.content }],
  });
  assert.equal(row.text, "legacy");
});
test("invalid message schemas fail before network requests", async () => {
  let calls = 0;
  const client = createGroqClient({ apiKey: "synthetic-key", fetchImpl: async () => {
    calls++; return { ok: true, json: async () => completion };
  } });
  for (const messages of [
    undefined, {}, [], [null], [[{ role: "user", content: "nested" }]],
    [{ role: "developer", content: "unsupported for this bot" }],
    [{ role: "tool", content: "no tool request" }],
    [{ role: "User", content: "wrong case" }],
    [{ role: "user", content: {} }], [{ role: "user", content: ["text"] }],
    [{ role: "user", content: null }], [{ role: "user", text: "legacy without content" }],
    [{ role: "user", content: " \n " }],
  ]) {
    await assert.rejects(client.complete({ model: GROQ_MODEL, messages }), error =>
      error.code === "invalid_request");
  }
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "hi" }] }));
  assert.equal(calls, 0);
});
test("malformed history never becomes malformed Groq messages", async () => {
  for (const history of [null, {}, "not an array"]) assert.deepEqual(compactHistory(history), []);
  const history = [
    null, { role: "system", content: "untrusted" },
    { role: "user", content: {} }, { role: "assistant", content: "  " },
    { role: "user", text: "לו״ז מלא\n06:00 השכמה\n06:35 יציאה" },
    { role: "assistant", content: "לאיזה יום?", id: 42 },
  ];
  let body;
  const client = createGroqClient({ apiKey: "synthetic-key", fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => completion };
  } });
  await analyzeMessage("מחר", { recentConversation: history }, client);
  assert.equal(body.response_format, undefined, "natural generation is not rejected by provider JSON enforcement");
  assert.deepEqual(body.messages.map(row => row.role), ["system", "user", "assistant", "user"]);
  assert.ok(body.messages.every(row => typeof row.content === "string"
    && Object.keys(row).join(",") === "role,content"));
  assert.equal(body.messages[1].content, history[4].text);
  assert.equal(JSON.parse(body.messages.at(-1).content).currentMessage, "מחר");
});
test("empty or object current messages do not reach the provider", async () => {
  let calls = 0;
  const client = { complete: async () => { calls++; return completion; } };
  for (const input of [null, {}, ["שלום"], "", "  "]) {
    await assert.rejects(analyzeMessage(input, {}, client), error => error.code === "invalid_request");
  }
  assert.equal(calls, 0);
});
