import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-intervals-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ extractRequestedInterval, nextIntervalDueAt, scheduleIntervalReminder },
  { createEmptyStore }, { handleAssistantMessage }, { handleAssistantIntent },
  { createReminderWorker }, { scheduleDailyReminders }, { loadPersistedReminders, persistReminders }] =
  await Promise.all([
    import("../src/reminder-intervals.js"), import("../src/store.js"), import("../src/assistant.js"),
    import("../src/commands.js"), import("../src/reminder-worker.js"), import("../src/schedule-reminders.js"),
    import("../src/reminder-repository.js"),
  ]);
after(() => rm(directory, { recursive: true, force: true }));

test("requested intervals convert to exact elapsed minutes, including hours and Hebrew two", () => {
  assert.equal(extractRequestedInterval("כל 2 דקות").minutes, 2);
  assert.equal(extractRequestedInterval("בהפרשים של 2 דקות").minutes, 2);
  assert.equal(extractRequestedInterval("במרווחים של שתי דקות").minutes, 2);
  assert.equal(extractRequestedInterval("כל 2 שעות").minutes, 120);
  assert.equal(extractRequestedInterval("כל דקה").minutes, 1);
  assert.equal(extractRequestedInterval("כל שעתיים").minutes, 120);
  const start = Date.parse("2026-10-24T22:59:00Z");
  assert.equal(nextIntervalDueAt(start, 120000, start), start + 120000);
  assert.equal(nextIntervalDueAt(start, 120000, start + 30000), start + 120000);
  assert.equal(nextIntervalDueAt(start, 120000, start + 600000), start + 720000);
});

test("two-minute batches ignore AI's one-minute increments and cross midnight correctly", async () => {
  const store = createEmptyStore();
  const entries = ["השכמה", "יציאה", "חזרה"].map((text, index) => ({
    text, date: "2099-01-02", hour: 23, minute: 58 + (index === 0 ? 0 : 1),
  }));
  await handleAssistantIntent(store, "owner", { type: "schedule-reminders", reminders: entries },
    "קבע את שלוש הפעילויות בהפרשים של 2 דקות");
  assert.equal(store.reminders.length, 3);
  assert.deepEqual(store.reminders.map(row => new Date(row.dueAt).toISOString()),
    ["2099-01-02T21:58:00.000Z", "2099-01-02T22:00:00.000Z", "2099-01-02T22:02:00.000Z"]);
  assert.deepEqual(store.reminders.map(row => row.text), ["השכמה", "יציאה", "חזרה"]);
  assert.equal(Object.keys(store.lists.owner ?? {}).length, 0);
});

test("incomplete later batch times are computed from the start, not guessed by AI", async () => {
  const store = createEmptyStore();
  await scheduleDailyReminders(store, "owner", [
    { text: "ראשון", date: "2099-01-02", hour: 10, minute: 58 },
    { text: "שני", date: null, hour: null, minute: null },
    { text: "שלישי", date: null, hour: null, minute: null },
  ], 0, 2);
  assert.equal(store.reminders[1].dueAt - store.reminders[0].dueAt, 120000);
  assert.equal(store.reminders[2].dueAt - store.reminders[1].dueAt, 120000);
});

test("a free-form every-two-minute request is stored durably without AI or minute rounding", async t => {
  const now = Date.parse("2099-01-02T08:00:34.123Z");
  t.mock.method(Date, "now", () => now);
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "owner", "תזכיר לי לשתות מים כל 2 דקות 3 פעמים",
    () => { throw new Error("AI must not calculate a clear interval request"); });
  assert.match(reply, /כל 2 דקות, 3 פעמים/u);
  assert.equal(store.reminders[0].dueAt, now + 120000);
  assert.equal(store.reminders[0].repeatEveryMs, 120000);
  assert.equal(store.reminders[0].remainingOccurrences, 3);
  assert.equal(store.reminders[0].text, "לשתות מים");
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.deepEqual(saved.reminders, store.reminders);
});

test("until-cancel repeats and explicitly timed repeats preserve requested settings", async t => {
  const now = Date.parse("2099-01-02T08:00:34Z");
  t.mock.method(Date, "now", () => now);
  const store = createEmptyStore();
  await handleAssistantMessage(store, "owner", "תזכיר לי לשתות מים כל 2 דקות עד לביטול",
    () => { throw new Error("no AI"); });
  assert.equal(store.reminders[0].remainingOccurrences, undefined);
  assert.equal(store.reminders[0].dueAt, now + 120000);
  await handleAssistantMessage(store, "owner", "תזכיר לי לקום כל 2 דקות מחר ב-10:58 3 פעמים",
    () => { throw new Error("no AI"); });
  assert.equal(new Date(store.reminders[1].dueAt).toISOString(), "2099-01-03T08:58:00.000Z");
  assert.equal(store.reminders[1].text, "לקום");
  assert.equal(store.reminders[1].remainingOccurrences, 3);
});

test("worker sends at 2/4/6 minutes, never at 1/3/5, and then stops the finite series", async t => {
  const base = 1000000;
  let now = base;
  t.mock.method(Date, "now", () => now);
  const store = createEmptyStore();
  store.reminders = [{ id: "series", chatId: "owner", text: "מים",
    dueAt: base + 120000, repeatEveryMs: 120000, remainingOccurrences: 3 }];
  const sends = [];
  const worker = createReminderWorker(store, { sendMessage: async () => { sends.push(now); } },
    "owner", () => {}, async () => {});
  for (let minute = 0; minute <= 8; minute++) {
    now = base + minute * 60000;
    await worker();
    await worker();
  }
  assert.deepEqual(sends, [base + 120000, base + 240000, base + 360000]);
  assert.equal(store.reminders[0].remainingOccurrences, 0);
  assert.ok(store.reminders[0].sentAt);
});

test("late delivery stays anchored and missed intervals do not cause a catch-up burst", async t => {
  let now = 153000;
  t.mock.method(Date, "now", () => now);
  const store = createEmptyStore();
  store.reminders = [{ id: "series", chatId: "owner", text: "מים", dueAt: 120000, repeatEveryMs: 120000 }];
  let sends = 0;
  const worker = createReminderWorker(store, { sendMessage: async () => { sends++; } },
    "owner", () => {}, async () => {});
  await worker();
  assert.equal(store.reminders[0].dueAt, 240000);
  now = 601000;
  await worker();
  await worker();
  assert.equal(sends, 2);
  assert.equal(store.reminders[0].dueAt, 720000);
});

test("uncertain confirmation of a repeat blocks same-process and restarted replays", async t => {
  t.mock.method(Date, "now", () => 120000);
  const store = createEmptyStore();
  store.reminders = [{ id: "series", chatId: "owner", text: "מים", dueAt: 120000, repeatEveryMs: 120000 }];
  let snapshot;
  let writes = 0;
  let sends = 0;
  const persist = async state => {
    writes++;
    if (writes === 2) throw new Error("confirmation not saved");
    snapshot = structuredClone(state);
  };
  const telegram = { sendMessage: async () => { sends++; } };
  const worker = createReminderWorker(store, telegram, "owner", () => {}, persist);
  await worker();
  await worker();
  const restarted = createReminderWorker(snapshot, telegram, "owner", () => {}, async () => {});
  await restarted();
  assert.equal(sends, 1);
  assert.equal(store.reminders[0].dueAt, 120000);
  assert.ok(store.reminders[0].lastAttemptAt);
});

test("cancellation, duplicate protection, and invalid intervals preserve existing records", async () => {
  const store = createEmptyStore();
  const intent = { text: "מים", intervalMinutes: 2, repeatCount: null };
  await scheduleIntervalReminder(store, "owner", intent, 1000000);
  await scheduleIntervalReminder(store, "owner", intent, 1000001);
  assert.equal(store.reminders.length, 1);
  await scheduleIntervalReminder(store, "owner", { ...intent, intervalMinutes: 0 });
  assert.equal(store.reminders.length, 1);
  await handleAssistantIntent(store, "owner", { type: "cancel-reminder", description: "מים" });
  assert.equal(store.reminders.length, 0);
});

test("database serialization preserves recurring and one-off metadata across reloads", async () => {
  const rows = [];
  const client = { release() {}, query: async (sql, args) => {
    if (sql.includes("INSERT INTO")) rows.push({
      id: args[0], chat_id: args[1], text: args[2], due_at: args[3], created_at: args[4],
      sent_at: args[5], last_attempt_at: args[6], repeat_every_ms: args[7], remaining_occurrences: args[8],
    });
    return { rows: [] };
  } };
  const pool = { connect: async () => client, query: async () => ({ rows }) };
  const reminders = [
    { id: "repeat", chatId: "owner", text: "מים", dueAt: 120000, createdAt: 1000, repeatEveryMs: 120000, remainingOccurrences: 3 },
    { id: "one-off", chatId: "owner", text: "פגישה", dueAt: 180000, createdAt: 1000 },
  ];
  await persistReminders(reminders, pool);
  assert.deepEqual(await loadPersistedReminders(pool), reminders);
});
