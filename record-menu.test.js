import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore } from "../src/store.js";
import { recordMenuForRequest, renderRecordMenu, renderRecordDetails, menuRecords } from "../src/record-menu.js";
import { handleRecordMenuCallback } from "../src/record-menu-callbacks.js";
import { replyToOwnerMessage } from "../src/message-handler.js";
import { TelegramClient } from "../src/telegram.js";

function fixture(count = 8) {
  const store = createEmptyStore();
  store.lists["42"] = {
    "מטרות מתמשכות": [{ id: "goal-ongoing", text: "אימון בקאנטרי", checked: false }],
    משימות: Array.from({ length: count }, (_, index) => ({
      id: `task-${index}`, text: index === 0 ? 'לאסוף ועד <בניין> & "כסף"' : `משימה ${index}`,
      checked: index === 1,
    })),
  };
  store.lists["99"] = { סודי: [{ id: "foreign", text: "מידע פרטי", checked: false }] };
  store.reminders = [
    { id: "weekly", chatId: "42", text: "פגישה שבועית", dueAt: 1_900_000_000_000 },
    { id: "once", chatId: "42", text: "פגישה חד־פעמית", dueAt: 1_900_000_060_000 },
    { id: "foreign-r", chatId: "99", text: "תזכורת פרטית", dueAt: 1_900_000_000_000 },
  ];
  store.savedSchedules = [{ chatId: "42", source: "לו״ז שבועי", entries: [{ reminderId: "weekly" }] }];
  store.pendingActions["42"] = { text: "עדיין מחכה לשעה" };
  return store;
}

const buttons = view => view.options.reply_markup.inline_keyboard.flat();
const query = data => ({
  id: "synthetic-callback", data, from: { id: 42, is_bot: false },
  message: { message_id: 12, from: { is_bot: true }, chat: { id: 42, type: "private" } },
});
const fakeTelegram = calls => ({
  call: async (method, payload) => { calls.push({ method, payload }); return true; },
});

test("weekly summary matches the reference layout with green single-column buttons and Show all", () => {
  const store = fixture();
  const before = JSON.stringify(store);
  const view = recordMenuForRequest(store, "42", "מה סיכום השבוע");
  assert.match(view.text, /^<b>📊 סיכום השבוע/u);
  assert.match(view.text, /🔄 מטרות מתמשכות · ☝️ מטרות חד־פעמיות/u);
  assert.equal(view.keepResponse, true);
  assert.equal(view.options.parse_mode, "HTML");
  assert.equal(view.options.reply_markup.inline_keyboard.length, 6);
  assert.ok(view.options.reply_markup.inline_keyboard.every(row => row.length === 1));
  assert.ok(buttons(view).every(button => button.style === "success"));
  assert.match(buttons(view).at(-1).text, /הצג הכל \(10 פריטים\)/u);
  assert.match(buttons(view)[0].text, /🔄/u);
  assert.doesNotMatch(JSON.stringify(view), /מידע פרטי|תזכורת פרטית/u);
  assert.equal(JSON.stringify(store), before);
});

test("all items are accessible through expansion and pagination without changing stored order", () => {
  const store = fixture(47);
  const before = JSON.stringify(store);
  const compact = renderRecordMenu(store, "42", "s");
  const expand = buttons(compact).at(-1).callback_data;
  assert.equal(expand, "v:p:s:a:0");
  const total = menuRecords(store, "42", "s").filter(record => !record.checked).length;
  const visited = [];
  for (let offset = 0; offset < total; offset += 20) {
    const page = renderRecordMenu(store, "42", "s", "a", offset);
    visited.push(...buttons(page).filter(button => button.callback_data.startsWith("v:i:"))
      .map(button => button.callback_data.split(":")[2]));
    assert.ok(buttons(page).every(button => Buffer.byteLength(button.callback_data) <= 64));
  }
  assert.equal(visited.length, total);
  assert.equal(new Set(visited).size, total);
  assert.equal(JSON.stringify(store), before);
});

test("completed records disappear from buttons, list counters and pagination, not storage", () => {
  const store = fixture();
  const closed = menuRecords(store, "42", "s").filter(record => record.checked);
  assert.ok(closed.length);
  const before = JSON.stringify(store);
  const menu = renderRecordMenu(store, "42", "s", "a");
  for (const record of closed) {
    assert.equal(buttons(menu).some(button => button.callback_data.includes(record.key)), false);
  }
  for (const record of menuRecords(store, "42", "a")) {
    assert.equal(record.count, store.lists["42"][record.name].filter(item => !item.checked).length);
  }
  assert.equal(JSON.stringify(store), before);
});

test("item buttons open complete escaped details with Back, and remain stable after restart or list edits", async () => {
  const store = fixture();
  const before = JSON.stringify(store);
  const view = recordMenuForRequest(store, "42", "מה רשימת המשימות שלי?");
  const entry = buttons(view)[0].callback_data;
  const parts = entry.split(":");
  const detail = renderRecordDetails(store, "42", parts[2], parts[3], parts[4], Number(parts[5]));
  assert.match(detail.text, /&lt;בניין&gt; &amp;/u);
  assert.doesNotMatch(detail.text, /<בניין>/u);
  assert.ok(buttons(detail).some(button => /חזרה/u.test(button.text)));
  const calls = [];
  await handleRecordMenuCallback(JSON.parse(before), fakeTelegram(calls), query(entry), {
    ownerChatId: "42", persist: async () => {},
  });
  assert.equal(calls[0].method, "answerCallbackQuery");
  assert.equal(calls[1].method, "editMessageText");
  assert.match(calls[1].payload.text, /לאסוף ועד/u);
  assert.equal(JSON.stringify(store), before);
  store.lists["42"].משימות.shift();
  const stale = [];
  const result = await handleRecordMenuCallback(store, fakeTelegram(stale), query(entry), { ownerChatId: "42" });
  assert.equal(result.stale, true);
  assert.equal(stale.length, 1);
  assert.match(stale[0].payload.text, /כבר לא מופיע/u);
});

test("foreign users, forwarded menus and non-private chats cannot navigate owner records", async () => {
  const store = fixture();
  const data = buttons(recordMenuForRequest(store, "42", "מה הסיכום"))[0].callback_data;
  for (const change of [
    q => { q.from.id = 99; },
    q => { q.message.chat.id = 99; },
    q => { q.message.chat.type = "group"; },
    q => { q.message.from.is_bot = false; },
    q => { q.message.message_id = 0; },
  ]) {
    const q = query(data);
    change(q);
    const calls = [];
    const before = JSON.stringify(store);
    const result = await handleRecordMenuCallback(store, fakeTelegram(calls), q, { ownerChatId: "42" });
    assert.equal(result.denied, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "answerCallbackQuery");
    assert.equal(JSON.stringify(store), before);
  }
});

test("list overview opens a named list and never mixes list items with scheduled events", async () => {
  const store = fixture();
  const overview = recordMenuForRequest(store, "42", "/lists");
  const calls = [];
  await handleRecordMenuCallback(store, fakeTelegram(calls), query(buttons(overview)[0].callback_data), {
    ownerChatId: "42", persist: async () => {},
  });
  assert.match(calls[1].payload.text, /מטרות מתמשכות/u);
  assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].text, "🔄 אימון בקאנטרי");
  const list = recordMenuForRequest(store, "42", "/show משימות");
  assert.doesNotMatch(JSON.stringify(list), /פגישה|תזכורת פרטית/u);
  assert.equal(recordMenuForRequest(store, "42", "תוסיף שמנת"), null);
  assert.equal(recordMenuForRequest(store, "42", "תזכיר לי מחר ב־07:30"), null);
  assert.equal(recordMenuForRequest(store, "42", "היי"), null);
  const reminderCalls = [];
  assert.deepEqual(await handleRecordMenuCallback(store, fakeTelegram(reminderCalls), query("r:d:existing"), {
    ownerChatId: "42",
  }), { ignored: true });
  assert.deepEqual(reminderCalls, []);
});

test("real message pipeline changes only list presentation and retains summary content and history", async () => {
  const store = fixture();
  const before = JSON.stringify(store);
  const sent = [], saved = [];
  const options = {
    readHistory: async () => [],
    readSummaryHistory: async () => ({ rows: [] }),
    saveConversation: async (...args) => saved.push(args),
    assistant: async () => "זה הסיכום המקורי, בלי שינוי.",
  };
  const telegram = { sendMessage: async (...args) => sent.push(args) };
  await replyToOwnerMessage(store, telegram, "42", "מה סיכום השבוע", options);
  assert.equal(sent.length, 2);
  assert.equal(sent[0][2].parse_mode, "HTML");
  assert.equal(sent[1][1], "זה הסיכום המקורי, בלי שינוי.");
  assert.equal(saved[0][2], sent[1][1]);
  sent.length = 0;
  await replyToOwnerMessage(store, telegram, "42", "מה רשימת המשימות שלי", options);
  assert.equal(sent.length, 1);
  assert.match(sent[0][1], /📝 משימות/u);
  assert.ok(sent[0][2].reply_markup.inline_keyboard.length);
  sent.length = 0;
  await replyToOwnerMessage(store, telegram, "42", "היי", options);
  assert.deepEqual(sent, [["42", "זה הסיכום המקורי, בלי שינוי."]]);
  assert.equal(JSON.stringify(store), before);
});

test("Telegram preserves the HTML mode and native button style only when requested", async () => {
  const client = new TelegramClient("synthetic-token");
  const payloads = [];
  client.call = async (_method, payload) => { payloads.push(payload); return { message_id: 1 }; };
  const view = recordMenuForRequest(fixture(), "42", "מה הסיכום");
  await client.sendMessage("42", view.text, view.options);
  assert.equal(payloads[0].parse_mode, "HTML");
  assert.equal(payloads[0].reply_markup.inline_keyboard[0][0].style, "success");
  await client.sendMessage("42", "תשובה רגילה");
  assert.equal(payloads[1].parse_mode, undefined);
  assert.equal(payloads[1].reply_markup, undefined);
});
