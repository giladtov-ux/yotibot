import test from "node:test";
import assert from "node:assert/strict";
import { compactHistory, needsConversationHistory, outputTokenBudget } from "../src/assistant-performance.js";
import { buildAssistantContext } from "../src/assistant.js";
import { analyzeMessage, createGroqClient } from "../src/groq-assistant.js";
import { createEmptyStore } from "../src/store.js";
import { replyToOwnerMessage } from "../src/message-handler.js";

const schedule = "סידור עבודה למחר:\n06:00 השכמה\n06:35 יציאה לאיסופים\n09:00 חזרה";
const historyText = row => row.content ?? row.text;

test("a self-contained schedule skips old history, but a clarification retains it", () => {
  assert.equal(needsConversationHistory(schedule), false);
  assert.equal(needsConversationHistory("יציאה לאיסופים ב-06:35"), true);
  assert.equal(needsConversationHistory("לו״ז למחר: 06:00 השכמה, יציאה לאיסופים"), true);
  assert.equal(needsConversationHistory("/help"), false);
  assert.equal(needsConversationHistory(`רק נתח, אל תיצור תזכורות: ${schedule}`), true);
});

test("bounded history preserves an older full schedule during multiple clarification turns", () => {
  const source = `${schedule}\n${"פרט ".repeat(950)}`;
  assert.ok(source.length < 4096);
  const history = [
    { role: "user", content: source },
    { role: "assistant", content: "שאלה ".repeat(400) },
    { role: "user", content: "היציאה 6:35" },
    { role: "assistant", content: "שאלה ".repeat(400) },
    { role: "user", content: "מחר" },
    { role: "assistant", content: "שאלה ".repeat(400) },
  ];
  const compact = compactHistory(history);
  assert.equal(compact[0].content, source);
  assert.ok(compact.length <= 8);
  assert.ok(compact.reduce((sum, row) => sum + historyText(row).length, 0) <= 5200);
  assert.ok(compact.filter(row => row.role === "assistant").every(row => row.content.length <= 350));
  assert.equal(history[1].content.length, 2000, "saved history is never mutated");
  assert.deepEqual(compactHistory(compact), compact, "compacting twice is stable");
});

test("four recent exchanges preserve the supplied future day without replaying older turns", () => {
  const history = [
    { role: "user", content: "הקשר ישן" }, { role: "assistant", content: "ישן" },
    { role: "user", content: "הפגישה מחר, לא היום" }, { role: "assistant", content: "באיזו שעה?" },
    { role: "user", content: "בשמונה" }, { role: "assistant", content: "סגור" },
    { role: "user", content: "אני לחוץ, תענה קצר" }, { role: "assistant", content: "ברור" },
    { role: "user", content: "תראה את הפגישה" }, { role: "assistant", content: "הפגישה מחר בשמונה" },
  ];
  const compact = compactHistory(history);
  assert.equal(compact.length, 8);
  assert.equal(historyText(compact[0]), "הפגישה מחר, לא היום");
  assert.ok(!compact.some(row => historyText(row) === "הקשר ישן"));
  assert.ok(compact.reduce((sum, row) => sum + historyText(row).length, 0) <= 5200);
  assert.deepEqual(compactHistory(compact), compact);
});

test("ordinary output is capped at 640 tokens; complete batches get bounded additional room", () => {
  assert.equal(outputTokenBudget("תן טיפ קצר"), 640);
  assert.equal(outputTokenBudget("תסביר בהרחבה"), 2048);
  const bulk = "סידור עבודה:\n" + Array.from({ length: 100 }, (_, i) =>
    `06:${String(i % 60).padStart(2, "0")} פעילות ${i}`).join("\n");
  assert.ok(outputTokenBudget(bulk) > 2048);
  assert.ok(outputTokenBudget(bulk) <= 8192);
  assert.equal(outputTokenBudget("מחר", [{ role: "user", content: bulk }]), outputTokenBudget(bulk));
  assert.equal(outputTokenBudget("x".repeat(40000)), 8192);
});

test("stored data is bounded and relevant, without changing real list contents", () => {
  const state = createEmptyStore();
  state.lists.owner = Object.fromEntries(Array.from({ length: 50 }, (_, n) =>
    [`רשימה ${n}`, Array.from({ length: 100 }, () => ({ text: "פריט ".repeat(100), checked: false }))]));
  const general = buildAssistantContext(state, "owner", new Date(), "תן טיפ לבוקר");
  assert.equal(general.lists.length, 0);
  assert.equal(general.availableListNames.length, 30);
  const relevant = buildAssistantContext(state, "owner", new Date(), "הצג רשימה 49");
  assert.equal(relevant.availableListNames.length, 30);
  assert.ok(relevant.lists.length <= 3);
  assert.ok(relevant.lists.some(list => list.name === "רשימה 49"));
  assert.ok(relevant.lists.every(list => list.items.length <= 12));
  assert.ok(relevant.lists.flatMap(list => list.items).every(item => item.text.length <= 160));
  assert.equal(state.lists.owner["רשימה 49"].length, 100);
  assert.equal(relevant.storedDataMayBePartial, true);
});

test("native payload keeps all new user text but omits duplicated static background", async () => {
  const input = "סידור עבודה:\n" + "06:00 השכמה\n".repeat(70);
  let body;
  await analyzeMessage(input, {
    currentLocalDate: "2099-01-02", timezone: "Asia/Jerusalem",
    user: { note: "static" }, dailyScheduleContextOnly: { entries: [] },
    recentConversation: [{ role: "assistant", content: "סיכום ".repeat(5000) }],
  }, { complete: async value => {
    body = value;
    return { choices: [{ finish_reason: "stop", message: { content: '{"type":"answer","response":"בדיקה"}' } }] };
  } });
  const sent = JSON.parse(body.messages.at(-1).content);
  assert.equal(sent.currentMessage, input);
  assert.equal(sent.chatContext.user, undefined);
  assert.equal(sent.chatContext.dailyScheduleContextOnly, undefined);
  assert.equal(sent.chatContext.recentConversation, undefined, "history is not duplicated in the current message");
  assert.equal(body.messages[1].role, "assistant");
  assert.equal(body.messages[1].content.length, 350);
  assert.ok(body.max_tokens < 16384);
});

test("the native client pins the requested fast model", () => {
  const client = createGroqClient({ apiKey: "synthetic-key", model: "unused-override" });
  assert.equal(client.model, "openai/gpt-oss-20b");
});

test("the delivery pipeline skips the history database read for a new full roster", async () => {
  let read = false;
  const result = await replyToOwnerMessage(createEmptyStore(), { sendMessage: async () => {} },
    "owner", schedule, {
      readHistory: async () => { read = true; return []; },
      assistant: async (_state, _owner, _text, _unused, history) => {
        assert.deepEqual(history, []); return "בדיקה";
      },
      saveConversation: async () => {},
    });
  assert.equal(read, false);
  assert.equal(result.delivered, true);
});
