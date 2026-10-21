import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createReminderScheduler, REMINDER_CHECK_INTERVAL_MS, REMINDER_CRON } from "../src/reminder-scheduler.js";
import { createReminderWorker } from "../src/reminder-worker.js";
import { createEmptyStore } from "../src/store.js";

function fakeTimers() {
  let tick;
  let timers = 0;
  let cancelled = 0;
  let spec;
  return {
    schedule(rule, callback) {
      tick = callback; timers++; spec = rule;
      return {};
    },
    cancel() { cancelled++; },
    tick: () => tick(),
    stats: () => ({ timers, cancelled, spec }),
  };
}

test("background timer starts immediately, once, and stops future checks", async () => {
  const timers = fakeTimers();
  let runs = 0;
  const scheduler = createReminderScheduler(async () => { runs++; }, timers);
  scheduler.start();
  scheduler.start();
  await sleep(0);
  assert.equal(runs, 1);
  assert.equal(REMINDER_CHECK_INTERVAL_MS, 1000);
  assert.deepEqual(timers.stats(), {
    timers: 1, cancelled: 0, spec: { rule: REMINDER_CRON, tz: "Asia/Jerusalem" },
  });
  timers.tick();
  await sleep(0);
  assert.equal(runs, 2);
  scheduler.stop();
  scheduler.stop();
  timers.tick();
  await sleep(0);
  assert.equal(runs, 2);
  assert.equal(timers.stats().cancelled, 1);
});

test("a slow delivery cannot overlap the next timer ticks", async () => {
  const timers = fakeTimers();
  let release;
  let runs = 0;
  const scheduler = createReminderScheduler(() => {
    runs++;
    return new Promise(resolve => { release = resolve; });
  }, timers);
  scheduler.start();
  timers.tick();
  timers.tick();
  assert.equal(runs, 1);
  release();
  await sleep(0);
  timers.tick();
  assert.equal(runs, 2);
  scheduler.stop();
  release();
});

test("a transient worker failure does not stop later background checks", async () => {
  const timers = fakeTimers();
  let runs = 0;
  let errors = 0;
  const scheduler = createReminderScheduler(async () => {
    runs++;
    if (runs === 1) throw new Error("temporary persistence failure");
  }, { ...timers, onError: () => { errors++; } });
  scheduler.start();
  await sleep(0);
  timers.tick();
  await sleep(0);
  scheduler.stop();
  assert.equal(errors, 1);
  assert.equal(runs, 2);
});

test("node-schedule sends a newly saved future reminder without any incoming message, never early or twice", { timeout: 5000 }, async () => {
  const state = createEmptyStore();
  let persisted;
  const sent = [];
  const persist = async store => { persisted = structuredClone(store); };
  const worker = createReminderWorker(state, {
    sendMessage: async (chat, text) => { sent.push({ chat, text, time: Date.now() }); },
  }, "synthetic-owner", () => {}, persist);
  const scheduler = createReminderScheduler(worker);
  scheduler.start();
  try {
    // Add after startup: there is no incoming-message handler or hook invocation.
    const dueAt = Date.now() + 60;
    state.reminders.push({ id: "timed", chatId: "synthetic-owner", text: "בדיקת תזכורת", dueAt });
    await persist(state);
    const deadline = Date.now() + 2200;
    while (sent.length === 0 && Date.now() < deadline) await sleep(10);
    assert.equal(sent.length, 1, "the timer must send without an incoming message");
    assert.equal(sent[0].chat, "synthetic-owner");
    assert.match(sent[0].text, /בדיקת תזכורת/u);
    assert.ok(sent[0].time >= dueAt, "must not send before the saved time");
    // Wait for another real library invocation, not just the first tick.
    await sleep(1100);
    assert.equal(sent.length, 1);
    assert.ok(persisted.reminders[0].sentAt);
  } finally {
    scheduler.stop();
  }
});

test("job registration failure is explicit and does not leave a false running state", () => {
  let runs = 0;
  const scheduler = createReminderScheduler(() => { runs++; }, { schedule: () => null });
  assert.throws(() => scheduler.start(), /could not be scheduled/);
  assert.throws(() => scheduler.start(), /could not be scheduled/);
  assert.equal(runs, 0);
  scheduler.stop();
});

test("startup delivers overdue persisted reminders but does not replay confirmed or uncertain sends", async () => {
  const state = createEmptyStore();
  state.reminders = [
    { id: "overdue", chatId: "synthetic-owner", text: "overdue", dueAt: Date.now() - 1000 },
    { id: "sent", chatId: "synthetic-owner", text: "already sent", dueAt: 0, sentAt: 1 },
    { id: "uncertain", chatId: "synthetic-owner", text: "uncertain", dueAt: 0, lastAttemptAt: 1 },
  ];
  const persisted = structuredClone(state);
  const sent = [];
  const worker = createReminderWorker(persisted, {
    sendMessage: async (_chat, text) => { sent.push(text); },
  }, "synthetic-owner", () => {}, async () => {});
  const scheduler = createReminderScheduler(worker, fakeTimers());
  scheduler.start();
  await sleep(0);
  scheduler.stop();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /overdue/u);
  assert.ok(persisted.reminders[0].sentAt);
});
