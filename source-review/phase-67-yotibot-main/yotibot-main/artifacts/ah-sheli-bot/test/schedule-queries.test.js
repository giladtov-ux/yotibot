import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore } from "../src/store.js";
import { handleAssistantMessage } from "../src/assistant.js";
import { formatTodaySchedule, isTodayScheduleQuery } from "../src/schedule-queries.js";
import { getJerusalemDateString, parseJerusalemDateTime } from "../src/time.js";
import { parseScheduleFallback } from "../src/schedule-fallback.js";
import { parseGroqContent } from "../src/groq-content.js";
import { AiServiceError } from "../src/ai-errors.js";

test("natural daily questions immediately read the owner's schedule without AI or pending writes", async () => {
  const store = createEmptyStore();
  const date = getJerusalemDateString(new Date());
  store.reminders = [
    { id: "late", chatId: "owner", text: "פגישה", dueAt: parseJerusalemDateTime(date, "14:00", { allowPast: true }) },
    { id: "early", chatId: "owner", text: "יציאה לאיסופים", dueAt: parseJerusalemDateTime(date, "06:35", { allowPast: true }) },
    { id: "other", chatId: "other", text: "מידע פרטי", dueAt: parseJerusalemDateTime(date, "09:00", { allowPast: true }) },
    { id: "future", chatId: "owner", text: "אירוע עתידי", dueAt: Date.parse("2099-01-01T12:00:00Z") },
  ];
  store.lists.owner = { קניות: [{ id: "milk", text: "חלב", checked: false }] };
  store.pendingActions.owner = { text: "בקשה ממתינה", date: null, hour: null };
  const before = JSON.stringify(store);
  for (const query of ['מה הלו"ז של היום', "מה הלו״ז שלי היום?", "מה יש לי היום?",
    "איך נראה היום שלי", "מה מתוכנן לי היום", "תציג לי את לוח הזמנים להיום"]) {
    assert.ok(isTodayScheduleQuery(query));
    const reply = await handleAssistantMessage(store, "owner", query, () => {
      throw new Error("daily schedule reads must not depend on AI");
    });
    assert.match(reply, /06:35 — יציאה לאיסופים[\s\S]*14:00 — פגישה/u);
    assert.doesNotMatch(reply, /חלב|מידע פרטי|אירוע עתידי|חסר|לא הבנתי/u);
    assert.equal(JSON.stringify(store), before);
  }
});

test("today uses Israel's date, includes sent events and saved weekly occurrences without duplication", () => {
  const store = createEmptyStore();
  // 21:15 UTC on Friday is already Saturday in Israel (summer time).
  const now = new Date("2026-10-09T21:15:00Z");
  store.reminders = [
    { id: "sent", chatId: "owner", text: "אירוע שכבר נשלח", dueAt: Date.parse("2026-10-09T21:05:00Z"), sentAt: 1 },
    { id: "yesterday", chatId: "owner", text: "אירוע של אתמול", dueAt: Date.parse("2026-10-09T20:55:00Z") },
    { id: "weekly", chatId: "owner", text: "השכמה שבועית", dueAt: Date.parse("2026-10-17T04:30:00Z") },
    { id: "today-weekly", chatId: "owner", text: "פגישה שבועית", dueAt: Date.parse("2026-10-10T06:00:00Z") },
  ];
  store.savedSchedules = [{ chatId: "owner", entries: [
    { reminderId: "weekly", text: "השכמה שבועית", hour: 7, minute: 30, weekdays: [6] },
    { reminderId: "today-weekly", text: "פגישה שבועית", hour: 9, minute: 0, weekdays: [6] },
    { reminderId: "deleted", text: "אירוע שנמחק", hour: 10, minute: 0, weekdays: [6] },
  ] }];
  const before = JSON.stringify(store);
  const reply = formatTodaySchedule(store, "owner", now);
  assert.match(reply, /00:05 — אירוע שכבר נשלח[\s\S]*07:30 — השכמה שבועית[\s\S]*09:00 — פגישה שבועית/u);
  assert.doesNotMatch(reply, /אירוע של אתמול|אירוע שנמחק/u);
  assert.equal(reply.split("פגישה שבועית").length - 1, 1);
  assert.equal(JSON.stringify(store), before);
});

test("no saved events gives an honest short answer, never the background routine", async () => {
  const store = createEmptyStore();
  const before = JSON.stringify(store);
  const reply = await handleAssistantMessage(store, "owner", "איך נראה היום שלי?");
  assert.equal(reply, "אחי, להיום אין כרגע תזכורת עם שעה.");
  assert.equal(JSON.stringify(store), before);
});

test("free schedule answers are readable and informational questions never trigger schedule backup writes", () => {
  for (const query of ['מה הלו"ז של היום', "מה הלו״ז שלי מחר", "איך נראה הלו״ז עם פגישה ב־09:00"]) {
    assert.equal(parseScheduleFallback(query), null);
    const result = parseGroqContent("יש לך פגישה ב־09:00.", query);
    assert.equal(result.type, "answer");
    assert.equal(result.response, "יש לך פגישה ב־09:00.");
  }
  assert.equal(parseScheduleFallback("לו״ז מחר: 07:30 השכמה\n08:00 יציאה").type, "schedule-reminders");
});

test("a schedule information turn cannot consume pending data or apply a mistaken model write", async () => {
  for (const outcome of ["write", "clarify", "outage"]) {
    const store = createEmptyStore();
    store.lists.owner = { קניות: [{ id: "item", text: "חלב", checked: false }] };
    store.pendingActions.owner = { text: "פעולה ממתינה", date: null, hour: null };
    store.reminders = [{ id: "existing", chatId: "owner", text: "פגישה שמורה", dueAt: Date.parse("2099-01-01T09:00:00Z") }];
    const before = JSON.stringify(store);
    const reply = await handleAssistantMessage(store, "owner", "איך נראה הלו״ז שלי בהמשך?", async (_text, context) => {
      assert.equal(context.activeReminders[0].text, "פגישה שמורה");
      if (outcome === "outage") throw new AiServiceError("invalid_response");
      return outcome === "clarify" ? { type: "clarify", response: "חסר לי פרט" }
        : { type: "cancel-reminder", description: "פגישה שמורה" };
    });
    assert.match(reply, /פגישה שמורה/u);
    assert.doesNotMatch(reply, /חסר לי פרט|אפשר לחדד/u);
    assert.equal(JSON.stringify(store), before);
  }
});
