import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-reminder-state-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, loadStore, saveStore, setReminderPersistence,
  getChatReminders } = await import("../src/store.js");
const { handleText, handleAssistantIntent } = await import("../src/commands.js");
const { scheduleDailyReminders } = await import("../src/schedule-reminders.js");
const { scheduleIntervalReminder } = await import("../src/reminder-intervals.js");
const { createReminderWorker } = await import("../src/reminder-worker.js");
after(() => rm(directory, { recursive: true, force: true }));

const reminder = { id: "synthetic-existing", chatId: "owner",
  text: "תזכורת לבדיקה", dueAt: Date.UTC(2099, 0, 1), createdAt: 1 };
const pending = { type: "reminder", text: "פעילות לבדיקה",
  date: "2099-01-02", hour: null, minute: null };
const complete = { type: "reminder", text: "פעילות חדשה לבדיקה",
  date: "2099-01-03", hour: 10, minute: 0 };
function fixture(withPending = false) {
  const store = createEmptyStore();
  store.reminders = [{ ...reminder }, { ...reminder, id: "synthetic-other", chatId: "other" }];
  store.lists.owner = { "בדיקה": [{ id: "synthetic-item", text: "10:00 פריט", checked: false }] };
  store.pendingListActions.other = { type: "add-items", items: ["פריט סינתטי"] };
  store.pendingActions.other = { ...pending, text: "בקשה אחרת" };
  if (withPending) store.pendingActions.owner = { ...pending };
  return store;
}
const snapshot = store => JSON.parse(JSON.stringify(store));

// Fail the actual file persistence, without connecting to a database or using
// the project's data directory. This also fails pending-only saves.
async function failedWrite(store, operation) {
  await saveStore(store);
  const before = snapshot(store);
  const backup = `${directory}-backup`;
  await rename(directory, backup);
  await writeFile(directory, "synthetic I/O blocker");
  try {
    await assert.rejects(operation(store), /EEXIST|ENOTDIR/);
    assert.deepEqual(snapshot(store), before);
    assert.deepEqual(getChatReminders(store, "owner"), [reminder]);
  } finally {
    await rm(directory, { force: true });
    await rename(backup, directory);
  }
  assert.deepEqual(snapshot(await loadStore()), before);
  // An unrelated later save must not resurrect any rejected mutation.
  store.lastUpdateId = 17;
  await saveStore(store);
  assert.deepEqual(snapshot(await loadStore()), { ...before, lastUpdateId: 17 });
}

test("failed reminder creation, cancellation and batch/interval writes keep durable state", async () => {
  const operations = [
    store => handleText(store, "owner", "/remind 2099-01-03 10:00 | בדיקה"),
    store => handleText(store, "owner", "תזכיר לי בתאריך 2099-01-03 בשעה 10:00 פעילות חדשה"),
    store => handleAssistantIntent(store, "owner", complete),
    store => handleText(store, "owner", "/cancelreminder 1"),
    store => handleAssistantIntent(store, "owner", { type: "cancel-reminder-number", position: 1 }),
    store => handleAssistantIntent(store, "owner", { type: "cancel-reminder", description: reminder.text }),
    store => scheduleDailyReminders(store, "owner", [
      { text: "פעילות א", date: "2099-01-03", hour: 10, minute: 0 },
      { text: "פעילות ב", date: "2099-01-03", hour: 11, minute: 0 },
    ]),
    store => scheduleIntervalReminder(store, "owner", {
      text: "פעילות חוזרת", intervalMinutes: 2, repeatCount: 3,
    }),
  ];
  for (const operation of operations) await failedWrite(fixture(), operation);
});

test("failed pending creation, replacement, cancellation, edits and completion retain old context", async () => {
  await failedWrite(fixture(), store => handleAssistantIntent(store, "owner", pending));
  await failedWrite(fixture(), store => handleAssistantIntent(store, "owner", {
    ...pending, text: "", hour: 10,
  }));
  const operations = [
    store => handleText(store, "owner", "ביטול"),
    store => handleAssistantIntent(store, "owner", { type: "answer" }, "ביטול"),
    store => handleText(store, "owner", "תזכיר לי משהו חדש"),
    store => handleAssistantIntent(store, "owner", { ...pending, text: "תחליף" }),
    store => handleText(store, "owner", "2099-01-04"),
    store => handleText(store, "owner", "10:00"),
    store => handleAssistantIntent(store, "owner", { type: "reminder", hour: 10 }),
    store => handleText(store, "owner", "תזכיר לי בתאריך 2099-01-03 בשעה 10:00 פעילות חדשה"),
  ];
  for (const operation of operations) await failedWrite(fixture(true), operation);
  const missingText = fixture(true);
  missingText.pendingActions.owner = { ...pending, text: "", date: null };
  await failedWrite(missingText, store => handleText(store, "owner", "פעילות סינתטית"));
});

test("an in-flight reminder is invisible, including when its persister rejects", async () => {
  for (const fail of [true, false]) {
    const store = fixture(true);
    await saveStore(store);
    const before = snapshot(store);
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    setReminderPersistence(async () => {
      entered();
      await gate;
      if (fail) throw new Error("synthetic reminder persistence failure");
    }, store.reminders);
    try {
      const writing = handleText(store, "owner", "10:00");
      // Attach rejection handling before releasing the failing write.
      const outcome = fail
        ? assert.rejects(writing, /synthetic reminder persistence failure/) : writing;
      await started;
      assert.deepEqual(snapshot(store), before);
      assert.deepEqual(snapshot(await loadStore()), before);
      release();
      await outcome;
      if (fail) assert.deepEqual(snapshot(store), before);
      else {
        assert.equal(store.reminders.length, 3);
        assert.equal(store.pendingActions.owner, undefined);
      }
      assert.deepEqual(snapshot(await loadStore()), snapshot(store));
    } finally {
      release?.();
      setReminderPersistence(null);
    }
  }
});

test("a due but unconfirmed reminder cannot be picked up by the worker", async () => {
  const store = fixture();
  await saveStore(store);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  setReminderPersistence(async () => {
    entered();
    await gate;
    throw new Error("synthetic persistence rejection");
  }, store.reminders);
  const worker = createReminderWorker(store, {
    sendMessage: async () => assert.fail("No Telegram send is allowed"),
  }, "owner", () => {}, async () => assert.fail("No due reminder should be persisted"));
  try {
    // Deliberately overdue synthetic candidate, so visibility alone decides
    // whether the worker could pick it up; no real clock wait or network.
    const writing = scheduleIntervalReminder(store, "owner", {
      text: "תזכורת שלא אושרה", intervalMinutes: 2,
    }, Date.now() - 600_000);
    const rejected = assert.rejects(writing, /synthetic persistence rejection/);
    await started;
    assert.equal((await worker()).sent, 0);
    release();
    await rejected;
    assert.equal((await worker()).sent, 0);
    assert.deepEqual(snapshot(await loadStore()), snapshot(store));
  } finally {
    release?.();
    setReminderPersistence(null);
  }
});

test("successful pending edits, completion and cancellation survive restart without affecting lists", async () => {
  let store = fixture();
  const lists = snapshot(store).lists;
  const pendingLists = snapshot(store).pendingListActions;
  await handleAssistantIntent(store, "owner", { ...pending, date: null });
  store = await loadStore();
  assert.equal(store.pendingActions.owner.date, null);
  await handleText(store, "owner", "2099-01-04");
  store = await loadStore();
  assert.equal(store.pendingActions.owner.date, "2099-01-04");
  await handleText(store, "owner", "10:00");
  store = await loadStore();
  assert.equal(store.pendingActions.owner, undefined);
  assert.equal(store.reminders.length, 3);
  await handleText(store, "owner", "/cancelreminder 1");
  store = await loadStore();
  assert.equal(store.reminders.some(item => item.id === reminder.id), false);
  await handleAssistantIntent(store, "owner", pending);
  await handleText(store, "owner", "ביטול");
  store = await loadStore();
  assert.equal(store.pendingActions.owner, undefined);
  assert.deepEqual(snapshot(store).lists, lists);
  assert.deepEqual(snapshot(store).pendingListActions, pendingLists);
  assert.deepEqual(store.pendingActions.other, { ...pending, text: "בקשה אחרת" });
});
