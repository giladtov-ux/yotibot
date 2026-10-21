import test from "node:test";
import assert from "node:assert/strict";
import { matchesSecret } from "../src/security.js";
import { createReminderWorker } from "../src/reminder-worker.js";
import { createEmptyStore } from "../src/store.js";
import { handleAssistantMessage } from "../src/assistant.js";

test("assistant receives only the supplied chat history", async () => {
  const history = [{ role: "user", content: "previous message" }];
  const reply = await handleAssistantMessage(createEmptyStore(), "owner", "hello",
    async (_text, context) => {
      assert.deepEqual(context.recentConversation, history);
      return { type: "answer", response: "hello back" };
    }, history);
  assert.equal(reply, "hello back");
});

test("hook tokens reject missing, wrong length and wrong content", () => {
  assert.equal(matchesSecret(undefined, "secret"), false);
  assert.equal(matchesSecret(["secret"], "secret"), false);
  assert.equal(matchesSecret("short", "secret"), false);
  assert.equal(matchesSecret("secreX", "secret"), false);
  assert.equal(matchesSecret("secret", "secret"), true);
});

test("reminder worker sends due owner reminders once, not other chats or future reminders", async () => {
  const store = createEmptyStore();
  store.reminders = [
    { id: "due", chatId: "owner", text: "due", dueAt: Date.now() - 1000 },
    { id: "foreign", chatId: "other", text: "private", dueAt: 0 },
    { id: "future", chatId: "owner", text: "future", dueAt: Date.now() + 100000 },
  ];
  const sent = [];
  const worker = createReminderWorker(store, {
    sendMessage: async (...args) => { sent.push(args); },
  }, "owner", () => {}, async () => {});
  await Promise.all([worker(), worker()]);
  await worker();
  assert.equal(sent.length, 1);
  assert.ok(store.reminders[0].sentAt);
});

test("uncertain network delivery stays unsent and is not automatically replayed", async () => {
  const store = createEmptyStore();
  store.reminders = [{ id: "failed", chatId: "owner", text: "due", dueAt: 0 }];
  let attempts = 0;
  const worker = createReminderWorker(store, {
    sendMessage: async () => { attempts++; throw new Error("network"); },
  }, "owner", () => {}, async () => {});
  await worker();
  await worker();
  assert.equal(attempts, 1);
  assert.equal(store.reminders[0].sentAt, undefined);
});

test("newly connected owner enables only that owner's reminder delivery", async () => {
  const store = createEmptyStore();
  store.reminders = [{ id: "after-connect", chatId: "owner", text: "due", dueAt: 0 }];
  let owner = null;
  let sent = 0;
  const worker = createReminderWorker(store, {
    sendMessage: async () => { sent++; },
  }, () => owner, () => {}, async () => {});
  await worker();
  assert.equal(sent, 0);
  owner = "owner";
  await worker();
  assert.equal(sent, 1);
});
