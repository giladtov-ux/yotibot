import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHmac } from "node:crypto";
const directory = await mkdtemp(join(tmpdir(), "ah-sheli-mini-app-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, saveStore, loadStore } = await import("../src/store.js");
const { applyMiniAppAction, verifyMiniAppRequest } = await import("../src/mini-app-actions.js");
const { occurrenceKey } = await import("../src/reminder-actions.js");
after(() => rm(directory, { recursive: true, force: true }));
const now = Date.parse("2026-10-10T10:30:15Z");
const action = (entity, operation, data = {}) => ({ requestId: randomUUID(), entity, action: operation, ...data });
function fixture() {
  const store = createEmptyStore();
  store.lists["123"] = { קניות: [{ id: "item1", text: "חלב", checked: false }] };
  store.lists["456"] = { קניות: [{ id: "item2", text: "נתון של משתמש אחר", checked: false }] };
  return store;
}
test("goal deadlines survive create/update/reload and do not create calendar reminders", async () => {
  const store = fixture();
  const deadline = Date.parse("2026-10-14T10:00:00Z");
  await applyMiniAppAction(store, "123", action("list", "create", { listName: "מטרות" }), now);
  const create = action("item", "create", { listName: "מטרות", text: "לסיים יעד", dueAt: deadline });
  await applyMiniAppAction(store, "123", create, now);
  assert.equal((await loadStore()).lists["123"]["מטרות"][0].dueAt, deadline);
  assert.equal(store.reminders.length, 0);
  await applyMiniAppAction(store, "123", action("item", "update", {
    listName: "מטרות", id: create.requestId, dueAt: deadline + 86400000,
  }), now);
  assert.equal((await loadStore()).lists["123"]["מטרות"][0].dueAt, deadline + 86400000);
  await applyMiniAppAction(store, "123", action("item", "update", {
    listName: "מטרות", id: create.requestId, dueAt: null,
  }), now);
  assert.equal((await loadStore()).lists["123"]["מטרות"][0].dueAt, null);
  await assert.rejects(applyMiniAppAction(store, "123", action("item", "update", {
    listName: "מטרות", id: create.requestId, dueAt: NaN,
  }), now));
  assert.equal(store.reminders.length, 0);
});
test("list and item CRUD is durable, idempotent and isolated from other users", async () => {
  const store = fixture();
  const other = structuredClone(store.lists["456"]);
  await applyMiniAppAction(store, "123", action("list", "create", { listName: "קישורים" }), now);
  const addition = action("item", "create", { listName: "קישורים", text: "https://example.com" });
  await applyMiniAppAction(store, "123", addition, now);
  await applyMiniAppAction(store, "123", addition, now);
  assert.equal(store.lists["123"]["קישורים"].length, 1);
  await applyMiniAppAction(store, "123", action("item", "complete", { listName: "קישורים", id: addition.requestId }), now);
  assert.equal(store.lists["123"]["קישורים"][0].checked, true);
  assert.deepEqual(store.lists["456"], other);
  await applyMiniAppAction(store, "123", action("list", "delete", { listName: "קישורים" }), now);
  const restored = await loadStore(null);
  assert.ok(!Object.hasOwn(restored.lists["123"], "קישורים"));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.lists["456"])), other);
});
test("foreign IDs cannot mutate someone else's list or reminder", async () => {
  const store = fixture();
  store.reminders.push({ id: "foreign", chatId: "456", text: "פרטי", dueAt: now + 600_000, createdAt: now });
  await saveStore(store);
  const before = JSON.stringify(store);
  await assert.rejects(applyMiniAppAction(store, "123", action("item", "update",
    { listName: "קניות", id: "item2", text: "אסור" }), now));
  await assert.rejects(applyMiniAppAction(store, "123", action("reminder", "complete", { id: "foreign" }), now));
  assert.equal(JSON.stringify(store), before);
});
test("one-time reminder uses Israel wall time including the current minute", async () => {
  const store = fixture();
  const input = action("reminder", "create", { text: "השכמה", date: "2026-10-10", hour: 13, minute: 30 });
  await applyMiniAppAction(store, "123", input, now);
  await applyMiniAppAction(store, "123", input, now);
  assert.equal(store.reminders.length, 1);
  assert.equal(store.reminders[0].dueAt, Math.floor(now / 60_000) * 60_000);
  await assert.rejects(applyMiniAppAction(store, "123", action("reminder", "create",
    { text: "עבר", date: "2026-10-10", hour: 13, minute: 29 }), now));
});
test("weekly creation, completion retry and reload preserve future occurrences", async () => {
  const store = fixture();
  const input = action("reminder", "create", { text: "השכמה לשבת", weekdays: [6], hour: 13, minute: 30 });
  await applyMiniAppAction(store, "123", input, now);
  const original = store.reminders[0].dueAt;
  const completion = action("reminder", "complete", { id: input.requestId });
  await applyMiniAppAction(store, "123", completion, now);
  const next = store.reminders[0].dueAt;
  assert.equal(next - original, 7 * 86_400_000);
  await applyMiniAppAction(store, "123", completion, now);
  assert.equal(store.reminders[0].dueAt, next);
  const restored = await loadStore(null);
  await applyMiniAppAction(restored, "123", completion, now);
  assert.equal(restored.reminders[0].dueAt, next);
  assert.equal(restored.savedSchedules[0].entries[0].reminderId, input.requestId);
});
test("completing a delivered/nudged occurrence does not advance recurrence twice", async () => {
  const store = fixture();
  const due = now - 600_000;
  store.reminders.push({ id: "delivered", chatId: "123", text: "תזכורת", dueAt: now + 60_000,
    createdAt: due, repeatEveryMs: 120_000, remainingOccurrences: 2,
    telegramDeliveries: { [occurrenceKey(due)]: { state: "pending", messageId: 11, nagCount: 2, nagMessageIds: [12, 13] } } });
  await applyMiniAppAction(store, "123", action("reminder", "complete", { id: "delivered" }), now);
  assert.equal(store.reminders[0].dueAt, now + 60_000);
  assert.equal(store.reminders[0].remainingOccurrences, 2);
  assert.equal(store.reminders[0].telegramDeliveries[occurrenceKey(due)].state, "done");
});
test("deleting a weekly series preserves unrelated schedules and lists", async () => {
  const store = fixture();
  const creation = action("reminder", "create", { text: "שבועית", weekdays: [0, 1], hour: 9, minute: 0 });
  await applyMiniAppAction(store, "123", creation, now);
  await applyMiniAppAction(store, "123", action("reminder", "delete", { id: creation.requestId }), now);
  assert.equal(store.reminders.length, 0);
  assert.equal(store.savedSchedules.length, 0);
  assert.equal(store.lists["123"]["קניות"][0].text, "חלב");
});
test("internal worker proof rejects tampering and stale timestamps", () => {
  const token = "synthetic-only";
  const body = { userId: "123", timestamp: now, action: action("list", "create", { listName: "קניות" }) };
  const signature = createHmac("sha256", token).update("AhSheliMiniApp\n").update(JSON.stringify(body)).digest("hex");
  assert.equal(verifyMiniAppRequest(body, signature, token, now), true);
  assert.equal(verifyMiniAppRequest({ ...body, userId: "456" }, signature, token, now), false);
  assert.equal(verifyMiniAppRequest(body, signature, token, now + 31_000), false);
});
test("editing an interval reminder preserves recurrence counts and delivery history", async () => {
  const store = fixture();
  const key = occurrenceKey(now - 120_000);
  store.reminders.push({ id: "interval", chatId: "123", text: "ישן",
    dueAt: now + 120_000, createdAt: now - 600_000, repeatEveryMs: 120_000,
    remainingOccurrences: 3, telegramDeliveries: { [key]: { state: "done", messageId: 11 } } });
  await applyMiniAppAction(store, "123", action("reminder", "update",
    { id: "interval", text: "מעודכן", date: "2026-10-11", hour: 13, minute: 30 }), now);
  assert.equal(store.reminders[0].repeatEveryMs, 120_000);
  assert.equal(store.reminders[0].remainingOccurrences, 3);
  assert.equal(store.reminders[0].telegramDeliveries[key].state, "done");
  const restored = await loadStore(null);
  assert.equal(restored.reminders[0].repeatEveryMs, 120_000);
  assert.equal(restored.reminders[0].telegramDeliveries[key].messageId, 11);
});
