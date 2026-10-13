import { randomUUID } from "node:crypto";
import { recordListReceipt } from "./list-mutation-receipts.js";
import { isDeepStrictEqual } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPool } from "./database.js";
import { updateShoppingStatus } from "./shopping-lifecycle.js";

const dataDirectory = process.env.AH_SHELI_DATA_DIR
  ? path.resolve(process.env.AH_SHELI_DATA_DIR)
  : fileURLToPath(new URL("../data/", import.meta.url));
const stateFile = path.join(dataDirectory, "state.json");

export function createEmptyStore() {
  return {
    version: 1,
    lastUpdateId: 0,
    lists: Object.create(null),
    reminders: [],
    telegramDeletionReceipts: [],
    savedSchedules: [],
    pendingActions: Object.create(null),
    pendingListActions: Object.create(null),
    lastListActions: Object.create(null),
    recordViews: Object.create(null),
    listConfirmations: Object.create(null),
    dailyRecaps: Object.create(null),
    listStatuses: Object.create(null),
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStore(parsed) {
  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new Error("The saved Ah Sheli data file has an unsupported format.");
  }
  if (!isRecord(parsed.lists) || !Array.isArray(parsed.reminders)) {
    throw new Error("The saved Ah Sheli data file is missing required sections.");
  }
  if (
    parsed.pendingActions !== undefined &&
    !isRecord(parsed.pendingActions)
  ) {
    throw new Error("The saved pending actions section is invalid.");
  }
  if (
    parsed.lastUpdateId !== undefined &&
    (!Number.isInteger(parsed.lastUpdateId) || parsed.lastUpdateId < 0)
  ) {
    throw new Error("The saved Telegram update position is invalid.");
  }

  const store = createEmptyStore();
  for (const field of ["dailyRecaps", "listStatuses"]) {
    if (parsed[field] !== undefined && !isRecord(parsed[field])) throw new Error(`Invalid ${field}.`);
    store[field] = Object.assign(Object.create(null), parsed[field] ?? {});
  }
  if (parsed.listConfirmations !== undefined && !isRecord(parsed.listConfirmations)) {
    throw new Error("The saved list confirmation state is invalid.");
  }
  for (const [chatId, confirmation] of Object.entries(parsed.listConfirmations ?? {})) {
    if (!isRecord(confirmation) || typeof confirmation.listName !== "string"
      || typeof confirmation.awaiting !== "boolean"
      || !/^[A-Za-z0-9_-]{22}$/u.test(confirmation.historyKey)) {
      throw new Error("A saved list confirmation is invalid.");
    }
    store.listConfirmations[chatId] = { ...confirmation };
  }
  if (parsed.recordViews !== undefined && !isRecord(parsed.recordViews)) {
    throw new Error("The saved record view context is invalid.");
  }
  for (const [chatId, view] of Object.entries(parsed.recordViews ?? {})) {
    if (!isRecord(view) || !/^[lr][A-Za-z0-9_-]{22}$/u.test(view.key)
      || !/^(?:s|r|t|n|l[A-Za-z0-9_-]{22})$/u.test(view.scope)
      || !["c", "a"].includes(view.mode) || !Number.isSafeInteger(view.offset)
      || view.offset < 0 || typeof view.awaitingDelete !== "boolean") {
      throw new Error("A saved record view target is invalid.");
    }
    store.recordViews[chatId] = { ...view };
  }
  if (parsed.savedSchedules !== undefined && (!Array.isArray(parsed.savedSchedules)
    || parsed.savedSchedules.some(item => !isRecord(item) || typeof item.id !== "string"
      || typeof item.chatId !== "string" || typeof item.source !== "string" || !Array.isArray(item.entries)
      || item.entries.some(entry => !isRecord(entry) || typeof entry.reminderId !== "string"
        || typeof entry.text !== "string" || !Array.isArray(entry.weekdays) || !entry.weekdays.length
        || entry.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
        || !Number.isInteger(entry.hour) || entry.hour < 0 || entry.hour > 23
        || !Number.isInteger(entry.minute) || entry.minute < 0 || entry.minute > 59)))) {
    throw new Error("A saved schedule is invalid.");
  }
  store.savedSchedules = structuredClone(parsed.savedSchedules ?? []);
  if (parsed.pendingListActions !== undefined && !isRecord(parsed.pendingListActions)) {
    throw new Error("The saved pending list actions section is invalid.");
  }
  for (const [chatId, action] of Object.entries(parsed.pendingListActions ?? {})) {
    if (!isRecord(action) || action.type !== "add-items" || !Array.isArray(action.items)
      || action.items.length < 1 || action.items.length > 20
      || action.items.some(item => typeof item !== "string" || !item.trim()
        || item !== item.trim() || item.length > 200)) {
      throw new Error("A saved pending list action is invalid.");
    }
    store.pendingListActions[chatId] = { type: "add-items", items: [...action.items] };
  }
  store.lastUpdateId = parsed.lastUpdateId ?? 0;
  for (const [chatId, action] of Object.entries(parsed.pendingActions ?? {})) {
    if (
      !isRecord(action) ||
      action.type !== "reminder" ||
      typeof action.text !== "string" ||
      (action.date !== null && typeof action.date !== "string") ||
      (action.hour !== null && !Number.isInteger(action.hour)) ||
      (action.minute !== null && !Number.isInteger(action.minute))
    ) {
      throw new Error(`A saved pending action for chat ${chatId} is invalid.`);
    }
    store.pendingActions[chatId] = action;
  }
  for (const [chatId, rawLists] of Object.entries(parsed.lists)) {
    if (!isRecord(rawLists)) {
      throw new Error(`Saved lists for chat ${chatId} are invalid.`);
    }

    const chatLists = Object.create(null);
    for (const [name, rawItems] of Object.entries(rawLists)) {
      if (!Array.isArray(rawItems)) {
        throw new Error(`Saved list "${name}" is invalid.`);
      }
      chatLists[name] = rawItems.map((item) => {
        if (
          !isRecord(item) ||
          typeof item.id !== "string" ||
          typeof item.text !== "string" ||
          typeof item.checked !== "boolean"
        ) {
          throw new Error(`An item in the saved list "${name}" is invalid.`);
        }
        return item;
      });
    }
    store.lists[chatId] = chatLists;
  }

  if (parsed.lastListActions !== undefined && !isRecord(parsed.lastListActions)) {
    throw new Error("The saved list action context is invalid.");
  }
  for (const [chatId, action] of Object.entries(parsed.lastListActions ?? {})) {
    if (!isRecord(action) || typeof action.listName !== "string"
      || !Object.hasOwn(store.lists[chatId] ?? {}, action.listName)) {
      throw new Error("A saved list action target is invalid.");
    }
    store.lastListActions[chatId] = { listName: action.listName };
  }

  store.reminders = parsed.reminders.map((reminder) => {
    if (
      !isRecord(reminder) ||
      typeof reminder.id !== "string" ||
      typeof reminder.chatId !== "string" ||
      typeof reminder.text !== "string" ||
      typeof reminder.dueAt !== "number" ||
      !Number.isFinite(reminder.dueAt)
    ) {
      throw new Error("A saved reminder is invalid.");
    }
    if (reminder.repeatEveryMs != null && (!Number.isSafeInteger(reminder.repeatEveryMs)
      || reminder.repeatEveryMs < 60_000 || reminder.repeatEveryMs > 604_800_000)) {
      throw new Error("A saved reminder interval is invalid.");
    }
    if (reminder.remainingOccurrences != null && (!Number.isInteger(reminder.remainingOccurrences)
      || reminder.remainingOccurrences < 0 || reminder.remainingOccurrences > 1000)) {
      throw new Error("A saved reminder repetition count is invalid.");
    }
    return reminder;
  });
  if (parsed.telegramDeletionReceipts !== undefined
    && (!Array.isArray(parsed.telegramDeletionReceipts)
      || parsed.telegramDeletionReceipts.length > 128
      || parsed.telegramDeletionReceipts.some(receipt => !isRecord(receipt)
        || typeof receipt.id !== "string" || typeof receipt.chatId !== "string"
        || !isRecord(receipt.telegramDeliveries)))) {
    throw new Error("The saved Telegram deletion receipts are invalid.");
  }
  store.telegramDeletionReceipts = structuredClone(parsed.telegramDeletionReceipts ?? []);

  return store;
}

export async function loadStore(pool = null) {
  // A stale, missing or damaged backup must not block loading committed data.
  if (pool) {
    const { rows } = await pool.query(
      "SELECT value FROM ah_sheli_state WHERE key = 'owner'",
    );
    if (rows.length) return parseStore(rows[0].value);
  }
  await mkdir(dataDirectory, { recursive: true });
  try {
    const contents = await readFile(stateFile, "utf8");
    return parseStore(JSON.parse(contents));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const store = createEmptyStore();
    await saveStore(store);
    return store;
  }
}

let writeQueue = Promise.resolve();
let statePool = null;
let reminderPersister = null;
let persistedReminderSnapshot = null;
let unknownCommitError = null;
let onUnknownCommit = () => {};

export function setUnknownCommitHandler(handler) {
  onUnknownCommit = handler;
}

// A fresh process must reacquire exclusive ownership and reload the database.
// Neither initialization nor a successful later query can clear this latch.
export function assertStatePersistenceActive() {
  if (unknownCommitError) throw unknownCommitError;
}

export function setReminderPersistence(persist, currentReminders = []) {
  reminderPersister = persist;
  persistedReminderSnapshot = JSON.stringify(currentReminders);
}

export async function initializeStatePersistence(store, pool = getPool()) {
  assertStatePersistenceActive();
  const { rows } = await pool.query(
    "SELECT value FROM ah_sheli_state WHERE key = 'owner'",
  );
  if (rows.length) {
    const persisted = parseStore(rows[0].value);
    // The database is authoritative after first migration; the old file
    // is retained as a backup, never used to resurrect deleted records.
    Object.assign(store, persisted);
  }
  statePool = pool;
  // Initialization finishes in initializeReminderPersistence: migration must
  // save the merged reminders and state together, not publish half a migration.
}

export function saveStore(store, { verifyList = null, verifyReminder = null } = {}) {
  if (unknownCommitError) return Promise.reject(unknownCommitError);
  const serialized = `${JSON.stringify(store, null, 2)}\n`;
  const reminderSnapshot = JSON.stringify(store.reminders);
  const write = writeQueue.catch(() => undefined).then(async () => {
    let verifiedList;
    assertStatePersistenceActive();
    await mkdir(dataDirectory, { recursive: true });
    const temporaryFile = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporaryFile, serialized, { encoding: "utf8", mode: 0o600 });

    const remindersChanged = reminderPersister && reminderSnapshot !== persistedReminderSnapshot;
    if (statePool) {
      const client = await statePool.connect();
      let releaseError;
      let committing = false;
      try {
        await client.query("BEGIN");
        if (remindersChanged) {
          // The callback writes on this client without opening its own transaction.
          await reminderPersister(JSON.parse(reminderSnapshot), client);
        }
        await client.query(
          `INSERT INTO ah_sheli_state (key, value) VALUES ('owner', $1::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [serialized],
        );
        // Revoke shares atomically when a list disappears, including deletion
        // from Telegram. A later list with the same name must not inherit access.
        const { rows: shareTable } = await client.query(
          "SELECT to_regclass('ah_sheli_list_shares') AS relation");
        if (shareTable[0]?.relation) {
          await client.query(`DELETE FROM ah_sheli_list_shares
            WHERE NOT COALESCE(($1::jsonb->'lists'->owner_id) ? list_name, false)`, [serialized]);
        }
        if (verifyList) {
          const { rows } = await client.query("SELECT value FROM ah_sheli_state WHERE key = 'owner'");
          const saved = typeof rows[0]?.value === "string" ? JSON.parse(rows[0].value) : rows[0]?.value;
          const expected = JSON.parse(serialized);
          if (!saved || !isDeepStrictEqual(saved.lists?.[verifyList.chatId]?.[verifyList.listName],
            expected.lists?.[verifyList.chatId]?.[verifyList.listName])) {
            const error = new Error("The database did not return the expected updated list.");
            error.code = "LIST_WRITE_NOT_VERIFIED";
            throw error;
          }
          verifiedList = structuredClone(saved.lists?.[verifyList.chatId]?.[verifyList.listName]);
        }
        if (verifyReminder) {
          const { rows } = await client.query(
            "SELECT id, chat_id, due_at FROM ah_sheli_reminders WHERE id = $1 AND chat_id = $2",
            [verifyReminder.id, verifyReminder.chatId],
          );
          if (rows.length !== 1 || new Date(rows[0].due_at).getTime() !== verifyReminder.dueAt) {
            const error = new Error("The database did not return the expected updated reminder.");
            error.code = "REMINDER_WRITE_NOT_VERIFIED";
            throw error;
          }
        }
        committing = true;
        await client.query("COMMIT");
      } catch (error) {
        if (committing) {
          // Even a successful ROLLBACK now cannot prove COMMIT did not happen.
          // Discard the connection and fence every already-queued write.
          unknownCommitError = new Error(
            "State COMMIT outcome is unknown; restart under exclusive ownership and reload before continuing.",
            { cause: error },
          );
          unknownCommitError.code = "STATE_COMMIT_UNKNOWN";
          releaseError = unknownCommitError;
          try {
            onUnknownCommit(unknownCommitError);
          } finally {
            throw unknownCommitError;
          }
        }
        await client.query("ROLLBACK").catch(rollbackError => {
          // Never put a connection with an unclosed transaction back in the pool.
          releaseError = rollbackError;
        });
        throw error;
      } finally {
        client.release(releaseError);
      }
    } else if (remindersChanged) {
      await reminderPersister(JSON.parse(reminderSnapshot));
    }
    // Advance the cache only after the entire authoritative write succeeds.
    if (statePool && remindersChanged) persistedReminderSnapshot = reminderSnapshot;
    // A rejected authoritative write must not publish an unconfirmed context
    // in the file used by file-only workers after a restart.
    try {
      await rename(temporaryFile, stateFile);
    } catch (error) {
      if (!statePool) throw error;
      // COMMIT is the success boundary. Rejecting here would make callers undo
      // live state even though the database has already accepted the candidate.
      console.warn("[Ah Sheli] State committed to PostgreSQL, but the local backup could not be replaced.");
    }
    if (!statePool && remindersChanged) persistedReminderSnapshot = reminderSnapshot;
    // Production receipts use the rows actually read from PostgreSQL, released
    // only after COMMIT succeeds. File-only test/tool mode retains its writer.
    return verifyList && !statePool
      ? JSON.parse(serialized).lists?.[verifyList.chatId]?.[verifyList.listName]
      : verifiedList;
  });
  writeQueue = write.catch(() => undefined);
  return write;
}

export function createId() {
  return randomUUID();
}

export function getChatLists(store, chatId) {
  if (!store.lists[chatId]) store.lists[chatId] = Object.create(null);
  return store.lists[chatId];
}

export function getChatReminders(store, chatId) {
  return store.reminders.filter(
    (reminder) => reminder.chatId === chatId && !reminder.sentAt,
  );
}

export function getPendingAction(store, chatId) {
  return store.pendingActions[chatId] ?? null;
}

// Keep unconfirmed reminders invisible to the delivery worker. The callback
// edits a detached candidate synchronously; failure leaves live state intact.
export async function mutateReminderState(store, mutate, options = {}) {
  const candidate = {
    ...store,
    // Existing records retain identity: the worker may be recording a delivery
    // outcome while this write awaits I/O. Callers only append/remove records.
    reminders: [...store.reminders],
    telegramDeletionReceipts: structuredClone(store.telegramDeletionReceipts ?? []),
    savedSchedules: structuredClone(store.savedSchedules ?? []),
    pendingActions: Object.assign(Object.create(null), structuredClone(store.pendingActions)),
  };
  mutate(candidate);
  await saveStore(candidate, options);
  store.reminders = candidate.reminders;
  store.telegramDeletionReceipts = candidate.telegramDeletionReceipts;
  store.savedSchedules = candidate.savedSchedules;
  store.pendingActions = candidate.pendingActions;
}

export async function setPendingAction(store, chatId, action) {
  const pendingActions = Object.assign(Object.create(null), store.pendingActions);
  if (action) pendingActions[chatId] = { ...action };
  else delete pendingActions[chatId];
  await saveStore({ ...store, pendingActions });
  store.pendingActions = pendingActions;
}

export function getLastListAction(store, chatId) {
  const action = store.lastListActions?.[chatId];
  return action && Object.hasOwn(store.lists[chatId] ?? {}, action.listName)
    ? { listName: action.listName } : null;
}

export function getPendingListAction(store, chatId) {
  return store.pendingListActions?.[chatId] ?? null;
}

// Publish clarification context only after its durable write succeeds.
export async function setPendingListAction(store, chatId, action) {
  const pendingListActions = Object.assign(Object.create(null), store.pendingListActions);
  if (action) pendingListActions[chatId] = { type: "add-items", items: [...action.items] };
  else delete pendingListActions[chatId];
  await saveStore({ ...store, pendingListActions });
  store.pendingListActions = pendingListActions;
}

export async function mutateList(store, chatId, listName, mutate, consumePendingList = false, consumePendingReminder = false,
  { verifyDeletion = false, completedAt = Date.now() } = {}) {
  const lists = getChatLists(store, chatId);
  const previousLists = structuredClone(lists);
  store.lastListActions ??= Object.create(null);
  try {
    mutate();
    const previousItems = new Map((previousLists[listName] ?? []).map(item => [item.id, item]));
    for (const item of lists[listName] ?? []) {
      const previous = previousItems.get(item.id);
      if (previous) trackItemCompletion(item, previous.checked, completedAt);
    }
    // Persist the candidate context with its items, but do not expose it as
    // confirmed to another consumer until persistence has resolved.
    const candidate = {
      ...store,
      lastListActions: Object.assign(Object.create(null), store.lastListActions, {
        [chatId]: { listName },
      }),
    };
    // Deleted lists cannot remain conversational targets: parseStore validates
    // those references on a fresh database read and on worker restart.
    if (!Object.hasOwn(lists, listName)) delete candidate.lastListActions[chatId];
    if (consumePendingList) {
      candidate.pendingListActions = Object.assign(Object.create(null), store.pendingListActions);
      delete candidate.pendingListActions[chatId];
    }
    if (consumePendingReminder) {
      candidate.pendingActions = Object.assign(Object.create(null), store.pendingActions);
      delete candidate.pendingActions[chatId];
    }
    // Additions, edits and completion need the same authoritative readback as
    // deletion. Do not publish a receipt for an unverified database write.
    updateShoppingStatus(candidate, chatId, listName, completedAt);
    const savedList = await saveStore(candidate, { verifyList: { chatId, listName } });
    store.listStatuses = candidate.listStatuses;
    store.lastListActions = candidate.lastListActions;
    if (consumePendingList) store.pendingListActions = candidate.pendingListActions;
    if (consumePendingReminder) store.pendingActions = candidate.pendingActions;
    recordListReceipt(chatId, listName, previousLists[listName], savedList);
    return savedList;
  } catch (error) {
    store.lists[chatId] = Object.assign(Object.create(null), previousLists);
    throw error;
  }
}

// Completion dates travel with the same verified write as the checked flag.
// Do not backdate legacy records or change the date on idempotent completion.
export function trackItemCompletion(item, wasChecked, completedAt = Date.now()) {
  if (!wasChecked && item.checked) item.completedAt = completedAt;
  else if (wasChecked && !item.checked) delete item.completedAt;
}
