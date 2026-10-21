import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-pending-list-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, loadStore, saveStore, getPendingListAction,
  getLastListAction, setReminderPersistence } = await import("../src/store.js");
const { handleAssistantMessage, buildAssistantContext } = await import("../src/assistant.js");
const { handleAssistantIntent, handleText } = await import("../src/commands.js");
after(() => rm(directory, { recursive: true, force: true }));
const stateFile = path.join(directory, "state.json");
// The semantic route may ask for a truly unresolved destination. Exact saved
// destination replies still bypass this fake analyzer entirely.
const noAI = async text => {
  if (/^(?:וגם|מסיבה|קניות ועבודה|אל תוסיף לקניות|קניות\?|כן)/u.test(text)) {
    return { type: "clarify", response: "לאיזו רשימה להוסיף? עדיין לא הוספתי דבר." };
  }
  throw new Error("An exact destination reply must not call AI");
};
const handlers = [
  (store, chat, text) => handleText(store, chat, text),
  (store, chat, text) => handleAssistantMessage(store, chat, text, noAI, [
    { role: "assistant", content: "הוספתי שמן לרשימת עבודה" },
  ]),
  (store, chat, text) => handleAssistantIntent(store, chat, {
    type: "add-items", listName: "עבודה", items: ["שמן"],
    pendingListItems: ["פריט מזויף"],
  }, text),
];
function syntheticStore() {
  const store = createEmptyStore();
  store.lists.owner = { "קניות": [], "עבודה": [] };
  return store;
}
const items = (store, name = "קניות") => store.lists.owner[name].map(item => item.text);

test("every entry point saves the original batch after a name-only reply without another AI call", async () => {
  for (const handle of handlers) {
    const store = syntheticStore();
    assert.match(await handle(store, "owner", "וגם ביצים, לחם וגבינה"), /לאיזו רשימה/u);
    assert.deepEqual(getPendingListAction(store, "owner").items, ["ביצים", "לחם", "גבינה"]);
    assert.deepEqual(items(store), []);
    assert.match(await handle(store, "owner", "קניות"), /קניות:/u);
    assert.deepEqual(items(store), ["ביצים", "לחם", "גבינה"]);
    assert.deepEqual(items(store, "עבודה"), []);
    assert.equal(getPendingListAction(store, "owner"), null);
    const saved = await loadStore();
    assert.equal(getPendingListAction(saved, "owner"), null);
    assert.deepEqual(items(saved), items(store));
    assert.deepEqual(getLastListAction(saved, "owner"), { listName: "קניות" });
    // Repeating only the name is retrieval, not permission to replay a write.
    await handleAssistantMessage(saved, "owner", "קניות", noAI);
    assert.deepEqual(items(saved), ["ביצים", "לחם", "גבינה"]);
    assert.deepEqual(store.reminders, []);
  }
});

test("pending batch survives restart but completed operations are never replayed", async () => {
  const store = syntheticStore();
  await handleAssistantMessage(store, "owner", "וגם 06:00 השכמה, חלב", noAI);
  const restarted = await loadStore();
  assert.deepEqual(getPendingListAction(restarted, "owner").items, ["06:00 השכמה", "חלב"]);
  await handleAssistantMessage(restarted, "owner", "רשימת הקניות.", noAI);
  const completed = await loadStore();
  await handleAssistantMessage(completed, "owner", "קניות", noAI);
  assert.deepEqual(items(completed), ["06:00 השכמה", "חלב"]);
  assert.equal(getPendingListAction(completed, "owner"), null);
  assert.deepEqual(completed.reminders, []);
});

test("unknown, mixed, negated and ambiguous targets cannot authorize a save", async () => {
  const store = syntheticStore();
  await handleText(store, "owner", "וגם ביצים");
  for (const text of ["מסיבה", "קניות ועבודה", "אל תוסיף לקניות", "קניות?", "כן"]) {
    const reply = await handleAssistantMessage(store, "owner", text, noAI);
    assert.equal(typeof reply, "string");
    assert.deepEqual(items(store), []);
    assert.deepEqual(getPendingListAction(store, "owner").items, ["ביצים"]);
  }
  await handleAssistantMessage(store, "owner", "עבודה", noAI);
  assert.deepEqual(items(store, "עבודה"), ["ביצים"]);
});

test("pending items and destination catalog belong only to their chat", async () => {
  const store = syntheticStore();
  store.lists.other = { "אחר": [] };
  await handleText(store, "owner", "וגם ביצים");
  const context = buildAssistantContext(store, "other");
  assert.equal(context.pendingListAddition, null);
  await handleText(store, "other", "קניות");
  assert.deepEqual(items(store), []);
  await handleText(store, "other", "וגם נייר");
  assert.match(await handleAssistantMessage(store, "other", "קניות", noAI), /לא.*(?:הוספתי|מצאתי)/u);
  await handleAssistantMessage(store, "other", "אחר", noAI);
  assert.deepEqual(store.lists.other["אחר"].map(item => item.text), ["נייר"]);
  assert.deepEqual(getPendingListAction(store, "owner").items, ["ביצים"]);
});

test("cancellation persists across restart on every entry point", async () => {
  for (const handle of handlers) {
    for (const cancellation of ["עזוב", "לא משנה", "ביטול", "בטל את זה", "/cancel"]) {
      const store = syntheticStore();
      await handle(store, "owner", "וגם ביצים");
      assert.match(await handle(store, "owner", cancellation), /ביטלתי את ההוספה/u);
      const restarted = await loadStore();
      assert.equal(getPendingListAction(restarted, "owner"), null);
      await handleAssistantMessage(restarted, "owner", "קניות", noAI);
      assert.deepEqual(items(restarted), []);
    }
  }
});

test("a new addition replaces the old batch, including explicit actions and commands", async () => {
  for (const handle of handlers) {
    const store = syntheticStore();
    await handle(store, "owner", "וגם ביצים");
    await handle(store, "owner", "וגם נייר, עטים");
    await handle(store, "owner", "עבודה");
    assert.deepEqual(items(store, "עבודה"), ["נייר", "עטים"]);
    assert.deepEqual(items(store), []);
  }
  for (const replacement of ["תוסיף נייר לעבודה", "/add עבודה | נייר",
    "שמור רשימת עבודה: נייר"]) {
    const store = syntheticStore();
    await handleText(store, "owner", "וגם ביצים");
    await handleAssistantMessage(store, "owner", replacement, async () => ({
      type: "add-items", listName: "עבודה", items: ["נייר"],
    }));
    assert.equal(getPendingListAction(store, "owner"), null);
    await handleAssistantMessage(store, "owner", "קניות", noAI);
    assert.deepEqual(items(store), []);
    assert.deepEqual(items(store, "עבודה"), ["נייר"]);
  }
});

test("reminder clarification remains separate from list clarification", async () => {
  const store = syntheticStore();
  await handleText(store, "owner", "וגם ביצים");
  await handleText(store, "owner", "תזכיר לי מחר ללכת לבנק");
  assert.equal(getPendingListAction(store, "owner"), null);
  assert.equal(store.pendingActions.owner.type, "reminder");
  assert.deepEqual(items(store), []);
});

test("failed begin, replacement, cancellation and completion retain only durable context", async () => {
  const store = syntheticStore();
  await saveStore(store);
  const fail = () => {
    setReminderPersistence(async () => { throw new Error("synthetic write failure"); }, []);
    store.reminders = [{ id: "fake", chatId: "owner", text: "synthetic", dueAt: 1 }];
  };
  try {
    fail();
    await assert.rejects(handleText(store, "owner", "וגם ביצים"), /synthetic write failure/u);
    assert.equal(getPendingListAction(store, "owner"), null);
    assert.equal(getPendingListAction(await loadStore(), "owner"), null);
    setReminderPersistence(null);
    store.reminders = [];
    await handleText(store, "owner", "וגם ביצים");
    const before = await readFile(stateFile, "utf8");
    fail();
    for (const reply of ["וגם נייר", "ביטול", "קניות"]) {
      await assert.rejects(handleAssistantMessage(store, "owner", reply, noAI),
        /synthetic write failure/u);
      assert.deepEqual(getPendingListAction(store, "owner").items, ["ביצים"]);
      assert.deepEqual(items(store), []);
      assert.equal(getLastListAction(store, "owner"), null);
      assert.equal(await readFile(stateFile, "utf8"), before);
      assert.deepEqual(getPendingListAction(await loadStore(), "owner").items, ["ביצים"]);
    }
    setReminderPersistence(null);
    const restarted = await loadStore();
    await handleAssistantMessage(restarted, "owner", "קניות", noAI);
    assert.deepEqual(items(restarted), ["ביצים"]);
    assert.equal(getPendingListAction(await loadStore(), "owner"), null);
  } finally {
    setReminderPersistence(null);
  }
});

test("old states load without pending lists, and malformed pending batches fail explicitly", async () => {
  const old = syntheticStore();
  delete old.pendingListActions;
  await writeFile(stateFile, JSON.stringify(old));
  assert.equal(getPendingListAction(await loadStore(), "owner"), null);
  for (const pending of [[], { owner: { type: "reminder", items: ["ביצים"] } },
    { owner: { type: "add-items", items: [] } },
    { owner: { type: "add-items", items: ["א".repeat(201)] } },
    { owner: { type: "add-items", items: [123] } }]) {
    await writeFile(stateFile, JSON.stringify({ ...old, pendingListActions: pending }));
    await assert.rejects(loadStore(), /pending list/u);
  }
});
