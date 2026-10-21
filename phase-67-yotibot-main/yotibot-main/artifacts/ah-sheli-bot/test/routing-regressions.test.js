import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-routing-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ createEmptyStore, setPendingAction, setPendingListAction }, { handleAssistantMessage },
  { handleAssistantIntent, handleText }, { analyzeMessage }, { parseGroqContent }, { compactHistory }] =
  await Promise.all([
    import("../src/store.js"), import("../src/assistant.js"), import("../src/commands.js"),
    import("../src/groq-assistant.js"), import("../src/groq-content.js"), import("../src/assistant-performance.js"),
  ]);
after(() => rm(directory, { recursive: true, force: true }));
const noAI = () => { throw new Error("This request must be handled in code"); };
function fixture() {
  const store = createEmptyStore();
  store.lists.owner = Object.assign(Object.create(null), {
    "קניות": ["חלב", "לחם", "ביצים", "מים", "אורז", "גבינה"].map((text, i) => ({ id: String(i), text, checked: false })),
    "משימות": [{ id: "task", text: "להתקשר לבנק", checked: false }],
  });
  store.lists.other = { "קניות": [{ id: "other", text: "שמור", checked: false }] };
  store.reminders = [{ id: "event", chatId: "owner", text: "יציאה לאיסופים",
    dueAt: Date.parse("2099-01-02T10:00:00Z") }];
  return store;
}
const model = content => (text, context) => analyzeMessage(text, context, {
  complete: async () => ({ choices: [{ finish_reason: "stop", message: { content } }] }),
});

test("whole-list deletion preempts every pending question and deletes only the explicit owner list", async () => {
  const store = fixture();
  await setPendingAction(store, "owner", { type: "reminder", text: "ישן", date: null, hour: null, minute: null });
  await setPendingListAction(store, "owner", { items: ["פריט שממתין"] });
  const beforeEvents = JSON.stringify(store.reminders);
  const reply = await handleAssistantMessage(store, "owner", "תסיר את כל רשימת הקניות", noAI);
  assert.equal(Object.hasOwn(store.lists.owner, "קניות"), false);
  assert.equal(store.lists.owner["משימות"][0].text, "להתקשר לבנק");
  assert.equal(store.lists.other["קניות"][0].text, "שמור");
  assert.equal(JSON.stringify(store.reminders), beforeEvents);
  assert.equal(store.pendingActions.owner, undefined);
  assert.equal(store.pendingListActions.owner, undefined);
  assert.match(reply, /מחקתי.*קניות/u);
  assert.doesNotMatch(reply, /תאריך|באיזה יום|אישור|לא הצלחתי לקרוא|מצב מקומי/u);
  const persisted = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.equal(Object.hasOwn(persisted.lists.owner, "קניות"), false);
});

test("clear removes all items but preserves the list and never changes another list", async () => {
  for (const text of ["נקה את רשימת הקניות", "תמחק את כל הפריטים ברשימת הקניות", "אח שלי, בבקשה תרוקן את רשימת קניות"]) {
    const store = fixture();
    await handleAssistantMessage(store, "owner", text, noAI);
    assert.deepEqual(store.lists.owner["קניות"], []);
    assert.equal(store.lists.owner["משימות"].length, 1);
    assert.equal(store.reminders.length, 1);
  }
});

test("number ranges are inclusive, preserve remaining order and use the exact named list", async () => {
  for (const text of [
    "תמחק סעיפים 2-4 מרשימת הקניות", "תסיר פריטים מ-2 עד 4 ברשימת קניות",
    "תמחק מרשימת קניות את סעיפים 2–4",
  ]) {
    const store = fixture();
    await handleAssistantMessage(store, "owner", text, noAI);
    assert.deepEqual(store.lists.owner["קניות"].map(item => item.text), ["חלב", "אורז", "גבינה"]);
    assert.equal(store.lists.owner["משימות"].length, 1);
  }
  const store = fixture();
  for (const text of ["תמחק סעיפים 0-3 מרשימת קניות", "תמחק סעיפים 5-2 מרשימת קניות",
    "תמחק סעיפים 2-100 מרשימת קניות", "תסיר את כל רשימת מכולת"]) {
    await handleAssistantMessage(store, "owner", text, noAI);
    assert.equal(store.lists.owner["קניות"].length, 6);
    assert.equal(store.lists.owner["משימות"].length, 1);
  }
});

test("an exact literal list name wins over grammatical suffix removal", async () => {
  const store = fixture();
  store.lists.owner["קניות שלי"] = [{ id: "literal", text: "לשמור על השם", checked: false }];
  await handleAssistantMessage(store, "owner", "תמחק את רשימת קניות שלי", noAI);
  assert.equal(store.lists.owner["קניות שלי"], undefined);
  assert.equal(store.lists.owner["קניות"].length, 6);
});

test("AI cannot invent a destructive action and unrelated acknowledgements never replay old writes", async () => {
  const store = fixture();
  await handleAssistantIntent(store, "owner", { type: "delete-list", listName: "קניות" }, "היי");
  await handleAssistantMessage(store, "owner", "כן", () => ({
    type: "add-items", listName: "קניות", items: ["פעולה ישנה"],
  }), [{ role: "user", text: "תוסיף חלב לקניות" }, { role: "assistant", text: "הוספתי חלב" }]);
  assert.equal(store.lists.owner["קניות"].length, 6);
});

test("a pending list accepts a supplied preposition target without asking for original items again", async () => {
  const store = fixture();
  await setPendingListAction(store, "owner", { items: ["עגבניות"] });
  await handleAssistantMessage(store, "owner", "היום היה עמוס", model("אני איתך אחי, קח רגע לנשום."));
  assert.deepEqual(store.pendingListActions.owner.items, ["עגבניות"]);
  await handleAssistantMessage(store, "owner", "לקניות", noAI);
  assert.equal(store.pendingListActions.owner, undefined);
  assert.equal(store.lists.owner["קניות"].at(-1).text, "עגבניות");
  assert.equal(store.lists.owner["משימות"].length, 1);
});

test("short shopping inputs reach semantic AI with the saved catalog and save without a keyword requirement", async () => {
  for (const text of ["שמנת", "צריך גם שמנת", "נגמרה השמנת, תרשום לי"]) {
    const store = fixture();
    let calls = 0;
    const reply = await handleAssistantMessage(store, "owner", text, async (message, context) => {
      calls++;
      assert.equal(message, text);
      assert.deepEqual(context.availableListNames, ["קניות", "משימות"]);
      return model(JSON.stringify({ type: "add-items", listName: "קניות", items: ["שמנת"] }))(message, context);
    });
    assert.equal(calls, 1);
    assert.equal(store.lists.owner["קניות"].at(-1).text, "שמנת");
    assert.equal(store.lists.owner["משימות"].length, 1);
    assert.equal(store.reminders.length, 1);
    assert.doesNotMatch(reply, /באיזה|באיזו|פורמט|אישור|מצב מקומי/u);
  }
});

test("semantic deletion and ranges do not need a literal deletion command template", async () => {
  const store = fixture();
  await handleAssistantMessage(store, "owner", "בקניות, מהשורה השנייה עד הרביעית אפשר להעיף",
    model(JSON.stringify({ type: "remove-range", listName: "קניות", position: 2, endPosition: 4 })));
  assert.deepEqual(store.lists.owner["קניות"].map(item => item.text), ["חלב", "אורז", "גבינה"]);
  await handleAssistantMessage(store, "owner", "רשימת הקניות כבר לא נחוצה, תעיף אותה",
    model(JSON.stringify({ type: "delete-list", listName: "קניות" })));
  assert.equal(store.lists.owner["קניות"], undefined);
  assert.equal(store.lists.owner["משימות"].length, 1);
  assert.equal(store.lists.other["קניות"].length, 1);
  assert.equal(store.reminders.length, 1);
});

test("semantic context resolves a pronoun without asking for the list again", async () => {
  const store = fixture();
  await handleAssistantMessage(store, "owner", "תוסיף שמנת לקניות", noAI);
  const reply = await handleAssistantMessage(store, "owner", "תשאיר אותה אבל בלי שום פריט", async (text, context) => {
    assert.equal(context.lastConfirmedListAction.listName, "קניות");
    return model(JSON.stringify({ type: "clear-list", listName: "קניות" }))(text, context);
  });
  assert.deepEqual(store.lists.owner["קניות"], []);
  assert.equal(store.lists.owner["משימות"].length, 1);
  assert.doesNotMatch(reply, /אישור|איזו|תאריך/u);
});

test("a natural pending destination consumes saved items only on durable success", async () => {
  const store = fixture();
  await setPendingListAction(store, "owner", { items: ["עגבניות"] });
  await handleAssistantMessage(store, "owner", "שים את זה בקניות", async (text, context) => {
    assert.deepEqual(context.pendingListAddition.items, ["עגבניות"]);
    return model(JSON.stringify({ type: "add-items", listName: "קניות", items: ["עגבניות"] }))(text, context);
  });
  assert.equal(store.lists.owner["קניות"].at(-1).text, "עגבניות");
  assert.equal(store.pendingListActions.owner, undefined);
});

test("a free-form save claim is reinterpreted once rather than accepted as an actual save", async () => {
  const store = fixture();
  let calls = 0;
  const client = { complete: async request => {
    calls++;
    assert.equal(request.model, "openai/gpt-oss-20b");
    return { choices: [{ finish_reason: "stop", message: { content: calls === 1
      ? "סגור, הוספתי שמנת לקניות."
      : JSON.stringify({ type: "add-items", listName: "קניות", items: ["שמנת"] }) } }] };
  } };
  const reply = await handleAssistantMessage(store, "owner", "שמנת",
    (text, context) => analyzeMessage(text, context, client));
  assert.equal(calls, 2);
  assert.equal(store.lists.owner["קניות"].filter(item => item.text === "שמנת").length, 1);
  assert.doesNotMatch(reply, /JSON|פורמט|מצב מקומי|איזו/u);
});

test("malformed action JSON retries from the original message, not invalid model fields", async () => {
  const store = fixture();
  let calls = 0;
  const client = { complete: async request => {
    calls++;
    const current = JSON.parse(request.messages.at(-1).content);
    assert.equal(current.currentMessage, "רשימת הקניות כבר לא נחוצה, תעיף אותה");
    assert.equal(request.messages.some(row => row.content.includes("שם שלא נמסר")), false);
    return { choices: [{ finish_reason: "stop", message: { content: calls === 1
      ? '{"type":"delete-list","listName":"שם שלא נמסר"'
      : JSON.stringify({ type: "delete-list", listName: "קניות" }) } }] };
  } };
  await handleAssistantMessage(store, "owner", "רשימת הקניות כבר לא נחוצה, תעיף אותה",
    (text, context) => analyzeMessage(text, context, client));
  assert.equal(calls, 2);
  assert.equal(store.lists.owner["קניות"], undefined);
  assert.equal(store.lists.owner["משימות"].length, 1);
});

test("bounded failed interpretation makes no changes and never exposes a JSON or local-mode error", async () => {
  const store = fixture();
  let calls = 0;
  const client = { complete: async () => {
    calls++;
    return { choices: [{ finish_reason: "stop", message: { content: '{"type":"add-items"' } }] };
  } };
  const reply = await handleAssistantMessage(store, "owner", "שמנת",
    (text, context) => analyzeMessage(text, context, client));
  assert.equal(calls, 2);
  assert.equal(store.lists.owner["קניות"].length, 6);
  assert.doesNotMatch(reply, /JSON|פורמט|מצב מקומי|כתוב במפורש|מה תרצה/u);
});

test("semantic destructive actions cannot be triggered by acknowledgements, negation or examples", async () => {
  for (const text of ["היי", "כן", "תודה", "אל תעיף את הקניות", "אני רק שואל איך מוחקים את הקניות", "זו רק דוגמה למחיקה"]) {
    const store = fixture();
    await handleAssistantIntent(store, "owner", { type: "delete-list", listName: "קניות" }, text, null, { semantic: true });
    assert.equal(store.lists.owner["קניות"].length, 6);
    assert.equal(store.lists.owner["משימות"].length, 1);
  }
});

test("a answered reminder date survives small talk and a later clock reply", async () => {
  const store = fixture();
  await handleAssistantMessage(store, "owner", "תזכיר לי להתקשר לבנק", noAI);
  const question = await handleAssistantMessage(store, "owner", "2099-01-02", noAI);
  assert.equal(store.pendingActions.owner.date, "2099-01-02");
  assert.match(question, /באיזו שעה/u);
  assert.doesNotMatch(question, /באיזה יום|מתי להזכיר/u);
  await handleAssistantMessage(store, "owner", "היום היה עמוס", model("אני פה אחי."));
  assert.equal(store.pendingActions.owner.date, "2099-01-02");
  const reply = await handleAssistantMessage(store, "owner", "כבר אמרתי, 10:00", noAI);
  assert.equal(store.pendingActions.owner, undefined);
  assert.equal(store.reminders.length, 2);
  assert.equal(store.reminders.at(-1).text, "להתקשר לבנק");
  assert.equal(store.reminders.at(-1).dueAt, Date.parse("2099-01-02T08:00:00Z"));
  assert.match(reply, /אזכיר/u);
});

test("a new reminder does not inherit the old reminder's date or time", async () => {
  const store = fixture();
  await setPendingAction(store, "owner", { type: "reminder", text: "ישן", date: "2099-01-02", hour: 10, minute: 30 });
  await handleAssistantMessage(store, "owner", "תזכיר לי ללכת לדואר", noAI);
  assert.equal(store.pendingActions.owner.text, "ללכת לדואר");
  assert.equal(store.pendingActions.owner.date, null);
  assert.equal(store.pendingActions.owner.hour, null);
  assert.equal(store.reminders.length, 1);
});

test("bare numeric clock answers use the remembered day without another AI clarification", async () => {
  const store = fixture();
  await setPendingAction(store, "owner", { type: "reminder", text: "שעון קצר",
    date: "2099-01-02", hour: null, minute: null });
  await handleAssistantMessage(store, "owner", "9", noAI);
  assert.equal(store.reminders.at(-1).dueAt, Date.parse("2099-01-02T07:00:00Z"));
  assert.equal(store.pendingActions.owner, undefined);
});

test("an informational current turn cannot execute an AI-suggested historical mutation", async () => {
  const store = fixture();
  await setPendingAction(store, "owner", { type: "reminder", text: "עדיין חסרה שעה",
    date: "2099-01-02", hour: null, minute: null });
  const before = JSON.stringify(store);
  await handleAssistantMessage(store, "owner", "מה נשמע", () => ({
    type: "remove-item", listName: "קניות", itemText: "חלב",
  }));
  assert.equal(JSON.stringify(store), before);
});

test("natural output accepts text fences, long answers, rich text blocks and unrelated invalid fields", async () => {
  for (const content of [
    "אהלן אחי, אפשר גם לדבר על {משהו אחר}.",
    "```text\nבשמחה אחי\n```",
    JSON.stringify({ type: "chat", text: "אהלן אחי", date: "bad", items: "irrelevant" }),
    JSON.stringify({ type: "answer", response: { text: "אהלן אחי" }, hour: "irrelevant" }),
    [{ type: "text", text: "אני איתך אחי." }],
    "תשובה אנושית ארוכה ".repeat(240),
  ]) {
    const store = fixture();
    const reply = await handleAssistantMessage(store, "owner", "היום היה עמוס", model(content));
    assert.doesNotMatch(reply, /לא הצלחתי לקרוא|מצב מקומי/u);
    assert.equal(store.lists.owner["קניות"].length, 6);
  }
  const long = "תשובה ".repeat(1000);
  const reply = await handleAssistantMessage(fixture(), "owner", "שתף מחשבה", model(long));
  assert.equal(reply, long.trim());
  const recovered = parseGroqContent('{"type":"add-items","items":', "תוסיף חלב לקניות");
  assert.equal(recovered.type, "add-items");
  assert.deepEqual(recovered.items, ["חלב"]);
});

test("all user clarifications after the schedule anchor survive context compaction", () => {
  const history = [
    { role: "user", text: "סידור עבודה: 06:00 השכמה, 06:35 יציאה לאיסופים" },
    { role: "assistant", text: "לאיזה יום?" },
    { role: "user", text: "2099-01-02" },
    { role: "assistant", text: "עוד פרט" },
    { role: "user", text: "חזרה ב-09:00" },
    { role: "assistant", text: "עוד פרט" },
    { role: "user", text: "כן, יציאה לאיסוף צהריים ב-14:00" },
    { role: "assistant", text: "עוד פרט" },
  ];
  const compacted = compactHistory(history);
  assert.ok(compacted.some(row => row.text === "2099-01-02"));
  assert.ok(compacted.some(row => row.text === history[0].text));
  assert.ok(compacted.some(row => row.text === "חזרה ב-09:00"));
});

test("a failed bulk delete rolls back items and both saved pending contexts", async () => {
  const store = fixture();
  await setPendingAction(store, "owner", { type: "reminder", text: "ישן", date: null, hour: null, minute: null });
  await setPendingListAction(store, "owner", { items: ["מחכה"] });
  const before = JSON.stringify(store);
  const file = path.join(directory, "state.json");
  await rm(file, { force: true });
  await mkdir(file);
  try {
    await assert.rejects(handleText(store, "owner", "תמחק את כל רשימת קניות"));
    assert.equal(JSON.stringify(store), before);
  } finally { await rm(file, { recursive: true, force: true }); }
});

test("informational turns neither consume a pending reminder nor require a state write", async () => {
  const store = fixture();
  await setPendingAction(store, "owner", { type: "reminder", text: "שמור להשלמה",
    date: "2099-01-02", hour: null, minute: null });
  const before = JSON.stringify(store);
  const file = path.join(directory, "state.json");
  await rm(file, { force: true }); await mkdir(file);
  try {
    await handleText(store, "owner", "מה השעה");
    await handleAssistantIntent(store, "owner", { type: "tell-time" });
    assert.equal(JSON.stringify(store), before);
  } finally { await rm(file, { recursive: true, force: true }); }
});
