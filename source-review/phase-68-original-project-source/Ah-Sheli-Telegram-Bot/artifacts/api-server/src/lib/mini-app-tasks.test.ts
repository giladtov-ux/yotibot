import test from "node:test";
import assert from "node:assert/strict";
import { openTasksFromState } from "./mini-app-tasks";

test("open tasks exclude completed items and other owners without mutating history", () => {
  const state = { lists: {
    owner: {
      משימות: [{ id: "open", text: "open", checked: false }, { id: "done", text: "done", checked: true }],
      "מטרות מתמשכות": [{ id: "goal", text: "goal", checked: false }],
      קניות: [{ id: "milk", text: "milk", checked: false }],
    },
    other: { משימות: [{ id: "private", text: "private", checked: false }] },
  } };
  const before = JSON.stringify(state);
  const result = openTasksFromState(state, "owner");
  assert.equal(result.count, 2);
  assert.deepEqual(result.tasks.map(item => item.id), ["open", "goal"]);
  assert.ok(result.tasks.every(item => item.status === "open" && item.checked === false));
  assert.equal(JSON.stringify(state), before);
  state.lists.owner.משימות[0].checked = true;
  assert.deepEqual(openTasksFromState(state, "owner").tasks.map(item => item.id), ["goal"]);
  state.lists.owner["מטרות מתמשכות"] = [];
  assert.deepEqual(openTasksFromState(state, "owner"), { tasks: [], count: 0 });
  assert.deepEqual(openTasksFromState(state, "unknown"), { tasks: [], count: 0 });
});
