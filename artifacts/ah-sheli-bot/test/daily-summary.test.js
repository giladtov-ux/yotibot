import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore } from "../src/store.js";
import { isDailySummaryRequest, formatDailySummary } from "../src/daily-summary.js";
import { isSummaryRequest, summaryPeriod, answerSummary } from "../src/summary-queries.js";
import { withReminderRequestTime, parseJerusalemDateTime } from "../src/time.js";
import { replyToOwnerMessage } from "../src/message-handler.js";
import { handleAssistantMessage } from "../src/assistant.js";

const now = Date.parse("2026-10-11T18:30:00Z");
const due = time => parseJerusalemDateTime("2026-10-12", time, { allowPast: true });
function fixture() {
  const store = createEmptyStore();
  store.lists.owner = { קניות: [{ id: "milk", text: "חלב", checked: false }],
    משימות: [{ id: "open", text: "משימה פתוחה ללא שעה", checked: false }] };
  store.reminders = [
    { id: "later", chatId: "owner", text: "יציאה לאיסופים", dueAt: due("13:45") },
    { id: "early", chatId: "owner", text: "השכמה", dueAt: due("06:10") },
    { id: "private", chatId: "other", text: "מידע פרטי", dueAt: due("07:00") },
    { id: "completed", chatId: "owner", text: "משימה שהושלמה", dueAt: due("09:00"),
      telegramDeliveries: { [due("09:00")]: { state: "done", completedAt: now } } },
  ];
  return store;
}
test("daily and preparation phrasing routes read-only; weekly and creation commands do not", () => {
  for (const text of ["מה הסיכום של היום והכנה למחר?", "סיכום יום", "סיכום יומי",
    "הכנה למחר", "תן לי סיכום היום", "סכם את היום", "מה עשינו היום"]) {
    assert.ok(isDailySummaryRequest(text), text);
    assert.ok(isSummaryRequest(text), text);
    assert.notEqual(summaryPeriod(text, now).from, null);
  }
  for (const text of ["תזכיר לי סיכום יום מחר בשמונה", "סיכום השבוע", "סיכום אתמול",
    "רשימת קניות", "משימות"]) assert.equal(isDailySummaryRequest(text), false, text);
});
test("exact two-section format, chronological saved agenda, no open lists or private records", () => {
  const store = fixture(), before = JSON.stringify(store);
  const text = formatDailySummary(store, "owner", {
    rows: [{ role: "assistant", content: "✅ עדכנתי: ביצים.", createdAt: new Date(now - 1000) }],
  }, now);
  assert.match(text, /^היום:\n[^\n]+\n\nמחר \(שני, 12\.10\):\n06:10 השכמה\n13:45 יציאה לאיסופים$/u);
  assert.doesNotMatch(text, /חלב|משימה פתוחה|מידע פרטי|ביצים/u);
  assert.doesNotMatch(text.split("\n\nמחר")[1], /משימה שהושלמה/u);
  assert.match(text.split("\n\nמחר")[0], /הושלמו: משימה שהושלמה/u);
  assert.equal(JSON.stringify(store), before);
});
test("no AI fallback can dump lists; undated/old history and sent reminders are not execution evidence", async () => {
  const store = fixture();
  store.reminders = [{ id: "sent", chatId: "owner", text: "נשלחה בלבד", dueAt: now, sentAt: now }];
  const rows = [
    { role: "assistant", content: "הוספתי חלב", createdAt: "2026-10-10T12:00:00Z" },
    { role: "assistant", content: "סומן כבוצע" },
    { role: "user", content: "סיימתי הכול", createdAt: new Date(now - 1000) },
  ];
  const text = await withReminderRequestTime(() => answerSummary(store, "owner", "סיכום יום",
    () => assert.fail("Daily formatting must not depend on AI"), { rows }), now);
  assert.match(text, /אין כרגע ביצועים או עדכונים מתועדים להיום/u);
  assert.match(text, /מחר \(שני, 12\.10\):\nאין כרגע אירועים מתוכננים עם שעה/u);
  assert.doesNotMatch(formatDailySummary(store, "owner", { unavailable: true }, now),
    /הרשימות|חלב|מתועדים/u);
});
test("request date follows Israel midnight and current times/text supersede stale schedule entries", () => {
  const store = fixture();
  store.reminders[1] = { ...store.reminders[1], dueAt: due("07:30"), text: "השכמה מעודכנת" };
  store.savedSchedules = [{ chatId: "owner", entries: [
    { reminderId: "early", text: "כותרת ישנה", weekdays: [1], hour: 6, minute: 10 },
  ] }];
  const text = formatDailySummary(store, "owner", [], now);
  assert.match(text, /07:30 השכמה מעודכנת/u);
  assert.doesNotMatch(text, /06:10|כותרת ישנה/u);
  const rollover = formatDailySummary(createEmptyStore(), "owner", [], Date.parse("2026-10-11T22:15:00Z"));
  assert.match(rollover, /מחר \(שלישי, 13\.10\)/u);
});
test("today is one short line of performed activity, not another full task list", () => {
  const store = createEmptyStore();
  const history = { rows: [{ role: "assistant",
    content: "✅ מעולה! סומן כבוצע: איסופים, שיחה עם עורך הדין, כביסה, אימון.",
    createdAt: new Date(now - 1000) }] };
  const today = formatDailySummary(store, "owner", history, now).split("\n\n")[0];
  assert.equal(today.split("\n").length, 2);
  assert.match(today, /איסופים, שיחה עם עורך הדין ועוד פעולות/u);
  assert.doesNotMatch(today, /כביסה|אימון/u);
});
test("message handler delivers exactly one summary with dated history and no list keyboard", async () => {
  const store = fixture(), sent = [];
  store.pendingListActions.owner = { type: "add-items", items: ["שמנת"] };
  await withReminderRequestTime(() => replyToOwnerMessage(store, {
    sendMessage: async (_chat, text, options) => sent.push({ text, options }),
  }, "owner", "מה הסיכום של היום והכנה למחר?", {
    readSummaryHistory: async (chat, period) => {
      assert.equal(chat, "owner"); assert.notEqual(period.from, null);
      return { rows: [] };
    },
    assistant: (state, chat, text, _unused, history) =>
      handleAssistantMessage(state, chat, text, () => assert.fail("no AI required"), history),
    saveConversation: async () => {},
  }), now);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options, undefined);
  assert.match(sent[0].text, /^היום:/u);
  assert.equal(store.lists.owner.קניות.length, 1);
  assert.equal(store.pendingListActions.owner.items[0], "שמנת");
});
