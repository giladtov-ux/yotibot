import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-record-types-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ createEmptyStore }, { handleAssistantMessage }, { handleAssistantIntent }] =
  await Promise.all([import("../src/store.js"), import("../src/assistant.js"), import("../src/commands.js")]);
after(() => rm(directory, { recursive: true, force: true }));
function fixture() {
  const store = createEmptyStore();
  store.lists.owner = {
    "משימות": [{ id: "task", text: "להתקשר לבנק", checked: false }],
    "קניות": [{ id: "item", text: "חלב", checked: false }],
  };
  store.reminders = [{ id: "event", chatId: "owner", text: "יציאה לאיסופים", dueAt: Date.parse("2099-01-02T04:35:00Z") }];
  return store;
}
const noAi = () => { throw new Error("explicit record queries must bypass AI"); };

test("task and shopping queries return only the actual list, never the daily schedule", async () => {
  const store = fixture();
  for (const query of ["מה רשימת המשימות שלי?", "מה המשימות שלי?", "תראה לי את רשימת המשימות"]) {
    const reply = await handleAssistantMessage(store, "owner", query, noAi);
    assert.match(reply, /להתקשר לבנק/u);
    assert.doesNotMatch(reply, /יציאה לאיסופים|06:35|חלב/u);
  }
  const shopping = await handleAssistantMessage(store, "owner", "מה רשימת הקניות שלי?", noAi);
  assert.match(shopping, /חלב/u);
  assert.doesNotMatch(shopping, /להתקשר לבנק|יציאה/u);
});

test("reminder and schedule queries return only timed records, not lists or background routine", async () => {
  for (const query of ["מה התזכורות שלי?", "מה הלו״ז שלי?", "תציג לי את לוח הזמנים שלי"]) {
    const reply = await handleAssistantMessage(fixture(), "owner", query, noAi);
    assert.match(reply, /יציאה לאיסופים/u);
    assert.doesNotMatch(reply, /להתקשר לבנק|חלב|השכמה|חזרה למשימות/u);
  }
});

test("wrong AI intents cannot override record-type queries and empty lists stay empty", async () => {
  const store = fixture();
  const reply = await handleAssistantIntent(store, "owner", { type: "list-reminders" }, "מה רשימת המשימות שלי?");
  assert.match(reply, /להתקשר לבנק/u);
  assert.doesNotMatch(reply, /יציאה/u);
  const schedule = await handleAssistantIntent(store, "owner", { type: "show-list", name: "משימות" }, "מה התזכורות שלי?");
  assert.match(schedule, /יציאה/u);
  delete store.lists.owner["משימות"];
  const absent = await handleAssistantMessage(store, "owner", "מה רשימת המשימות שלי?", noAi);
  assert.match(absent, /לא מצאתי רשימה/u);
  assert.doesNotMatch(absent, /יציאה/u);
});

test("explicit list items containing times stay text and never become reminders", async () => {
  const store = createEmptyStore();
  const text = "שמור רשימת משימות: 06:00 השכמה, 06:35 יציאה לאיסופים";
  await handleAssistantMessage(store, "owner", text, noAi);
  assert.deepEqual(store.lists.owner["משימות"].map(row => row.text), ["06:00 השכמה", "06:35 יציאה לאיסופים"]);
  assert.deepEqual(store.reminders, []);
});

test("an explicit list write overrides a mistaken AI schedule action", async () => {
  const store = createEmptyStore();
  await handleAssistantIntent(store, "owner", {
    type: "schedule-reminders", reminders: [{ text: "wrong alert", date: "2099-01-02", hour: 6, minute: 0 }],
  }, "שמור רשימת משימות: 06:00 השכמה");
  assert.deepEqual(store.reminders, []);
  assert.equal(store.lists.owner["משימות"][0].text, "06:00 השכמה");
});

test("unrepresentable end constraints are clarified instead of becoming unlimited repeats", async () => {
  for (const text of ["תזכיר לי לשתות מים כל 2 דקות למשך שעה", "תזכיר לי לשתות מים כל 2 דקות שלוש פעמים"]) {
    const store = createEmptyStore();
    const reply = await handleAssistantMessage(store, "owner", text, noAi);
    assert.match(reply, /כמה פעמים|מספר הפעמים/u);
    assert.equal(store.reminders.length, 0);
  }
});
