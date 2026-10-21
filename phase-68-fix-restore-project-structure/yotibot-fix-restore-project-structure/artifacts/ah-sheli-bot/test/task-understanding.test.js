import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBareTasks, parseNaturalTaskAction, bindItemIntent } from "../src/task-understanding.js";
import { normalizeIntent } from "../src/assistant-intent.js";
import { menuRecords } from "../src/record-menu.js";

test("bare task batches preserve all activities without interpreting questions, examples or references as new tasks", () => {
  assert.deepEqual(parseBareTasks("ללכת לספר, לקנות חלב; לדבר עם עורך הדין"), {
    type: "add-items", listName: "משימות", items: ["ללכת לספר", "לקנות חלב", "לדבר עם עורך הדין"],
  });
  for (const text of ["שלום", "מה הלו״ז?", "לקנות חלב?", "לדוגמה ללכת לספר",
    "אל תוסיף לקנות חלב", "לשנות את המשימה", "לעשות את זה", "ללכת לספר מה דעתך",
    "ללכת לספר כבר לא צריך", "לקנות חלב סיימתי", "לדבר עם עורך הדין - בוצע"]) {
    assert.equal(parseBareTasks(text), null, text);
  }
});

test("semantic targets never cross owners, guess among duplicates, or use a stale view", () => {
  const store = { lists: {
    a: { משימות: [{ id: "first", text: "לדבר עם עורך הדין", checked: false },
      { id: "second", text: "ללכת לספר", checked: false }] },
    b: { משימות: [{ id: "private", text: "לדבר עם עורך הדין", checked: false }] },
  }, recordViews: {}, lastListActions: {}, reminders: [] };
  assert.equal(bindItemIntent(store, "a", { type: "mark-item", itemText: "עורך הדין" }).itemId, "first");
  assert.equal(bindItemIntent(store, "a", { type: "remove-item", itemText: "הספר" }).itemId, "second");
  store.lists.a.משימות.push({ id: "third", text: "לפגוש את עורך הדין", checked: false });
  assert.match(bindItemIntent(store, "a", { type: "remove-item", itemText: "עורך הדין" }).response, /כמה משימות/u);
  store.recordViews.a = { key: "stale" };
  store.lastListActions.a = { listName: "משימות" };
  assert.match(bindItemIntent(store, "a", { type: "remove-item", itemText: "זה" }).response, /ברשימה הפתוחה/u);
  const record = menuRecords(store, "a", "s").find(item => item.id === "second");
  store.recordViews.a = { key: record.key };
  assert.equal(bindItemIntent(store, "a", { type: "remove-item", itemText: "זה" }).itemId, "second");
  assert.equal(bindItemIntent(store, "unknown", { type: "mark-item", itemText: "עורך הדין" }).type, undefined);
});

test("natural removal matches committee spelling variants without AI, preserves completed history and is owner-scoped", () => {
  const store = { lists: {
    a: { מטרות: [{ id: "open", text: "לאסוף וועד", checked: false },
      { id: "history", text: "לאסוף ועד", checked: true }] },
    b: { משימות: [{ id: "foreign", text: "לאסוף ועד", checked: false }] },
  }, reminders: [], recordViews: {}, lastListActions: {} };
  const intent = parseNaturalTaskAction("תוריד לאסוף ועד");
  assert.equal(intent.type, "remove-item");
  assert.equal(bindItemIntent(store, "a", intent, "תוריד לאסוף ועד").itemId, "open");
  assert.equal(bindItemIntent(store, "a", { ...intent, listName: "משימות" }, "תוריד לאסוף ועד").itemId, "open");
  assert.equal(bindItemIntent(store, "a", { ...intent, itemText: "איסוף" }, "תוריד איסוף").type, undefined);
  for (const text of ["אל תוריד לאסוף ועד", "איך למחוק לאסוף ועד?", "תוריד לאסוף ועד?",
    "תוריד את כל התזכורות", "תמחק את הרשימה"]) {
    assert.equal(parseNaturalTaskAction(text), null, text);
  }
});

test("task edit intent is accepted by the real model-output validator", () => {
  const parsed = normalizeIntent({ type: "update-item", itemText: "חלב", text: "לקנות לחם" });
  assert.equal(parsed.type, "update-item");
  assert.equal(parsed.text, "לקנות לחם");
});
