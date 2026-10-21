import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-resilience-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [
  { createGroqClient, analyzeMessage }, { handleAssistantMessage },
  { createEmptyStore }, { parseScheduleFallback }, { replyToOwnerMessage },
] = await Promise.all([
  import("../src/groq-assistant.js"), import("../src/assistant.js"),
  import("../src/store.js"), import("../src/schedule-fallback.js"),
  import("../src/message-handler.js"),
]);
after(() => rm(directory, { recursive: true, force: true }));
const input = "סידור העבודה שלי למחר:\n06:00 השכמה\n06:35 יציאה לאיסופים\n09:00 חזרה למשימות\n14:00 יציאה לאיסוף צהריים\n16:30 חזרה למשימות";
const validRequest = { model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "test" }] };
const response = (status, error = {}, retryAfter = null) => ({
  ok: status === 200, status,
  headers: { get: () => retryAfter },
  json: async () => status === 200 ? { choices: [] } : { error },
});
function fixture(fetchImpl, options = {}) {
  let clock = 0;
  const waits = [];
  const client = createGroqClient({
    apiKey: "synthetic-key", fetchImpl,
    requestOptions: {
      now: () => clock, random: () => 0,
      sleep: async ms => { waits.push(ms); clock += ms; },
      ...options,
    },
  });
  return { client, waits, advance: ms => { clock += ms; } };
}

test("temporary 503s retry at most three times and recover without local mode", async () => {
  let calls = 0;
  const { client, waits } = fixture(async () => response(++calls < 3 ? 503 : 200));
  await client.complete(validRequest);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1000]);
});

test("network timeouts retry without changing endpoint or credentials", async () => {
  let calls = 0;
  const { client } = fixture(async (url, options) => {
    assert.equal(new URL(url).hostname, "api.groq.com");
    assert.equal(options.headers.authorization, "Bearer synthetic-key");
    if (++calls === 1) throw new DOMException("simulated timeout", "TimeoutError");
    return response(200);
  });
  await client.complete(validRequest);
  assert.equal(calls, 2);
});

test("temporary rate limits respect Retry-After", async () => {
  let calls = 0;
  const { client, waits } = fixture(async () => ++calls === 1
    ? response(429, { code: "rate_limit_exceeded" }, "2") : response(200));
  await client.complete(validRequest);
  assert.deepEqual(waits, [2000]);
  assert.equal(calls, 2);
});

test("long Retry-After opens a cooldown instead of blocking or flooding Groq", async () => {
  let calls = 0;
  const { client, waits, advance } = fixture(async () => {
    calls += 1; return response(429, { code: "rate_limit_exceeded" }, "60");
  });
  for (let index = 0; index < 2; index += 1) {
    await assert.rejects(client.complete(validRequest), error => error.code === "rate_limited");
  }
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  advance(60_001);
  await assert.rejects(client.complete(validRequest));
  assert.equal(calls, 2);
});

test("billing quotas, invalid credentials, rejected schemas and missing models never retry", async () => {
  for (const [status, error, code] of [
    [429, { code: "insufficient_quota" }, "quota_exhausted"],
    [401, { code: "invalid_api_key" }, "authentication_failed"],
    [400, { code: "invalid_request_error" }, "invalid_request"],
    [404, { code: "model_not_found" }, "model_unavailable"],
  ]) {
    let calls = 0;
    const { client } = fixture(async () => { calls += 1; return response(status, error, "1"); });
    await assert.rejects(client.complete(validRequest), value => value.code === code);
    assert.equal(calls, 1);
  }
});

test("backoff cannot exceed the overall request budget", async () => {
  let calls = 0;
  let harness;
  harness = fixture(async () => {
    calls += 1; harness.advance(900); return response(503);
  }, { totalBudgetMs: 1000 });
  await assert.rejects(harness.client.complete(validRequest));
  assert.equal(calls, 1);
  assert.deepEqual(harness.waits, []);
});

test("responses received after the total deadline are refused", async () => {
  let harness;
  harness = fixture(async () => {
    harness.advance(1001); return response(200);
  }, { totalBudgetMs: 1000 });
  await assert.rejects(harness.client.complete(validRequest), error => error.code === "unavailable");
});

test("complete schedules survive persistent AI failure, save once and deliver one summary", async () => {
  const store = createEmptyStore();
  let calls = 0, deliveries = 0;
  const { client } = fixture(async () => { calls += 1; return response(503); });
  const assistant = (state, chatId, text, _unused, history) =>
    handleAssistantMessage(state, chatId, text,
      (message, context) => analyzeMessage(message, context, client), history);
  const result = await replyToOwnerMessage(store, {
    sendMessage: async (_chatId, reply) => {
      deliveries += 1;
      assert.match(reply, /אזכיר לך/);
      assert.doesNotMatch(reply, /מצב מקומי ללא AI/);
      assert.doesNotMatch(reply, /גיבוי|לא נוצרו תזכורות/);
    },
  }, "synthetic-owner", input, {
    assistant, readHistory: async () => [], saveConversation: async () => {},
  });
  assert.equal(result.delivered, true);
  assert.equal(calls, 3);
  assert.equal(deliveries, 1);
  assert.equal(store.reminders.length, 5);
  await assistant(store, "synthetic-owner", input, null, []);
  assert.equal(store.reminders.length, 5);
  assert.equal(calls, 3);
});

test("fallback supports time-before-task, task-before-time, paragraphs and Hebrew periods", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  for (const text of [
    "מחר 06:00 השכמה 06:35 יציאה לאיסופים 09:00 חזרה",
    "מחר השכמה 06:00 יציאה לאיסופים 06:35 חזרה 09:00",
    "סידור עבודה למחר: השכמה ב-6 בבוקר, יציאה לאיסופים 6:35 בבוקר, חזרה 9 בבוקר",
  ]) {
    const intent = parseScheduleFallback(text, now);
    assert.equal(intent.type, "schedule-reminders");
    assert.equal(intent.reminders.length, 3);
    assert.deepEqual(intent.reminders.map(item => [item.hour, item.minute]), [[6, 0], [6, 35], [9, 0]]);
    assert.ok(intent.reminders.every(item => item.date === "2026-10-08"));
  }
});

test("ISO date headings, date changes and activity-before-clock are preserved", () => {
  const intent = parseScheduleFallback("סידור עבודה בתאריך 2099-01-02:\nהשכמה 06:00\nיציאה 06:35\n2099-01-03:\n07:00 חזרה");
  assert.equal(intent.type, "schedule-reminders");
  assert.deepEqual(intent.reminders.map(item => item.date), ["2099-01-02", "2099-01-02", "2099-01-03"]);
});

test("fallback never builds reminders from background, examples, questions or analysis-only requests", () => {
  assert.equal(parseScheduleFallback("באילו שעות אני פנוי?"), null);
  assert.equal(parseScheduleFallback(`האם זה סידור עבודה הגיוני? ${input}`), null);
  for (const text of [
    `רק נתח, בלי תזכורות: ${input}`,
    `דוגמה: ${input}`,
  ]) {
    assert.equal(parseScheduleFallback(text).type, "clarify");
  }
});

test("missing or ambiguous details are clarified together, never partially saved", async () => {
  const { AiServiceError } = await import("../src/ai-errors.js");
  for (const text of [
    "סידור עבודה למחר:\n06:00 השכמה\nיציאה לאיסופים",
    "סידור עבודה למחר:\n06:00 השכמה\n09:00-14:00 עבודה",
    "סידור עבודה 12/10/2026:\n06:00 השכמה\n06:35 יציאה",
    "סידור עבודה למחר:\n06:00 השכמה\n25:99 יציאה",
  ]) {
    const store = createEmptyStore();
    await handleAssistantMessage(store, "synthetic-owner", text,
      async () => { throw new AiServiceError("unavailable"); });
    assert.deepEqual(store.reminders, []);
  }
});

test("backup never substitutes today's date or event times for unsupported explicit instructions", () => {
  for (const text of [
    "סידור עבודה: 06:00 השכמה אתמול, 14:00 יציאה",
    "סידור עבודה: 06:00 השכמה ב-12 באוקטובר, 14:00 יציאה",
    `${input}\nתזכיר לי 15 דקות לפני`,
    `${input}\nלהצגה בלבד`,
    `סידור עבודה למחר: 06:00 השכמה, 06:35 ${"תיאור".repeat(100)}`,
  ]) {
    assert.equal(parseScheduleFallback(text).type, "clarify");
  }
});
