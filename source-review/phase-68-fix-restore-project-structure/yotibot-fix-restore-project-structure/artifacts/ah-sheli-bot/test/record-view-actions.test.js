import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-record-view-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore } = await import("../src/store.js");
const { menuRecords, renderRecordMenu, pageData } = await import("../src/record-menu.js");
const { handleRecordMenuCallback } = await import("../src/record-menu-callbacks.js");
const { handleRecordViewAction } = await import("../src/record-view-actions.js");
const { handleAuthorizedUpdate } = await import("../src/user-update-handler.js");
const { createReminderOperationQueue } = await import("../src/reminder-actions.js");
after(() => rm(directory, { recursive: true, force: true }));

function fixture() {
  const store = createEmptyStore();
  store.lists["42"] = {
    משימות: [
      { id: "first", text: "בדיקה", checked: false },
      { id: "second", text: "🔄 בדיקה", checked: false },
    ],
    קניות: [{ id: "third", text: "בדיקה", checked: false }],
  };
  store.lists["99"] = { משימות: [{ id: "foreign", text: "בדיקה", checked: false }] };
  store.reminders = [
    { id: "repeat", chatId: "42", text: "תזכורת חוזרת", dueAt: Date.UTC(2099, 0, 1),
      createdAt: 1000, repeatEveryMs: 300000, remainingOccurrences: 10 },
    { id: "once", chatId: "42", text: "פגישה", dueAt: Date.UTC(2099, 0, 2), createdAt: 1000 },
    { id: "foreign", chatId: "99", text: "תזכורת פרטית", dueAt: Date.UTC(2099, 0, 2), createdAt: 1000 },
  ];
  return store;
}
const syntheticTelegram = () => ({
  sent: [], calls: [],
  async call(method, payload) { this.calls.push({ method, payload }); },
  async sendMessage(...args) { this.sent.push(args); },
});
const persist = async () => {};
const callback = data => ({
  id: "callback", data, from: { id: 42 },
  message: { message_id: 12, from: { is_bot: true }, chat: { id: 42, type: "private" } },
});
async function open(store, record, telegram = syntheticTelegram(), persistence = persist) {
  await handleRecordMenuCallback(store, telegram,
    callback(`v:i:${record.key}:s:c:0`), { ownerChatId: "42", persist: persistence });
}
const find = (store, id) => menuRecords(store, "42", "s").find(record => record.id === id);

for (const wording of ["מחק", "למחוק", "מחק את זה", "תמחק אותו"]) {
  test(`${wording}: delete the displayed stable ID, not its sorted position or identical text`, async () => {
    const store = fixture();
    const deletedKey = find(store, "first").key;
    await open(store, find(store, "first"));
    store.lists["42"].משימות.reverse();
    const result = await handleRecordViewAction(store, "42", wording, { persist });
    assert.equal(result.text, "הפריט נמחק");
    assert.deepEqual(store.lists["42"].משימות.map(item => item.id), ["second"]);
    assert.equal(store.lists["42"].קניות.length, 1);
    assert.equal(store.lists["99"].משימות.length, 1);
    assert.equal(store.reminders.length, 3);
    assert.equal(store.recordViews["42"], undefined);
    assert.ok(result.menu.options.reply_markup);
    assert.equal(renderRecordMenu(store, "42", "s").options.reply_markup.inline_keyboard
      .flat().some(button => button.callback_data.includes(deletedKey)), false);
  });
}

for (const wording of ["בוצע", "✅ בוצע!", "סיימתי", "עשיתי", "סמן כבוצע", "Done"]) {
  test(`${wording}: displayed task completes durably with an updated checked menu`, async () => {
    const store = fixture();
    await open(store, find(store, "first"));
    let persisted;
    const result = await handleRecordViewAction(store, "42", wording, {
      persist: async (candidate, options) => {
        assert.equal(store.lists["42"].משימות[0].checked, false);
        persisted = structuredClone(candidate);
        assert.deepEqual(options.verifyList, { chatId: "42", listName: "משימות" });
      },
    });
    assert.equal(persisted.lists["42"].משימות[0].checked, true);
    assert.equal(store.lists["42"].משימות[0].checked, true);
    assert.equal(store.lists["42"].משימות[1].checked, false);
    assert.equal(store.lists["42"].קניות[0].checked, false);
    assert.equal(store.lists["99"].משימות[0].checked, false);
    assert.match(result.text, /סומן כבוצע/u);
    const key = find(store, "first").key;
    assert.equal(result.menu.options.reply_markup.inline_keyboard.flat()
      .some(button => button.callback_data.includes(key)), false);
    assert.match(result.menu.text, /4 פריטים/u);
    assert.equal(store.recordViews["42"], undefined);
  });
}

test("failed completion never changes live data or returns a receipt", async () => {
  const store = fixture();
  await open(store, find(store, "first"));
  const before = JSON.stringify(store);
  await assert.rejects(handleRecordViewAction(store, "42", "בוצע", {
    persist: async () => { throw new Error("synthetic database failure"); },
  }), /synthetic database failure/u);
  assert.equal(JSON.stringify(store), before);
});

test("done and delete detail buttons use the same owner-bound writer, not AI", async () => {
  const store = fixture();
  const telegram = syntheticTelegram();
  const record = find(store, "first");
  await open(store, record, telegram);
  const { renderRecordDetails } = await import("../src/record-menu.js");
  const buttons = renderRecordDetails(store, "42", record.key, "s", "c", 0)
    .options.reply_markup.inline_keyboard.flat();
  const done = buttons.find(button => button.text.includes("בוצע"));
  const remove = buttons.find(button => button.text.includes("מחק"));
  assert.ok(Buffer.byteLength(done.callback_data) <= 64);
  telegram.sent.length = 0;
  await handleRecordMenuCallback(store, telegram, callback(done.callback_data), {
    ownerChatId: "42", persist: async candidate => {
      assert.equal(telegram.sent.length, 0);
      assert.equal(candidate.lists["42"].משימות[0].checked, true);
    },
  });
  assert.equal(store.lists["42"].משימות[0].checked, true);
  assert.match(telegram.sent[0][1], /סומן כבוצע/u);
  await handleRecordMenuCallback(store, telegram, callback(done.callback_data), {
    ownerChatId: "42", persist,
  });
  assert.match(telegram.sent[1][1], /כבר סומן/u);
  await handleRecordMenuCallback(store, telegram, callback(remove.callback_data), {
    ownerChatId: "42", persist,
  });
  assert.deepEqual(store.lists["42"].משימות.map(item => item.id), ["second"]);
});

test("completion callback rejects foreign senders and cannot acknowledge a failed save", async () => {
  const store = fixture();
  const telegram = syntheticTelegram();
  const data = `v:d:${find(store, "first").key}:s:c:0`;
  assert.equal((await handleRecordMenuCallback(store, telegram,
    { ...callback(data), from: { id: 99 } }, { ownerChatId: "42", persist })).denied, true);
  assert.equal(store.lists["42"].משימות[0].checked, false);
  telegram.calls.length = 0;
  await assert.rejects(handleRecordMenuCallback(store, telegram, callback(data), {
    ownerChatId: "42", persist: async () => { throw new Error("failed"); },
  }), /failed/u);
  assert.equal(telegram.sent.length, 0);
  assert.equal(telegram.calls.length, 0);
});

test("bare done without a selected item never reaches a technical error", async () => {
  assert.doesNotMatch((await handleRecordViewAction(fixture(), "42", "בוצע")).text, /מידע טכני/u);
});

test("authorized Telegram text executes completion without calling history or AI", async () => {
  const store = fixture();
  const telegram = syntheticTelegram();
  await open(store, find(store, "first"), telegram);
  const result = await handleAuthorizedUpdate(store, telegram, {
    message: { text: "בוצע", chat: { id: 42, type: "private" }, from: { id: 42 } },
  }, {
    userAccess: { handle: async () => "42", assertPermission: async () => {} },
    replyOptions: {
      readHistory: async () => { throw new Error("history must not be consulted"); },
      assistant: async () => { throw new Error("AI must not execute direct completion"); },
    },
  });
  assert.equal(result.delivered, true);
  assert.equal(store.lists["42"].משימות[0].checked, true);
  assert.match(telegram.sent[0][1], /סומן כבוצע/u);
});

test("typed done closes the displayed delivered occurrence without consuming the next recurring one", async () => {
  const store = fixture();
  const reminder = store.reminders.find(item => item.id === "repeat");
  const deliveredAt = reminder.dueAt - reminder.repeatEveryMs;
  reminder.telegramDeliveries = {
    [deliveredAt.toString(36)]: { state: "sent", messageId: 11, nagMessageIds: [12] },
  };
  const futureDeadline = reminder.dueAt;
  await open(store, find(store, "repeat"));
  const result = await handleRecordViewAction(store, "42", "בוצע", { persist });
  const updated = store.reminders.find(item => item.id === "repeat");
  assert.equal(updated.telegramDeliveries[deliveredAt.toString(36)].state, "done");
  assert.equal(updated.dueAt, futureDeadline);
  assert.equal(updated.remainingOccurrences, 10);
  assert.match(result.text, /סומן כבוצע/u);
});

test("a future one-off completion stops its send and is idempotent on an older button", async () => {
  const store = fixture();
  const item = find(store, "once");
  await open(store, item);
  const view = { ...store.recordViews["42"] };
  await handleRecordViewAction(store, "42", "בוצע", { persist, now: () => 2000 });
  assert.equal(store.reminders.find(reminder => reminder.id === "once").sentAt, 2000);
  assert.match((await handleRecordViewAction(store, "42", "בוצע", {
    persist, selectedView: view,
  })).text, /כבר סומן/u);
});

test("a recurring reminder asks once; yes deletes the entire series and returns to the list", async () => {
  const store = fixture();
  store.savedSchedules = [{ id: "schedule", chatId: "42", source: "לו״ז", entries: [
    { reminderId: "repeat", text: "תזכורת חוזרת", weekdays: [0], hour: 9, minute: 0 },
    { reminderId: "once", text: "פגישה", weekdays: [1], hour: 9, minute: 0 },
  ] }, { id: "foreign-empty", chatId: "99", source: "פרטי", entries: [] }];
  await open(store, find(store, "repeat"));
  assert.match((await handleRecordViewAction(store, "42", "מחק", { persist })).text, /וגם את התזכורות הבאות/u);
  assert.equal(store.reminders.length, 3);
  const result = await handleRecordViewAction(store, "42", "כן", { persist });
  assert.equal(result.text, "הפריט נמחק");
  assert.deepEqual(store.reminders.map(item => item.id), ["once", "foreign"]);
  assert.deepEqual(store.savedSchedules[0].entries.map(item => item.reminderId), ["once"]);
  assert.equal(store.savedSchedules[1].id, "foreign-empty");
  assert.equal(await handleRecordViewAction(store, "42", "כן", { persist }), null);
});

test("cancel, unrelated turns, back navigation and changing selection cannot reuse old consent", async () => {
  const store = fixture();
  await open(store, find(store, "repeat"));
  await handleRecordViewAction(store, "42", "מחק", { persist });
  assert.equal((await handleRecordViewAction(store, "42", "לא", { persist })).text, "לא מחקתי דבר.");
  assert.equal(await handleRecordViewAction(store, "42", "כן", { persist }), null);
  await handleRecordViewAction(store, "42", "מחק", { persist });
  assert.equal(await handleRecordViewAction(store, "42", "איך היום שלך?", { persist }), null);
  assert.equal(await handleRecordViewAction(store, "42", "כן", { persist }), null);
  await handleRecordViewAction(store, "42", "מחק", { persist });
  await open(store, find(store, "once"));
  assert.equal(await handleRecordViewAction(store, "42", "כן", { persist }), null);
  await handleRecordMenuCallback(store, syntheticTelegram(), callback(pageData("s")), { ownerChatId: "42", persist });
  assert.equal(store.recordViews["42"], undefined);
  assert.equal(await handleRecordViewAction(store, "42", "מחק", { persist }), null);
  assert.equal(store.reminders.length, 3);
});

test("a stale or foreign target never deletes a replacement item", async () => {
  const store = fixture();
  await open(store, find(store, "first"));
  store.lists["42"].משימות.shift();
  const before = JSON.stringify(store.lists);
  const result = await handleRecordViewAction(store, "42", "מחק", { persist });
  assert.match(result.text, /כבר לא נמצא/u);
  assert.equal(JSON.stringify(store.lists), before);
  assert.equal(await handleRecordViewAction(store, "99", "מחק", { persist }), null);
});

test("a failed save keeps the target and all records intact; retry succeeds", async () => {
  const store = fixture();
  await open(store, find(store, "first"));
  const before = JSON.stringify(store);
  await assert.rejects(handleRecordViewAction(store, "42", "מחק", {
    persist: async () => { throw new Error("synthetic database failure"); },
  }), /synthetic database failure/u);
  assert.equal(JSON.stringify(store), before);
  assert.equal((await handleRecordViewAction(store, "42", "מחק", { persist })).text, "הפריט נמחק");
});

test("already-displayed Telegram details still bind context even when edit is not modified", async () => {
  const store = fixture();
  const telegram = syntheticTelegram();
  telegram.call = async method => {
    if (method === "editMessageText") throw Object.assign(new Error("message is not modified"), { deliveryRejected: true });
  };
  await open(store, find(store, "first"), telegram);
  assert.equal(store.recordViews["42"].key, find(store, "first").key);
});

test("failed context save after switching visible items leaves neither old nor new target actionable", async () => {
  const store = fixture();
  await open(store, find(store, "first"));
  let writes = 0;
  await assert.rejects(open(store, find(store, "second"), syntheticTelegram(), async () => {
    if (++writes === 2) throw new Error("synthetic context save failure");
  }), /synthetic context save failure/u);
  assert.equal(store.recordViews["42"], undefined);
  assert.equal(await handleRecordViewAction(store, "42", "מחק", { persist }), null);
  assert.equal(store.lists["42"].משימות.length, 2);
});

test("real authorized text and voice flow bypasses AI for deletion and yes, then sends the fresh menu", async () => {
  const store = fixture(), telegram = syntheticTelegram();
  const options = {
    userAccess: { handle: async () => "42", assertPermission: async () => {} },
    reminderOperation: createReminderOperationQueue(),
    replyOptions: {
      assistant: async () => { assert.fail("a bound deletion must not reach AI"); },
      readHistory: async () => { assert.fail("a bound deletion must not read AI history"); },
    },
    transcribeVoice: async () => "כן",
  };
  await handleAuthorizedUpdate(store, telegram, {
    callback_query: callback(`v:i:${find(store, "repeat").key}:s:c:0`),
  }, options);
  const message = { chat: { id: 42, type: "private" }, from: { id: 42 }, date: 1_800_000_000 };
  await handleAuthorizedUpdate(store, telegram, { message: { ...message, text: "מחק" } }, options);
  await handleAuthorizedUpdate(store, telegram, { message: { ...message, voice: { file_id: "synthetic" } } }, options);
  assert.match(telegram.sent[0][1], /וגם את התזכורות הבאות/u);
  assert.equal(telegram.sent[1][1], "הפריט נמחק");
  assert.match(telegram.sent[2][1], /הסיכום/u);
  assert.ok(telegram.sent[2][2].reply_markup.inline_keyboard);
  assert.equal(store.reminders.some(item => item.id === "repeat"), false);
});
