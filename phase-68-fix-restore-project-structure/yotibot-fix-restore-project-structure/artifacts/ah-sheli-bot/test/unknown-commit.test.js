import assert from "node:assert/strict";
import { after, test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeReminders, loadPersistedReminders } from "../src/reminder-repository.js";
import { createReminderWorker } from "../src/reminder-worker.js";
import { createWorkerLock } from "../src/worker-lock.js";
import { claimUpdate, readInterruptedRequests } from "../src/conversation-repository.js";
import { handleInterruptedRequests } from "../src/interrupted-requests.js";

// No running bot, network, webhooks, credentials, or actual database.
const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-unknown-commit-"));
process.env.AH_SHELI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
let moduleId = 0;
const freshStoreModule = () => import(`../src/store.js?synthetic-process=${++moduleId}`);
const plain = value => JSON.parse(JSON.stringify(value));

function fakeDatabase(initial) {
  const db = {
    state: plain(initial), reminders: [], events: [], owned: false,
    failCommit: false, applyCommit: true, releases: [], updates: [],
    async query(sql, args = []) {
      assert.ok(this.owned, "reload requires exclusive ownership");
      this.events.push("read");
      if (sql.includes("INSERT INTO ah_sheli_updates")) {
        if (this.updates.some(r => r.update_id === args[0])) return { rowCount: 0 };
        this.updates.push({ update_id: args[0], status: "processing",
          chat_id: args[1], request_text: args[2], created_at: new Date("2026-10-07T08:00:00Z") });
        return { rowCount: 1 };
      }
      if (sql.includes("FROM ah_sheli_updates")) {
        return { rows: this.updates.filter(r => r.chat_id === args[0] && r.status === "processing") };
      }
      if (sql.includes("SELECT value")) return { rows: [{ value: plain(this.state) }] };
      if (sql.includes("FROM ah_sheli_reminders")) return { rows: structuredClone(this.reminders) };
      assert.fail(`Unexpected read: ${sql}`);
    },
    async connect() {
      assert.ok(this.owned);
      this.events.push("connect");
      let tx;
      return {
        query: async (sql, args = []) => {
          this.events.push(sql);
          if (sql === "BEGIN") tx = { state: plain(this.state), reminders: structuredClone(this.reminders) };
          else if (sql === "ROLLBACK") tx = null;
          else {
            assert.ok(tx, "all writes use one transaction");
            if (sql.includes("INSERT INTO ah_sheli_state")) tx.state = JSON.parse(args[0]);
            else if (sql.startsWith("SELECT value FROM ah_sheli_state")) {
              return { rows: tx.state ? [{ value: plain(tx.state) }] : [] };
            }
            else if (sql === "SELECT to_regclass('ah_sheli_list_shares') AS relation") {
              return { rows: [{ relation: null }] };
            }
            else if (sql.includes("INSERT INTO ah_sheli_reminders")) {
              const [id, chat_id, text, due_at, created_at, sent_at, last_attempt_at,
                repeat_every_ms, remaining_occurrences] = args;
              tx.reminders = tx.reminders.filter(r => r.id !== id);
              tx.reminders.push({ id, chat_id, text, due_at, created_at, sent_at,
                last_attempt_at, repeat_every_ms, remaining_occurrences });
            } else if (sql.includes("DELETE FROM ah_sheli_reminders")) {
              tx.reminders = tx.reminders.filter(r => args[0]?.includes(r.id));
            } else if (sql === "COMMIT") {
              if (!this.failCommit || this.applyCommit) {
                this.state = tx.state;
                this.reminders = tx.reminders;
              }
              tx = null;
              if (this.failCommit) {
                this.failCommit = false;
                throw Object.assign(new Error("synthetic lost COMMIT response"), { code: "ECONNRESET" });
              }
            } else assert.fail(`Unexpected write: ${sql}`);
          }
          return { rows: [] };
        },
        release: error => this.releases.push(error),
      };
    },
  };
  return db;
}

class SyntheticLockClient extends EventEmitter {
  constructor(db) { super(); this.db = db; }
  async connect() {}
  async query({ text }) {
    if (text.includes("pg_try_advisory_lock")) {
      const acquired = !this.db.owned;
      if (acquired) this.db.owned = true;
      return { rows: [{ acquired, pid: 42 }] };
    }
    if (text.includes("pg_advisory_unlock")) this.db.owned = false;
    return { rows: [{ owned: this.db.owned }] };
  }
  async end() {}
}
const acquire = db => createWorkerLock(new SyntheticLockClient(db), {
  schedule: () => ({ unref() {} }), cancel: () => {}, log: () => {},
});
async function initialize(api, db) {
  const store = await api.loadStore(db);
  await api.initializeStatePersistence(store, db);
  store.reminders = await loadPersistedReminders(db);
  api.setReminderPersistence(writeReminders, store.reminders);
  await api.saveStore(store);
  return store;
}
const isUnknown = error => error.code === "STATE_COMMIT_UNKNOWN"
  && error.cause?.code === "ECONNRESET";
const backup = async () => JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
async function inspectInterrupted(db) {
  const sent = [];
  await handleInterruptedRequests({
    text: "/interrupted", chat: { id: "synthetic-owner" }, from: { is_bot: false },
  }, { sendMessage: async (_chat, text) => sent.push(text) }, {
    ownerChatId: "synthetic-owner", currentUpdateId: 902,
    readRequests: (chat, options) => readInterruptedRequests(chat, options, db),
  });
  assert.match(sent[0], /בקשה 901/);
  assert.match(sent[0], /אי אפשר להסיק מהסטטוס לבדו/);
  assert.match(sent[0], /ייתכן שהיא נשמרה/);
  assert.equal(db.updates[0].status, "processing");
  assert.equal(await claimUpdate(901, {}, db), false, "inspection must never unblock replay");
}

test("applied COMMIT with lost response fences list retries, queued stale writes, and same-process reload", async () => {
  const api = await freshStoreModule();
  const initial = api.createEmptyStore();
  initial.lists["synthetic-owner"] = { synthetic: [] };
  initial.pendingListActions["synthetic-owner"] = { type: "add-items", items: ["synthetic item"] };
  const db = fakeDatabase(initial);
  const lock = await acquire(db);
  const store = await initialize(api, db);
  await claimUpdate(901, { chatId: "synthetic-owner", text: "synthetic add item" }, db);
  let stopped = 0;
  api.setUnknownCommitHandler(() => stopped++);
  db.events = [];
  db.failCommit = true;
  const addition = api.mutateList(store, "synthetic-owner", "synthetic", () => {
    store.lists["synthetic-owner"].synthetic.push({
      id: "synthetic-item", text: "synthetic item", checked: false,
    });
  }, true);
  // Already enqueued before the missing response: must not overwrite COMMIT.
  const staleWrite = api.saveStore(initial);
  await Promise.all([
    assert.rejects(addition, isUnknown),
    assert.rejects(staleWrite, isUnknown),
  ]);
  assert.equal(stopped, 1);
  assert.equal(db.state.lists["synthetic-owner"].synthetic.length, 1);
  assert.equal(db.state.pendingListActions["synthetic-owner"], undefined);
  assert.equal(store.lists["synthetic-owner"].synthetic.length, 0, "memory is stale");
  assert.deepEqual(await backup(), plain(initial), "unconfirmed backup never published");
  assert.equal(db.events.filter(sql => sql === "COMMIT").length, 1);
  assert.equal(db.events.includes("ROLLBACK"), false, "ROLLBACK cannot resolve a missing response");
  assert.equal(db.releases.at(-1).code, "STATE_COMMIT_UNKNOWN", "discard uncertain connection");
  const events = db.events.length;
  await assert.rejects(api.mutateList(store, "synthetic-owner", "synthetic", () => {
    store.lists["synthetic-owner"].synthetic.push({
      id: "synthetic-retry", text: "synthetic retry", checked: false,
    });
  }), isUnknown);
  await assert.rejects(api.initializeStatePersistence(store, db), isUnknown);
  assert.equal(db.events.length, events, "no writes or reset after uncertainty");
  await assert.rejects(acquire(db), /Another Ah Sheli worker/);
  await lock.release();
  const newLock = await acquire(db);
  try {
    const restarted = await initialize(await freshStoreModule(), db);
    assert.equal(restarted.lists["synthetic-owner"].synthetic.length, 1);
    assert.equal(restarted.pendingListActions["synthetic-owner"], undefined);
    assert.deepEqual(await backup(), db.state);
    const persisted = plain(db.state);
    await inspectInterrupted(db);
    assert.deepEqual(db.state, persisted, "inspection does not execute the committed action again");
  } finally { await newLock.release(); }
});

test("applied attempt-marker COMMIT cannot send or retry, including after exclusive reload", async () => {
  const api = await freshStoreModule();
  const initial = api.createEmptyStore();
  initial.reminders = [{ id: "synthetic-reminder", chatId: "synthetic-owner",
    text: "synthetic reminder", dueAt: 0, createdAt: 1 }];
  const db = fakeDatabase(initial);
  const lock = await acquire(db);
  // Populate synthetic reminder rows using the actual repository writer.
  await api.initializeStatePersistence(initial, db);
  api.setReminderPersistence(writeReminders, []);
  await api.saveStore(initial);
  const store = await initialize(api, db);
  let sends = 0;
  const sink = { sendMessage: async () => { sends++; } };
  const worker = createReminderWorker(store, sink, "synthetic-owner", () => {},
    api.saveStore, api.assertStatePersistenceActive);
  db.events = [];
  db.failCommit = true;
  await assert.rejects(worker(), isUnknown);
  assert.ok(store.reminders[0].lastAttemptAt, "uncertain marker is not reset in memory");
  assert.ok(db.state.reminders[0].lastAttemptAt);
  assert.equal((await loadPersistedReminders(db))[0].lastAttemptAt,
    db.state.reminders[0].lastAttemptAt);
  const events = db.events.length;
  await assert.rejects(worker(), isUnknown);
  await assert.rejects(api.saveStore({ ...store, reminders: [] }), isUnknown);
  assert.equal(db.events.length, events, "old snapshot cannot erase the marker");
  assert.equal(sends, 0);
  await lock.release();
  const newLock = await acquire(db);
  try {
    const restartedApi = await freshStoreModule();
    const restarted = await initialize(restartedApi, db);
    await createReminderWorker(restarted, sink, "synthetic-owner", () => {},
      restartedApi.saveStore, restartedApi.assertStatePersistenceActive)();
    assert.equal(sends, 0, "persisted uncertain attempt is not replayed");
    assert.ok(restarted.reminders[0].lastAttemptAt);
  } finally { await newLock.release(); }
});

test("a missing COMMIT response before application still requires a fresh exclusive reload", async () => {
  const api = await freshStoreModule();
  const initial = api.createEmptyStore();
  const db = fakeDatabase(initial);
  const lock = await acquire(db);
  const store = await initialize(api, db);
  db.failCommit = true;
  db.applyCommit = false;
  await claimUpdate(901, { chatId: "synthetic-owner", text: "synthetic add item" }, db);
  await assert.rejects(api.setPendingListAction(store, "synthetic-owner", {
    type: "add-items", items: ["synthetic item"],
  }), isUnknown);
  assert.deepEqual(db.state, plain(initial));
  await assert.rejects(api.saveStore(store), isUnknown);
  await lock.release();
  const newLock = await acquire(db);
  try {
    assert.deepEqual(plain(await initialize(await freshStoreModule(), db)), plain(initial));
    await inspectInterrupted(db);
    assert.deepEqual(db.state, plain(initial), "inspection does not execute the uncommitted action");
  } finally { await newLock.release(); }
});
