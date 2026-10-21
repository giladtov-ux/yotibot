import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-current-minute-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ parseJerusalemDateTime, isReminderTimePast }, { createEmptyStore },
  { handleAssistantMessage }, { scheduleDailyReminders },
  { scheduleIntervalReminder, nextIntervalDueAt }, { saveWeeklySchedule, nextWeeklyDueAt },
  { createReminderWorker }] = await Promise.all([
  import("../src/time.js"), import("../src/store.js"), import("../src/assistant.js"),
  import("../src/schedule-reminders.js"), import("../src/reminder-intervals.js"),
  import("../src/weekly-schedules.js"), import("../src/reminder-worker.js"),
]);
after(() => rm(directory, { recursive: true, force: true }));

test("processing across a minute or Israel midnight keeps the requested minute and sends once", async t => {
  const { replyToOwnerMessage } = await import("../src/message-handler.js");
  for (const [received, date, clock, dueAt] of [
    ["2026-10-09T08:22:59Z", "2026-10-09", "11:22", "2026-10-09T08:22:00Z"],
    ["2026-07-01T20:59:59Z", "2026-07-01", "23:59", "2026-07-01T20:59:00Z"],
  ]) {
    const start = Date.parse(received);
    t.mock.timers.enable({ apis: ["Date"], now: start });
    const store = createEmptyStore();
    const messages = [];
    const telegram = { sendMessage: async (_, text) => {
      messages.push(text); return { message_id: messages.length };
    } };
    await replyToOwnerMessage(store, telegram, "time-owner",
      `תזכיר לי היום ב־${clock} לקחת תרופה`, {
        readHistory: async () => [],
        saveConversation: async () => {},
        assistant: async (state, owner, text, unused, history) => {
          t.mock.timers.setTime(start + 20_000);
          return handleAssistantMessage(state, owner, text,
            () => { throw new Error("No AI call expected"); }, history);
        },
      });
    assert.equal(store.reminders.length, 1);
    assert.equal(store.reminders[0].dueAt, Date.parse(dueAt), date);
    assert.ok(!messages[0].includes("עבר"));
    const worker = createReminderWorker(store, telegram, "time-owner", () => {});
    await worker();
    await worker();
    assert.equal(messages.length, 2, "one confirmation and one reminder");
    t.mock.timers.reset();
  }
});

test("a slow AI schedule uses the same Israel request clock for interpretation and saving", async t => {
  const received = Date.parse("2026-10-09T08:22:59Z");
  t.mock.timers.enable({ apis: ["Date"], now: received });
  const store = createEmptyStore();
  let aiCalls = 0;
  const reply = await handleAssistantMessage(store, "time-owner",
    "סידור עבודה להיום:\n11:22 איסוף\n11:24 חזרה", async (_, context) => {
      aiCalls++;
      assert.equal(context.currentLocalDate, "2026-10-09");
      assert.match(context.currentLocalDateTime, /11:22/u);
      t.mock.timers.setTime(received + 20_000);
      return { type: "schedule-reminders", reminders: [
        { text: "איסוף", date: "2026-10-09", hour: 11, minute: 22 },
        { text: "חזרה", date: "2026-10-09", hour: 11, minute: 24 },
      ] };
    });
  assert.equal(aiCalls, 1);
  assert.deepEqual(store.reminders.map(reminder => reminder.dueAt), [
    Date.parse("2026-10-09T08:22:00Z"), Date.parse("2026-10-09T08:24:00Z"),
  ]);
  assert.ok(!reply.includes("עברו"));
});

test("the real Telegram handler uses message UTC seconds, not a later server clock", async t => {
  const { handleOwnerUpdate } = await import("../src/message-handler.js");
  const received = Date.parse("2026-10-09T08:22:59Z");
  t.mock.timers.enable({ apis: ["Date"], now: received + 125_000 });
  for (const [clock, count] of [["11:22", 1], ["11:21", 0]]) {
    const store = createEmptyStore();
    const messages = [];
    await handleOwnerUpdate(store, { sendMessage: async (_, text) => { messages.push(text); } }, {
      update_id: 1, message: {
        date: received / 1000, chat: { id: 123, type: "private" }, from: { id: 123 },
        text: `תזכיר לי היום ב־${clock} לקחת תרופה`,
      },
    }, {
      ownerChatId: "123",
      replyOptions: {
        readHistory: async () => [], saveConversation: async () => {},
        assistant: (state, owner, text) => handleAssistantMessage(state, owner, text,
          () => { throw new Error("No AI call expected"); }),
      },
    });
    assert.equal(store.reminders.length, count);
    if (count) assert.equal(store.reminders[0].dueAt, Date.parse("2026-10-09T08:22:00Z"));
    else assert.match(messages[0], /עבר/u);
  }
});

test("request clocks stay isolated and expire without globally accepting earlier minutes", async t => {
  const { withReminderRequestTime, reminderValidationTime } = await import("../src/time.js");
  const received = Date.parse("2026-10-09T08:22:59Z");
  t.mock.timers.enable({ apis: ["Date"], now: received + 120_000 });
  let resume;
  const wait = new Promise(resolve => { resume = resolve; });
  const first = withReminderRequestTime(async () => {
    await wait;
    assert.equal(reminderValidationTime(), received);
    assert.equal(parseJerusalemDateTime("2026-10-09", "11:22"),
      Date.parse("2026-10-09T08:22:00Z"));
  }, received);
  await withReminderRequestTime(async () => {
    assert.equal(reminderValidationTime(), received + 60_000);
    assert.throws(() => parseJerusalemDateTime("2026-10-09", "11:22"), /עבר/u);
  }, received + 60_000);
  resume();
  await first;
  assert.equal(reminderValidationTime(), Date.now());
  assert.throws(() => parseJerusalemDateTime("2026-10-09", "11:22"), /עבר/u);
});

test("Israel's current HH:mm is accepted throughout its minute in summer and winter, regardless of server timezone", () => {
  const previousTZ = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/New_York", "Asia/Jerusalem"]) {
      process.env.TZ = zone;
      for (const [date, utc] of [
        ["2026-07-01", "2026-07-01T04:45:00Z"],
        ["2026-12-01", "2026-12-01T05:45:00Z"],
      ]) {
        const epoch = Date.parse(utc);
        for (const seconds of [0, 20_000, 59_999]) {
          const now = epoch + seconds;
          assert.equal(parseJerusalemDateTime(date, "07:45", { now }), epoch);
          assert.equal(isReminderTimePast(epoch, now), false);
          assert.throws(() => parseJerusalemDateTime(date, "07:44", { now }), /עבר/u);
          assert.equal(parseJerusalemDateTime(date, "07:46", { now }), epoch + 60_000);
        }
        assert.throws(() => parseJerusalemDateTime(date, "07:45", { now: epoch + 60_000 }), /עבר/u);
      }
    }
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("Israel midnight accepts today's current minute but rejects the previous local date", () => {
  const now = Date.parse("2026-07-01T21:00:35Z");
  assert.equal(parseJerusalemDateTime("2026-07-02", "00:00", { now }), Date.parse("2026-07-01T21:00:00Z"));
  assert.throws(() => parseJerusalemDateTime("2026-07-01", "23:59", { now }), /עבר/u);
  assert.throws(() => parseJerusalemDateTime("2026-03-27", "02:30", { allowPast: true }), /לא קיימת/u);
});

test("a real message path saves a current-minute reminder and the worker sends it once without AI", async t => {
  const now = Date.parse("2026-07-01T04:45:20Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "owner-test",
    "תזכיר לי היום ב־07:45 לקחת תרופה", () => { throw new Error("AI is not needed"); });
  assert.equal(store.reminders.length, 1);
  assert.equal(store.reminders[0].dueAt, now - 20_000);
  assert.doesNotMatch(reply, /עבר|מחר/u);
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.equal(saved.reminders[0].dueAt, now - 20_000);
  const sent = [];
  const worker = createReminderWorker(store,
    { sendMessage: async (...args) => { sent.push(args); return { message_id: 1 }; } },
    "owner-test", error => { throw error; }, async () => {});
  await worker();
  await worker();
  assert.equal(sent.length, 1);
  assert.equal(store.reminders[0].sentAt, now);
});

test("daily schedules retain the current minute, reject earlier minutes and preserve exact two-minute spacing", async () => {
  const now = Date.parse("2026-07-01T04:45:40Z");
  const entries = [44, 45, 47].map(minute => ({
    text: `אירוע ${minute}`, date: "2026-07-01", hour: 7, minute,
  }));
  const store = createEmptyStore();
  await scheduleDailyReminders(store, "owner-test", entries, now);
  assert.deepEqual(store.reminders.map(item => item.dueAt), [now - 40_000, now + 80_000]);
  const spaced = createEmptyStore();
  await scheduleDailyReminders(spaced, "owner-test", entries.slice(1), now, 2);
  assert.equal(spaced.reminders[1].dueAt - spaced.reminders[0].dueAt, 120_000);
  await scheduleDailyReminders(spaced, "owner-test", entries.slice(1), now, 2);
  assert.equal(spaced.reminders.length, 2);
});

test("explicit recurring starts accept the current minute without shifting the interval anchor", async () => {
  const now = Date.parse("2026-07-01T04:45:40Z");
  const intent = { text: "בדיקת תזכורת", date: "2026-07-01", hour: 7, minute: 45,
    intervalMinutes: 2, repeatCount: 3 };
  const store = createEmptyStore();
  await scheduleIntervalReminder(store, "owner-test", intent, now);
  assert.equal(store.reminders[0].dueAt, now - 40_000);
  assert.equal(nextIntervalDueAt(store.reminders[0].dueAt, 120_000, now), now + 80_000);
  await scheduleIntervalReminder(store, "owner-test", intent, now);
  assert.equal(store.reminders.length, 1);
  const past = createEmptyStore();
  assert.match(await scheduleIntervalReminder(past, "owner-test", { ...intent, minute: 44 }, now), /עבר/u);
  assert.equal(past.reminders.length, 0);
});

test("weekly creation includes the current minute but advancing after delivery never repeats it", async () => {
  const now = Date.parse("2026-07-01T04:45:40Z"); // Wednesday in Israel.
  const entry = { text: "השכמה", weekdays: [3], hour: 7, minute: 45 };
  const store = createEmptyStore();
  await saveWeeklySchedule(store, "owner-test", { source: "בימי רביעי 07:45 השכמה", entries: [entry] }, now);
  assert.equal(store.reminders[0].dueAt, now - 40_000);
  const next = nextWeeklyDueAt(entry, now);
  assert.equal(next, Date.parse("2026-07-08T04:45:00Z"));
  assert.ok(next > now);
});
