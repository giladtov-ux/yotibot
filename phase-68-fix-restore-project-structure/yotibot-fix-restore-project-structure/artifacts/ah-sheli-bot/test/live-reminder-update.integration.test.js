import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("real PostgreSQL UPDATE and reload show the new tomorrow deadline without touching application tables", {
  skip: process.env.LAB_SQL_TESTS_ENABLED !== "1"
    || process.env.AH_SHELI_RUN_ISOLATED_DATABASE_TESTS !== "1",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-time-postgres-"));
  process.env.AH_SHELI_DATA_DIR = directory;
  const { getPool } = await import("../src/database.js");
  const { createEmptyStore, initializeStatePersistence, saveStore, loadStore, setReminderPersistence } =
    await import("../src/store.js");
  const { writeReminders, loadPersistedReminders } = await import("../src/reminder-repository.js");
  const { handleAssistantMessage } = await import("../src/assistant.js");
  const { withReminderRequestTime, parseJerusalemDateTime } = await import("../src/time.js");
  const pool = getPool();
  const client = await pool.connect();
  const rewrite = sql => sql.replaceAll("ah_sheli_state", "ah_sheli_temp_time_state")
    .replaceAll("ah_sheli_reminders", "ah_sheli_temp_time_reminders");
  const isolated = {
    query: (sql, ...args) => client.query(rewrite(sql), ...args),
    connect: async () => ({ query: (sql, ...args) => client.query(rewrite(sql), ...args), release() {} }),
  };
  try {
    await client.query(`CREATE TEMP TABLE ah_sheli_temp_time_state
      (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT NOW())`);
    await client.query(`CREATE TEMP TABLE ah_sheli_temp_time_reminders (
      id text PRIMARY KEY, chat_id text, text text, due_at timestamptz, created_at timestamptz,
      sent_at timestamptz, last_attempt_at timestamptz, repeat_every_ms bigint, remaining_occurrences integer
    )`);
    const now = Date.UTC(2099, 0, 1, 19);
    const due = time => parseJerusalemDateTime("2099-01-02", time, { now });
    const store = createEmptyStore();
    store.reminders = ["owner", "other"].map(chatId => ({
      id: chatId, chatId, text: "פגישה", dueAt: due("10:00"), createdAt: now,
    }));
    await initializeStatePersistence(store, isolated);
    setReminderPersistence(writeReminders, []);
    await saveStore(store);
    const receipt = await withReminderRequestTime(() =>
      handleAssistantMessage(store, "owner", "שנה את הפגישה למחר ל07:45"), now);
    assert.match(receipt, /הועברה/u);
    const sqlRecords = await loadPersistedReminders(isolated);
    assert.equal(sqlRecords.find(item => item.chatId === "owner").dueAt, due("07:45"));
    assert.equal(sqlRecords.find(item => item.chatId === "other").dueAt, due("10:00"));
    const restarted = await loadStore(isolated);
    const schedule = await withReminderRequestTime(() =>
      handleAssistantMessage(restarted, "owner", "מה הלו״ז למחר"), now);
    assert.match(schedule, /07:45/u);
    assert.doesNotMatch(schedule, /10:00/u);
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.ah_sheli_temp_time_reminders, pg_temp.ah_sheli_temp_time_state");
    client.release();
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
