import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerRestartDelay } from "../../api-server/src/lib/worker-restart.ts";
import { relayTelegramRequest } from "../../api-server/src/lib/telegram.functions.ts";
import { createReminderWorker } from "../src/reminder-worker.js";
import { replyToOwnerMessage } from "../src/message-handler.js";
import { createEmptyStore } from "../src/store.js";
import { TelegramClient } from "../src/telegram.js";

test("recovery is quick after a transient loss but repeated failures back off", () => {
  const delay = createWorkerRestartDelay();
  assert.deepEqual(Array.from({ length: 8 }, () => delay(100)),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(delay(60000), 1000);
});

test("relay rejects an initializing worker and resumes forwarding when ready", async () => {
  const original = globalThis.fetch;
  let ready = false;
  let forwarded = 0;
  globalThis.fetch = async url => {
    if (url.endsWith("/healthz")) return Response.json({ service: "ah-sheli-bot", ready });
    forwarded++;
    return Response.json({ ok: true });
  };
  const statuses = [];
  const response = {
    status(code) { statuses.push(code); return this; },
    json() { return this; }, type() { return this; }, send() { return this; },
  };
  try {
    await relayTelegramRequest({ get: () => "", body: {} }, response, "/webhook");
    assert.equal(forwarded, 0);
    ready = true;
    await relayTelegramRequest({ get: () => "", body: {} }, response, "/webhook");
    assert.equal(forwarded, 1);
    assert.deepEqual(statuses, [503, 200]);
  } finally { globalThis.fetch = original; }
});

test("a lost lock after AI or during history persistence cannot send a reply", async () => {
  for (const lossPhase of ["assistant", "save"]) {
    let active = true;
    let sends = 0;
    await assert.rejects(replyToOwnerMessage(createEmptyStore(), {
      sendMessage: async () => sends++,
    }, "synthetic-owner", "/help", {
      assistant: async () => { if (lossPhase === "assistant") active = false; return "reply"; },
      saveConversation: async () => { active = false; },
      assertActive: () => { if (!active) throw new Error("lock lost"); },
    }), /lock lost/);
    assert.equal(sends, 0);
  }
});

test("interrupted delivery markers survive restart without duplicate sends", async () => {
  const store = createEmptyStore();
  store.reminders = [{ id: "test", chatId: "synthetic-owner", text: "test", dueAt: 0 }];
  let persisted;
  let sends = 0;
  const persist = async state => { persisted = JSON.parse(JSON.stringify(state)); };
  const worker = createReminderWorker(store, {
    sendMessage: async () => { sends++; throw new Error("uncertain network outcome"); },
  }, "synthetic-owner", () => {}, persist);
  await worker();
  // Simulate a new process loading the DB after the attempt was committed.
  const restarted = createReminderWorker(persisted, {
    sendMessage: async () => sends++,
  }, "synthetic-owner", () => {}, persist);
  await restarted();
  assert.equal(sends, 1);
  assert.ok(persisted.reminders[0].lastAttemptAt);
});

test("a confirmed Telegram rejection retries while accepted-but-unsaved delivery never does", async () => {
  for (const mode of ["rejected", "save-failed"]) {
    const store = createEmptyStore();
    store.reminders = [{ id: mode, chatId: "synthetic-owner", text: "test", dueAt: 0 }];
    let persisted;
    let sends = 0;
    let writes = 0;
    const persist = async state => {
      writes++;
      if (mode === "save-failed" && writes === 2) throw new Error("database disconnected");
      persisted = JSON.parse(JSON.stringify(state));
    };
    const worker = createReminderWorker(store, {
      sendMessage: async () => {
        sends++;
        if (mode === "rejected" && sends === 1) {
          throw Object.assign(new Error("Telegram rejected"), { deliveryRejected: true });
        }
      },
    }, "synthetic-owner", () => {}, persist);
    await worker();
    await worker();
    assert.equal(sends, 1, "same-process retries are throttled or suppressed");
    const restarted = createReminderWorker(persisted, {
      sendMessage: async () => sends++,
    }, "synthetic-owner", () => {}, persist);
    await restarted();
    assert.equal(sends, mode === "rejected" ? 2 : 1);
  }
});

test("loss during reminder persistence fences outbound delivery", async () => {
  const store = createEmptyStore();
  store.reminders = [{ id: "test", chatId: "synthetic-owner", text: "test", dueAt: 0 }];
  let active = true;
  let sends = 0;
  const worker = createReminderWorker(store, {
    sendMessage: async () => sends++,
  }, "synthetic-owner", () => {}, async () => { active = false; },
  () => { if (!active) throw new Error("lock lost"); });
  await worker();
  assert.equal(sends, 0);
});

test("explicit Telegram rejection is distinct from an ambiguous transport failure", async () => {
  const original = globalThis.fetch;
  const client = new TelegramClient("synthetic-token");
  try {
    globalThis.fetch = async () => Response.json({ ok: false, description: "rate limit" }, { status: 429 });
    await assert.rejects(client.sendMessage("synthetic-owner", "test"),
      error => error.deliveryRejected === true);
    globalThis.fetch = async () => { throw new Error("network"); };
    await assert.rejects(client.sendMessage("synthetic-owner", "test"),
      error => error.deliveryRejected !== true);
  } finally { globalThis.fetch = original; }
});

test("rejection after an accepted multipart prefix cannot replay the whole message", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? Response.json({ ok: true, result: {} })
      : Response.json({ ok: false, description: "rate limit" }, { status: 429 });
  };
  try {
    await assert.rejects(new TelegramClient("synthetic-token")
      .sendMessage("synthetic-owner", "x".repeat(5000)),
    error => error.deliveryRejected === false);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("database failure before starting a send does not strand the in-memory reminder", async () => {
  const store = createEmptyStore();
  store.reminders = [{ id: "test", chatId: "synthetic-owner", text: "test", dueAt: 0 }];
  let fail = true;
  let sends = 0;
  const worker = createReminderWorker(store, {
    sendMessage: async () => sends++,
  }, "synthetic-owner", () => {}, async () => {
    if (fail) throw new Error("database unavailable");
  });
  await assert.rejects(worker(), /database unavailable/);
  assert.equal(sends, 0);
  fail = false;
  await worker();
  assert.equal(sends, 1);
  assert.ok(store.reminders[0].sentAt);
});
