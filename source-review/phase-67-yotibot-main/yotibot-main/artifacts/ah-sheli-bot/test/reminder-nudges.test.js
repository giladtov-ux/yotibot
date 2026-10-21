import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NUDGE_INTERVAL_MS, MAX_NUDGES_PER_OCCURRENCE } from "../src/reminder-nudges.js";
import { handleReminderCallback } from "../src/reminder-actions.js";

const directory = await mkdtemp(join(tmpdir(), "ah-sheli-nudges-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, saveStore, loadStore } = await import("../src/store.js");
const { createReminderWorker } = await import("../src/reminder-worker.js");
after(() => rm(directory, { recursive: true, force: true }));

const BASE = 1_800_000_000_000;
function fixture(t, repeat = false) {
  t.mock.timers.enable({ apis: ["Date"], now: BASE });
  const store = createEmptyStore();
  const reminder = { id: "reminder", chatId: "123", text: "להתקשר לבנק", dueAt: BASE,
    ...(repeat ? { repeatEveryMs: 3_600_000, remainingOccurrences: 3 } : {}) };
  store.reminders = [reminder];
  store.lists["123"] = { משימות: [{ id: "task", text: "לשלם חשבון", checked: false }] };
  const messages = [];
  const calls = [];
  const telegram = {
    async sendMessage(chatId, text, options) {
      const message = { message_id: messages.length + 1, chatId, text, options };
      messages.push(message);
      return message;
    },
    async call(method, payload) { calls.push({ method, payload }); return true; },
  };
  const worker = createReminderWorker(store, telegram, "123", () => {});
  const query = (index, action = "d") => {
    const message = messages[index];
    return {
      id: "callback", from: { id: 123 },
      data: message.options.reply_markup.inline_keyboard[0][action === "d" ? 0 : 1].callback_data,
      message: { message_id: message.message_id, text: message.text,
        from: { is_bot: true }, chat: { id: 123, type: "private" } },
    };
  };
  return { store, reminder, messages, telegram, worker, query, calls };
}

test("nudges start at five minutes, repeat every five minutes, and survive restart", async t => {
  const f = fixture(t);
  await f.worker();
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS - 1);
  await f.worker();
  assert.equal(f.messages.length, 1);
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1].text, /הספקת לטפל בזה/u);
  assert.match(f.messages[1].text, /להתקשר לבנק/u);
  const originalData = f.query(0).data;
  assert.ok(f.query(1).data.startsWith(`${originalData}:`));
  assert.ok(f.messages[1].options.reply_markup.inline_keyboard[0].every(button =>
    Buffer.byteLength(button.callback_data) <= 64));
  await f.worker();
  assert.equal(f.messages.length, 2);
  const reloaded = await loadStore();
  const restarted = createReminderWorker(reloaded, f.telegram, "123", () => {});
  t.mock.timers.setTime(BASE + 2 * NUDGE_INTERVAL_MS - 1);
  await restarted();
  assert.equal(f.messages.length, 2);
  t.mock.timers.setTime(BASE + 2 * NUDGE_INTERVAL_MS);
  await restarted();
  assert.equal(f.messages.length, 3);
  assert.equal(reloaded.reminders[0].dueAt, BASE);
  assert.equal(reloaded.lists["123"].משימות[0].checked, false);
});

test("completion on either the original or nudge stops further nudges", async t => {
  for (const messageIndex of [0, 1]) {
    const f = fixture(t);
    await f.worker();
    t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
    await f.worker();
    await handleReminderCallback(f.store, f.telegram, f.query(messageIndex), { ownerChatId: "123" });
    assert.equal(f.messages.length, 3, "one encouragement follows completion");
    assert.ok(f.calls.some(call => call.method === "editMessageReplyMarkup"
      && call.payload.message_id === f.messages[1 - messageIndex].message_id
      && call.payload.reply_markup.inline_keyboard.length === 0));
    t.mock.timers.setTime(BASE + 3 * NUDGE_INTERVAL_MS);
    await f.worker();
    await handleReminderCallback(f.store, f.telegram, f.query(1 - messageIndex), { ownerChatId: "123" });
    assert.equal(f.messages.length, 3, "another button cannot complete or encourage twice");
    t.mock.timers.reset();
  }
});

test("deletion from a nudge cancels the reminder without changing lists", async t => {
  const f = fixture(t);
  await f.worker();
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  await handleReminderCallback(f.store, f.telegram, f.query(1, "x"), { ownerChatId: "123" });
  t.mock.timers.setTime(BASE + 2 * NUDGE_INTERVAL_MS);
  await f.worker();
  assert.equal(f.messages.length, 2);
  assert.equal(f.store.reminders.length, 0);
  assert.equal(f.store.lists["123"].משימות.length, 1);
});

test("nudges never advance or decrement the scheduled recurring series", async t => {
  const f = fixture(t, true);
  await f.worker();
  const dueAt = f.reminder.dueAt;
  const remaining = f.reminder.remainingOccurrences;
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  assert.equal(f.reminder.dueAt, dueAt);
  assert.equal(f.reminder.remainingOccurrences, remaining);
  await handleReminderCallback(f.store, f.telegram, f.query(1), { ownerChatId: "123" });
  assert.equal(f.store.reminders[0].dueAt, dueAt);
  assert.equal(f.store.reminders[0].remainingOccurrences, remaining);
  t.mock.timers.setTime(dueAt);
  await f.worker();
  assert.equal(f.messages.length, 4, "the next scheduled occurrence still sends");
});

test("a nudge with a lost send response completes durably after restart without replay", async t => {
  const f = fixture(t);
  await f.worker();
  const send = f.telegram.sendMessage;
  f.telegram.sendMessage = async (...args) => {
    await send(...args);
    throw new Error("synthetic response lost");
  };
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  const reloaded = await loadStore();
  const restarted = createReminderWorker(reloaded, f.telegram, "123", () => {});
  t.mock.timers.setTime(BASE + 3 * NUDGE_INTERVAL_MS);
  await restarted();
  assert.equal(f.messages.length, 2);
  f.telegram.sendMessage = send;
  const result = await handleReminderCallback(reloaded, f.telegram, f.query(1), { ownerChatId: "123" });
  assert.deepEqual(result, { action: "done" });
  const completed = await loadStore();
  const completedWorker = createReminderWorker(completed, f.telegram, "123", () => {});
  t.mock.timers.setTime(BASE + 5 * NUDGE_INTERVAL_MS);
  await completedWorker();
  await restarted();
  assert.equal(f.messages.length, 3);
  assert.equal(Object.values(reloaded.reminders[0].telegramDeliveries)[0].state, "done");
  assert.equal(Object.values(completed.reminders[0].telegramDeliveries)[0].state, "done");
  assert.deepEqual(await handleReminderCallback(completed, f.telegram, f.query(0),
    { ownerChatId: "123" }), { alreadyDone: true });
  assert.deepEqual(await handleReminderCallback(completed, f.telegram, f.query(1),
    { ownerChatId: "123" }), { alreadyDone: true });
  assert.equal(f.messages.length, 3);
});

test("a definite nudge rejection retries after backoff; foreign owners are never nudged", async t => {
  const f = fixture(t);
  await f.worker();
  const send = f.telegram.sendMessage;
  let attempts = 0;
  f.telegram.sendMessage = async (...args) => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error("synthetic rejection"), { deliveryRejected: true });
    return send(...args);
  };
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  await f.worker();
  assert.equal(attempts, 1);
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS + 60_000);
  await f.worker();
  assert.equal(attempts, 2);
  f.store.reminders[0].chatId = "456";
  t.mock.timers.setTime(BASE + 3 * NUDGE_INTERVAL_MS);
  await f.worker();
  assert.equal(attempts, 2);
});

test("failed persistence prevents the nudge; uncertain confirmation saving fences in-memory retries", async t => {
  const f = fixture(t);
  await f.worker();
  let writes = 0;
  const persist = async store => {
    writes++;
    if (writes === 1) throw new Error("synthetic write rejected");
    await saveStore(store);
    if (writes === 3) throw Object.assign(new Error("synthetic commit response lost"), {
      code: "STATE_COMMIT_UNKNOWN",
    });
  };
  const worker = createReminderWorker(f.store, f.telegram, "123", () => {}, persist);
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await assert.rejects(worker(), /write rejected/u);
  assert.equal(f.messages.length, 1);
  await worker();
  assert.equal(f.messages.length, 2);
  t.mock.timers.setTime(BASE + 3 * NUDGE_INTERVAL_MS);
  await worker();
  assert.equal(f.messages.length, 2);
});

test("a copied nudge callback from an unbound message cannot complete a reminder", async t => {
  const f = fixture(t);
  await f.worker();
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  const query = f.query(1);
  query.message.message_id = 999;
  assert.deepEqual(await handleReminderCallback(f.store, f.telegram, query, { ownerChatId: "123" }),
    { ignored: true });
  assert.equal(Object.values(f.store.reminders[0].telegramDeliveries)[0].state, "sent");
});

test("legacy receipts with more than 127 follow-ups stop nudging but remain actionable", async t => {
  const f = fixture(t);
  await f.worker();
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  const receipt = Object.values(f.reminder.telegramDeliveries)[0];
  receipt.nagMessageIds = Array.from({ length: 130 }, (_, index) => index + 2);
  await saveStore(f.store);
  const restored = await loadStore();
  const restarted = createReminderWorker(restored, f.telegram, "123", () => {});
  t.mock.timers.setTime(BASE + 140 * NUDGE_INTERVAL_MS);
  await restarted();
  assert.equal(f.messages.length, 2, "legacy history cannot bypass the new limit");
  assert.deepEqual(await handleReminderCallback(restored, f.telegram, f.query(1),
    { ownerChatId: "123" }), { action: "done" });
  await restarted();
  assert.equal(f.messages.length, 3, "only one encouragement, no more nudges");
});

test("only three five-minute nudges send, and the limit survives restart without closing the task", async t => {
  const f = fixture(t);
  const listsBefore = JSON.stringify(f.store.lists);
  await f.worker();
  assert.equal(MAX_NUDGES_PER_OCCURRENCE, 3);
  for (let index = 1; index <= 3; index++) {
    t.mock.timers.setTime(BASE + index * NUDGE_INTERVAL_MS - 1);
    await f.worker();
    assert.equal(f.messages.length, index);
    t.mock.timers.setTime(BASE + index * NUDGE_INTERVAL_MS);
    await f.worker();
    assert.equal(f.messages.length, index + 1);
  }
  const restored = await loadStore();
  const restarted = createReminderWorker(restored, f.telegram, "123", () => {});
  for (const minutes of [20, 25, 60, 1_440]) {
    t.mock.timers.setTime(BASE + minutes * 60_000);
    await restarted();
    await restarted();
    assert.equal(f.messages.length, 4, "the original plus three follow-ups only");
  }
  const receipt = Object.values(restored.reminders[0].telegramDeliveries)[0];
  assert.equal(receipt.state, "sent", "exhaustion must not complete the occurrence");
  assert.equal(receipt.nagMessageIds.length, 3);
  assert.equal(restored.reminders[0].dueAt, BASE);
  assert.equal(JSON.stringify(restored.lists), listsBefore);
});

test("Done on any copy still completes the occurrence after its three nudges are exhausted", async t => {
  for (const messageIndex of [0, 1, 2, 3]) {
    const f = fixture(t);
    await f.worker();
    for (let index = 1; index <= 3; index++) {
      t.mock.timers.setTime(BASE + index * NUDGE_INTERVAL_MS);
      await f.worker();
    }
    t.mock.timers.setTime(BASE + 4 * NUDGE_INTERVAL_MS);
    await f.worker();
    assert.equal(f.messages.length, 4);
    assert.deepEqual(await handleReminderCallback(f.store, f.telegram, f.query(messageIndex),
      { ownerChatId: "123" }), { action: "done" });
    const restored = await loadStore();
    assert.equal(Object.values(restored.reminders[0].telegramDeliveries)[0].state, "done");
    t.mock.timers.setTime(BASE + 10 * NUDGE_INTERVAL_MS);
    await createReminderWorker(restored, f.telegram, "123", () => {})();
    assert.equal(f.messages.length, 5, "only one encouragement, without another reminder");
    t.mock.timers.reset();
  }
});

test("a recurring series keeps its schedule and gives each new occurrence its own three-nudge limit", async t => {
  const f = fixture(t, true);
  await f.worker();
  const nextDueAt = f.reminder.dueAt;
  const remaining = f.reminder.remainingOccurrences;
  for (let index = 1; index <= 4; index++) {
    t.mock.timers.setTime(BASE + index * NUDGE_INTERVAL_MS);
    await f.worker();
  }
  assert.equal(f.messages.length, 4);
  assert.equal(f.reminder.dueAt, nextDueAt);
  assert.equal(f.reminder.remainingOccurrences, remaining);
  t.mock.timers.setTime(nextDueAt);
  await f.worker();
  assert.equal(f.messages.length, 5, "the next scheduled occurrence must still send");
  const nextSeriesDueAt = f.reminder.dueAt;
  for (let index = 1; index <= 4; index++) {
    t.mock.timers.setTime(nextDueAt + index * NUDGE_INTERVAL_MS);
    await f.worker();
  }
  assert.equal(f.messages.length, 8, "three follow-ups for each of two occurrences");
  assert.equal(f.reminder.dueAt, nextSeriesDueAt);
  assert.equal(f.reminder.remainingOccurrences, remaining - 1);
  assert.deepEqual(Object.values(f.reminder.telegramDeliveries).map(receipt =>
    receipt.nagMessageIds.length), [3, 3]);
});

test("a fabricated token or foreign user cannot complete an uncertain nudge", async t => {
  const f = fixture(t);
  await f.worker();
  const send = f.telegram.sendMessage;
  f.telegram.sendMessage = async (...args) => {
    await send(...args);
    throw new Error("synthetic response lost");
  };
  t.mock.timers.setTime(BASE + NUDGE_INTERVAL_MS);
  await f.worker();
  const forged = f.query(1);
  forged.data = `${f.query(0).data}:AAAAAAAAAAAAAAAA`;
  assert.deepEqual(await handleReminderCallback(f.store, f.telegram, forged,
    { ownerChatId: "123" }), { ignored: true });
  const foreign = f.query(1);
  foreign.from.id = 456;
  assert.deepEqual(await handleReminderCallback(f.store, f.telegram, foreign,
    { ownerChatId: "123" }), { denied: true });
  assert.equal(Object.values(f.store.reminders[0].telegramDeliveries)[0].state, "sent");
});
