import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Never import the running bot, open a real database, or call Telegram/webhooks.
const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-atomic-state-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore, initializeStatePersistence, loadStore, mutateReminderState,
  saveStore, setPendingAction, setReminderPersistence } = await import("../src/store.js");
const { initializeReminderPersistence, loadPersistedReminders } =
  await import("../src/reminder-repository.js");
const { menuRecords } = await import("../src/record-menu.js");
const { handleRecordViewAction } = await import("../src/record-view-actions.js");
const { resolveListConfirmation, rememberListConfirmation } = await import("../src/list-confirmations.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
const { handleText } = await import("../src/commands.js");
const { replyToOwnerMessage } = await import("../src/message-handler.js");
const { handleReminderCallback, reminderKeyboard, occurrenceKey,
  retryReminderMessageUpdates } = await import("../src/reminder-actions.js");
after(() => rm(directory, { recursive: true, force: true }));

const plain = value => JSON.parse(JSON.stringify(value));
const reminder = { id: "synthetic-reminder", chatId: "synthetic-owner",
  text: "synthetic text", dueAt: Date.UTC(2099, 0, 1), createdAt: 1000,
  repeatEveryMs: 120000, remainingOccurrences: 3, lastAttemptAt: 900 };
const pending = { type: "reminder", text: "synthetic pending",
  date: "2099-01-01", hour: null, minute: null };
function fixture() {
  const store = createEmptyStore();
  store.reminders = [{ ...reminder }];
  store.pendingActions["synthetic-owner"] = { ...pending };
  store.lists["synthetic-owner"] = {
    synthetic: [{ id: "synthetic-item", text: "synthetic item", checked: false }],
  };
  store.pendingListActions["synthetic-owner"] = { type: "add-items", items: ["synthetic item"] };
  store.lastListActions["synthetic-owner"] = { listName: "synthetic" };
  store.lastUpdateId = 10;
  return store;
}

function row(item) {
  return {
    id: item.id, chat_id: item.chatId, text: item.text,
    due_at: new Date(item.dueAt), created_at: new Date(item.createdAt),
    sent_at: item.sentAt ? new Date(item.sentAt) : null,
    last_attempt_at: item.lastAttemptAt ? new Date(item.lastAttemptAt) : null,
    repeat_every_ms: item.repeatEveryMs ?? null,
    remaining_occurrences: item.remainingOccurrences ?? null,
  };
}

// Snapshot-based fake: writes affect a detached transaction until COMMIT.
// SQL outside that transaction is rejected, rather than silently accepted.
function fakePool(initial = fixture()) {
  const pool = {
    committed: {
      state: initial ? plain(initial) : null,
      reminders: initial ? initial.reminders.map(row) : [],
    },
    events: [], failAt: null, failNth: 1, releases: 0, releaseErrors: [],
    failRollback: false,
    async query(sql) {
      if (sql.includes("SELECT value FROM ah_sheli_state")) {
        return { rows: this.committed.state ? [{ value: plain(this.committed.state) }] : [] };
      }
      if (sql.includes("FROM ah_sheli_reminders")) {
        return { rows: structuredClone(this.committed.reminders) };
      }
      assert.fail(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      this.events.push("connect");
      this.maybeFail("connect");
      let transaction = null;
      return {
        query: async (sql, args = []) => {
          // This isolated fixture has no sharing table. Production probes its
          // existence before optional share revocation in the same transaction.
          if (sql.includes("SELECT to_regclass('ah_sheli_list_shares')")) {
            assert.ok(transaction);
            return { rows: [{ relation: null }] };
          }
          const stage = sql.includes("INSERT INTO ah_sheli_reminders") ? "reminder"
            : sql.includes("DELETE FROM ah_sheli_reminders") ? "delete"
            : sql.includes("SELECT id, chat_id, due_at FROM ah_sheli_reminders") ? "verify-reminder"
            : sql.includes("SELECT value FROM ah_sheli_state") ? "verify-list"
            : sql.includes("INSERT INTO ah_sheli_state") ? "state" : sql;
          this.events.push(stage);
          if (stage === "ROLLBACK" && this.failRollback) {
            throw new Error("synthetic rollback failure");
          }
          this.maybeFail(stage);
          if (stage === "BEGIN") {
            assert.equal(transaction, null, "no nested transaction");
            transaction = structuredClone(this.committed);
          } else if (stage === "ROLLBACK") {
            transaction = null;
          } else {
            assert.ok(transaction, "every write uses the same transaction");
            if (stage === "verify-reminder") {
              const reminders = this.returnOldRemindersOnVerification
                ? this.committed.reminders : transaction.reminders;
              return { rows: reminders.filter(item => item.id === args[0] && item.chat_id === args[1]) };
            } else if (stage === "reminder") {
              const [id, chat_id, text, due_at, created_at, sent_at, last_attempt_at,
                repeat_every_ms, remaining_occurrences] = args;
              transaction.reminders = transaction.reminders.filter(item => item.id !== id);
              transaction.reminders.push({ id, chat_id, text, due_at, created_at,
                sent_at, last_attempt_at, repeat_every_ms, remaining_occurrences });
            } else if (stage === "delete") {
              transaction.reminders = transaction.reminders.filter(item => args[0]?.includes(item.id));
          } else if (stage === "verify-list") {
            assert.ok(transaction, "verification must run inside the write transaction");
            const state = this.returnOldListsOnVerification
              ? { ...transaction.state, lists: this.committed.state.lists } : transaction.state;
            return { rows: [{ value: plain(state) }] };
          } else if (stage === "state") {
              transaction.state = JSON.parse(args[0]);
            } else if (stage === "COMMIT") {
              this.committed = transaction;
              transaction = null;
            } else assert.fail(`Unexpected client query: ${sql}`);
          }
          return { rows: [] };
        },
        release: error => { this.releases++; this.releaseErrors.push(error); },
      };
    },
    maybeFail(stage) {
      if (this.failAt === stage && --this.failNth === 0) {
        this.failAt = null;
        throw new Error(`synthetic failure at ${stage}`);
      }
    },
  };
  return pool;
}

test("time updates commit SQL and state before receipt; failure or stale readback preserves the old deadline", async () => {
  const { withReminderRequestTime, parseJerusalemDateTime } = await import("../src/time.js");
  const now = Date.UTC(2098, 11, 31, 19);
  for (const mode of ["success", "reminder", "state", "verify-reminder", "stale"]) {
    const initial = fixture();
    initial.reminders[0] = { ...initial.reminders[0], repeatEveryMs: undefined, remainingOccurrences: undefined };
    initial.pendingActions = Object.create(null);
    const pool = fakePool(initial);
    const store = await start(pool);
    const before = plain(store);
    if (mode === "stale") pool.returnOldRemindersOnVerification = true;
    else if (mode !== "success") pool.failAt = mode;
    const update = () => withReminderRequestTime(() => handleAssistantMessage(store,
      "synthetic-owner", "שנה synthetic text ל08:15"), now);
    if (mode === "success") {
      const receipt = await update();
      assert.match(receipt, /הועברה/u);
      const expected = parseJerusalemDateTime("2099-01-01", "08:15", { now });
      assert.equal(store.reminders[0].dueAt, expected);
      assert.equal((await loadPersistedReminders(pool))[0].dueAt, expected);
      assert.equal((await loadStore(pool)).reminders[0].dueAt, expected);
      assert.ok(pool.events.includes("verify-reminder"));
    } else {
      await assert.rejects(update(), /synthetic failure|expected updated reminder/u);
      assert.deepEqual(plain(store), before);
      assert.equal((await loadPersistedReminders(pool))[0].dueAt, before.reminders[0].dueAt);
    }
  }
});

async function start(pool) {
  const store = await loadStore(pool);
  await initializeStatePersistence(store, pool);
  await initializeReminderPersistence(store, pool);
  return store;
}
async function backup() {
  return JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
}

test("task insertion waits for COMMIT before Telegram sends the verified open list", async () => {
  const pool = fakePool();
  const store = await start(pool);
  const chat = "synthetic-owner";
  store.lists[chat].משימות = [{ id: "done-task", text: "already finished", checked: true }];
  await saveStore(store);
  let releaseCommit, signalCommit;
  const commitGate = new Promise(resolve => { releaseCommit = resolve; });
  const commitReached = new Promise(resolve => { signalCommit = resolve; });
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    const query = client.query;
    client.query = async (...args) => {
      if (args[0] === "COMMIT") { signalCommit(); await commitGate; }
      return query(...args);
    };
    return client;
  };
  const sent = [];
  let calls = 0;
  const response = replyToOwnerMessage(store, {
    sendMessage: async (_chat, text) => { sent.push(text); },
  }, chat, "לאסוף ועד", {
    readHistory: async () => [],
    saveConversation: async () => {},
    assistant: (state, owner, text) => handleAssistantMessage(state, owner, text,
      async () => ++calls === 1
        ? { type: "answer", response: "אני מוסיף עכשיו... רגע" }
        : { type: "add-task", text: "לאסוף ועד" }),
  });
  await commitReached;
  try {
    assert.deepEqual(sent, []);
    assert.equal(pool.committed.state.lists[chat].משימות.length, 1);
    // The receipt must use the database readback, not this mutable live array.
    store.lists[chat].משימות.at(-1).text = "synthetic local corruption";
  } finally { releaseCommit(); }
  await response;
  assert.equal(calls, 0);
  assert.equal(pool.committed.state.lists[chat].משימות.at(-1).text, "לאסוף ועד");
  assert.ok(pool.events.includes("verify-list"));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /לאסוף ועד/u);
  assert.doesNotMatch(sent[0], /רגע|אני מוסיף|already finished|synthetic local corruption/u);
});
function append(candidate) {
  candidate.reminders.push({ ...reminder, id: "synthetic-new" });
  delete candidate.pendingActions["synthetic-owner"];
}

test("displayed-item deletion commits to database state and cannot return after restart", async () => {
  const pool = fakePool();
  let store = await start(pool);
  const key = menuRecords(store, "synthetic-owner", "s").find(item => item.kind === "item").key;
  store.recordViews["synthetic-owner"] = { key, scope: "s", mode: "c", offset: 0, awaitingDelete: false };
  await saveStore(store);
  store = await start(pool);
  const before = plain(store);
  pool.failAt = "state";
  await assert.rejects(handleRecordViewAction(store, "synthetic-owner", "למחוק"), /synthetic failure/u);
  assert.deepEqual(plain(store), before);
  assert.deepEqual(plain(await start(pool)), before);
  const result = await handleRecordViewAction(store, "synthetic-owner", "מחק");
  assert.equal(result.text, "הפריט נמחק");
  assert.equal(pool.committed.state.lists["synthetic-owner"].synthetic.length, 0);
  assert.equal(pool.committed.reminders.length, 1);
  const restarted = await start(pool);
  assert.equal(restarted.lists["synthetic-owner"].synthetic.length, 0);
  assert.equal(restarted.recordViews["synthetic-owner"], undefined);
});

test("confirmed reminder deletion removes its SQL row and pending consent atomically", async () => {
  const pool = fakePool();
  let store = await start(pool);
  const key = menuRecords(store, "synthetic-owner", "s").find(item => item.kind === "reminder").key;
  store.recordViews["synthetic-owner"] = { key, scope: "r", mode: "c", offset: 0, awaitingDelete: false };
  await saveStore(store);
  await handleRecordViewAction(store, "synthetic-owner", "מחק");
  store = await start(pool);
  assert.equal(store.recordViews["synthetic-owner"].awaitingDelete, true);
  const before = plain(store);
  pool.failAt = "delete";
  await assert.rejects(handleRecordViewAction(store, "synthetic-owner", "כן"), /synthetic failure/u);
  assert.deepEqual(plain(store), before);
  assert.equal(pool.committed.reminders.length, 1);
  assert.equal((await handleRecordViewAction(store, "synthetic-owner", "כן")).text, "הפריט נמחק");
  assert.equal(pool.committed.reminders.length, 0);
  assert.equal(pool.committed.state.reminders.length, 0);
  const restarted = await start(pool);
  assert.equal(restarted.reminders.length, 0);
  assert.equal(restarted.recordViews["synthetic-owner"], undefined);
  assert.equal(await handleRecordViewAction(restarted, "synthetic-owner", "כן"), null);
});

test("list cleanup and consumed confirmation commit together, survive restart, and roll back on failure", async () => {
  const pool = fakePool();
  let store = await start(pool);
  const request = "נקה את רשימת synthetic";
  const question = await rememberListConfirmation(store, "synthetic-owner", request, "מנקה. סגור?");
  store = await start(pool);
  assert.equal(store.listConfirmations["synthetic-owner"].awaiting, true);
  const before = plain(store);
  pool.failAt = "state";
  await assert.rejects(resolveListConfirmation(store, "synthetic-owner", "כן"), /synthetic failure/u);
  assert.deepEqual(plain(store), before);
  assert.deepEqual(plain(await start(pool)), before);
  await resolveListConfirmation(store, "synthetic-owner", "כן");
  assert.equal(pool.committed.state.lists["synthetic-owner"].synthetic.length, 0);
  assert.equal(pool.committed.state.listConfirmations["synthetic-owner"].awaiting, false);
  store = await start(pool);
  assert.equal(store.lists["synthetic-owner"].synthetic.length, 0);
  assert.equal(store.reminders.length, 1);
  assert.deepEqual(plain(store.pendingActions), before.pendingActions);
  assert.deepEqual(plain(store.pendingListActions), before.pendingListActions);
  // Even an unavailable history save cannot replay the consumed question.
  store.lists["synthetic-owner"].synthetic.push({ id: "new", text: "new", checked: false });
  await saveStore(store);
  const history = [{ role: "user", content: request }, { role: "assistant", content: question }];
  assert.equal(await resolveListConfirmation(store, "synthetic-owner", "כן", { history }), null);
  assert.equal((await start(pool)).lists["synthetic-owner"].synthetic.length, 1);
});

test("topic-switch cancellation remains cancelled after database reload and old history cannot clear the list", async () => {
  const pool = fakePool();
  let store = await start(pool);
  const request = "נקה את רשימת synthetic";
  const question = await rememberListConfirmation(store, "synthetic-owner", request, "סגור?");
  await resolveListConfirmation(store, "synthetic-owner", "רשימת קניות");
  store = await start(pool);
  assert.equal(store.listConfirmations["synthetic-owner"].awaiting, false);
  const history = [{ role: "user", content: request }, { role: "assistant", content: question }];
  assert.equal(await resolveListConfirmation(store, "synthetic-owner", "כן", { history }), null);
  assert.equal(store.lists["synthetic-owner"].synthetic.length, 1);
});

test("a free-text AI cleanup claim invokes SQL verification, and a fresh database read returns an empty list", async () => {
  const pool = fakePool();
  const store = await start(pool);
  const sent = [];
  await replyToOwnerMessage(store, { sendMessage: async (...args) => sent.push(args) },
    "synthetic-owner", "נקה אותה", {
      readHistory: async () => [],
      saveConversation: async () => {},
      assistant: (s, id, text, _, history) => handleAssistantMessage(s, id, text,
        async () => ({ type: "answer", response: "ניקיתי את הרשימה." }), history),
    });
  assert.ok(pool.events.includes("verify-list"));
  assert.equal((await loadStore(pool)).lists["synthetic-owner"].synthetic.length, 0);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0][1], /ניקיתי/u);
  assert.match(sent[0][1], /synthetic/u);
});

test("SQL verification rejects unchanged data or a failed SELECT, rolls back, and sends no success receipt", async () => {
  for (const mode of ["old-data", "read-failure"]) {
    const initial = fixture();
    initial.pendingListActions = Object.create(null);
    const pool = fakePool(initial);
    const store = await start(pool);
    const original = plain(store), sent = [];
    pool.events.length = 0;
    if (mode === "old-data") pool.returnOldListsOnVerification = true;
    else pool.failAt = "verify-list";
    await assert.rejects(replyToOwnerMessage(store, { sendMessage: async (...args) => sent.push(args) },
      "synthetic-owner", "/remove synthetic | 1", {
        readHistory: async () => [],
        saveConversation: async () => {},
      }), /database did not return|synthetic failure/u);
    assert.deepEqual(plain(store), original);
    assert.equal((await loadStore(pool)).lists["synthetic-owner"].synthetic.length, 1);
    assert.ok(pool.events.includes("ROLLBACK"));
    assert.equal(pool.events.includes("COMMIT"), false);
    assert.equal(sent.length, 0);
  }
});

test("a validated contextual cleanup runs the writer even when AI uses a different completion phrase", async () => {
  const pool = fakePool();
  const store = await start(pool);
  await handleAssistantMessage(store, "synthetic-owner", "נקה אותה",
    async () => ({ type: "answer", response: "סגרתי לך את זה, הרשימה פנויה." }));
  assert.equal((await loadStore(pool)).lists["synthetic-owner"].synthetic.length, 0);
  assert.ok(pool.events.includes("verify-list"));
});

test("an unbound AI deletion claim is rejected and never reaches a SQL write", async () => {
  const pool = fakePool();
  const store = await start(pool);
  const original = plain(store);
  pool.events.length = 0;
  const response = await handleAssistantMessage(store, "synthetic-owner", "אהלן אחי מה חדש אצלך",
    async () => ({ type: "answer", response: "אחי, מחקתי את הרשימה." }));
  assert.match(response, /לא מחקתי דבר/u);
  assert.deepEqual(plain(store), original);
  assert.equal(pool.events.includes("state"), false);
});

test("successful single-item deletion verifies SQL before returning; reload contains only the surviving item", async () => {
  const pool = fakePool();
  const store = await start(pool);
  store.lists["synthetic-owner"].synthetic.push({ id: "survivor", text: "surviving item", checked: false });
  await saveStore(store);
  pool.events.length = 0;
  await handleText(store, "synthetic-owner", "/remove synthetic | 1");
  assert.deepEqual(pool.events.slice(-4), ["BEGIN", "state", "verify-list", "COMMIT"]);
  assert.deepEqual((await loadStore(pool)).lists["synthetic-owner"].synthetic,
    [{ id: "survivor", text: "surviving item", checked: false }]);
});

test("Telegram occurrence receipts survive database reload without new schema columns", async () => {
  const initial = fixture();
  initial.reminders[0].telegramDeliveries = {
    synthetic: { state: "done", messageId: 11, completedAt: 1000 },
  };
  const pool = fakePool(initial);
  const store = await start(pool);
  assert.deepEqual(store.reminders[0].telegramDeliveries, initial.reminders[0].telegramDeliveries);
  assert.deepEqual(pool.committed.state.reminders[0].telegramDeliveries,
    initial.reminders[0].telegramDeliveries);
  const reloaded = await start(pool);
  assert.deepEqual(reloaded.reminders[0].telegramDeliveries, initial.reminders[0].telegramDeliveries);
  assert.equal(reloaded.reminders[0].dueAt, reminder.dueAt);
});

test("completion and deletion UI retries survive SQL reload in the action transaction", async () => {
  for (const action of ["d", "x"]) {
    const initial = fixture();
    const key = occurrenceKey(reminder.dueAt);
    initial.reminders[0].telegramDeliveries = {
      [key]: { state: "sent", messageId: 11, nagMessageIds: [12], sentAt: 1000 },
    };
    initial.reminders[0].sentAt = 1000;
    const pool = fakePool(initial);
    const store = await start(pool);
    const telegram = {
      call: async () => { throw new Error("synthetic Telegram outage"); },
      sendMessage: async () => { throw new Error("synthetic Telegram outage"); },
    };
    await handleReminderCallback(store, telegram, {
      id: "synthetic-callback", from: { id: reminder.chatId },
      data: reminderKeyboard(reminder).inline_keyboard[0][action === "d" ? 0 : 1].callback_data,
      message: { message_id: 11, text: "synthetic", from: { is_bot: true },
        chat: { id: reminder.chatId, type: "private" } },
    }, { ownerChatId: reminder.chatId });
    assert.equal(pool.committed.reminders.length, action === "d" ? 1 : 0);
    const restarted = await start(pool);
    const receipt = action === "d" ? restarted.reminders[0] : restarted.telegramDeletionReceipts[0];
    const jobs = receipt.telegramDeliveries[key].messageUpdates;
    assert.ok(jobs.every(job => job.status === "pending" && job.attempts === 1));
    const calls = [];
    telegram.call = async (method, payload) => { calls.push({ method, payload }); };
    await retryReminderMessageUpdates(restarted, telegram, {
      ownerChatId: reminder.chatId, now: () => Math.max(...jobs.map(job => job.nextAttemptAt)),
    });
    assert.deepEqual(calls.map(call => call.payload.message_id), [11, 12]);
    const reloaded = await loadStore(pool);
    const saved = action === "d" ? reloaded.reminders[0] : reloaded.telegramDeletionReceipts[0];
    assert.ok(saved.telegramDeliveries[key].messageUpdates.every(job => job.status === "updated"));
    assert.equal(pool.committed.reminders.length, action === "d" ? 1 : 0);
    assert.deepEqual(plain(reloaded.lists), plain(initial.lists));
  }
});

test("pre-COMMIT SQL failures roll back reminders and state, preserve memory/backup, and permit retry", async () => {
  const cases = [
    ["connect", 1], ["BEGIN", 1], ["reminder", 1], ["reminder", 2],
    ["delete", 1], ["state", 1],
  ];
  for (const [stage, nth] of cases) {
    const pool = fakePool();
    const store = await start(pool);
    const before = plain(store);
    const databaseBefore = structuredClone(pool.committed);
    const releasesBefore = pool.releases;
    pool.events = [];
    pool.failAt = stage;
    pool.failNth = nth;
    await assert.rejects(mutateReminderState(store, append), /synthetic failure/);
    assert.deepEqual(plain(store), before, stage);
    assert.deepEqual(pool.committed, databaseBefore, stage);
    assert.deepEqual(await backup(), before, stage);
    assert.equal(pool.releases - releasesBefore, stage === "connect" ? 0 : 1);
    if (stage !== "connect") assert.equal(pool.events.at(-1), "ROLLBACK");
    assert.deepEqual(plain(await loadStore(pool)), before);

    // Retry before resetting the persistence snapshot: a premature cache update
    // would skip the required reminder writes and make these stores disagree.
    await mutateReminderState(store, append);
    assert.equal((await loadPersistedReminders(pool)).length, 2, stage);
    assert.deepEqual(pool.committed.state, plain(store), stage);
    assert.deepEqual(plain(await start(pool)), plain(store), stage);
  }
});

test("directory and temporary-file failures happen before any database write", async () => {
  for (const stage of ["mkdir", "writeFile"]) {
    const pool = fakePool();
    const store = await start(pool);
    const before = plain(store);
    pool.events = [];
    const moved = `${directory}-moved`;
    const temporary = path.join(directory, `state.json.${process.pid}.tmp`);
    if (stage === "mkdir") {
      await rename(directory, moved);
      await writeFile(directory, "synthetic blocker");
    } else {
      await rm(temporary, { force: true });
      await mkdir(temporary);
    }
    try {
      await assert.rejects(mutateReminderState(store, append), /EEXIST|ENOTDIR|EISDIR/);
      assert.deepEqual(plain(store), before);
      assert.deepEqual(pool.committed.state, before);
      assert.deepEqual(pool.events, []);
      assert.deepEqual(plain(await loadStore(pool)), before);
    } finally {
      if (stage === "mkdir") {
        await rm(directory, { force: true });
        await rename(moved, directory);
      } else await rm(temporary, { recursive: true, force: true });
    }
    assert.deepEqual(plain(await start(pool)), before);
  }
});

test("post-commit backup replacement failure succeeds and restart ignores damaged/missing/stale backup", async () => {
  const pool = fakePool();
  const store = await start(pool);
  const old = plain(store);
  const stateFile = path.join(directory, "state.json");
  await rm(stateFile);
  await mkdir(stateFile); // rename cannot replace a directory
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    await mutateReminderState(store, append);
  } finally {
    console.warn = originalWarn;
    await rm(stateFile, { recursive: true, force: true });
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /committed.*backup/);
  assert.equal(store.reminders.length, 2);
  assert.equal(store.pendingActions["synthetic-owner"], undefined);
  assert.deepEqual(pool.committed.state, plain(store));
  for (const contents of [null, "{synthetic corrupt JSON", JSON.stringify(old)]) {
    await rm(stateFile, { force: true });
    if (contents !== null) await writeFile(stateFile, contents);
    assert.deepEqual(plain(await start(pool)), plain(store));
    assert.deepEqual(await backup(), plain(store));
    assert.deepEqual(await loadPersistedReminders(pool), store.reminders);
  }
});

test("failed deletion/empty snapshot cannot resurrect or delete reminders across startup", async () => {
  for (const stage of ["delete", "state"]) {
    const pool = fakePool();
    let store = await start(pool);
    const before = plain(store);
    pool.failAt = stage;
    await assert.rejects(mutateReminderState(store, candidate => {
      candidate.reminders = [];
    }), /synthetic failure/);
    store = await start(pool);
    assert.deepEqual(plain(store), before);
    await mutateReminderState(store, candidate => { candidate.reminders = []; });
    // Keep a stale backup deliberately containing the now-deleted reminder.
    await writeFile(path.join(directory, "state.json"), JSON.stringify(before));
    assert.deepEqual((await start(pool)).reminders, []);
    assert.deepEqual(await loadPersistedReminders(pool), []);
  }
});

test("pending-only changes still use an atomic state transaction without needless reminder writes", async () => {
  const pool = fakePool();
  let store = await start(pool);
  const before = plain(store);
  pool.events = [];
  pool.failAt = "state";
  await assert.rejects(setPendingAction(store, "synthetic-owner", null), /synthetic failure/);
  assert.deepEqual(plain(store), before);
  assert.equal(pool.events.includes("reminder"), false);
  assert.deepEqual(plain(await start(pool)), before);
  pool.events = [];
  await setPendingAction(store, "synthetic-owner", null);
  assert.deepEqual(pool.events, ["connect", "BEGIN", "state", "COMMIT"]);
  store = await start(pool);
  assert.equal(store.pendingActions["synthetic-owner"], undefined);
  assert.deepEqual(store.reminders, before.reminders);
});

test("initial file migration and previously stored reminders commit together or not at all", async () => {
  for (const stage of ["reminder", "state", null]) {
    const fileStore = fixture();
    const pool = fakePool(null);
    pool.committed.reminders = [row({ ...reminder, id: "synthetic-legacy-db" })];
    await writeFile(path.join(directory, "state.json"), JSON.stringify(fileStore));
    const store = await loadStore(pool);
    await initializeStatePersistence(store, pool);
    pool.failAt = stage;
    if (stage) {
      const before = structuredClone(pool.committed);
      await assert.rejects(initializeReminderPersistence(store, pool), /synthetic failure/);
      assert.deepEqual(pool.committed, before);
      assert.deepEqual(await backup(), plain(fileStore));
      assert.deepEqual(plain(store), plain(fileStore));
    } else await initializeReminderPersistence(store, pool);
    const restarted = await start(pool);
    assert.equal(restarted.reminders.length, 2);
    assert.deepEqual(pool.committed.state, plain(restarted));
    assert.deepEqual(await loadPersistedReminders(pool), restarted.reminders);
  }
});

test("database initialization does not expose a half-migrated owner snapshot", async () => {
  const pool = fakePool(null);
  const store = fixture();
  await initializeStatePersistence(store, pool);
  assert.equal(pool.committed.state, null);
  assert.equal(pool.events.includes("COMMIT"), false);
  // The default persister is attached only when completing initialization.
  setReminderPersistence(null);
});

test("failed rollback discards the client and preserves the original write error", async () => {
  const pool = fakePool();
  const store = await start(pool);
  const before = structuredClone(pool.committed);
  pool.failAt = "state";
  pool.failRollback = true;
  await assert.rejects(mutateReminderState(store, append), /synthetic failure at state/);
  assert.match(pool.releaseErrors.at(-1).message, /rollback failure/);
  assert.deepEqual(pool.committed, before);
  assert.deepEqual(plain(store), before.state);
  pool.failRollback = false;
  assert.deepEqual(plain(await start(pool)), before.state);
});

test("delivery metadata and companion context change together across failures and restart", async () => {
  const pool = fakePool();
  const store = await start(pool);
  const before = plain(store);
  const candidate = structuredClone(store);
  candidate.reminders[0].sentAt = 5000;
  candidate.reminders[0].lastAttemptAt = 4000;
  candidate.reminders[0].remainingOccurrences = 2;
  candidate.reminders[0].dueAt += 120000;
  candidate.lastUpdateId = 11;
  candidate.lists["synthetic-owner"].synthetic[0].checked = true;
  delete candidate.pendingListActions["synthetic-owner"];
  pool.failAt = "state";
  await assert.rejects(saveStore(candidate), /synthetic failure/);
  assert.deepEqual(plain(await start(pool)), before);
  await saveStore(candidate);
  assert.deepEqual(plain(await start(pool)), plain(candidate));
  assert.deepEqual(await loadPersistedReminders(pool), candidate.reminders);
});
