import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-update-time-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore } = await import("../src/store.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
const { withReminderRequestTime, parseJerusalemDateTime } = await import("../src/time.js");
const { scheduleEventsOnDate, formatDaySchedule } = await import("../src/schedule-queries.js");
const { nextWeeklyDueAt } = await import("../src/weekly-schedules.js");
const { normalizeIntent } = await import("../src/assistant-intent.js");
const { menuRecords } = await import("../src/record-menu.js");
after(() => rm(directory, { recursive: true, force: true }));
const now = Date.UTC(2099, 0, 1, 19);
const due = (date, time) => parseJerusalemDateTime(date, time, { allowPast: true });
function fixture() {
  const store = createEmptyStore();
  store.reminders = [
    { id: "own", chatId: "owner", text: "פגישה", dueAt: due("2099-01-02", "10:00"), createdAt: now },
    { id: "other", chatId: "other", text: "פגישה", dueAt: due("2099-01-02", "10:00"), createdAt: now },
  ];
  return store;
}
const run = (store, text, analyzer = async () => { throw new Error("unnecessary AI call"); }, history = []) =>
  withReminderRequestTime(() => handleAssistantMessage(store, "owner", text, analyzer, history), now);

test("changing tomorrow to an earlier clock keeps tomorrow, preserves identity and shows only the new time", async () => {
  const store = fixture();
  const receipt = await run(store, "שנה את הפגישה ל08:15");
  assert.match(receipt, /הועברה/u);
  assert.equal(store.reminders[0].dueAt, due("2099-01-02", "08:15"));
  assert.equal(store.reminders[1].dueAt, due("2099-01-02", "10:00"));
  assert.equal(store.reminders.length, 2);
  const schedule = await run(store, "מה הלו״ז למחר");
  assert.match(schedule, /08:15/u);
  assert.doesNotMatch(schedule, /10:00/u);
  assert.match(await run(store, "ומה מחר?"), /08:15/u);
});

test("explicit future date beats today; explicit past today is rejected without mutation", async () => {
  const store = fixture();
  await run(store, "תעביר את הפגישה למחר ל07:30");
  assert.equal(store.reminders[0].dueAt, due("2099-01-02", "07:30"));
  const before = structuredClone(store);
  assert.match(await run(store, "שנה את הפגישה היום ל07:30"), /לא שיניתי/u);
  assert.equal(store.reminders[0].dueAt, before.reminders[0].dueAt);
  await run(store, "שנה את הפגישה 2099-01-04 ל06:00");
  assert.equal(store.reminders[0].dueAt, due("2099-01-04", "06:00"));
});

test("the last displayed tomorrow disambiguates identical titles; no day context does not guess", async () => {
  const store = fixture();
  store.reminders.push({ ...store.reminders[0], id: "later", dueAt: due("2099-01-03", "10:00") });
  assert.match(await run(store, "שנה את הפגישה ל08:00"), /כמה שמתאימות/u);
  await run(store, "שנה את הפגישה ל08:00", undefined,
    [{ role: "user", content: "מה הלו״ז למחר" }, { role: "assistant", content: "10:00 — פגישה" }]);
  assert.equal(store.reminders[0].dueAt, due("2099-01-02", "08:00"));
  assert.equal(store.reminders[2].dueAt, due("2099-01-03", "10:00"));
});

test("semantic updates use the current spoken clock and saved date, not hallucinated today fields", async () => {
  const store = fixture();
  const intent = normalizeIntent({ type: "update-reminder", reminderId: "own",
    date: "2099-01-01", hour: 6, minute: 0 });
  await run(store, "את הפגישה תעביר ל08:45", async () => intent);
  assert.equal(store.reminders[0].dueAt, due("2099-01-02", "08:45"));
  assert.match(await run(store, "אפשר לסדר את זה?", async () => ({
    type: "answer", response: "שיניתי את השעה, אחי.",
  })), /לא שיניתי/u);
});

test("unknown named targets, foreign IDs and ambiguous pronouns never change another record", async () => {
  for (const [text, intent] of [
    ["שנה משימה שאינה קיימת ל08:00", {}],
    ["תעביר את זה ל08:00", { type: "update-reminder", reminderId: "other" }],
  ]) {
    const store = fixture();
    store.recordViews.owner = {
      key: menuRecords(store, "owner", "s").find(item => item.kind === "reminder").key,
      scope: "r", mode: "c", offset: 0, awaitingDelete: false,
    };
    const before = structuredClone(store.reminders);
    if (intent.type) await run(store, "את זה תעביר ל08:00", async () => intent);
    else await run(store, text);
    assert.deepEqual(store.reminders, before);
  }
});

test("a one-occurrence weekly change updates tomorrow and does not repeat at the old hour", async () => {
  const store = fixture();
  const weekday = new Date("2099-01-02T12:00:00Z").getUTCDay();
  store.savedSchedules.push({ id: "weekly", chatId: "owner", source: "original",
    entries: [{ reminderId: "own", text: "פגישה", weekdays: [weekday], hour: 10, minute: 0 }] });
  await run(store, "שנה את הפגישה מחר ל08:00");
  assert.deepEqual(scheduleEventsOnDate(store, "owner", "2099-01-02").map(item => item.dueAt),
    [due("2099-01-02", "08:00")]);
  const entry = store.savedSchedules[0].entries[0];
  assert.equal(nextWeeklyDueAt(entry, due("2099-01-02", "08:01")), due("2099-01-09", "10:00"));
  assert.match(formatDaySchedule(store, "owner", new Date(now), 1), /08:00/u);
});

test("moving a weekly occurrence to another date removes the old day and preserves following weeks", async () => {
  const store = fixture();
  const weekday = new Date("2099-01-02T12:00:00Z").getUTCDay();
  store.savedSchedules.push({ id: "weekly", chatId: "owner", source: "original",
    entries: [{ reminderId: "own", text: "פגישה", weekdays: [weekday], hour: 10, minute: 0 }] });
  await run(store, "שנה את הפגישה 2099-01-03 ל08:00");
  assert.equal(scheduleEventsOnDate(store, "owner", "2099-01-02").length, 0);
  assert.equal(scheduleEventsOnDate(store, "owner", "2099-01-03").length, 1);
  assert.equal(nextWeeklyDueAt(store.savedSchedules[0].entries[0], due("2099-01-03", "08:01")),
    due("2099-01-09", "10:00"));
});

test("an explicit whole-series clock change updates the definition as well as the queued deadline", async () => {
  const store = fixture();
  const weekday = new Date("2099-01-02T12:00:00Z").getUTCDay();
  store.savedSchedules.push({ id: "weekly", chatId: "owner", source: "original",
    entries: [{ reminderId: "own", text: "פגישה", weekdays: [weekday], hour: 10, minute: 0 }] });
  await run(store, "שנה את הפגישה בכל הסדרה ל08:00");
  assert.equal(store.savedSchedules[0].entries[0].hour, 8);
  assert.equal(store.reminders[0].dueAt, due("2099-01-02", "08:00"));
});
