import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const directory = await mkdtemp(path.join(os.tmpdir(), "ah-sheli-appointments-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, loadStore } = await import("../src/store.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
const { replyToOwnerMessage } = await import("../src/message-handler.js");
const { parseNewAppointment } = await import("../src/appointment-flow.js");
const { handleRecordMenuCallback } = await import("../src/record-menu-callbacks.js");
const { withReminderRequestTime, parseJerusalemDateTime } = await import("../src/time.js");
const { initializeStatePersistence } = await import("../src/store.js");
const now = Date.parse("2026-10-12T18:00:00Z");
const owner = "12345";
after(() => rm(directory, { recursive: true, force: true }));
const future = [{ role: "assistant", createdAt: new Date(now),
  content: "היום:\nלא סומנו משימות שהושלמו היום.\n\nמחר (שלישי, 13.10):\n06:10 השכמה" }];
const run = (store, text, history = []) => withReminderRequestTime(() =>
  handleAssistantMessage(store, owner, text, () => assert.fail("Clear appointment needs no AI"),
    history, { telegramResponseStyle: true }), now);

test("appointment retains tomorrow and content through clarification and a reload, then saves task and event", async () => {
  const store = createEmptyStore();
  assert.equal(await run(store, "יש לי פגישה עם דני", future), "באיזו שעה?");
  assert.equal(store.pendingActions[owner].date, "2026-10-13");
  assert.equal(store.reminders.length, 0);
  assert.equal(Object.keys(store.lists[owner] ?? {}).length, 0);
  const restored = await loadStore();
  assert.equal(restored.pendingActions[owner].trackTask, true);
  const response = await run(restored, "10:30");
  assert.match(response, /10:30/u);
  assert.equal(restored.reminders[0].dueAt, parseJerusalemDateTime("2026-10-13", "10:30", { allowPast: true }));
  assert.equal(restored.lists[owner].משימות[0].text, "פגישה עם דני");
  assert.equal(restored.pendingActions[owner], undefined);
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.equal(saved.reminders[0].trackingTaskId, saved.lists[owner].משימות[0].id);
});

test("missing day and time are completed separately without losing content or asking twice", async () => {
  const store = createEmptyStore();
  assert.equal(await run(store, "יש לי תור לרופא"), "באיזה יום ובאיזו שעה?");
  assert.equal(await run(store, "מחר"), "באיזו שעה?");
  await run(store, "בשעה 09:00");
  assert.equal(store.reminders.length, 1);
  assert.equal(store.reminders[0].text, "תור לרופא");
  assert.equal(store.lists[owner].משימות.length, 1);
});

test("a naturally dated task requests only its missing time and becomes an event plus a task", async () => {
  const store = createEmptyStore();
  assert.equal(await run(store, "לדבר עם עדי מחר"), "באיזו שעה?");
  await run(store, "10:30");
  assert.equal(store.reminders[0].text, "לדבר עם עדי");
  assert.equal(store.lists[owner].משימות[0].text, "לדבר עם עדי");
});

test("complete appointment commits once and reuses an existing open task without copying other records", async () => {
  const store = createEmptyStore();
  store.lists[owner] = { משימות: [{ id: "existing", text: "פגישה עם דני", checked: false }] };
  store.lists.other = { משימות: [{ id: "private", text: "פרטי", checked: false }] };
  await run(store, "יש לי פגישה עם דני מחר ב10:30");
  assert.equal(store.lists[owner].משימות.length, 1);
  assert.equal(store.reminders[0].trackingTaskId, "existing");
  assert.equal(store.lists.other.משימות[0].text, "פרטי");
});

test("negative requests, queries and existing schedule commands stay outside the new appointment fast path", () => {
  for (const text of ["אין לי פגישה מחר", "מה עם הפגישה?", "תבטל פגישה מחר",
    "סיימתי פגישה", "פגישה לדוגמה מחר", "9:00 חזרה למשימות מחר", "לקנות חלב"]) {
    assert.equal(parseNewAppointment(text, future, now), null, text);
  }
});

test("real Telegram replies expose owner-bound done/update/delete actions, without a full-list gallery", async () => {
  const store = createEmptyStore(), sent = [];
  const telegram = { sendMessage: async (_chat, text, options) => sent.push({ text, options }),
    call: async (method, payload) => {
      if (payload.text && method !== "answerCallbackQuery") sent.push({ text: payload.text, options: payload });
      return {};
    }, editMessageText: async (_chat, _id, text, options) => sent.push({ text, options }) };
  const settings = { telegramResponseStyle: true, readHistory: async () => future,
    saveConversation: async () => {},
    assistant: (state, chatId, text, _analyzer, history, opts) => handleAssistantMessage(state, chatId, text,
      () => assert.fail("No AI for an explicit appointment"), history, opts) };
  await withReminderRequestTime(() => replyToOwnerMessage(store, telegram, owner,
    "יש לי פגישה עם דני מחר ב10:30", settings), now);
  assert.equal(sent.length, 1);
  const buttons = sent[0].options.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map(button => button.text), ["✅ בוצע", "✏️ עדכן", "🗑️ מחק"]);
  assert.equal(store.recordViews[owner].scope, "r");
  const callback = { id: "test", data: buttons[1].callback_data,
    from: { id: 12345, is_bot: false }, message: { message_id: 1, from: { is_bot: true },
      chat: { id: 12345, type: "private" } } };
  await handleRecordMenuCallback(store, telegram, callback, { ownerChatId: owner });
  assert.match(sent.at(-1).text, /לעדכון/u);
  await withReminderRequestTime(() => replyToOwnerMessage(store, telegram, owner, "תשנה את השעה ל11:30", settings), now);
  assert.equal(store.reminders[0].dueAt, parseJerusalemDateTime("2026-10-13", "11:30", { allowPast: true }));
  // Completing an event never fabricates a TASKS completion in today's summary.
  const view = store.recordViews[owner];
  assert.ok(view);
  assert.equal(view.completionDueAt, store.reminders[0].dueAt);
});

test("new task actions target its saved item and enforce the Telegram owner", async () => {
  const store = createEmptyStore(), sent = [];
  const telegram = { sendMessage: async (_chat, text, options) => sent.push({ text, options }),
    call: async () => ({}) };
  await withReminderRequestTime(() => replyToOwnerMessage(store, telegram, owner, "ללכת לספר", {
    telegramResponseStyle: true, readHistory: async () => [], saveConversation: async () => {},
    assistant: (state, chatId, text, _analyzer, history, opts) => handleAssistantMessage(state, chatId, text,
      async () => ({ type: "add-task", text: "ללכת לספר" }), history, opts),
  }), now);
  const buttons = sent[0].options.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 3);
  const query = { id: "test", data: buttons[0].callback_data, from: { id: 999, is_bot: false },
    message: { message_id: 1, from: { is_bot: true }, chat: { id: 12345, type: "private" } } };
  await handleRecordMenuCallback(store, telegram, query, { ownerChatId: owner });
  assert.equal(store.lists[owner].משימות[0].checked, false);
  await handleRecordMenuCallback(store, telegram, { ...query, from: { id: 12345, is_bot: false } }, { ownerChatId: owner });
  assert.equal(store.lists[owner].משימות[0].checked, true);
  assert.ok(store.lists[owner].משימות[0].completedAt);
});

test("an explicit goals destination is retained while the missing time is supplied", async () => {
  const store = createEmptyStore();
  assert.equal(await run(store, "יש לי פגישה עם דני מחר ותוסיף למטרות"), "באיזו שעה?");
  await run(store, "10:30");
  assert.equal(store.lists[owner].מטרות[0].text, "פגישה עם דני");
  assert.equal(store.lists[owner].משימות, undefined);
});

test("actual PostgreSQL commits the new event and task together, then returns both through SQL", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const { getPool, closeDatabase } = await import("../src/database.js");
  const client = await getPool().connect();
  try {
    await client.query(`CREATE TEMP TABLE ah_sheli_state (
      key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT NOW()
    )`);
    const store = createEmptyStore();
    const connection = { query: (...args) => client.query(...args), release() {} };
    await initializeStatePersistence(store, { query: connection.query, connect: async () => connection });
    await run(store, "יש לי פגישה עם דני מחר ב10:30");
    const { rows } = await client.query(`SELECT value->'lists'->$1::text->'משימות' AS tasks,
      value->'reminders' AS events FROM pg_temp.ah_sheli_state`, [owner]);
    assert.equal(rows[0].tasks.length, 1);
    assert.equal(rows[0].events.length, 1);
    assert.equal(rows[0].events[0].trackingTaskId, rows[0].tasks[0].id);
    assert.equal(rows[0].tasks[0].checked, false);
  } finally {
    client.release(true);
    await closeDatabase();
  }
});

test("failed SQL insertion produces neither task, event nor success receipt", async () => {
  const store = createEmptyStore();
  const pool = { query: async () => ({ rows: [] }), connect: async () => ({
    query: async statement => {
      if (/INSERT/u.test(statement)) throw new Error("synthetic SQL insert failed");
      return { rows: [] };
    }, release() {},
  }) };
  await initializeStatePersistence(store, pool);
  await assert.rejects(run(store, "יש לי פגישה עם דני מחר ב10:30"), /SQL insert failed/u);
  assert.equal(store.reminders.length, 0);
  assert.equal(Object.keys(store.lists[owner] ?? {}).length, 0);
});
