import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyStore } from "../src/store.js";
import { handleAssistantMessage } from "../src/assistant.js";
import { analyzeMessage } from "../src/groq-assistant.js";
import { replyToOwnerMessage } from "../src/message-handler.js";
import { loadSummaryHistory } from "../src/conversation-repository.js";
import { isSummaryRequest, summaryPeriod, buildSummaryEvidence, formatSummaryEvidence } from "../src/summary-queries.js";
import { stripRepetitiveClosing } from "../src/conversation-style.js";
import { withReminderRequestTime } from "../src/time.js";
import { AiServiceError } from "../src/ai-errors.js";

const now = Date.parse("2026-10-09T08:30:00Z");
const inRequest = operation => withReminderRequestTime(operation, now);
const history = Array.from({ length: 44 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: index === 0 ? "דיברנו על בדיקת חוזה בתחילת השבוע" : `שיחה ${index}`,
  createdAt: new Date(now - (44 - index) * 60_000),
}));

function fixture() {
  const store = createEmptyStore();
  store.lists.owner = { משימות: [{ text: "בדיקת חוזה", checked: true }], קניות: [{ text: "חלב", checked: false }] };
  store.lists.foreign = { סודי: [{ text: "מידע פרטי אחר", checked: false }] };
  store.reminders = [
    { id: "weekly", chatId: "owner", text: "פגישה", dueAt: now + 7 * 86_400_000,
      telegramDeliveries: { [now - 60_000]: { state: "done", completedAt: now - 30_000 } } },
    { id: "sent", chatId: "owner", text: "השכמה", dueAt: now - 120_000, sentAt: now - 120_000 },
    { id: "foreign", chatId: "foreign", text: "אירוע פרטי אחר", dueAt: now },
  ];
  store.savedSchedules = [
    { chatId: "owner", source: "בימי ראשון 09:00 פגישה", entries: [] },
    { chatId: "foreign", source: "לו״ז פרטי אחר", entries: [] },
  ];
  store.pendingActions.owner = { type: "reminder", text: "בקשה שעדיין חסר לה מועד" };
  store.pendingListActions.owner = { type: "add-items", items: ["שמנת"] };
  return store;
}

test("only retrospective queries enter the summary path", () => {
  for (const text of ["מה הסיכום?", "מה עשינו השבוע", "על מה דיברנו השבוע?", "תסכם לי את השבוע", "סיכום שבוע שעבר", "מה היה היום"]) {
    assert.equal(isSummaryRequest(text), true, text);
  }
  for (const text of ["תוסיף חלב", "סיכום פגישה: צריך לקנות חלב", "תסכם את המאמר הבא: טקסט", "מה הלו״ז של היום", "תזכיר לי לסכם את השבוע בשעה 11:30"]) {
    assert.equal(isSummaryRequest(text), false, text);
  }
});

test("week boundaries use Israel calendar days, not the server timezone", () => {
  assert.deepEqual(summaryPeriod("מה עשינו השבוע", now), {
    from: Date.parse("2026-10-03T21:00:00Z"), until: now + 1,
  });
  assert.deepEqual(summaryPeriod("סיכום שבוע שעבר", now), {
    from: Date.parse("2026-09-26T21:00:00Z"), until: Date.parse("2026-10-03T21:00:00Z"),
  });
  const rows = [
    { role: "user", content: "לפני השבוע", createdAt: "2026-10-03T20:59:59Z" },
    { role: "user", content: "בתוך השבוע", createdAt: "2026-10-03T21:00:00Z" },
  ];
  const evidence = buildSummaryEvidence(createEmptyStore(), "owner", "מה עשינו השבוע", rows, now);
  assert.deepEqual(evidence.conversation.map(row => row.content), ["בתוך השבוע"]);
});

test("summary evidence reaches the real AI messages array without four-message compaction", async () => {
  const store = fixture();
  const before = JSON.stringify(store);
  let request;
  const reply = await inRequest(() => handleAssistantMessage(store, "owner", "מה עשינו השבוע",
    (text, context) => analyzeMessage(text, context, {
      complete: async body => {
        request = body;
        return { choices: [{ finish_reason: "stop", message: { content: "דיברנו על החוזה ויש אישור ביצוע לפגישה." } }] };
      },
    }), { rows: history, partial: false }));
  assert.equal(reply, "דיברנו על החוזה ויש אישור ביצוע לפגישה.");
  const evidence = JSON.parse(request.messages.at(-1).content).chatContext.summaryEvidence;
  assert.equal(evidence.conversation.length, 44);
  assert.match(evidence.conversation[0].content, /בדיקת חוזה/u);
  assert.equal(evidence.currentLists.length, 2);
  assert.equal(evidence.reminders.length, 2);
  assert.equal(evidence.reminders[0].deliveries[0].state, "done");
  assert.equal(evidence.savedSchedules.length, 1);
  assert.doesNotMatch(JSON.stringify(evidence), /פרטי אחר/u);
  assert.equal(JSON.stringify(store), before);
});

test("AI write misclassification, outage, or false empty reply produces a read-only evidence report", async () => {
  for (const analyzer of [
    async () => ({ type: "delete-list", listName: "קניות" }),
    async () => { throw new AiServiceError("unavailable"); },
    async () => ({ type: "answer", response: "אין שום דבר שמור." }),
  ]) {
    const store = fixture();
    const before = JSON.stringify(store);
    const reply = await inRequest(() => handleAssistantMessage(store, "owner", "מה הסיכום", analyzer, history));
    assert.match(reply, /בדיקת חוזה/u);
    assert.match(reply, /השכמה/u);
    assert.match(reply, /אישור ביצוע שמור/u);
    assert.doesNotMatch(reply, /אין שום דבר שמור|פרטי אחר/u);
    assert.equal(JSON.stringify(store), before);
  }
});

test("summary history query is chat-bound and covers more than the normal 32 messages", async () => {
  let query, parameters;
  const rows = Array.from({ length: 1001 }, (_, i) => ({ role: "user", content: String(i) }));
  const period = summaryPeriod("מה עשינו השבוע", now);
  const result = await loadSummaryHistory("owner", period, {
    query: async (sql, params) => { query = sql; parameters = params; return { rows }; },
  });
  assert.match(query, /WHERE chat_id = \$1/u);
  assert.match(query, /created_at >= \$2/u);
  assert.equal(parameters[0], "owner");
  assert.equal(parameters[1].getTime(), period.from);
  assert.equal(parameters[2].getTime(), period.until);
  assert.equal(result.rows.length, 1000);
  assert.equal(result.rows[0].content, "999");
  assert.equal(result.partial, true);
});

test("real handler uses summary history, saves and sends a reply without the reported robotic ending", async () => {
  const store = fixture();
  let summaryReads = 0, regularReads = 0;
  const saved = [], sent = [];
  const body = "דיברנו על בדיקת חוזה.\n\nאם יש משהו ספציפי שתרצה להוסיף או לעדכן, תגיד לי.";
  await inRequest(() => replyToOwnerMessage(store, { sendMessage: async (chat, reply) => sent.push([chat, reply]) },
    "owner", "מה הסיכום", {
      readHistory: async () => { regularReads++; return []; },
      readSummaryHistory: async (chat, period) => {
        summaryReads++;
        assert.equal(chat, "owner");
        assert.equal(period.from, null);
        return { rows: history, partial: false };
      },
      assistant: (state, chat, text, _unused, rows) =>
        handleAssistantMessage(state, chat, text, async () => ({ type: "answer", response: body }), rows),
      saveConversation: async (...args) => saved.push(args),
    }));
  assert.equal(summaryReads, 1);
  assert.equal(regularReads, 0);
  assert.equal(sent.length, 2);
  assert.match(sent[0][1], /הסיכום והמטרות/u);
  assert.deepEqual(sent[1], ["owner", "דיברנו על בדיקת חוזה."]);
  assert.equal(saved[0][2], sent[1][1]);
});

test("unavailable or partial history is disclosed rather than reported as an empty archive", async () => {
  const sent = [];
  await inRequest(() => replyToOwnerMessage(createEmptyStore(),
    { sendMessage: async (_chat, reply) => sent.push(reply) }, "owner", "מה הסיכום", {
      readSummaryHistory: async () => { throw new Error("temporary database failure"); },
      saveConversation: async () => {},
    }));
  assert.match(sent.at(-1), /לא הצלחתי לקרוא כרגע את היסטוריית השיחות/u);
  assert.doesNotMatch(sent.at(-1), /אין שום דבר שמור/u);
  const evidence = buildSummaryEvidence(fixture(), "owner", "מה הסיכום",
    { rows: history, partial: true }, now);
  assert.match(formatSummaryEvidence(evidence), /סיכום חלקי/u);
  assert.doesNotMatch(formatSummaryEvidence(evidence), /השכמה.*יש אישור ביצוע/u);
});

test("only the exact generic final closing is stripped, not facts, quotes or other personal endings", () => {
  assert.equal(stripRepetitiveClosing("הפגישה מחר. אם יש משהו ספציפי שתרצה להוסיף, אני כאן."), "הפגישה מחר.");
  for (const reply of ['אמרת "אם יש משהו ספציפי שתרצה להוסיף". זה הציטוט.',
    "סגור, תיהנה מהיום!", "07:30 — השכמה\n09:00 — חזרה", "  תשובה בלי סיום.  "]) {
    assert.equal(stripRepetitiveClosing(reply), reply);
  }
  assert.ok(stripRepetitiveClosing("אם יש משהו ספציפי שתרצה להוסיף, תגיד לי.").trim());
});
