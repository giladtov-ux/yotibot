import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-schedule-context-"));
process.env.AH_SHELI_DATA_DIR = directory;
// The parser imports the existing intent graph, which transitively loads store.
// Set the isolated directory before any import of that graph.
const { parseContextualSchedule } = await import("../src/contextual-schedule.js");
const { createEmptyStore } = await import("../src/store.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
const { withReminderRequestTime, parseJerusalemDateTime } = await import("../src/time.js");
const now = Date.parse("2026-10-12T18:00:00Z");
const history = [{ role: "assistant", createdAt: new Date(now),
  content: "היום:\nלא סומנו משימות שהושלמו היום.\n\nמחר (שלישי, 13.10):\n06:10 השכמה" }];
after(() => rm(directory, { recursive: true, force: true }));

test("a time plus activity uses tomorrow's summary section, not today's clock", () => {
  assert.deepEqual(parseContextualSchedule("9:00 חזרה למשימות", history, now), {
    type: "schedule-reminders",
    reminders: [{ text: "חזרה למשימות", date: "2026-10-13", hour: 9, minute: 0 }],
  });
  assert.equal(parseContextualSchedule("תוריד 9:00 למשימות למחר", [], now).reminders[0].text, "משימות");
  assert.equal(parseContextualSchedule("9:00 חזרה למשימות מחר", [], now).reminders[0].date, "2026-10-13");
});
test("explicit dates override context; unrelated topics and stale context never replay it", () => {
  assert.equal(parseContextualSchedule("9:00 פגישה 2026-10-15", history, now).reminders[0].date, "2026-10-15");
  assert.equal(parseContextualSchedule("9:00 פגישה", [...history, { role: "user", content: "רשימת קניות" }], now), null);
  assert.equal(parseContextualSchedule("9:00 פגישה", history, now + 86_400_001), null);
  assert.equal(parseContextualSchedule("9:00 פגישה", [{ ...history[0], createdAt: new Date(now + 999) }], now)
    .reminders[0].date, "2026-10-13");
  assert.equal(parseContextualSchedule("9:00 פגישה", [{ ...history[0], createdAt: new Date(now + 1000) }], now), null);
  for (const text of ["תוריד 9:00 השכמה מחר", "שנה 9:00 השכמה מחר", "9:00 פגישה מחר?",
    "9:00 פגישה; 10:00 כביסה", "25:00 פגישה מחר", "9:00 פגישה"]) {
    assert.equal(parseContextualSchedule(text, [], now), null);
  }
});
test("Telegram schedules a real saved event without changing or completing any task", async () => {
  const store = createEmptyStore();
  store.lists.owner = { משימות: [{ id: "task", text: "חזרה למשימות", checked: false }] };
  const before = structuredClone(store.lists);
  const reply = await withReminderRequestTime(() => handleAssistantMessage(store, "owner",
    "9:00 חזרה למשימות", () => assert.fail("No AI or clarification for an explicit contextual schedule"),
    history, { telegramResponseStyle: true }), now);
  assert.equal(JSON.stringify(store.lists), JSON.stringify(before));
  assert.equal(store.reminders.length, 1);
  assert.equal(store.reminders[0].dueAt, parseJerusalemDateTime("2026-10-13", "09:00", { allowPast: true }));
  assert.equal(store.reminders[0].text, "חזרה למשימות");
  assert.match(reply, /0?9:00.*חזרה למשימות/u);
  assert.doesNotMatch(reply, /חסר|למחוק|כבר עברו/u);
  const { readFile } = await import("node:fs/promises");
  const persisted = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.deepEqual(persisted.lists, before);
  assert.equal(persisted.reminders[0].dueAt, store.reminders[0].dueAt);
});
test("real PostgreSQL commits scheduling to events while the SQL task rows remain identical", {
  skip: process.env.LAB_SQL_TESTS_ENABLED !== "1",
}, async () => {
  const { getPool, closeDatabase } = await import("../src/database.js");
  const { initializeStatePersistence } = await import("../src/store.js");
  const client = await getPool().connect();
  try {
    // One connection and a session-local table: no user data or public tables
    // are written, and the real persistence transaction executes unchanged.
    await client.query(`CREATE TEMP TABLE ah_sheli_state (
      key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT NOW()
    )`);
    const store = createEmptyStore();
    store.lists.owner = { משימות: [{ id: "task", text: "חזרה למשימות", checked: false }] };
    await client.query("INSERT INTO pg_temp.ah_sheli_state (key,value) VALUES ('owner',$1::jsonb)",
      [JSON.stringify(store)]);
    const connection = { query: (...args) => client.query(...args), release() {} };
    await initializeStatePersistence(store, {
      query: connection.query, connect: async () => connection,
    });
    const read = () => client.query(`SELECT value->'lists'->'owner' AS tasks,
      value->'reminders' AS events FROM pg_temp.ah_sheli_state WHERE key='owner'`);
    const before = (await read()).rows[0].tasks;
    await withReminderRequestTime(() => handleAssistantMessage(store, "owner",
      "תוריד 9:00 למשימות למחר", () => assert.fail("Scheduling must not call AI"),
      [], { telegramResponseStyle: true }), now);
    const after = (await read()).rows[0];
    assert.deepEqual(after.tasks, before);
    assert.equal(after.events.length, 1);
    assert.equal(after.events[0].text, "משימות");
    assert.equal(after.events[0].dueAt, parseJerusalemDateTime("2026-10-13", "09:00", { allowPast: true }));
    // Prove a fresh SQL summary includes the event only under tomorrow.
    const { loadDailySummaryStore } = await import("../src/daily-summary-repository.js");
    const { formatTelegramDailySummary } = await import("../src/daily-summary.js");
    const summary = formatTelegramDailySummary(await loadDailySummaryStore("owner", connection, now), "owner", now);
    assert.equal(summary, "היום:\nלא סומנו משימות שהושלמו היום.\n\nמחר (שלישי, 13.10):\n09:00 משימות");
  } finally {
    client.release(true);
    await closeDatabase();
  }
});
