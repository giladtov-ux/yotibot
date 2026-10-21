import { randomUUID } from "node:crypto";
import { UserInputError } from "./input-errors.js";
import { recordListReceipt } from "./list-mutation-receipts.js";
import { reminderWriteSnapshot, recordReminderReceipts } from "./reminder-mutation-receipts.js";
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
    telegramMenuMessages: Object.create(null),
    currentStateOnly: false,
    reminderCheckIns: Object.create(null),
    savedSchedules: [],
    pendingActions: Object.create(null),
    pendingListActions: Object.create(null),
    lastListActions: Object.create(null),
    recordViews: Object.create(null),
    pendingReminderSelections: Object.create(null),
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
  for (const field of ["dailyRecaps", "listStatuses", "reminderCheckIns"]) {
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
  if (parsed.pendingReminderSelections !== undefined && !isRecord(parsed.pendingReminderSelections)) {
    throw new Error("The saved reminder selection context is invalid.");
  }
  for (const [chatId, selection] of Object.entries(parsed.pendingReminderSelections ?? {})) {
    if (!isRecord(selection) || selection.action !== "delete"
      || !Number.isSafeInteger(selection.createdAt)
      || !Array.isArray(selection.keys) || !selection.keys.length
      || selection.keys.some(key => typeof key !== "string" || !/^r[A-Za-z0-9_-]{22}$/u.test(key))) {
      throw new Error("A saved reminder selection is invalid.");
    }
    store.pendingReminderSelections[chatId] = { ...selection, keys: [...selection.keys] };
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
    if (isRecord(action) && action.type === "reminder-edit" && isRecord(action.plan)
      && typeof action.text === "string" && Number.isFinite(action.createdAt)
      && Array.isArray(action.candidateIds) && action.candidateIds.every(id => typeof id === "string")) {
      store.pendingActions[chatId] = action;
      continue;
    }
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
  if (parsed.telegramMenuMessages !== undefined && !isRecord(parsed.telegramMenuMessages)) {
    throw new Error("Invalid saved reminder menu references.");
  }
  for (const [chatId, reference] of Object.entries(parsed.telegramMenuMessages ?? {})) {
    if (!isRecord(reference) || !Number.isSafeInteger(reference.messageId)) {
      throw new Error("Invalid saved reminder menu message.");
    }
    store.telegramMenuMessages[chatId] = { messageId: reference.messageId };
  }
  store.currentStateOnly = parsed.currentStateOnly === true;
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
// One owner-scoped SQL snapshot feeds both the text and its button counts.
// With no SQL binding (isolated/file-backed mode), use the same current store.
export async function refreshCommittedLists(store, chatId) {
  if (!statePool) return;
  const { rows } = await statePool.query(
    `SELECT COALESCE(value->'lists'->($1::text), '{}'::jsonb) AS lists,
      COALESCE(value->'listStatuses'->($1::text), '{}'::jsonb) AS statuses
      FROM ah_sheli_state WHERE key = 'owner'`, [chatId]);
  if (!rows.length || !isRecord(rows[0].lists)
    || Object.values(rows[0].lists).some(items => !Array.isArray(items))) {
    throw new Error("Committed list snapshot is unavailable.");
  }
  store.lists[chatId] = Object.assign(Object.create(null), rows[0].lists);
  store.listStatuses ??= Object.create(null);
  store.listStatuses[chatId] = rows[0].statuses;
}
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

export function saveStore(store, { verifyList = null, verifyReminder = null, verifyRetention = null, verifyCheckIns = null,
  verifyOwnerState = null } = {}) {
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
          const names = verifyList.listNames ?? [verifyList.listName];
          if (!saved || names.some(name => !isDeepStrictEqual(saved.lists?.[verifyList.chatId]?.[name],
            expected.lists?.[verifyList.chatId]?.[name]))) {
            const error = new Error("The database did not return the expected updated list.");
            error.code = "LIST_WRITE_NOT_VERIFIED";
            throw error;
          }
          verifiedList = structuredClone(verifyList.listNames
            ? Object.fromEntries(names.map(name => [name, saved.lists?.[verifyList.chatId]?.[name]]))
            : saved.lists?.[verifyList.chatId]?.[verifyList.listName]);
        }
        if (verifyReminder) {
          const { rows } = await client.query(
            verifyReminder.text !== undefined
              ? "SELECT id, chat_id, due_at, text FROM ah_sheli_reminders WHERE id = $1 AND chat_id = $2"
              : "SELECT id, chat_id, due_at FROM ah_sheli_reminders WHERE id = $1 AND chat_id = $2",
            [verifyReminder.id, verifyReminder.chatId],
          );
          if (rows.length !== 1 || new Date(rows[0].due_at).getTime() !== verifyReminder.dueAt
            || (verifyReminder.text !== undefined && rows[0].text !== verifyReminder.text)) {
            const error = new Error("The database did not return the expected updated reminder.");
            error.code = "REMINDER_WRITE_NOT_VERIFIED";
            throw error;
          }
          if (verifyReminder.absentIds?.length) {
            const removed = await client.query(
              "SELECT id FROM ah_sheli_reminders WHERE chat_id=$1 AND id=ANY($2)",
              [verifyReminder.chatId, verifyReminder.absentIds]);
            if (removed.rows.length) {
              const error = new Error("The replaced duplicate reminders were not removed.");
              error.code = "REMINDER_WRITE_NOT_VERIFIED";
              throw error;
            }
          }
        }
        if (verifyOwnerState) {
          const { rows } = await client.query("SELECT value FROM ah_sheli_state WHERE key='owner'");
          const actual = typeof rows[0]?.value === "string" ? JSON.parse(rows[0].value) : rows[0]?.value;
          const expected = JSON.parse(serialized);
          const id = verifyOwnerState.chatId;
          const owned = state => ({
            lists: state?.lists?.[id] ?? {},
            reminders: state?.reminders?.filter(item => item.chatId === id),
            schedules: state?.savedSchedules?.filter(item => item.chatId === id),
            checkIns: state?.reminderCheckIns?.[id] ?? null,
          });
          if (!actual || !isDeepStrictEqual(owned(actual), owned(expected))) {
            const error = new Error("Tool state write was not verified.");
            error.code = "TOOL_WRITE_NOT_VERIFIED";
            throw error;
          }
        }
        if (verifyCheckIns) {
          const { rows } = await client.query("SELECT value FROM ah_sheli_state WHERE key='owner'");
          const actual = typeof rows[0]?.value === "string" ? JSON.parse(rows[0].value) : rows[0]?.value;
          if (!isDeepStrictEqual(actual?.reminderCheckIns?.[verifyCheckIns.chatId],
            store.reminderCheckIns?.[verifyCheckIns.chatId])) throw new Error("Check-in state was not verified.");
        }
        if (verifyRetention) {
          const { rows } = await client.query("SELECT value FROM ah_sheli_state WHERE key='owner'");
          const actual = typeof rows[0]?.value === "string" ? JSON.parse(rows[0].value) : rows[0]?.value;
          const expected = JSON.parse(serialized);
          const owned = state => state?.savedSchedules?.filter(item => item.chatId === verifyRetention.chatId);
          if (!actual?.currentStateOnly || !isDeepStrictEqual(owned(actual), owned(expected))
            || !isDeepStrictEqual(actual.lists?.[verifyRetention.chatId], expected.lists?.[verifyRetention.chatId])) {
            throw new Error("Current-state retention was not verified.");
          }
          if (verifyRetention.removed.length) {
            const leftovers = await client.query("SELECT id FROM ah_sheli_reminders WHERE chat_id=$1 AND id=ANY($2)",
              [verifyRetention.chatId, verifyRetention.removed]);
            if (leftovers.rows.length) throw new Error("Expired reminders remain after cleanup.");
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
      ? verifyList.listNames
        ? Object.fromEntries(verifyList.listNames.map(name => [name, JSON.parse(serialized).lists?.[verifyList.chatId]?.[name]]))
        : JSON.parse(serialized).lists?.[verifyList.chatId]?.[verifyList.listName]
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
  const before = reminderWriteSnapshot(store);
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
  const removed = new Set(store.reminders.filter(item => !candidate.reminders.some(next => next.id === item.id)).map(item => item.id));
  if (removed.size) {
    candidate.reminderCheckIns = structuredClone(store.reminderCheckIns ?? {});
    for (const state of Object.values(candidate.reminderCheckIns)) {
      for (const [id, record] of Object.entries(state.pending ?? {})) {
        if (removed.has(record.reminderId)) delete state.pending[id];
      }
    }
  }
  await saveStore(candidate, options);
  store.reminders = candidate.reminders;
  store.telegramDeletionReceipts = candidate.telegramDeletionReceipts;
  store.savedSchedules = candidate.savedSchedules;
  store.pendingActions = candidate.pendingActions;
  store.reminderCheckIns = candidate.reminderCheckIns;
  store.lists = candidate.lists;
  recordReminderReceipts(before, candidate);
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
  if (store.currentStateOnly && !["משימות", "קניות"].includes(listName)) {
    throw new UserInputError("בחר ברשימת המשימות או ברשימת הקניות.");
  }
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
    const checkIns = store.reminderCheckIns?.[chatId];
    if (checkIns) {
      const pending = Object.fromEntries(Object.entries(checkIns.pending ?? {}).filter(([, record]) => {
        if (record.listName !== listName || !record.taskId) return true;
        const task = lists[listName]?.find(item => item.id === record.taskId);
        return task && !task.checked;
      }));
      candidate.reminderCheckIns = { ...store.reminderCheckIns, [chatId]: { ...checkIns, pending } };
    }
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
    store.reminderCheckIns = candidate.reminderCheckIns;
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
