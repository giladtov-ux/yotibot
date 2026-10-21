import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore } from "../src/store.js";
import { recordMenuForRequest, renderRecordMenu, menuRecords } from "../src/record-menu.js";
import { handleRecordMenuCallback } from "../src/record-menu-callbacks.js";
import { handleOwnerUpdate } from "../src/message-handler.js";
import { handleAssistantMessage } from "../src/assistant.js";
import { withReminderRequestTime, parseJerusalemDateTime } from "../src/time.js";
import { scheduleQueryDayOffset } from "../src/schedule-queries.js";

const now = Date.parse("2026-10-09T18:43:00Z");
const inRequest = fn => withReminderRequestTime(fn, now);
const buttons = view => view.options.reply_markup.inline_keyboard.flat();
const local = (date, clock) => parseJerusalemDateTime(date, clock, { allowPast: true });
function fixture() {
  const store = createEmptyStore();
  store.lists["42"] = { קניות: [{ id: "milk", text: "חלב", checked: false }] };
  store.pendingActions["42"] = { type: "reminder", text: "ממתין לתשובה", date: null, hour: null, minute: null };
  const entries = [
    { reminderId: "daily", text: "סיכום יום והכנה למחר", weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 21, minute: 30 },
    { reminderId: "sun", text: "השכמה", weekdays: [0], hour: 6, minute: 45 },
    { reminderId: "mon", text: "פגישה", weekdays: [1], hour: 9, minute: 0 },
    { reminderId: "tue", text: "איסוף", weekdays: [2], hour: 12, minute: 0 },
    { reminderId: "wed", text: "חשבון", weekdays: [3], hour: 13, minute: 0 },
    { reminderId: "fri", text: "הליכה לבית כנסת", weekdays: [5], hour: 17, minute: 15 },
    { reminderId: "sat", text: "לו״ז שבת: בית כנסת אחה״צ <מקורי>", weekdays: [6], hour: 16, minute: 0 },
  ];
  store.savedSchedules = [{ chatId: "42", source: "לו״ז מקורי", entries }];
  store.reminders = entries.map(entry => ({
    id: entry.reminderId, chatId: "42", text: entry.text,
    dueAt: local("2026-10-17", `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`),
  }));
  store.reminders.push(
    { id: "once", chatId: "42", text: "תזכורת חד־פעמית", dueAt: local("2026-10-10", "08:00") },
    { id: "private", chatId: "99", text: "לא לחשוף", dueAt: local("2026-10-10", "09:00") },
  );
  return store;
}

test("reminders match the reference header, days, clocks, recurring icons and Show all", () => inRequest(() => {
  const store = fixture(), before = JSON.stringify(store);
  const view = recordMenuForRequest(store, "42", "מה רשימת התזכורות שלי");
  assert.match(view.text, /^<b>🟨 רשימת התזכורות שלך<\/b>/u);
  assert.match(view.text, /לעדכון או מחיקה, לחץ על התזכורת 👇/u);
  assert.match(view.text, /🔄 תזכורות חוזרות · ☝️ תזכורות חד־פעמיות/u);
  const rows = view.options.reply_markup.inline_keyboard;
  assert.ok(rows.every(row => row.length === 1));
  assert.ok(buttons(view).every(button => button.style === "success"));
  assert.ok(buttons(view).some(button => button.text.includes("א–ש") && button.text.includes("21:30")));
  assert.ok(buttons(view).some(button => button.text.includes("06:45")));
  assert.match(buttons(view).at(-1).text, /הצג הכל \(8 פריטים\)/u);
  assert.ok(buttons(view).every(button => Buffer.byteLength(button.callback_data) <= 64));
  assert.doesNotMatch(JSON.stringify(view), /חלב|לא לחשוף/u);
  assert.equal(JSON.stringify(store), before);
}));

test("Show all and reminder details work without modifying records, schedules or pending writes", async () => inRequest(async () => {
  const store = fixture(), before = JSON.stringify(store), calls = [];
  const telegram = { call: async (method, payload) => { calls.push({ method, payload }); return true; } };
  const query = data => ({
    id: "test-query", data, from: { id: 42 },
    message: { message_id: 7, from: { is_bot: true }, chat: { id: 42, type: "private" } },
  });
  const view = recordMenuForRequest(store, "42", "תזכורות");
  await handleRecordMenuCallback(store, telegram, query(buttons(view).at(-1).callback_data), {
    ownerChatId: "42", persist: async () => {},
  });
  assert.equal(calls[1].method, "editMessageText");
  assert.match(calls[1].payload.text, /8 מתוך 8/u);
  const full = renderRecordMenu(store, "42", "r", "a");
  const saturday = buttons(full).find(button => button.text.includes("אחה״צ"));
  await handleRecordMenuCallback(store, telegram, query(saturday.callback_data), {
    ownerChatId: "42", persist: async () => {},
  });
  assert.match(calls.at(-1).payload.text, /🔄 תזכורת חוזרת/u);
  assert.match(calls.at(-1).payload.text, /&lt;מקורי&gt;/u);
  const foreign = query(saturday.callback_data);
  foreign.from.id = 99;
  assert.deepEqual(await handleRecordMenuCallback(store, telegram, foreign, { ownerChatId: "42" }), { denied: true });
  assert.equal(JSON.stringify({ ...store, recordViews: {} }), before);
}));

test("tomorrow reads saved weekly occurrences and sorts by Israel time without rescheduling anything", () => inRequest(() => {
  const store = fixture(), before = JSON.stringify(store);
  const view = recordMenuForRequest(store, "42", "מה יש מחר? מה התוכנית למחר?");
  assert.match(view.text, /רשימת התזכורות שלך למחר/u);
  const entries = menuRecords(store, "42", "n");
  assert.deepEqual(entries.map(item => item.clock), ["08:00", "16:00", "21:30"]);
  assert.deepEqual(entries.map(item => item.id), ["once", "sat", "daily"]);
  assert.doesNotMatch(JSON.stringify(view), /הליכה לבית כנסת|חלב|לא לחשוף/u);
  assert.equal(view.keepResponse, true);
  assert.equal(JSON.stringify(store), before);
}));

test("voice and text produce exactly the same real reminder menu and tomorrow response", async () => {
  const results = [];
  for (const spoken of [false, true]) {
    const store = fixture(), before = JSON.stringify(store), sent = [], saved = [];
    const text = "מה יש מחר? מה התוכנית למחר?";
    await handleOwnerUpdate(store, { sendMessage: async (...args) => sent.push(args) }, {
      update_id: 90,
      message: { message_id: 7, date: now / 1000, from: { id: 42 }, chat: { id: 42, type: "private" },
        ...(spoken ? { voice: { file_id: "test-recording" } } : { text }),
      },
    }, {
      ownerChatId: "42",
      transcribeVoice: async () => text,
      replyOptions: {
        readHistory: async () => [],
        saveConversation: async (...args) => saved.push(args),
        assistant: (state, chat, request, _unused, history) => handleAssistantMessage(
          state, chat, request, async () => assert.fail("clear schedule questions do not need AI"), history),
      },
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0][1], /🟨 רשימת התזכורות שלך למחר/u);
    assert.match(sent[0][1], /16:00 — לו״ז שבת/u);
    assert.doesNotMatch(sent[0][1], /חסר לי פרט/u);
    assert.equal(JSON.stringify(store), before);
    results.push({ sent, saved });
  }
  assert.deepEqual(results[0], results[1]);
});

test("relative day views respect Israel midnight, not the host UTC date", () => {
  withReminderRequestTime(() => {
    const store = fixture();
    const entries = menuRecords(store, "42", "n");
    assert.deepEqual(entries.map(item => item.id), ["sun", "daily"]);
    assert.equal(entries[0].days, "א");
  }, Date.parse("2026-10-09T22:40:00Z"));
});

test("no-one-off footer is honest; empty views and read-only queries never invent data", () => inRequest(() => {
  const store = fixture();
  store.reminders = store.reminders.filter(item => item.id !== "once");
  assert.match(JSON.stringify(recordMenuForRequest(store, "42", "תזכורות")), /אין תזכורות חד־פעמיות/u);
  const empty = createEmptyStore(), before = JSON.stringify(empty);
  assert.match(recordMenuForRequest(empty, "42", "מה יש מחר").text, /עוד אין כאן תזכורות/u);
  assert.equal(JSON.stringify(empty), before);
  assert.equal(scheduleQueryDayOffset("מה יש מחר?"), 1);
  assert.equal(scheduleQueryDayOffset("מה יש היום"), 0);
  for (const text of ["תזכיר לי מחר ב־8", "תמחק את התזכורות", "מה יש ברשימת קניות",
    "מה יש מחר? תוסיף חלב לרשימת הקניות", "מה יש היום? מה יש מחר?"]) {
    assert.equal(scheduleQueryDayOffset(text), null);
  }
}));
