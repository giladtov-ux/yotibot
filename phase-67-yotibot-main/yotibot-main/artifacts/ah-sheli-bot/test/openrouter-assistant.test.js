import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOpenRouterClient, OPENROUTER_URL } from "../src/openrouter-client.js";
import { askAssistant } from "../src/lib/assistant.server.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-openrouter-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ handleAssistantMessage }, { createEmptyStore }] = await Promise.all([
  import("../src/assistant.js"), import("../src/store.js"),
]);
after(() => rm(directory, { recursive: true, force: true }));
const completion = content => ({
  choices: [{ finish_reason: "stop", message: { content } }],
});
const successful = content => ({ ok: true, status: 200, json: async () => completion(content) });

test("the active brain picks OpenRouter when its own key exists, never a Groq credential", () => {
  const script = `
    import { createAssistantClient } from "./src/lib/assistant.server.ts";
    const client = createAssistantClient();
    console.log(JSON.stringify({provider:client.provider,model:client.model}));
  `;
  for (const [env, provider] of [
    [{ OPENROUTER_API_KEY: "synthetic-router", GROQ_API_KEY: "synthetic-groq" }, "OpenRouter"],
    [{ GROQ_API_KEY: "synthetic-groq" }, "Groq"],
  ]) {
    const result = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: new URL("..", import.meta.url), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(JSON.parse(result).provider, provider);
  }
  assert.throws(() => createOpenRouterClient({ apiKey: "" }), error =>
    error.code === "missing_configuration");
});

test("OpenRouter sends valid messages without JSON forcing and delivers prose unchanged", async () => {
  const response = "אני חושב שכדאי לקנות עוגה... אפשר גם להכין משהו קטן בבית.";
  let calls = 0;
  const client = createOpenRouterClient({
    apiKey: "synthetic-router", model: "openai/gpt-4o-mini",
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, OPENROUTER_URL);
      assert.equal(options.headers.authorization, "Bearer synthetic-router");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "openai/gpt-4o-mini");
      assert.equal(body.stream, false);
      assert.equal(body.response_format, undefined);
      assert.equal(body.reasoning_effort, undefined);
      assert.ok(body.messages.every(message =>
        ["system", "user", "assistant"].includes(message.role) && typeof message.content === "string"));
      assert.match(body.messages[0].content, /בשיחה השב ישירות בטקסט חופשי/);
      return successful(response);
    },
  });
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "owner", "מה כדאי להביא ליום הולדת של חבר?",
    (message, context) => askAssistant(message, context, client));
  assert.equal(reply, response);
  assert.equal(calls, 1);
  assert.deepEqual(store.reminders, []);
  assert.deepEqual(Object.keys(store.lists), []);
});

test("OpenRouter still validates and persists explicit list actions", async () => {
  const store = createEmptyStore();
  const client = createOpenRouterClient({
    apiKey: "synthetic-router",
    fetchImpl: async () => successful('{"type":"add-items","listName":"קניות","items":["חלב","לחם"]}'),
  });
  // Exercise the active brain and writer without bypassing the AI via the fast path.
  const intent = await askAssistant("אפשר לרשום את המצרכים שהזכרתי?", {}, client);
  const { handleAssistantIntent } = await import("../src/commands.js");
  await handleAssistantIntent(store, "owner", intent, "אפשר לרשום את המצרכים שהזכרתי?", { semantic: true });
  assert.deepEqual(store.lists.owner["קניות"].map(item => item.text), ["חלב", "לחם"]);
});

test("retryable OpenRouter outages recover within a bounded request budget", async () => {
  let calls = 0;
  const client = createOpenRouterClient({
    apiKey: "synthetic-router",
    requestOptions: { maxAttempts: 2, sleep: async () => {}, random: () => 0 },
    fetchImpl: async () => ++calls === 1
      ? { ok: false, status: 503, json: async () => ({ error: { code: 503 } }) }
      : successful("בשמחה אחי, אני כאן."),
  });
  const result = await askAssistant("מה נשמע?", {}, client);
  assert.equal(result.response, "בשמחה אחי, אני כאן.");
  assert.equal(calls, 2);
});

test("malformed upstream JSON and authentication failure produce honest nontechnical replies", async () => {
  for (const fetchImpl of [
    async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("synthetic malformed JSON"); } }),
    async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 401 } }) }),
    async () => ({ ok: true, status: 200, json: async () => ({ error: { code: 401 } }) }),
    async () => { throw new TypeError("synthetic network failure"); },
  ]) {
    const client = createOpenRouterClient({
      apiKey: "synthetic-router", fetchImpl, requestOptions: { maxAttempts: 1 },
    });
    const store = createEmptyStore();
    const reply = await handleAssistantMessage(store, "owner", "למה הירח משנה צורה?",
      (message, context) => askAssistant(message, context, client));
    assert.ok(reply.trim());
    assert.doesNotMatch(reply, /לא הצלחתי להשלים את הבקשה|JSON|OpenRouter|API|synthetic|401/);
    assert.deepEqual(store.reminders, []);
    assert.deepEqual(Object.keys(store.lists), []);
  }
});
