import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-schedule-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [
  { scheduleDailyReminders },
  { createEmptyStore },
  { handleAssistantMessage, buildAssistantContext },
  { analyzeMessage },
  { normalizeIntent },
  { parseJerusalemDateTime },
  { TelegramClient },
] = await Promise.all([
  import("../src/schedule-reminders.js"), import("../src/store.js"),
  import("../src/assistant.js"), import("../src/groq-assistant.js"),
  import("../src/assistant-intent.js"), import("../src/time.js"),
  import("../src/telegram.js"),
]);
after(() => rm(directory, { recursive: true, force: true }));
const entries = [
  { text: "השכמה", hour: 6, minute: 0 },
  { text: "יציאה לאיסופים", hour: 6, minute: 35 },
  { text: "חזרה למשימות", hour: 9, minute: 0 },
  { text: "יציאה לאיסוף צהריים", hour: 14, minute: 0 },
  { text: "חזרה למשימות", hour: 16, minute: 30 },
].map(item => ({ ...item, date: "2099-01-02" }));
const fakeClient = intent => ({
  complete: async () => ({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(intent) } }],
  }),
});

test("a full daily schedule saves all five reminders durably in Israel time", async () => {
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "owner-test", "הלו״ז שלי ל־2099-01-02:\n06:00 השכמה\n06:35 יציאה לאיסופים\n09:00 חזרה למשימות\n14:00 יציאה לאיסוף צהריים\n16:30 חזרה למשימות",
    async () => normalizeIntent({ type: "schedule-reminders", reminders: entries }));
  assert.match(reply, /אזכיר לך/);
  assert.equal(store.reminders.length, 5);
  assert.equal(new Date(store.reminders[0].dueAt).toISOString(), "2099-01-02T04:00:00.000Z");
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.deepEqual(saved.reminders, store.reminders);
  assert.equal(new Set(store.reminders.map(item => item.id)).size, 5);
  for (const entry of entries) assert.ok(reply.includes(entry.text));
});

test("resending a schedule and repeated rows do not duplicate reminders", async () => {
  const store = createEmptyStore();
  await scheduleDailyReminders(store, "owner-test", [...entries, entries[0]]);
  const reply = await scheduleDailyReminders(store, "owner-test", entries);
  assert.equal(store.reminders.length, 5);
  assert.match(reply, /כבר שמור/);
});

test("duplicate detection cannot use another chat's reminders", async () => {
  const store = createEmptyStore();
  await scheduleDailyReminders(store, "other-chat", entries);
  await scheduleDailyReminders(store, "owner-test", entries);
  assert.equal(store.reminders.filter(item => item.chatId === "owner-test").length, 5);
});

test("past events are reported, not moved to tomorrow, while future events are saved", async () => {
  const store = createEmptyStore();
  const now = parseJerusalemDateTime("2099-01-02", "09:30", { allowPast: true });
  const reply = await scheduleDailyReminders(store, "owner-test", entries, now);
  assert.equal(store.reminders.length, 2);
  assert.match(reply, /כבר עברו/);
  assert.match(reply, /לא הזזתי אותם ליום אחר/);
  assert.ok(store.reminders.every(item => new Date(item.dueAt).toISOString().startsWith("2099-01-02")));
});

test("missing details are asked together without partial writes or per-item submission", async () => {
  const store = createEmptyStore();
  const reply = await scheduleDailyReminders(store, "owner-test", [
    entries[0], { ...entries[1], hour: null }, { ...entries[2], date: null },
  ]);
  assert.deepEqual(store.reminders, []);
  assert.match(reply, /יציאה לאיסופים: באיזו שעה/);
  assert.match(reply, /חזרה למשימות: באיזה יום/);
  assert.match(reply, /אין צורך לשלוח את כל הלו״ז מחדש/);
});

test("a single clarification reply can complete the original schedule using history", async () => {
  const store = createEmptyStore();
  const history = [{ role: "user", text: "לו״ז למחר: 06:00 השכמה, יציאה לאיסופים" }];
  const reply = await handleAssistantMessage(store, "owner-test", "היציאה ב-06:35",
    async (_text, context) => {
      assert.deepEqual(context.recentConversation, history);
      return normalizeIntent({ type: "schedule-reminders", reminders: entries.slice(0, 2) });
    }, history);
  assert.match(reply, /אזכיר לך/);
  assert.equal(store.reminders.length, 2);
});

test("an invalid last AI entry prevents all writes, including otherwise valid entries", async () => {
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "owner-test", "קבע כמה התראות לשעות שציינתי",
    (text, context) => analyzeMessage(text, context, fakeClient({
      type: "schedule-reminders", reminders: [...entries, { ...entries[0], hour: 25 }],
    })));
  assert.deepEqual(store.reminders, []);
  assert.match(reply, /לא שמרתי דבר/);
});

test("a nonexistent DST time rejects the entire schedule", async () => {
  const store = createEmptyStore();
  const reply = await scheduleDailyReminders(store, "owner-test",
    [...entries, { text: "יציאה", date: "2027-03-26", hour: 2, minute: 30 }]);
  assert.equal(store.reminders.length, 0);
  assert.match(reply, /שעון קיץ או חורף/);
});

test("the model receives the whole Telegram message and an explicit Israel date", async () => {
  const context = buildAssistantContext(createEmptyStore(), "owner-test", new Date("2026-10-07T22:30:00Z"));
  assert.equal(context.currentLocalDate, "2026-10-08");
  const input = "א".repeat(4096);
  const client = fakeClient({ type: "answer", response: "בסדר" });
  const generate = client.complete;
  client.complete = async request => {
    assert.equal(JSON.parse(request.messages[1].content).currentMessage, input);
    assert.equal(request.response_format, undefined);
    assert.match(request.messages[0].content, /schedule-reminders/);
    return generate(request);
  };
  await analyzeMessage(input, context, client);
});

test("long schedule summaries are sent completely, not truncated at Telegram limits", async () => {
  const client = new TelegramClient("synthetic-test-token");
  const text = `${"א".repeat(3999)}💪\n${"פעילות מתוזמנת\n".repeat(600)}`;
  const parts = [];
  client.call = async (method, payload) => {
    assert.equal(method, "sendMessage");
    assert.equal(payload.chat_id, "owner-test");
    assert.ok(payload.text.length <= 4000);
    parts.push(payload.text);
    return { message_id: parts.length };
  };
  await client.sendMessage("owner-test", text);
  assert.equal(parts.join(""), text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => !/[\uD800-\uDBFF]$/u.test(part)));
});

test("analysis-only answers do not automatically create reminders from background context", async () => {
  const store = createEmptyStore();
  await handleAssistantMessage(store, "owner-test", "רק נתח את הלו״ז, בלי ליצור תזכורות",
    async () => ({ type: "answer", response: "הנה הניתוח" }));
  assert.deepEqual(store.reminders, []);
});
