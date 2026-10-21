import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramClient } from "../src/telegram.js";
import { completionEncouragements } from "../src/conversation-style.js";

// Synthetic owner/messages only. Never start a worker or connect to Telegram/DB.
const directory = await mkdtemp(join(tmpdir(), "ah-sheli-buttons-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, saveStore, loadStore, mutateReminderState } = await import("../src/store.js");
const { createReminderWorker } = await import("../src/reminder-worker.js");
const { handleReminderCallback, reminderKeyboard, occurrenceKey,
  createReminderOperationQueue, TELEGRAM_ALLOWED_UPDATES,
  retryReminderMessageUpdates, MESSAGE_UPDATE_MAX_ATTEMPTS,
  MESSAGE_UPDATE_LIFETIME_MS } = await import("../src/reminder-actions.js");
const { requestMetadata } = await import("../src/interrupted-requests.js");
after(() => rm(directory, { recursive: true, force: true }));

function fixture({ repeat = false, weekly = false } = {}) {
  const store = createEmptyStore();
  const reminder = { id: "synthetic-reminder", chatId: "123", text: "השכמה",
    dueAt: Date.now() - 1000, createdAt: 1,
    ...(repeat ? { repeatEveryMs: 120_000, remainingOccurrences: 3 } : {}) };
  store.reminders = [reminder, { ...reminder, id: "other", chatId: "456" }];
  store.lists["123"] = { קניות: [{ id: "item", text: "חלב", checked: false }] };
  if (weekly) store.savedSchedules = [{ id: "weekly", chatId: "123",
    source: "ימי א׳–ה׳, 07:30 השכמה",
    entries: [{ reminderId: reminder.id, text: "השכמה", weekdays: [0, 1, 2, 3, 4],
      hour: 7, minute: 30 }] }];
  const calls = [];
  const sent = [];
  const telegram = {
    call: async (method, payload) => { calls.push({ method, payload }); return true; },
    sendMessage: async (chatId, text, options) => {
      sent.push({ chatId, text, options });
      return { message_id: 11 };
    },
  };
  const worker = createReminderWorker(store, telegram, "123", () => {}, saveStore);
  const callback = (action = "d") => ({
    id: "synthetic-callback", from: { id: 123, is_bot: false },
    data: sent[0].options.reply_markup.inline_keyboard[0][action === "d" ? 0 : 1].callback_data,
    message: { message_id: 11, text: sent[0].text, from: { is_bot: true },
      chat: { id: 123, type: "private" } },
  });
  return { store, worker, callback, telegram, sent, calls, reminder };
}
const owner = { ownerChatId: "123" };
const plain = value => JSON.parse(JSON.stringify(value));

test("real reminder sends native buttons with bounded callback payloads", async () => {
  const f = fixture();
  await f.worker();
  assert.equal(f.sent.length, 1);
  const buttons = f.sent[0].options.reply_markup.inline_keyboard[0];
  assert.deepEqual(buttons.map(button => button.text), ["✅ בוצע!", "🗑️ מחק"]);
  assert.ok(buttons.every(button => Buffer.byteLength(button.callback_data) <= 64));
  assert.ok(reminderKeyboard({ id: "very-long-id".repeat(100), dueAt: Date.now() })
    .inline_keyboard[0].every(button => Buffer.byteLength(button.callback_data) <= 64));
  await f.worker();
  assert.equal(f.sent.length, 1);
});

test("done persists completion, retires buttons and never changes a list", async () => {
  const f = fixture();
  await f.worker();
  const lists = structuredClone(f.store.lists);
  const query = f.callback();
  await handleReminderCallback(f.store, f.telegram, query, owner);
  const receipt = Object.values(f.store.reminders[0].telegramDeliveries)[0];
  assert.equal(receipt.state, "done");
  assert.ok(receipt.completedAt);
  assert.deepEqual(plain(f.store.lists), lists);
  assert.equal(Object.values((await loadStore()).reminders[0].telegramDeliveries)[0].state, "done");
  const edit = f.calls.find(call => call.method === "editMessageText");
  assert.match(edit.payload.text, /✅ בוצע!$/u);
  assert.equal(f.sent[1].chatId, "123");
  assert.ok(completionEncouragements.some(text => f.sent[1].text.startsWith(`${text}\n\n`)));
  assert.match(f.sent[1].text, /כרגע אין עוד תזכורת בתור/u);
  assert.equal(f.calls.find(call => call.method === "answerCallbackQuery").payload.text,
    f.sent[1].text.split("\n\n")[0]);
  assert.deepEqual(edit.payload.reply_markup.inline_keyboard, []);
  const before = structuredClone(f.store);
  assert.deepEqual(await handleReminderCallback(f.store, f.telegram, query, owner), { alreadyDone: true });
  assert.equal(f.sent.length, 2, "a repeated click must not send encouragement again");
  assert.deepEqual(plain(f.store), before);
});

test("delete removes only the selected reminder and its Telegram message", async () => {
  const f = fixture();
  await f.worker();
  const beforeLists = structuredClone(f.store.lists);
  await handleReminderCallback(f.store, f.telegram, f.callback("x"), owner);
  assert.deepEqual(f.store.reminders.map(item => item.id), ["other"]);
  assert.deepEqual(plain(f.store.lists), beforeLists);
  assert.ok(f.calls.some(call => call.method === "deleteMessage" && call.payload.message_id === 11));
  assert.deepEqual((await loadStore()).reminders.map(item => item.id), ["other"]);
  assert.deepEqual(await handleReminderCallback(f.store, f.telegram, f.callback("x"), owner),
    { alreadyRemoved: true });
});

test("completion includes the next owner's reminder and Israel time in the same chat reply", async () => {
  const f = fixture({ repeat: true });
  await f.worker();
  const nextDueAt = f.store.reminders[0].dueAt;
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.match(f.sent[1].text, /הבאה בתור: השכמה/u);
  const { formatJerusalemTime } = await import("../src/time.js");
  assert.ok(f.sent[1].text.includes(formatJerusalemTime(nextDueAt)));
  assert.equal(f.store.reminders[0].dueAt, nextDueAt);
  assert.equal(f.sent.length, 2, "encouragement and next reminder share one message");
});

test("completing a long reminder preserves its original text and stays below Telegram's limit", async () => {
  const f = fixture();
  f.reminder.text = "א".repeat(3940) + "✨";
  await f.worker();
  const original = f.sent[0].text;
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  const edit = f.calls.find(call => call.method === "editMessageText");
  assert.equal(edit.payload.text, `${original}\n\n✅ בוצע!`);
  assert.ok(edit.payload.text.length < 4096);
});

test("done on a repeating occurrence preserves its next exact deadline and count", async () => {
  const f = fixture({ repeat: true });
  await f.worker();
  const nextDue = f.store.reminders[0].dueAt;
  assert.match(f.sent[0].text, /מחק.*יבטל גם את ההמשך/u);
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.equal(f.store.reminders[0].dueAt, nextDue);
  assert.equal(f.store.reminders[0].remainingOccurrences, 2);
  assert.equal(f.store.reminders[0].sentAt, undefined);
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.equal(f.store.reminders[0].remainingOccurrences, 2);
});

test("weekly done leaves recurrence intact; delete cancels that entry only", async () => {
  const f = fixture({ weekly: true });
  await f.worker();
  const nextDue = f.store.reminders[0].dueAt;
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.equal(f.store.reminders[0].dueAt, nextDue);
  assert.equal(f.store.savedSchedules[0].entries.length, 1);
  // A fresh delivered occurrence retains the delete option.
  const laterKey = occurrenceKey(nextDue);
  f.store.reminders[0].telegramDeliveries[laterKey] = { state: "sent", messageId: 12 };
  const query = f.callback("x");
  query.data = reminderKeyboard(f.store.reminders[0]).inline_keyboard[0][1].callback_data;
  query.message.message_id = 12;
  await handleReminderCallback(f.store, f.telegram, query, owner);
  assert.equal(f.store.savedSchedules.length, 0);
  assert.equal(f.store.reminders.length, 1);
});

test("forged sender, foreign/group chat, wrong message and unknown occurrence cannot mutate", async () => {
  const f = fixture();
  await f.worker();
  const before = structuredClone(f.store);
  const modifications = [
    q => { q.from.id = 456; },
    q => { q.message.chat.id = 456; },
    q => { q.message.chat.type = "group"; },
    q => { q.message.message_id = 99; },
    q => { q.data = q.data.replace(/:[a-z0-9]+$/u, ":1"); },
    q => { q.data = "arbitrary"; },
    q => { q.message.from.is_bot = false; },
  ];
  for (const modify of modifications) {
    const query = f.callback("x");
    modify(query);
    await handleReminderCallback(f.store, f.telegram, query, owner);
    assert.deepEqual(plain(f.store), before);
  }
  assert.equal(f.calls.filter(call => call.method === "deleteMessage").length, 0);
});

test("a rejected persistence leaves state and buttons unchanged for a fresh retry", async () => {
  const f = fixture();
  await f.worker();
  const before = structuredClone(f.store);
  const commit = (store, mutate) => mutateReminderState(store, candidate => {
    mutate(candidate);
    throw new Error("synthetic storage failure");
  });
  await assert.rejects(handleReminderCallback(f.store, f.telegram, f.callback(), { ...owner, commit }),
    /synthetic storage/u);
  assert.deepEqual(plain(f.store), before);
  assert.equal(f.calls.some(call => call.method.startsWith("edit") || call.method === "deleteMessage"), false);
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.equal(Object.values(f.store.reminders[0].telegramDeliveries)[0].state, "done");
});

test("old Telegram deletion refusal falls back to an empty-keyboard status message", async () => {
  const f = fixture();
  await f.worker();
  const originalCall = f.telegram.call;
  f.telegram.call = async (method, payload) => {
    if (method === "deleteMessage") throw new Error("synthetic Telegram refusal");
    return originalCall(method, payload);
  };
  await handleReminderCallback(f.store, f.telegram, f.callback("x"), owner);
  const edit = f.calls.find(call => call.method === "editMessageText");
  assert.equal(edit.payload.text, "🗑️ התזכורת נמחקה.");
  assert.deepEqual(edit.payload.reply_markup.inline_keyboard, []);
  assert.equal(f.store.reminders.length, 1);
});

test("a UI failure cannot revert a committed completion or apply it twice", async () => {
  const f = fixture({ repeat: true });
  await f.worker();
  f.telegram.call = async () => { throw new Error("synthetic network failure"); };
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  const receipt = Object.values(f.store.reminders[0].telegramDeliveries)[0];
  assert.equal(receipt.state, "done");
  const count = f.store.reminders[0].remainingOccurrences;
  f.telegram.call = async () => true;
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.equal(f.store.reminders[0].remainingOccurrences, count);
});

test("failed completion UI survives restart and worker retires every copy without replaying actions", async () => {
  const f = fixture({ repeat: true });
  await f.worker();
  const receipt = Object.values(f.store.reminders[0].telegramDeliveries)[0];
  receipt.nagMessageIds = [12, 13];
  const deadline = f.store.reminders[0].dueAt;
  const query = f.callback();
  const actualKey = Object.keys(f.store.reminders[0].telegramDeliveries)[0];
  f.telegram.call = async () => { throw new Error("synthetic outage"); };
  await handleReminderCallback(f.store, f.telegram, query, owner);
  const restarted = await loadStore();
  const updates = restarted.reminders[0].telegramDeliveries[actualKey].messageUpdates;
  assert.equal(updates.length, 3);
  assert.ok(updates.every(update => update.attempts === 1 && update.status === "pending"));
  const sentCount = f.sent.length;
  const calls = [];
  f.telegram.call = async (method, payload) => { calls.push({ method, payload }); return true; };
  // Simulate the due retry clock without sleeping or touching the real worker.
  for (const update of updates) update.nextAttemptAt = 0;
  await saveStore(restarted);
  const worker = createReminderWorker(restarted, f.telegram, "123", () => {}, saveStore);
  await createReminderOperationQueue()(worker);
  assert.deepEqual(calls.map(call => [call.method, call.payload.message_id]), [
    ["editMessageText", 11], ["editMessageReplyMarkup", 12], ["editMessageReplyMarkup", 13],
  ]);
  assert.ok(calls.every(call => call.payload.chat_id === "123"
    && call.payload.reply_markup.inline_keyboard.length === 0));
  assert.equal(restarted.reminders[0].dueAt, deadline);
  assert.equal(restarted.reminders[0].remainingOccurrences, 2);
  assert.equal(f.sent.length, sentCount, "no reminders or encouragements are resent");
  await worker();
  assert.equal(calls.length, 3);
  assert.ok(Object.values((await loadStore()).reminders[0].telegramDeliveries)[0]
    .messageUpdates.every(update => update.status === "updated"));
});

test("deleted series keeps UI-only receipts across restart and cleans all delivered occurrences", async () => {
  const f = fixture({ repeat: true });
  await f.worker();
  const firstKey = Object.keys(f.store.reminders[0].telegramDeliveries)[0];
  f.store.reminders[0].telegramDeliveries[firstKey].nagMessageIds = [12];
  f.store.reminders[0].telegramDeliveries["1"] = { state: "sent", messageId: 10 };
  f.telegram.call = async () => { throw new Error("synthetic outage"); };
  await handleReminderCallback(f.store, f.telegram, f.callback("x"), owner);
  assert.deepEqual(f.store.reminders.map(item => item.id), ["other"]);
  const restarted = await loadStore();
  assert.equal(restarted.telegramDeletionReceipts.length, 1);
  assert.equal(restarted.reminders.some(item => item.id === "synthetic-reminder"), false);
  const jobs = Object.values(restarted.telegramDeletionReceipts[0].telegramDeliveries)
    .flatMap(receipt => receipt.messageUpdates);
  assert.ok(jobs.every(job => job.attempts === 1));
  const sentCount = f.sent.length;
  const removed = [];
  f.telegram.call = async (method, payload) => { removed.push([method, payload.message_id]); };
  await retryReminderMessageUpdates(restarted, f.telegram, {
    ...owner, now: () => Math.max(...jobs.map(job => job.nextAttemptAt)),
  });
  assert.deepEqual(removed, [["deleteMessage", 10], ["deleteMessage", 11], ["deleteMessage", 12]]);
  assert.equal(f.sent.length, sentCount);
  assert.deepEqual((await loadStore()).reminders.map(item => item.id), ["other"]);
});

test("UI retry backoff, lifetime and attempt budget remain bounded through reloads", async () => {
  const f = fixture();
  await f.worker();
  const start = Date.now();
  f.telegram.call = async () => { throw new Error("synthetic outage"); };
  await handleReminderCallback(f.store, f.telegram, f.callback(), { ...owner, now: () => start });
  let store = await loadStore();
  const job = () => Object.values(store.reminders[0].telegramDeliveries)[0].messageUpdates[0];
  assert.equal(await retryReminderMessageUpdates(store, f.telegram, {
    ...owner, now: () => job().nextAttemptAt - 1,
  }), 0);
  for (let attempt = 1; attempt < MESSAGE_UPDATE_MAX_ATTEMPTS; attempt++) {
    await retryReminderMessageUpdates(store, f.telegram, { ...owner, now: () => job().nextAttemptAt });
    store = await loadStore();
  }
  assert.equal(job().attempts, MESSAGE_UPDATE_MAX_ATTEMPTS);
  assert.equal(job().status, "exhausted");
  assert.equal(await retryReminderMessageUpdates(store, f.telegram, {
    ...owner, now: () => start + MESSAGE_UPDATE_LIFETIME_MS,
  }), 0);
  job().attempts = 1;
  job().status = "pending";
  assert.equal(await retryReminderMessageUpdates(store, f.telegram, {
    ...owner, now: () => job().expiresAt,
  }), 0, "expired work cannot retry even below the attempt cap");
});

test("each retry pass bounds Telegram work and a failed attempt write makes no request", async () => {
  const f = fixture();
  await f.worker();
  Object.values(f.store.reminders[0].telegramDeliveries)[0].nagMessageIds =
    Array.from({ length: 20 }, (_, index) => index + 12);
  const timestamp = Date.now();
  f.telegram.call = async () => { throw new Error("synthetic outage"); };
  await handleReminderCallback(f.store, f.telegram, f.callback(), { ...owner, now: () => timestamp });
  const jobs = Object.values(f.store.reminders[0].telegramDeliveries)[0].messageUpdates;
  assert.equal(jobs.filter(job => job.attempts === 1).length, 16);
  const calls = [];
  f.telegram.call = async (...args) => { calls.push(args); };
  const before = plain(f.store);
  await assert.rejects(retryReminderMessageUpdates(f.store, f.telegram, {
    ...owner, now: () => timestamp + 60_000,
    commit: async () => { throw new Error("synthetic failed attempt write"); },
  }), /failed attempt write/u);
  assert.equal(calls.length, 0);
  assert.deepEqual(plain(f.store), before);
  assert.equal(await retryReminderMessageUpdates(f.store, f.telegram, {
    ...owner, now: () => timestamp + 60_000,
  }), 16);
  assert.equal(calls.length, 16);
  assert.equal(await retryReminderMessageUpdates(f.store, f.telegram, {
    ...owner, now: () => timestamp + 60_000,
  }), 5);
  assert.equal(calls.length, 21);
});

test("delivery receipt rotation preserves an older pending UI update", async () => {
  const f = fixture({ repeat: true });
  await f.worker();
  const oldKey = Object.keys(f.store.reminders[0].telegramDeliveries)[0];
  f.telegram.call = async () => { throw new Error("synthetic outage"); };
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  const reminder = f.store.reminders[0];
  for (let index = 0; index < 127; index++) {
    reminder.telegramDeliveries[`history${index}`] = { state: "done", messageId: 100 + index };
  }
  reminder.dueAt = Date.now() - 2000;
  await f.worker();
  assert.ok(f.store.reminders[0].telegramDeliveries[oldKey].messageUpdates
    .some(update => update.status === "pending"));
  assert.equal(Object.keys(f.store.reminders[0].telegramDeliveries).length, 128);
  assert.ok((await loadStore()).reminders[0].telegramDeliveries[oldKey]);
});

test("UI retries recognize only confirmed not-modified/missing responses as applied", async () => {
  for (const [action, description] of [
    ["d", "message is not modified"], ["x", "message to delete not found"],
  ]) {
    const f = fixture();
    await f.worker();
    f.telegram.call = async method => {
      if (method !== "answerCallbackQuery") {
        throw Object.assign(new Error(description), { deliveryRejected: true });
      }
    };
    await handleReminderCallback(f.store, f.telegram, f.callback(action), owner);
    const reminder = action === "x" ? f.store.telegramDeletionReceipts[0] : f.store.reminders[0];
    assert.equal(Object.values(reminder.telegramDeliveries)[0].messageUpdates[0].status, "updated");
  }
});

test("retries preserve chat authorization, including membership loss during persistence", async () => {
  const f = fixture();
  await f.worker();
  f.telegram.call = async () => { throw new Error("synthetic outage"); };
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  const job = Object.values(f.store.reminders[0].telegramDeliveries)[0].messageUpdates[0];
  const calls = [];
  f.telegram.call = async (...args) => { calls.push(args); };
  const before = plain(f.store);
  await retryReminderMessageUpdates(f.store, f.telegram, {
    ownerChatId: "456", now: () => job.nextAttemptAt,
  });
  assert.deepEqual(plain(f.store), before);
  let authorized = true;
  await retryReminderMessageUpdates(f.store, f.telegram, {
    ownerChatId: "456", now: () => job.nextAttemptAt, isAuthorized: async id => {
      assert.equal(id, "123"); return authorized;
    },
    commit: async (store, mutate) => {
      await mutateReminderState(store, mutate);
      authorized = false;
    },
  });
  assert.equal(calls.length, 0);
  await retryReminderMessageUpdates(f.store, f.telegram, {
    ...owner, assertActive: () => { throw new Error("synthetic lock lost"); },
    now: () => Date.now() + 600_000,
  }).then(() => assert.fail("lock loss must stop retrying"), error => {
    assert.match(error.message, /lock lost/u);
  });
  assert.equal(calls.length, 0);
});

test("unknown action COMMIT never sends UI or encouragement before authoritative reload", async () => {
  const f = fixture();
  await f.worker();
  const before = plain(f.store);
  const unknown = Object.assign(new Error("synthetic COMMIT response lost"), { code: "STATE_COMMIT_UNKNOWN" });
  let durable;
  await assert.rejects(handleReminderCallback(f.store, f.telegram, f.callback(), {
    ...owner, commit: async (store, mutate) => {
      durable = structuredClone(store);
      mutate(durable);
      await saveStore(durable);
      throw unknown;
    },
  }), { code: "STATE_COMMIT_UNKNOWN" });
  assert.deepEqual(plain(f.store), before);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sent.length, 1);
  const restarted = await loadStore();
  await retryReminderMessageUpdates(restarted, f.telegram, owner);
  assert.equal(f.calls.filter(call => call.method === "editMessageText").length, 1);
  assert.equal(f.sent.length, 1, "recover only UI, not encouragement");
});

test("uncertain retry COMMIT fences Telegram I/O; confirmed retries recover after reload", async () => {
  for (const failAt of [1, 2]) {
    const f = fixture();
    await f.worker();
    f.telegram.call = async () => { throw new Error("synthetic outage"); };
    await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
    const pending = Object.values(f.store.reminders[0].telegramDeliveries)[0].messageUpdates[0];
    const timestamp = pending.nextAttemptAt;
    let commits = 0;
    const calls = [];
    f.telegram.call = async (method, payload) => { calls.push({ method, payload }); };
    await assert.rejects(retryReminderMessageUpdates(f.store, f.telegram, {
      ...owner, now: () => timestamp,
      commit: async (store, mutate) => {
        const candidate = structuredClone(store);
        mutate(candidate);
        await saveStore(candidate); // emulate COMMIT accepted, response lost
        if (++commits === failAt) {
          throw Object.assign(new Error("synthetic uncertain COMMIT"), { code: "STATE_COMMIT_UNKNOWN" });
        }
        await mutateReminderState(store, mutate);
      },
    }), { code: "STATE_COMMIT_UNKNOWN" });
    assert.equal(calls.length, failAt === 1 ? 0 : 1);
    const restarted = await loadStore();
    const job = Object.values(restarted.reminders[0].telegramDeliveries)[0].messageUpdates[0];
    await retryReminderMessageUpdates(restarted, f.telegram, {
      ...owner, now: () => job.nextAttemptAt,
    });
    assert.equal(calls.length, 1);
    assert.equal(f.sent.length, 2);
  }
});

test("a clicked uncertain delivery is completed safely without resending or advancing twice", async () => {
  const f = fixture({ repeat: true });
  f.telegram.sendMessage = async (chatId, text, options) => {
    f.sent.push({ chatId, text, options });
    throw new Error("synthetic response lost");
  };
  const dueAt = f.reminder.dueAt;
  await f.worker();
  assert.ok(f.store.reminders[0].lastAttemptAt);
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.equal(f.store.reminders[0].dueAt, dueAt + 120_000);
  assert.equal(f.store.reminders[0].remainingOccurrences, 2);
  assert.equal(f.store.reminders[0].lastAttemptAt, undefined);
  await f.worker();
  assert.equal(f.sent.filter(message => message.options?.reply_markup).length, 1);
  assert.equal(f.sent.filter(message =>
    completionEncouragements.some(text => message.text.startsWith(`${text}\n\n`))).length, 1);
  await handleReminderCallback(f.store, f.telegram, f.callback(), owner);
  assert.equal(f.sent.length, 2, "an uncertain encouragement send must not be replayed");
});

test("button operations wait for an in-flight send, and a failed job does not poison the queue", async () => {
  const queue = createReminderOperationQueue();
  let release;
  const order = [];
  const sending = queue(async () => {
    order.push("sending");
    await new Promise(resolve => { release = resolve; });
    order.push("sent");
  });
  const clicking = queue(async () => { order.push("clicked"); });
  await Promise.resolve();
  assert.deepEqual(order, ["sending"]);
  release();
  await Promise.all([sending, clicking]);
  assert.deepEqual(order, ["sending", "sent", "clicked"]);
  await assert.rejects(queue(async () => { throw new Error("failure"); }));
  assert.equal(await queue(async () => "ready"), "ready");
});

test("Telegram's actual JSON transport puts native keyboard on the last chunk only", async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [];
  try {
    globalThis.fetch = async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, result: { message_id: payloads.length } }) };
    };
    const keyboard = reminderKeyboard({ id: "transport", dueAt: 1 });
    const client = new TelegramClient("synthetic-not-a-secret");
    await client.sendMessage("123", "א".repeat(4500), { reply_markup: keyboard });
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].reply_markup, undefined);
    assert.deepEqual(payloads[1].reply_markup, keyboard);
    assert.equal(payloads[1].chat_id, "123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("polling and webhook both request callback events, with owner-only inspection metadata", async () => {
  assert.deepEqual(TELEGRAM_ALLOWED_UPDATES, ["message", "callback_query"]);
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
  assert.equal(source.match(/allowed_updates: TELEGRAM_ALLOWED_UPDATES/gu)?.length, 2);
  const f = fixture();
  await f.worker();
  assert.match(requestMetadata({ callback_query: f.callback() }, "123").text, /בוצע/u);
  const query = f.callback();
  query.from.id = 456;
  assert.equal(requestMetadata({ callback_query: query }, "123").text, undefined);
});
