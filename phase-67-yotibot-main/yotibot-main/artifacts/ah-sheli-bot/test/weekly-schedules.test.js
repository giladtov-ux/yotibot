import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-weekly-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ handleAssistantMessage }, { createEmptyStore, loadStore }, weekly, time, { createReminderWorker }] =
  await Promise.all([import("../src/assistant.js"), import("../src/store.js"),
    import("../src/weekly-schedules.js"), import("../src/time.js"), import("../src/reminder-worker.js")]);
after(() => rm(directory, { recursive: true, force: true }));
const noAI = async () => { throw new Error("Recurring schedules must not need an AI call."); };
const epoch = (date, clock) => time.parseJerusalemDateTime(date, clock, { allowPast: true });

test("weekday and Friday schedules preserve source, save distinct rules and survive restart", async () => {
  const source = "  לו״ז קבוע לימי א׳–ה׳:\n06:00 השכמה\n06:35 יציאה לאיסופים\nימי שישי:\n09:00 חזרה למשימות  ";
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "owner", source, noAI);
  assert.equal(store.savedSchedules[0].source, source);
  assert.equal(store.reminders.length, 3);
  assert.deepEqual(store.savedSchedules[0].entries.map(row => row.weekdays), [[0,1,2,3,4], [0,1,2,3,4], [5]]);
  assert.match(reply, /בימים ובשעות שכתבת/);
  assert.doesNotMatch(reply, /חסר|באיזה יום|לא נוצרו|הנה התזכורות/);
  await handleAssistantMessage(store, "owner", source, noAI);
  assert.equal(store.reminders.length, 3);
  const loaded = await loadStore();
  assert.equal(loaded.savedSchedules[0].source, source);
  assert.ok(weekly.weeklyEntryFor(loaded, loaded.reminders[0].id));
  assert.equal(await handleAssistantMessage(store, "owner", "מה הלו״ז הקבוע שלי?", noAI), source);
});

test("weekly wall-clock times stay exact across DST and exclude unrequested weekdays", () => {
  const rule = { weekdays: [0,1,2,3,4], hour: 6, minute: 0 };
  assert.equal(weekly.nextWeeklyDueAt(rule, epoch("2026-10-22", "06:00")),
    epoch("2026-10-25", "06:00")); // Thursday to Sunday, across Israel's DST change.
  assert.equal(weekly.nextWeeklyDueAt({ weekdays: [5], hour: 9, minute: 15 }, epoch("2026-10-23", "09:15")),
    epoch("2026-10-30", "09:15"));
  assert.equal(weekly.nextWeeklyDueAt({ weekdays: [0], hour: 6, minute: 0 }, epoch("2026-03-22", "06:00")),
    epoch("2026-03-29", "06:00"));
});

test("weekday declarations are not inferred from activity words and numeric Hebrew hours work", () => {
  assert.deepEqual(weekly.parseWeeklySchedule("לו״ז שבועי לימי ב׳–ד׳:\n06:00 השכמה").entries[0].weekdays, [1,2,3]);
  assert.deepEqual(weekly.parseWeeklySchedule("בימי ראשון ושלישי:\n06:00 שני איסופים").entries[0].weekdays, [0,2]);
  assert.deepEqual(weekly.parseWeeklySchedule("כל יום:\n06:00 שני איסופים").entries[0].weekdays, [0,1,2,3,4,5,6]);
  const entry = weekly.parseWeeklySchedule("בימי שישי:\nבשעה 6 בבוקר השכמה").entries[0];
  assert.equal(entry.hour, 6);
  assert.equal(entry.minute, 0);
  assert.equal(entry.text, "השכמה");
});

test("missing times and time ranges are retained without guesses or repeated questions", async () => {
  for (const source of ["לו״ז שבועי:\nימי שישי: מנוחה", "לו״ז קבוע לימי א׳–ה׳:\n06:00–09:00 עבודה",
    "לו״ז קבוע לימי א׳–ה׳ עד 2099-01-02:\n06:00 השכמה",
    "לו״ז קבוע לימי א׳–ה׳ למעט חגים:\n06:00 השכמה"]) {
    const store = createEmptyStore();
    const reply = await handleAssistantMessage(store, "owner", source, noAI);
    assert.equal(store.savedSchedules[0].source, source);
    assert.equal(store.reminders.length, 0);
    assert.doesNotMatch(reply, /חסר לי|באיזו שעה|באיזה יום/);
  }
  for (const source of ["וגם ביצים ושימי לי התראה", "מה הלו״ז הקבוע שלי?",
    "שמור רשימת משימות: ימי שישי מנוחה", "לו״ז קבוע לדוגמה: ימי שישי 09:00 עבודה"]) {
    assert.equal(weekly.parseWeeklySchedule(source), null);
  }
});

test("resubmitting an explicitly cancelled series recreates its calendar rule, not a one-off alert", async () => {
  const store = createEmptyStore();
  const source = "ימי שישי:\n09:00 עבודה";
  await handleAssistantMessage(store, "owner", source, noAI);
  store.reminders = [];
  await handleAssistantMessage(store, "owner", source, noAI);
  assert.equal(store.reminders.length, 1);
  assert.ok(weekly.weeklyEntryFor(store, store.reminders[0].id));
  assert.equal(store.savedSchedules.length, 1);
});

test("the worker initiates weekly sends without messages and reschedules only after confirmed delivery", async () => {
  const previousNow = Date.now;
  const now = epoch("2026-10-23", "09:00");
  Date.now = () => now;
  try {
    const store = createEmptyStore();
    await weekly.saveWeeklySchedule(store, "owner", weekly.parseWeeklySchedule("ימי שישי:\n09:00 עבודה"), now - 1000);
    const sent = [];
    const worker = createReminderWorker(store, { sendMessage: async (...args) => sent.push(args) }, "owner",
      () => {}, async () => {});
    assert.equal((await worker()).sent, 1);
    assert.equal(store.reminders[0].dueAt, epoch("2026-10-30", "09:00"));
    assert.equal(store.reminders[0].sentAt, undefined);
    await worker();
    assert.equal(sent.length, 1);
    store.reminders[0].dueAt = now;
    const failed = createReminderWorker(store, { sendMessage: async () => { throw new Error("uncertain delivery"); } },
      "owner", () => {}, async () => {});
    await failed();
    assert.equal(store.reminders[0].dueAt, now);
    assert.equal(store.reminders[0].lastAttemptAt, now);
    assert.equal((await failed()).sent, 0);
  } finally { Date.now = previousNow; }
});

test("list additions and numbered removals show only the resulting list", async () => {
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "owner", "תוסיף חלב, לחם וביצים לקניות", noAI);
  assert.match(reply, /^קניות:\n/u);
  assert.doesNotMatch(reply, /הוספתי|פתחתי|הנה/);
  const removed = await handleAssistantMessage(store, "owner", "תסיר סעיפים 1 עד 2 מרשימת קניות", noAI);
  assert.equal(removed, "קניות:\n□ 1. 🥚 ביצים");
  assert.deepEqual(store.lists.owner["קניות"].map(item => item.text), ["ביצים"]);
  assert.equal(store.reminders.length, 0);
});

test("an incomplete daily schedule preserves the complete original without inventing a clock", async () => {
  const store = createEmptyStore();
  const source = "הלו״ז שלי למחר:\nהשכמה\nיציאה לאיסופים";
  const reply = await handleAssistantMessage(store, "owner", source, async () => ({
    type: "schedule-reminders",
    reminders: [{ text: "השכמה", date: "2099-01-02", hour: 6, minute: 0 }],
  }));
  assert.equal(store.savedSchedules[0].source, source);
  assert.equal(store.reminders.length, 0);
  assert.doesNotMatch(reply, /חסר|באיזו שעה|באיזה יום/);
});

test("a clearly dated daily source overrides invented model labels, dates and clocks", async () => {
  const store = createEmptyStore();
  const source = "הלו״ז שלי ל־2099-01-02:\n06:00 השכמה\n06:35 יציאה לאיסופים";
  await handleAssistantMessage(store, "owner", source, async () => ({
    type: "schedule-reminders",
    reminders: [{ text: "פעילות שהומצאה", date: "2099-04-01", hour: 18, minute: 0 }],
  }));
  assert.deepEqual(store.reminders.map(item => item.text), ["השכמה", "יציאה לאיסופים"]);
  assert.deepEqual(store.reminders.map(item => item.dueAt), [epoch("2099-01-02", "06:00"), epoch("2099-01-02", "06:35")]);
  assert.equal(store.savedSchedules[0].source, source);
});
