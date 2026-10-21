import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "semantic-context-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { buildAssistantContext, handleAssistantMessage } = await import("../src/assistant.js");
const { createEmptyStore } = await import("../src/store.js");
const { promptForContext } = await import("../src/assistant-intent.js");
const { menuRecords } = await import("../src/record-menu.js");
after(() => rm(directory, { recursive: true, force: true }));

test("free phrasing gets current records without keyword gates or other users' data", () => {
  const store = createEmptyStore();
  store.lists.me = { קניות: [{ text: "חלב", checked: false }] };
  store.lists.other = { סודות: [{ text: "פרטי", checked: false }] };
  store.savedSchedules = [
    { chatId: "me", source: "ביום ראשון 09:00 עבודה" },
    { chatId: "other", source: "פרטי אחר" },
  ];
  const context = buildAssistantContext(store, "me", new Date(), "מה מחכה לי?");
  assert.equal(context.semanticRecordOverview.lists[0].items[0].text, "חלב");
  assert.equal(context.semanticRecordOverview.schedules.length, 1);
  assert.doesNotMatch(JSON.stringify(context), /פרטי/);
  assert.equal(context.semanticRecordOverview.partial, true);
});

test("contextual short addition uses AI and the existing durable list writer", async () => {
  const store = createEmptyStore();
  store.lists.me = { קניות: [{ text: "חלב", checked: false }] };
  let calls = 0;
  await handleAssistantMessage(store, "me", "גם שמנת", async (text, context) => {
    calls++;
    assert.equal(text, "גם שמנת");
    assert.equal(context.semanticRecordOverview.lists[0].name, "קניות");
    assert.ok(context.recentConversation.some(row => row.content?.includes("קניות")));
    return { type: "add-items", listName: "קניות", items: ["שמנת"] };
  }, [{ role: "user", content: "אני מסדר את הקניות" }]);
  assert.equal(calls, 1);
  assert.deepEqual(store.lists.me.קניות.map(item => item.text), ["חלב", "שמנת"]);
  assert.deepEqual(store.reminders, []);
});

test("semantic conversation does not execute historical actions", async () => {
  const store = createEmptyStore();
  const reply = await handleAssistantMessage(store, "me", "מה דעתך על זה?", async () =>
    ({ type: "answer", response: "נשמע לי טוב." }),
  [{ role: "user", content: "תזכיר לי לקנות חלב מחר" }]);
  assert.equal(reply, "נשמע לי טוב.");
  assert.deepEqual(store.reminders, []);
  assert.deepEqual(Object.keys(store.lists), []);
});

test("prompt accepts imperfect phrasing but retains ambiguity and read-only boundaries", () => {
  const prompt = promptForContext({ isOwner: false });
  assert.match(prompt, /חלקי משפטים ומילים/u);
  assert.match(prompt, /אין חובה לנסח בקשה בצורה מסוימת/u);
  assert.match(prompt, /דגימה חלקית/u);
  assert.match(prompt, /אל תהפוך עצה/u);
  assert.match(prompt, /displayedRecord/u);
  assert.match(prompt, /answer, clarify ושיחת חולין אינם מבצעים שינוי/u);
});

test("a displayed reminder outside the sampled eight remains exact and user-bound", () => {
  const store = createEmptyStore();
  store.reminders = Array.from({ length: 12 }, (_, i) => ({
    id: `reminder-${i}`, chatId: "me", text: `פגישה ${i}`,
    dueAt: Date.UTC(2099, 0, 2, 6, i), createdAt: Date.UTC(2099, 0, 1), sentAt: null,
  }));
  const selected = menuRecords(store, "me", "s").find(record => record.id === "reminder-11");
  store.recordViews.me = { key: selected.key, scope: "r", mode: "c", offset: 0 };
  const context = buildAssistantContext(store, "me", new Date(), "אותה תעביר לשמונה");
  assert.equal(context.displayedRecord.id, "reminder-11");
  assert.equal(context.displayedRecord.date, "2099-01-02");
  assert.equal(context.semanticRecordOverview.reminders.length, 8);
  assert.equal(buildAssistantContext(store, "other", new Date()).displayedRecord, null);
  store.recordViews.other = { key: selected.key };
  assert.equal(buildAssistantContext(store, "other", new Date()).displayedRecord, null);
  store.reminders = store.reminders.filter(item => item.id !== selected.id);
  assert.equal(buildAssistantContext(store, "me", new Date()).displayedRecord, null);
});

test("unexecuted write receipts cannot escape through conversational intent types", async () => {
  for (const type of ["answer", "clarify", "small-talk", "greeting", "thanks", "farewell"]) {
    for (const response of ["סגור, שיניתי את השעה", "ניקיתי את הרשימה",
      "בשמחה אחי, עדכנתי את השעה", "בטח.\nהוספתי לרשימה"]) {
      const store = createEmptyStore();
      store.lists.me = { קניות: [{ id: "milk", text: "חלב", checked: false }] };
      const before = structuredClone(store);
      const reply = await handleAssistantMessage(store, "me", "מה אתה אומר?", async () =>
        ({ type, response }));
      assert.match(reply, /לא (?:שיניתי|מחקתי)/u);
      assert.equal(JSON.stringify(store), JSON.stringify(before));
    }
  }
});

test("an honest negative write status stays a natural reply rather than a false receipt", async () => {
  const store = createEmptyStore();
  const response = "עוד לא שיניתי דבר, נחזור לזה כשיתאים לך.";
  assert.equal(await handleAssistantMessage(store, "me", "עזוב בינתיים", async () =>
    ({ type: "answer", response })), response);
});

test("task interpretation never relays the generic technical-information reply", async () => {
  const reply = await handleAssistantMessage(createEmptyStore(), "me", "את המשימה הזאת", async () =>
    ({ type: "answer", response: "נראה ששלחת לי מידע טכני" }));
  assert.doesNotMatch(reply, /מידע טכני/u);
});
