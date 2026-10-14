import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDataDirectory = await mkdtemp(
  path.join(tmpdir(), "ah-sheli-assistant-tests-"),
);
process.env.AH_SHELI_DATA_DIR = temporaryDataDirectory;

const [{ handleAssistantMessage }, { createEmptyStore }, { analyzeMessage }] =
  await Promise.all([
    import("../src/assistant.js"),
    import("../src/store.js"),
    import("../src/groq-assistant.js"),
  ]);

after(async () => {
  await rm(temporaryDataDirectory, { recursive: true, force: true });
});

test("a prose addition is repaired once and confirms only the saved current task", async () => {
  const store = createEmptyStore();
  let calls = 0;
  const response = await handleAssistantMessage(store, "task-repair", "תוסיף לאסוף וועד",
    async (text, context) => {
      calls++;
      assert.equal(text, "תוסיף לאסוף וועד");
      if (calls === 1) return { type: "answer", response: "הוספתי למשימות" };
      assert.equal(context.actionReceiptCorrection.previousReplyWasNotExecuted, true);
      return { type: "add-task", text: "לאסוף וועד" };
    });
  assert.equal(calls, 2);
  assert.equal(store.lists["task-repair"].משימות[0].text, "לאסוף וועד");
  assert.equal(store.lists["task-repair"].משימות[0].checked, false);
  assert.match(response, /לאסוף וועד/u);
});

test("repeated prose receipts cannot become successful additions or loop", async () => {
  const store = createEmptyStore();
  let calls = 0;
  const response = await handleAssistantMessage(store, "task-repair-failed", "תוסיף לאסוף וועד",
    async () => { calls++; return { type: "answer", response: "המשימה נוספה למשימות" }; });
  assert.equal(calls, 2);
  assert.match(response, /עוד לא נשמרה משימה/u);
  assert.equal((store.lists["task-repair-failed"]?.משימות ?? []).length, 0);
});

test("passive saved-task claims are not forwarded as receipts without an action", async () => {
  const store = createEmptyStore();
  const response = await handleAssistantMessage(store, "passive-receipt", "ומה עם הוועד?",
    async () => ({ type: "answer", response: "סגור, המשימה נוספה למשימות." }));
  assert.match(response, /עוד לא שיניתי/u);
  assert.equal((store.lists["passive-receipt"]?.משימות ?? []).length, 0);
});

test("a clear bare task is saved directly without an AI waiting message", async () => {
  const store = createEmptyStore();
  let calls = 0;
  const response = await handleAssistantMessage(store, "bare-task", "לאסוף ועד",
    async (text, context) => {
      assert.equal(text, "לאסוף ועד");
      if (++calls === 1) return { type: "answer", response: "אני מוסיף עכשיו... רגע" };
      assert.equal(context.actionReceiptCorrection.previousReplyWasNotExecuted, true);
      return { type: "add-task", text: "לאסוף ועד" };
    });
  assert.equal(calls, 0);
  assert.match(response, /לאסוף ועד/u);
  assert.doesNotMatch(response, /אני מוסיף|רגע/u);
  assert.equal(store.lists["bare-task"].משימות[0].text, "לאסוף ועד");
});

test("a repeated progress-only answer stops without sending a waiting promise", async () => {
  const store = createEmptyStore();
  let calls = 0;
  const response = await handleAssistantMessage(store, "bare-task-failure", "הטיפול בוועד עוד מחכה לי",
    async () => { calls++; return { type: "answer", response: "אני מוסיף עכשיו... רגע" }; });
  assert.equal(calls, 2);
  assert.match(response, /עוד לא נשמרה משימה/u);
  assert.doesNotMatch(response, /רגע|אני מוסיף/u);
  assert.equal((store.lists["bare-task-failure"]?.משימות ?? []).length, 0);
});

test("natural bare tasks are saved in full without command words or clarification", async () => {
  const store = createEmptyStore();
  const tasks = ["ללכת לספר", "לקנות חלב", "ללכת למשכנתא", "לדבר עם עורך הדין"];
  for (const text of tasks) {
    const response = await handleAssistantMessage(store, "natural-tasks", text,
      async () => assert.fail("Clear task phrases do not need AI or a command"));
    assert.match(response, new RegExp(text, "u"));
    assert.doesNotMatch(response, /צריך לכתוב|רגע|לאיזו רשימה/u);
  }
  assert.deepEqual(store.lists["natural-tasks"].משימות.map(item => item.text), tasks);
  assert.ok(store.lists["natural-tasks"].משימות.every(item => !item.checked));
});

test("semantic completion, removal and editing resolve the current owner's real task and return the open list", async () => {
  const store = createEmptyStore();
  store.lists["task-owner"] = { משימות: [
    { id: "lawyer", text: "לדבר עם עורך הדין", checked: false },
    { id: "hair", text: "ללכת לספר", checked: false },
    { id: "milk", text: "לקנות חלב", checked: false },
  ] };
  store.lists["other-owner"] = { משימות: [{ id: "other", text: "לדבר עם עורך הדין", checked: false }] };
  const completed = await handleAssistantMessage(store, "task-owner", "סיימתי עם עורך הדין",
    async () => ({ type: "mark-item", itemText: "עורך הדין" }));
  assert.equal(store.lists["task-owner"].משימות[0].checked, true);
  assert.doesNotMatch(completed, /לדבר עם עורך הדין/u);
  assert.match(completed, /ללכת לספר/u);
  assert.equal(store.lists["other-owner"].משימות[0].checked, false);
  const removed = await handleAssistantMessage(store, "task-owner", "את הספר כבר לא צריך, תוריד אותו",
    async () => ({ type: "remove-item", itemText: "הספר" }));
  assert.equal(store.lists["task-owner"].משימות.length, 2);
  assert.doesNotMatch(removed, /ללכת לספר|לדבר עם עורך הדין/u);
  const edited = await handleAssistantMessage(store, "task-owner", "במקום חלב שיהיה לקנות לחם",
    async () => ({ type: "update-item", itemText: "חלב", text: "לקנות לחם" }));
  assert.equal(store.lists["task-owner"].משימות[1].text, "לקנות לחם");
  assert.match(edited, /לקנות לחם/u);
  assert.doesNotMatch(edited, /לקנות חלב|לדבר עם עורך הדין/u);
});

test("a nonliteral model completion acknowledgement is repaired once into a real completion", async () => {
  const store = createEmptyStore();
  store.lists["task-completion"] = { משימות: [{ id: "lawyer", text: "לדבר עם עורך הדין", checked: false }] };
  let calls = 0;
  await handleAssistantMessage(store, "task-completion", "סיימתי לטפל בנושא המשפטי",
    async () => ++calls === 1 ? { type: "answer", response: "כל הכבוד!" }
      : { type: "mark-item", itemText: "עורך הדין" });
  assert.equal(calls, 2);
  assert.equal(store.lists["task-completion"].משימות[0].checked, true);
});

test("a short completion uses the sole open task in confirmed context without demanding that it be opened", async () => {
  const store = createEmptyStore();
  await handleAssistantMessage(store, "single-task", "ללכת לספר",
    async () => assert.fail("No AI needed for a clear task"));
  const { replyToOwnerMessage } = await import("../src/message-handler.js");
  const sent = [];
  await replyToOwnerMessage(store, {
    sendMessage: async (_chat, text) => { sent.push(text); },
  }, "single-task", "סיימתי", {
    readHistory: async () => [],
    saveConversation: async () => {},
    assistant: async () => assert.fail("Confirmed single-task context resolves completion before AI"),
  });
  assert.equal(store.lists["single-task"].משימות[0].checked, true);
  assert.match(sent[0], /סומן כבוצע/u);
});

test("assistant context includes the fixed daily schedule only as background", async () => {
  const store = createEmptyStore();
  let capturedContext;

  const response = await handleAssistantMessage(
    store,
    "chat-schedule",
    "באילו שעות אני בדרך כלל פנוי?",
    async (_message, context) => {
      capturedContext = context;
      return {
        type: "answer",
        response: "בדרך כלל אתה פנוי בין 09:00 ל-14:00 ומ-16:30 ואילך.",
      };
    },
  );

  assert.match(response, /09:00/u);
  assert.equal(capturedContext.dailyScheduleContextOnly.neverCreateRemindersFromTheseEntries, true);
  assert.deepEqual(store.reminders, []);
});

test("free-form AI intent saves a task through the existing validated command layer", async () => {
  const store = createEmptyStore();

  const response = await handleAssistantMessage(
    store,
    "chat-task-ai",
    "תשמור לי לבדוק את החוזה לפני הפגישה ברשימת המשימות",
    async () => ({
      type: "add-task",
      text: "לבדוק את החוזה לפני הפגישה",
    }),
  );

  assert.match(response, /משימות:/u);
  assert.equal(
    store.lists["chat-task-ai"]["משימות"][0].text,
    "לבדוק את החוזה לפני הפגישה",
  );
  assert.deepEqual(store.reminders, []);
});

test("AI follow-up completes a pending reminder without losing its saved details", async () => {
  const store = createEmptyStore();
  const firstResponse = await handleAssistantMessage(
    store,
    "chat-reminder-ai",
    "תזכיר לי לקנות עוגה ביום 2 בינואר 2099",
    async () => ({
      type: "reminder",
      text: "לקנות עוגה",
      date: "2099-01-02",
      hour: null,
      minute: null,
    }),
  );
  assert.match(firstResponse, /באיזו שעה/u);
  assert.equal(store.reminders.length, 0);

  const finalResponse = await handleAssistantMessage(
    store,
    "chat-reminder-ai",
    "10 בבוקר",
    async () => ({
      type: "reminder",
      text: null,
      date: null,
      hour: 10,
      minute: 0,
    }),
  );

  assert.match(finalResponse, /אזכיר לך/u);
  assert.equal(store.reminders.length, 1);
  assert.equal(store.reminders[0].text, "לקנות עוגה");
  assert.equal(store.pendingActions["chat-reminder-ai"], undefined);
});

test("Groq output is parsed as structured data and checked before use", async () => {
  let request;
  const fakeClient = {
        complete: async (options) => {
          request = options;
          return {
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify({
                    type: "answer",
                    response: "הכול בסדר, אח שלי.",
                  }) },
              },
            ],
          };
        },
  };

  const result = await analyzeMessage("מה נשמע?", { lists: [] }, fakeClient);

  assert.equal(result.type, "answer");
  assert.equal(result.response, "הכול בסדר, אח שלי.");
  assert.equal(request.response_format, undefined);
  assert.equal(request.model, "openai/gpt-oss-20b");
  assert.equal(request.reasoning_effort, "low");
  assert.equal(request.messages[1].content.includes("מה נשמע?"), true);
  assert.ok(request.messages[0].content.includes("Asia/Jerusalem"));
});

test("AI quota exhaustion does not prepend a technical error to a local greeting", async () => {
  const { AiServiceError } = await import("../src/ai-errors.js");
  const reply = await handleAssistantMessage(createEmptyStore(), "quota-test", "היי",
    async () => { throw new AiServiceError("quota_exhausted"); });
  assert.doesNotMatch(reply, /Groq|API|מכסת|מצב מקומי ללא AI/);
  assert.match(reply, /אהלן אחי/u);
});

test("provider failures yield a natural reply without fake saves or technical instructions", async () => {
  const { AiServiceError } = await import("../src/ai-errors.js");
  for (const code of ["invalid_request", "invalid_response", "authentication_failed"]) {
    const store = createEmptyStore();
    const reply = await handleAssistantMessage(store, "owner", "בוא נתכנן סוף שבוע בגליל",
      async () => { throw new AiServiceError(code); });
    assert.doesNotMatch(reply, /Groq|API|JSON|LOVABLE|GROQ_API_KEY|מבנה הבקשה|שלא הצלחתי לקרוא/);
    assert.doesNotMatch(reply, /שמרתי לך|קבעתי לך|התזכורת נקבעה/);
    assert.deepEqual(store.reminders, []);
    assert.deepEqual(Object.keys(store.lists), []);
  }
});

test("local task handling remains usable when AI quota is exhausted", async () => {
  const { AiServiceError } = await import("../src/ai-errors.js");
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "quota-task", "אני צריך להתקשר לדני",
    async () => { throw new AiServiceError("quota_exhausted"); });
  assert.doesNotMatch(reply, /מצב מקומי ללא AI/);
  assert.equal(store.lists["quota-task"]["משימות"].length, 1);
});