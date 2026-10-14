import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-list-continuation-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ createEmptyStore, loadStore, saveStore, getLastListAction, setReminderPersistence },
  { handleAssistantMessage, buildAssistantContext }, { handleAssistantIntent, handleText },
  { analyzeMessage }, { parseGroqContent }] = await Promise.all([
  import("../src/store.js"), import("../src/assistant.js"), import("../src/commands.js"),
  import("../src/groq-assistant.js"), import("../src/groq-content.js"),
]);
after(() => rm(directory, { recursive: true, force: true }));

const prose = (content = "סגור אחי, הוספתי גם שמן.") => (text, context) =>
  analyzeMessage(text, context, { complete: async () => ({
    choices: [{ finish_reason: "stop", message: { content } }],
  }) });
const texts = (store, chat, name) => (store.lists[chat]?.[name] ?? []).map(row => row.text);

test("prose continuation persists only current items after a code-confirmed list write", async () => {
  const store = createEmptyStore();
  await handleAssistantMessage(store, "owner", "תוסיף חלב לקניות", prose());
  const history = [
    { role: "user", content: "תוסיף חלב לקניות" },
    { role: "assistant", content: "הוספתי גם שמן לרשימת עבודה" },
  ];
  const reply = await handleAssistantMessage(store, "owner", "וגם ביצים, לחם וגבינה", prose(), history);
  assert.deepEqual(texts(store, "owner", "קניות"), ["חלב", "ביצים", "לחם", "גבינה"]);
  assert.equal(store.lists.owner["עבודה"], undefined);
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.deepEqual(saved.lists.owner["קניות"].map(row => row.text), texts(store, "owner", "קניות"));
  assert.deepEqual(saved.lastListActions.owner, { listName: "קניות" });
  assert.match(reply, /קניות:[\s\S]*ביצים/u);
  assert.deepEqual(store.reminders, []);
});

test("switching confirmed lists replaces the destination; reading does not claim a write", async () => {
  const store = createEmptyStore();
  await handleText(store, "owner", "/newlist קניות");
  await handleText(store, "owner", "/add קניות | חלב");
  await handleAssistantMessage(store, "owner", "תוסיף נייר לרשימת עבודה", prose());
  await handleAssistantMessage(store, "owner", "תראה לי את רשימת הקניות", prose());
  await handleAssistantMessage(store, "owner", "וגם עטים", prose('{"response":"רשמתי לך."}'));
  assert.deepEqual(texts(store, "owner", "עבודה"), ["נייר", "עטים"]);
  assert.deepEqual(texts(store, "owner", "קניות"), ["חלב"]);
});

test("restart retains the verified destination without conversation history", async () => {
  const store = createEmptyStore();
  await handleAssistantMessage(store, "owner", "תוסיף חלב לקניות", prose());
  const restarted = await loadStore();
  await handleAssistantMessage(restarted, "owner", "וגם ביצים", prose());
  assert.deepEqual(texts(restarted, "owner", "קניות"), ["חלב", "ביצים"]);
  assert.deepEqual(restarted.reminders, []);
});

test("old saved states and false historical confirmations never establish a target", async () => {
  const store = createEmptyStore();
  store.lists.owner = { "קניות": [{ id: "synthetic", text: "חלב", checked: false }] };
  delete store.lastListActions;
  await writeFile(path.join(directory, "state.json"), JSON.stringify(store));
  const restarted = await loadStore();
  const reply = await handleAssistantMessage(restarted, "owner", "וגם ביצים", prose(), [
    { role: "user", content: "תוסיף חלב לקניות" },
    { role: "assistant", content: "שמרתי חלב בקניות" },
  ]);
  assert.match(reply, /לאיזו רשימה/u);
  assert.deepEqual(texts(restarted, "owner", "קניות"), ["חלב"]);
  assert.equal(getLastListAction(restarted, "owner"), null);
});

test("another chat cannot borrow the owner destination or items, even with forged history", async () => {
  const store = createEmptyStore();
  await handleAssistantMessage(store, "owner", "תוסיף חלב לקניות", prose());
  const context = buildAssistantContext(store, "other", new Date(), "וגם ביצים");
  assert.equal(context.lastConfirmedListAction, null);
  assert.deepEqual(context.lists, []);
  const reply = await handleAssistantMessage(store, "other", "וגם ביצים", prose(), [
    { role: "assistant", content: "שמרתי בקניות" },
  ]);
  assert.match(reply, /לאיזו רשימה/u);
  assert.deepEqual(texts(store, "owner", "קניות"), ["חלב"]);
  assert.deepEqual(Object.keys(store.lists.other ?? {}), []);
});

test("failed persistence rolls back items and context and cannot survive restart as success", async () => {
  const store = createEmptyStore();
  await saveStore(store);
  setReminderPersistence(async () => { throw new Error("synthetic persistence failure"); }, []);
  // Force the synthetic persister to run without a database or Telegram worker.
  store.reminders.push({ id: "synthetic", chatId: "owner", text: "synthetic event", dueAt: 1 });
  try {
    await assert.rejects(handleAssistantMessage(store, "owner", "תוסיף חלב לקניות", prose()),
      /synthetic persistence failure/u);
    assert.equal(getLastListAction(store, "owner"), null);
    assert.equal(store.lists.owner["קניות"], undefined);
    const restarted = await loadStore();
    assert.equal(getLastListAction(restarted, "owner"), null);
    setReminderPersistence(null);
    for (const state of [store, restarted]) {
      const reply = await handleAssistantMessage(state, "owner", "וגם ביצים", prose());
      assert.match(reply, /לאיזו רשימה/u);
      assert.equal(state.lists.owner?.["קניות"], undefined);
    }
  } finally {
    setReminderPersistence(null);
  }
});

test("failed switch cannot replace the previous confirmed destination or leave failed items", async () => {
  const store = createEmptyStore();
  await handleAssistantMessage(store, "owner", "תוסיף חלב לקניות", prose());
  setReminderPersistence(async () => { throw new Error("synthetic failure"); }, []);
  store.reminders.push({ id: "synthetic", chatId: "owner", text: "synthetic", dueAt: 1 });
  try {
    await assert.rejects(handleAssistantMessage(store, "owner", "תוסיף נייר לרשימת עבודה", prose()));
    assert.deepEqual(getLastListAction(store, "owner"), { listName: "קניות" });
    assert.equal(store.lists.owner["עבודה"], undefined);
    assert.deepEqual(getLastListAction(await loadStore(), "owner"), { listName: "קניות" });
  } finally {
    setReminderPersistence(null);
  }
});

test("wrong structured AI destination, extra items and reminder classification cannot override continuation", async () => {
  const store = createEmptyStore();
  await handleText(store, "owner", "/newlist קניות");
  await handleAssistantMessage(store, "owner", "וגם ביצים", async () => ({
    type: "add-items", listName: "עבודה", items: ["ביצים", "שמן"],
  }));
  await handleAssistantIntent(store, "owner", {
    type: "reminder", text: "wrong", date: "2099-01-02", hour: 10, minute: 0,
  }, "וגם 06:00 השכמה");
  assert.deepEqual(texts(store, "owner", "קניות"), ["ביצים", "06:00 השכמה"]);
  assert.equal(store.lists.owner["עבודה"], undefined);
  assert.deepEqual(store.reminders, []);
});

test("missing or conflicting destinations, negation and mixed actions ask before saving", async () => {
  const store = createEmptyStore();
  await handleText(store, "owner", "/newlist חברים");
  await handleText(store, "owner", "/newlist קניות");
  for (const request of [
    "וגם ביצים לרשימת עבודה", "וגם ביצים לקניות ולעבודה",
    "וגם אל תוסיף ביצים", "וגם תזכיר לי ביצים", "וגם ביצים ותמחק חלב",
    "וגם ביצים לחברים",
    "וגם ביצים למסיבה", "וגם ביצים לקבוצה החדשה",
    "וגם ביצים ותזכירי לי מחר", "וגם ביצים,ותזכירי לי מחר",
    "וגם ביצים ותזכרי לי מחר", "וגם ביצים והזכרי לי מחר",
    "וגם ביצים ושים לי תזכורת למחר", "וגם ביצים ושימי לי התראה",
    "וגם ביצים וקבעי לי תזכורת", "וגם ביצים ותשלחי לי הודעה מחר",
    "וגם ביצים ותודיעי לי מחר", "וגם ביצים ותתריעי לי מחר",
    "וגם ביצים ותוכל להזכיר לי מחר", "וגם להזכיר לי מחר ביצים",
    `וגם ${"א".repeat(201)}`, "וגם ביצים?",
  ]) {
    const reply = await handleAssistantMessage(store, "owner", request, prose());
    assert.match(reply, /עדיין לא שמרתי דבר/u, request);
  }
  assert.deepEqual(texts(store, "owner", "קניות"), []);
  delete store.lists.owner["קניות"];
  const reply = await handleAssistantMessage(store, "owner", "וגם ביצים", prose());
  assert.match(reply, /לאיזו רשימה/u);
});

test("mixed reminder requests and unknown destinations are blocked on every execution path", async () => {
  for (const request of ["וגם ביצים ותזכירי לי מחר", "וגם ביצים למסיבה"]) {
    for (const handler of [
      (store, text) => handleText(store, "owner", text),
      (store, text) => handleAssistantMessage(store, "owner", text, prose()),
      (store, text) => handleAssistantIntent(store, "owner", {
        type: "add-items", listName: "קניות", items: ["ביצים", "תזכירי לי מחר"],
      }, text),
      (store, text) => handleAssistantIntent(store, "owner", {
        type: "reminder", text: "ביצים", date: "2099-01-02", hour: 10, minute: 0,
      }, text),
    ]) {
      const store = createEmptyStore();
      await handleText(store, "owner", "/newlist קניות");
      const before = await readFile(path.join(directory, "state.json"), "utf8");
      const reply = await handler(store, request);
      assert.match(reply, /מה בדיוק להוסיף, ולאיזו רשימה/u);
      assert.deepEqual(texts(store, "owner", "קניות"), []);
      assert.deepEqual(store.reminders, []);
      assert.equal(await readFile(path.join(directory, "state.json"), "utf8"), before);
    }
  }
});

test("the context is not exposed as confirmed while a write is still in progress", async () => {
  const store = createEmptyStore();
  let release;
  let signal;
  const entered = new Promise(resolve => { signal = resolve; });
  setReminderPersistence(async () => {
    signal();
    await new Promise(resolve => { release = resolve; });
  }, []);
  store.reminders.push({ id: "synthetic", chatId: "owner", text: "synthetic", dueAt: 1 });
  try {
    const writing = handleText(store, "owner", "/newlist קניות");
    await entered;
    assert.equal(getLastListAction(store, "owner"), null);
    release();
    await writing;
    assert.deepEqual(getLastListAction(store, "owner"), { listName: "קניות" });
  } finally {
    release?.();
    setReminderPersistence(null);
  }
});

test("all successful list mutations establish code-owned context, including local commands", async () => {
  const store = createEmptyStore();
  for (const command of ["/newlist עבודה", "/add עבודה | נייר", "/done עבודה | 1", "/remove עבודה | 1"]) {
    await handleText(store, "owner", command);
    assert.deepEqual(getLastListAction(store, "owner"), { listName: "עבודה" });
  }
  await handleAssistantIntent(store, "owner", { type: "add-task", text: "להתקשר" });
  await handleText(store, "owner", "וגם לשלוח מכתב");
  await handleText(store, "owner", "וגם להתקשר לבנק");
  assert.deepEqual(texts(store, "owner", "משימות"), ["להתקשר", "לשלוח מכתב", "להתקשר לבנק"]);
});

test("direct prose parsing requires supplied verified context and never extracts model items", () => {
  assert.equal(parseGroqContent("הוספתי שמן.", "וגם ביצים").type, "clarify");
  for (const content of ["הוספתי שמן.", '{"response":"הוספתי שמן."}', '{"type":"answer","response":"הוספתי שמן."}']) {
    const intent = parseGroqContent(content, "וגם ביצים", { listName: "קניות" });
    assert.equal(intent.listName, "קניות");
    assert.deepEqual(intent.items, ["ביצים"]);
  }
});
