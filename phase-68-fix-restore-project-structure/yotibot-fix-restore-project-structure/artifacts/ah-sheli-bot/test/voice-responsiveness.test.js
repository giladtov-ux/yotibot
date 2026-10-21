import test from "node:test";
import assert from "node:assert/strict";
import { menuDelivery } from "../src/menu-delivery.js";
import { needsConversationHistory, outputTokenBudget } from "../src/assistant-performance.js";
import { transcribeTelegramVoice } from "../src/voice-transcription.js";
import { TelegramClient } from "../src/telegram.js";
import { systemPrompt } from "../src/assistant-intent.js";

test("explicit saved-data reads skip history; follow-ups and mixed requests keep it", () => {
  for (const text of ["מה יש מחר?", "מה רשימת הקניות שלי?", "מה התזכורות שלי?", "מה הלו״ז של היום"]) {
    assert.equal(needsConversationHistory(text), false);
  }
  for (const text of ["מה עשינו השבוע?", "כן בשמונה", "קניות", "תוסיף גם חלב", "מה יש מחר? תוסיף חלב לרשימת הקניות"]) {
    assert.equal(needsConversationHistory(text), true);
  }
  assert.equal(outputTokenBudget("היי אח שלי"), 640);
});

test("small menu replies send once and include every full item, with safe HTML", () => {
  const menu = { text: "<b>📝 קניות</b>", options: { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } } };
  const response = `1. ${"פריט ארוך ".repeat(15)}\n2. חלב <טרי> & ביצים`;
  const plan = menuDelivery(menu, response);
  assert.equal(plan.length, 1);
  assert.match(plan[0][0], /&lt;טרי&gt; &amp; ביצים/u);
  assert.ok(plan[0][0].includes("פריט ארוך ".repeat(15)));
  assert.equal(plan[0][1], menu.options);
  const large = response.repeat(80);
  assert.deepEqual(menuDelivery(menu, large), [[menu.text, menu.options], [large]]);
  assert.deepEqual(menuDelivery(menu, response, { summary: true }), [[menu.text, menu.options], [response]]);
});

test("getFile metadata waits at most four seconds, without changing Telegram send timeouts", async () => {
  const client = new TelegramClient("test-token");
  client.call = async (method, payload, options) => {
    assert.equal(method, "getFile");
    assert.deepEqual(payload, { file_id: "recording" });
    assert.equal(options.timeoutMs, 4000);
    throw Object.assign(new Error("rejected"), { deliveryRejected: true, status: 400 });
  };
  await assert.rejects(client.downloadFile("recording"), error => error.code === "VOICE_GET_FILE");
});

test("one shared voice deadline covers download and retries while the entire audio and transcript survive", async () => {
  const bytes = Buffer.from("OggS complete recording");
  const transcript = "מה יש מחר? " + "משימה עם שעה מדויקת ".repeat(80);
  let deadline, attempts = 0;
  const result = await transcribeTelegramVoice({ file_id: "recording", duration: 8, file_size: bytes.length }, {
    downloadFile: async (_id, options) => {
      deadline = options.signal;
      assert.ok(deadline instanceof AbortSignal);
      return { bytes };
    },
  }, {
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      assert.equal(deadline.aborted, false);
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), bytes);
      attempts++;
      return new Response(JSON.stringify(attempts === 1 ? {} : { text: transcript }),
        { status: attempts === 1 ? 503 : 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result, transcript.trim());
  assert.equal(attempts, 2);
});

test("system tone is warm and direct, without formal openings or fabricated saved actions", () => {
  assert.match(systemPrompt, /חם, קליל וידידותי/u);
  assert.match(systemPrompt, /"אחי" רק כשזה מתאים/u);
  assert.match(systemPrompt, /נראה שיש לך תזכורות/u);
  assert.match(systemPrompt, /לא אישור לפעולה שלא נשמרה/u);
});
