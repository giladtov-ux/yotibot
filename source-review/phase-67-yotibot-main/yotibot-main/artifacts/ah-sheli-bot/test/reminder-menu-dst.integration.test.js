import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolate storage before importing the callback's transitive store dependencies.
const dataDir = await mkdtemp(path.join(tmpdir(), "ah-sheli-menu-dst-"));
process.env.AH_SHELI_DATA_DIR = dataDir;
const { createEmptyStore } = await import("../src/store.js");
const { reminderMenuRecords } = await import("../src/reminder-menu-records.js");
const { recordMenuForRequest } = await import("../src/record-menu.js");
const { handleRecordMenuCallback } = await import("../src/record-menu-callbacks.js");
const { scheduleEventsOnDate, formatDaySchedule } = await import("../src/schedule-queries.js");
const { withReminderRequestTime } = await import("../src/time.js");
test.after(() => rm(dataDir, { recursive: true, force: true }));

const epoch = value => Date.parse(value);
const owner = "42";
const buttons = view => view.options.reply_markup.inline_keyboard.flat();
function fixture() {
  const store = createEmptyStore();
  store.lists[owner] = { קניות: [{ id: "milk", text: "חלב", checked: false }] };
  store.pendingActions[owner] = { type: "reminder", text: "בקשה ממתינה", hour: null };
  store.pendingListActions[owner] = { text: "פריטים ממתינים", items: ["לחם"] };
  store.recordViews["99"] = { key: "unrelated", awaitingDelete: true };
  return store;
}
function reminder(store, id, utc, chatId = owner) {
  const item = { id, chatId, text: `תזכורת ${id}`, dueAt: epoch(utc), createdAt: 1 };
  store.reminders.push(item);
  return item;
}
function weekly(store, item, weekday, hour, minute) {
  store.savedSchedules.push({ chatId: item.chatId, source: "מקור שבועי ללא שינוי", entries: [{
    reminderId: item.id, text: item.text, weekdays: [weekday], hour, minute,
  }] });
}
function query(data) {
  return { id: "dst-query", data, from: { id: 42 },
    message: { message_id: 7, from: { is_bot: true }, chat: { id: 42, type: "private" } } };
}
function assertUnchanged(actual, before) {
  // Navigation is allowed to persist only the owner's displayed target.
  const comparable = structuredClone(actual);
  comparable.recordViews = before.recordViews;
  assert.deepEqual(comparable, before);
  assert.deepEqual(actual.recordViews["99"], before.recordViews["99"]);
}

async function checkView(store, now, scope, date, expected) {
  return withReminderRequestTime(async () => {
    const before = structuredClone(store);
    const events = scheduleEventsOnDate(store, owner, date);
    assert.deepEqual(events.map(item => [item.id, item.dueAt]),
      expected.map(item => [item.id, epoch(item.utc)]));
    const records = reminderMenuRecords(store, owner, scope);
    assert.deepEqual(records.map(item => [item.id, item.clock, item.days, item.date]), expected.map(item =>
      [item.id, item.clock, item.day, item.date]));
    const view = recordMenuForRequest(store, owner, scope === "t" ? "מה יש היום" : "מה יש מחר");
    const itemButtons = buttons(view).filter(button => button.callback_data.startsWith("v:i:"));
    assert.equal(itemButtons.length, expected.length, "one button per real occurrence");
    const summary = formatDaySchedule(store, owner, new Date(now), scope === "n" ? 1 : 0);
    assert.deepEqual(summary.split("\n").filter(line => line.includes(" — ")),
      expected.map(item => `${item.clock} — תזכורת ${item.id}`));
    assert.deepEqual(structuredClone(store), before, "menu and summary reads are entirely read-only");

    const edits = [];
    let saves = 0;
    const persist = async candidate => { saves++; assertUnchanged(candidate, before); };
    const telegram = { call: async (method, payload) => {
      if (method === "editMessageText") edits.push(payload);
      else assert.equal(method, "answerCallbackQuery");
    } };
    // Exercise page callbacks, detail callbacks and the real back buttons.
    await handleRecordMenuCallback(store, telegram, query(`v:p:${scope}:c:0`),
      { ownerChatId: owner, persist });
    assert.deepEqual(edits.at(-1).reply_markup, view.options.reply_markup);
    for (const [index, item] of expected.entries()) {
      const button = itemButtons[index];
      assert.ok(button.text.includes(`${item.day}${records[index].ongoing ? "" : ` (${item.date})`}`));
      assert.ok(button.text.includes(`\u2066${item.clock}\u2069`));
      assert.deepEqual(await handleRecordMenuCallback(store, telegram, query(button.callback_data),
        { ownerChatId: owner, persist }), { displayed: true });
      assertUnchanged(store, before);
      const detail = edits.at(-1);
      assert.ok(detail.text.includes(`תזכורת ${item.id}`));
      // Details use a short clock (1:30), while menu labels pad it (01:30).
      assert.ok(detail.text.includes(`${item.shortDate}, ${item.clock.replace(/^0/u, "")}`),
        `detail must match ${date} ${item.clock}: ${detail.text}`);
      const back = detail.reply_markup.inline_keyboard.flat().find(value => value.text.includes("חזרה"));
      await handleRecordMenuCallback(store, telegram, query(back.callback_data),
        { ownerChatId: owner, persist });
      assert.deepEqual(edits.at(-1).reply_markup, view.options.reply_markup);
    }
    assert.ok(saves > 0);
    assertUnchanged(store, before);
  }, epoch(now));
}

const spring = [
  { id: "before-gap", utc: "2026-03-26T23:30:00Z", clock: "01:30", day: "ו", date: "27.03.2026", shortDate: "27.3.2026" },
  { id: "after-gap", utc: "2026-03-27T00:30:00Z", clock: "03:30", day: "ו", date: "27.03.2026", shortDate: "27.3.2026" },
];
for (const scope of ["t", "n"]) {
  test(`spring ${scope}: the missing hour is omitted, not shifted or duplicated`, async () => {
    const store = fixture();
    // Deliberately reverse the queue: display sorting must not reorder storage.
    reminder(store, "after-gap", spring[1].utc);
    reminder(store, "before-gap", spring[0].utc);
    const missing = reminder(store, "missing-02:30", "2026-04-03T00:30:00Z");
    weekly(store, missing, 5, 2, 30);
    weekly(store, store.reminders[0], 5, 3, 30);
    reminder(store, "yesterday", "2026-03-26T21:30:00Z");
    reminder(store, "tomorrow", "2026-03-27T21:30:00Z");
    reminder(store, "foreign", spring[0].utc, "99");
    await checkView(store, scope === "t" ? "2026-03-26T22:10:00Z" : "2026-03-26T21:10:00Z",
      scope, "2026-03-27", spring);
  });
}

const autumn = [
  { id: "first-01:30", utc: "2026-10-24T22:30:00Z", clock: "01:30", day: "א", date: "25.10.2026", shortDate: "25.10.2026" },
  { id: "second-01:30", utc: "2026-10-24T23:30:00Z", clock: "01:30", day: "א", date: "25.10.2026", shortDate: "25.10.2026" },
  { id: "after-fold", utc: "2026-10-25T00:30:00Z", clock: "02:30", day: "א", date: "25.10.2026", shortDate: "25.10.2026" },
];
for (const [scope, now] of [
  ["n", "2026-10-24T20:50:00Z"],
  ["t", "2026-10-24T21:10:00Z"],
  ["t", "2026-10-24T22:45:00Z"],
  ["t", "2026-10-24T23:45:00Z"],
]) {
  test(`autumn ${scope} at ${now}: both saved instants survive the repeated hour once each`, async () => {
    const store = fixture();
    for (const item of [...autumn].reverse()) reminder(store, item.id, item.utc);
    reminder(store, "yesterday", "2026-10-24T20:30:00Z");
    reminder(store, "tomorrow", "2026-10-25T22:30:00Z");
    reminder(store, "foreign", autumn[0].utc, "99");
    await checkView(store, now, scope, "2026-10-25", autumn);
  });
}

for (const scenario of [
  { date: "2026-03-27", now: "2026-03-26T22:10:00Z", previous: "2026-03-20T06:00:00Z",
    utc: "2026-03-27T05:00:00Z", next: "2026-04-03T05:00:00Z", day: "ו", weekday: 5, shortDate: "27.3.2026", displayDate: "27.03.2026" },
  { date: "2026-10-25", now: "2026-10-24T21:10:00Z", previous: "2026-10-18T05:00:00Z",
    utc: "2026-10-25T06:00:00Z", next: "2026-11-01T06:00:00Z", day: "א", weekday: 0, shortDate: "25.10.2026", displayDate: "25.10.2026" },
]) {
  test(`advanced weekly definition on ${scenario.date} retains the displayed day after delivery`, async () => {
    const store = fixture();
    const item = reminder(store, "advanced-weekly", scenario.next);
    weekly(store, item, scenario.weekday, 8, 0);
    item.sentAt = epoch(scenario.utc);
    item.telegramDeliveries = { [epoch(scenario.utc).toString(36)]: { state: "sent" } };
    await checkView(store, scenario.now, "t", scenario.date, [{
      id: item.id, utc: scenario.utc, clock: "08:00", day: scenario.day,
      date: scenario.displayDate, shortDate: scenario.shortDate,
    }]);
  });
  for (const scope of ["t", "n"]) {
    for (const receipt of [false, true]) {
      test(`advanced weekly ${scenario.date} (${scope}, old receipt=${receipt}) must retain the displayed date`, {
        todo: "Known display bug: detail callback chooses the stored next dueAt or an old open receipt, not the day-menu occurrence. Fix separately; scheduling is out of scope.",
      }, async () => {
        const store = fixture();
        const item = reminder(store, "advanced-weekly", scenario.next);
        weekly(store, item, scenario.weekday, 8, 0);
        if (receipt) {
          item.sentAt = epoch(scenario.previous);
          item.telegramDeliveries = { [epoch(scenario.previous).toString(36)]: { state: "sent" } };
        }
        const now = scope === "n" ? new Date(epoch(scenario.now) - 3_600_000).toISOString() : scenario.now;
        await checkView(store, now, scope, scenario.date, [{
          id: item.id, utc: scenario.utc, clock: "08:00", day: scenario.day,
          date: scenario.displayDate, shortDate: scenario.shortDate,
        }]);
      });
    }
  }
}

test("one weekly reminder in the repeated hour never gains a synthesized second occurrence", {
  todo: "Known display bug: scheduleEventsOnDate synthesizes the second 01:30 despite an existing first 01:30 for the same weekly reminder.",
}, async () => {
  const store = fixture();
  // The parser chooses the later 01:30; the saved instant is the earlier one.
  const item = reminder(store, "weekly-fold", autumn[0].utc);
  weekly(store, item, 0, 1, 30);
  await checkView(store, "2026-10-24T21:10:00Z", "t", "2026-10-25", [{
    ...autumn[0], id: item.id,
  }]);
});
