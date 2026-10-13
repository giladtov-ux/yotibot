import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { completionEncouragement, completionEncouragements } from "../src/conversation-style.js";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-encouragement-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ createEmptyStore }, { handleText, handleAssistantIntent }] = await Promise.all([
  import("../src/store.js"), import("../src/commands.js"),
]);
after(() => rm(directory, { recursive: true, force: true }));

test("task completion replies warmly after saving, while reopening remains unchanged", async () => {
  const store = createEmptyStore();
  store.lists.owner = { משימות: [{ id: "task", text: "להתקשר לבנק", checked: false }] };
  const completed = await handleText(store, "owner", "/done משימות | 1");
  assert.ok(completionEncouragements.some(text => completed.startsWith(text)));
  assert.match(completed, /להתקשר לבנק/u);
  assert.equal(store.lists.owner.משימות[0].checked, true);
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.equal(saved.lists.owner.משימות[0].checked, true);
  const reopened = await handleText(store, "owner", "/done משימות | 1");
  assert.equal(reopened, "החזרתי את “להתקשר לבנק” לרשימה.");
  assert.equal(store.lists.owner.משימות[0].checked, false);
});

test("named-item completion uses the same encouragement without touching reminders", async () => {
  const store = createEmptyStore();
  store.lists.owner = { משימות: [{ id: "task", text: "להתקשר לבנק", checked: false }] };
  store.reminders = [{ id: "event", chatId: "owner", text: "פגישה", dueAt: 4070941200000 }];
  const before = structuredClone(store.reminders);
  const reply = await handleAssistantIntent(store, "owner", {
    type: "mark-item", listName: "משימות", itemText: "להתקשר לבנק",
  });
  assert.ok(completionEncouragements.some(text => reply.startsWith(text)));
  assert.equal(store.lists.owner.משימות[0].checked, true);
  assert.deepEqual(store.reminders, before);
  const missing = await handleAssistantIntent(store, "owner", {
    type: "mark-item", listName: "משימות", itemText: "משימה שלא קיימת",
  });
  assert.ok(!completionEncouragements.some(text => missing.includes(text)));
});

test("encouragement varies without repeating the preceding response", () => {
  let previous = completionEncouragement();
  for (let index = 0; index < 100; index++) {
    const next = completionEncouragement();
    assert.ok(completionEncouragements.includes(next));
    assert.notEqual(next, previous);
    previous = next;
  }
});
