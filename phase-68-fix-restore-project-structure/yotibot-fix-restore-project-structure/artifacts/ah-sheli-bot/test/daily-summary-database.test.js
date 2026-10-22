import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_SUMMARY_SQL, loadDailySummaryStore } from "../src/daily-summary-repository.js";
import { formatDailySummary } from "../src/daily-summary.js";
import { trackItemCompletion } from "../src/store.js";
import { getPool, closeDatabase } from "../src/database.js";

const now = Date.parse("2026-10-11T18:30:00Z");
test("completion metadata is transition-bound, preserved on repeat, and cleared on reopening", () => {
  const item = { text: "איסופים", checked: true };
  trackItemCompletion(item, false, now);
  assert.equal(item.completedAt, now);
  trackItemCompletion(item, true, now + 1000);
  assert.equal(item.completedAt, now);
  item.checked = false;
  trackItemCompletion(item, true, now + 2000);
  assert.equal(item.completedAt, undefined);
  item.checked = true;
  trackItemCompletion(item, false, now + 3000);
  assert.equal(item.completedAt, now + 3000);
});
test("summary database reads are parameterized and a missing snapshot is not an empty day", async () => {
  const chatId = "12345";
  await assert.rejects(loadDailySummaryStore(chatId, { query: async (sql, params) => {
    assert.equal(sql, DAILY_SUMMARY_SQL);
    assert.equal(params[0], chatId);
    assert.equal(params.length, 6);
    return { rows: [] };
  } }), /unavailable/u);
});
test("Telegram returns every SQL task text unchanged without prefix, truncation, deduplication or event union", () => {
  const tasks = ["  איסופים  ", "טקסט ארוך ".repeat(15), "כביסה", "כביסה"];
  const store = { completedTasks: tasks.map(text => ({ text })), reminders: [
    { id: "event", chatId: "owner", text: "אירוע אינו משימה", dueAt: now,
      telegramDeliveries: { [now]: { state: "done", completedAt: now } } },
  ], savedSchedules: [] };
  const summary = formatDailySummary(store, "owner", [], now, { telegramResponseStyle: true });
  assert.equal(summary.split("\n\nמחר")[0], `היום:\n${tasks.join("\n")}`);
  assert.doesNotMatch(summary, /אירוע אינו משימה|הושלמו:|ועוד|…/u);
  store.completedTasks = [];
  assert.match(formatDailySummary(store, "owner", [], now, { telegramResponseStyle: true }),
    /^היום:\nלא סומנו משימות שהושלמו היום\./u);
});
test("exact two-section Telegram format reports empty records honestly and dates tomorrow in Israel", () => {
  const store = { completedTasks: [], reminders: [], savedSchedules: [] };
  assert.equal(formatDailySummary(store, "owner", [], now, { telegramResponseStyle: true }),
    "היום:\nלא סומנו משימות שהושלמו היום.\n\nמחר (שני, 12.10):\nלא נשמר לו״ז עם שעות למחר.");
  assert.equal(formatDailySummary(store, "owner", [], Date.parse("2026-10-11T22:15:00Z"),
    { telegramResponseStyle: true }),
  "היום:\nלא סומנו משימות שהושלמו היום.\n\nמחר (שלישי, 13.10):\nלא נשמר לו״ז עם שעות למחר.");
});
test("real PostgreSQL executes the production reader SQL with an isolated read-only fixture", {
  skip: process.env.LAB_SQL_TESTS_ENABLED !== "1",
}, async () => {
  const value = {
    lists: { owner: {
      משימות: [{ text: "איסופים", checked: true, completedAt: now },
        { text: "השלמה אחרי חצות בישראל", checked: true, completedAt: Date.parse("2026-10-10T22:15:00Z") },
        { text: "אתמול", checked: true, completedAt: Date.parse("2026-10-10T20:00:00Z") },
        { text: "פתוח", checked: false, completedAt: now },
        { text: "ללא תאריך", checked: true },
        { text: "תאריך פגום", checked: true, completedAt: "invalid" },
        { text: "בעתיד", checked: true, completedAt: now + 1000 }],
      קניות: [{ text: "חלב", checked: true, completedAt: now }],
    },
      other: { משימות: [{ text: "private", checked: true, completedAt: now }] } },
    reminders: [{ id: "own", chatId: "owner", text: "שיחה", dueAt: now },
      { id: "private", chatId: "other", text: "private", dueAt: now }],
    savedSchedules: [{ chatId: "owner", entries: [] }, { chatId: "other", entries: [] }],
  };
  try {
    const pool = getPool();
    const reader = { query: (sql, params) => pool.query(
      `WITH ah_sheli_state AS (SELECT 'owner' AS key, $7::jsonb AS value) ${sql}`,
      [...params, JSON.stringify(value)],
    ) };
    const snapshot = await loadDailySummaryStore("owner", reader, now);
    assert.deepEqual(snapshot.completedTasks, [value.lists.owner.משימות[1], value.lists.owner.משימות[0]]);
    assert.deepEqual(snapshot.reminders, [value.reminders[0]]);
    assert.deepEqual(snapshot.savedSchedules, [value.savedSchedules[0]]);
    value.lists.owner.משימות = [];
    value.reminders[0].telegramDeliveries = { [now]: { state: "done", completedAt: now } };
    const onlyEvents = await loadDailySummaryStore("owner", reader, now);
    assert.deepEqual(onlyEvents.completedTasks, []);
    assert.match(formatDailySummary(onlyEvents, "owner", [], now, { telegramResponseStyle: true }),
      /^היום:\nלא סומנו משימות שהושלמו היום\./u);
  } finally { await closeDatabase(); }
});
