import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-list-confirmations-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore } = await import("../src/store.js");
const { resolveListConfirmation, rememberListConfirmation, activeConfirmationHistory } =
  await import("../src/list-confirmations.js");
const { replyToOwnerMessage } = await import("../src/message-handler.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
const { createReminderOperationQueue } = await import("../src/reminder-actions.js");
after(() => rm(directory, { recursive: true, force: true }));

const request = "אפשר לנקות את רשימת הקניות?";
const question = "מנקה את רשימת הקניות. סגור?";
const legacyHistory = () => [
  { role: "user", content: request }, { role: "assistant", content: question },
];
const persist = async () => {};
function fixture() {
  const store = createEmptyStore();
  store.lists["42"] = {
    קניות: [{ id: "milk", text: "חלב", checked: false }, { id: "bread", text: "לחם", checked: true }],
    משימות: [{ id: "task", text: "פגישה", checked: false }],
  };
  store.lists["99"] = { קניות: [{ id: "private", text: "פרטי", checked: false }] };
  store.reminders = [{ id: "reminder", chatId: "42", text: "פגישה", dueAt: Date.UTC(2099, 0, 1) }];
  return store;
}

test("a real pending cleanup is cancelled by a list request, without deleting data or reviving on yes", async () => {
  const store = fixture();
  const before = JSON.stringify(store.lists);
  const response = await rememberListConfirmation(store, "42", request, question, { persist });
  assert.match(response, /כן או לא/u);
  assert.equal(store.listConfirmations["42"].awaiting, true);
  assert.equal(await resolveListConfirmation(store, "42", "רשימת קניות", { persist }), null);
  assert.equal(store.listConfirmations["42"].awaiting, false);
  assert.equal(await resolveListConfirmation(store, "42", "כן", {
    history: [{ role: "user", content: request }, { role: "assistant", content: response }], persist,
  }), null);
  assert.equal(JSON.stringify(store.lists), before);
});

test("explicit yes clears every list item and consumes the confirmation; other records are untouched", async () => {
  const store = fixture();
  await rememberListConfirmation(store, "42", request, question, { persist });
  const result = await resolveListConfirmation(store, "42", "כן", { persist });
  assert.match(result.text, /נוקתה/u);
  assert.equal(store.lists["42"].קניות.length, 0);
  assert.equal(store.lists["42"].משימות.length, 1);
  assert.equal(store.lists["99"].קניות.length, 1);
  assert.equal(store.reminders.length, 1);
  assert.match(result.menu.text, /עוד אין כאן פריטים/u);
  assert.equal(await resolveListConfirmation(store, "42", "כן", { persist }), null);
});

test("no cancels, and ambiguous agreement or yes with another request never authorizes cleanup", async () => {
  for (const text of ["לא", "אוקיי", "סגור", "כן אבל תראה רשימת קניות", "תזכיר לי מחר"]) {
    const store = fixture();
    await rememberListConfirmation(store, "42", request, question, { persist });
    await resolveListConfirmation(store, "42", text, { persist });
    assert.equal(store.listConfirmations["42"].awaiting, false);
    assert.equal(store.lists["42"].קניות.length, 2);
  }
});

test("legacy recovery uses only the immediate user request, never a target supplied by AI", async () => {
  const store = fixture();
  assert.match((await resolveListConfirmation(store, "42", "כן", {
    history: legacyHistory(), persist,
  })).text, /נוקתה/u);
  assert.equal(store.lists["42"].קניות.length, 0);
  assert.equal(await resolveListConfirmation(store, "42", "כן", {
    history: legacyHistory(), persist,
  }), null);
  const other = fixture();
  const badHistory = [{ role: "user", content: "שלום" }, { role: "assistant", content: question }];
  assert.equal(await resolveListConfirmation(other, "42", "כן", { history: badHistory, persist }), null);
  assert.equal(other.lists["42"].קניות.length, 2);
  assert.equal(await resolveListConfirmation(other, "99", "כן", { persist }), null);
});

test("switching topic cancels a legacy prompt and active-context filtering keeps the stored archive intact", async () => {
  const store = fixture(), history = legacyHistory();
  const archive = JSON.stringify(history);
  await resolveListConfirmation(store, "42", "איך היה היום?", { history, persist });
  assert.deepEqual(activeConfirmationHistory(store, "42", history, "איך היה היום?"), []);
  assert.equal(JSON.stringify(history), archive);
  assert.equal(await resolveListConfirmation(store, "42", "כן", { history, persist }), null);
  assert.equal(store.lists["42"].קניות.length, 2);
});

test("failed persistence keeps the list and pending consent unchanged for a safe retry", async () => {
  const store = fixture();
  await rememberListConfirmation(store, "42", request, question, { persist });
  const before = JSON.stringify(store);
  await assert.rejects(resolveListConfirmation(store, "42", "כן", {
    persist: async () => { throw new Error("synthetic SQL failure"); },
  }), /synthetic SQL failure/u);
  assert.equal(JSON.stringify(store), before);
  await resolveListConfirmation(store, "42", "כן", { persist });
  assert.equal(store.lists["42"].קניות.length, 0);
});

test("native message pipeline processes the new list request immediately and never repeats the cleanup prompt", async () => {
  const store = fixture(), sent = [], history = legacyHistory();
  await rememberListConfirmation(store, "42", request, question);
  await replyToOwnerMessage(store, { sendMessage: async (...args) => sent.push(args) }, "42", "רשימת קניות", {
    readHistory: async () => history,
    saveConversation: async () => {},
    recordOperation: createReminderOperationQueue(),
    assistant: (s, id, text, _, rows) => handleAssistantMessage(s, id, text,
      async () => { assert.fail("the list query must not go to AI"); }, rows),
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0][1], /קניות/u);
  assert.doesNotMatch(sent[0][1], /סגור/u);
  assert.equal(store.listConfirmations["42"].awaiting, false);
  assert.equal(store.lists["42"].קניות.length, 2);
});

test("the real reply pipeline records a confirmation, then yes performs the actual cleanup without AI", async () => {
  const store = fixture(), sent = [], turns = [];
  const telegram = { sendMessage: async (...args) => sent.push(args) };
  const options = {
    readHistory: async () => [],
    saveConversation: async (...args) => turns.push(args),
    assistant: async () => question,
  };
  await replyToOwnerMessage(store, telegram, "42", request, options);
  assert.match(sent[0][1], /כן או לא/u);
  await replyToOwnerMessage(store, telegram, "42", "כן", {
    ...options, assistant: async () => { assert.fail("confirmation must bypass AI"); },
  });
  assert.match(sent[1][1], /נוקתה/u);
  assert.match(sent[2][1], /עוד אין כאן פריטים/u);
  assert.equal(store.lists["42"].קניות.length, 0);
  assert.equal(turns.at(-1)[1], "כן");
});
