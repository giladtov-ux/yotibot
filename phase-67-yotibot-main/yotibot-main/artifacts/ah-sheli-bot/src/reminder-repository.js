import { getPool, closeDatabase } from "./database.js";
import { saveStore, setReminderPersistence } from "./store.js";

// Deleted reminders cannot be scheduled again. Their bounded UI-only receipts
// remain in the same authoritative state transaction, never in the reminders table.
export function telegramMessageReceipts(store) {
  return [
    ...store.reminders,
    ...(store.telegramDeletionReceipts ?? []),
  ].flatMap(reminder => Object.entries(reminder.telegramDeliveries ?? {})
    .filter(([, receipt]) => ["done", "deleted"].includes(receipt.state))
    .map(([key, receipt]) => ({ reminder, key, receipt })));
}

function fromDatabase(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    text: row.text,
    dueAt: new Date(row.due_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
    ...(row.repeat_every_ms != null ? { repeatEveryMs: row.repeat_every_ms } : {}),
    ...(row.remaining_occurrences != null ? { remainingOccurrences: row.remaining_occurrences } : {}),
    ...(row.sent_at ? { sentAt: new Date(row.sent_at).getTime() } : {}),
    ...(row.last_attempt_at
      ? { lastAttemptAt: new Date(row.last_attempt_at).getTime() }
      : {}),
  };
}

export async function loadPersistedReminders(pool = getPool()) {
  const { rows } = await pool.query(
    `SELECT id, chat_id, text, due_at, created_at, sent_at, last_attempt_at, repeat_every_ms, remaining_occurrences
     FROM ah_sheli_reminders
     ORDER BY due_at ASC`,
  );
  return rows.map(fromDatabase);
}

// Transaction ownership belongs to the caller when saving reminders + state.
export async function writeReminders(reminders, client) {
  for (const reminder of reminders) {
    await client.query(
        `INSERT INTO ah_sheli_reminders
           (id, chat_id, text, due_at, created_at, sent_at, last_attempt_at, repeat_every_ms, remaining_occurrences)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           chat_id = EXCLUDED.chat_id,
           text = EXCLUDED.text,
           due_at = EXCLUDED.due_at,
           created_at = EXCLUDED.created_at,
           sent_at = EXCLUDED.sent_at,
           last_attempt_at = EXCLUDED.last_attempt_at,
           repeat_every_ms = EXCLUDED.repeat_every_ms,
           remaining_occurrences = EXCLUDED.remaining_occurrences`,
        [
          reminder.id,
          reminder.chatId,
          reminder.text,
          new Date(reminder.dueAt),
          new Date(reminder.createdAt ?? Date.now()),
          reminder.sentAt ? new Date(reminder.sentAt) : null,
          reminder.lastAttemptAt ? new Date(reminder.lastAttemptAt) : null,
          reminder.repeatEveryMs ?? null,
          reminder.remainingOccurrences ?? null,
        ],
    );
  }

  const ids = reminders.map((reminder) => reminder.id);
  if (ids.length > 0) {
    await client.query(
      "DELETE FROM ah_sheli_reminders WHERE NOT (id = ANY($1::text[]))",
      [ids],
    );
  } else {
    await client.query("DELETE FROM ah_sheli_reminders");
  }
}

export async function persistReminders(reminders, pool = getPool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeReminders(reminders, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeReminderPersistence(store, pool = getPool()) {
  const savedReminders = await loadPersistedReminders(pool);
  const remindersById = new Map(
    savedReminders.map((reminder) => [reminder.id, reminder]),
  );

  // Migrate reminders from the existing JSON store without discarding
  // reminders that were already saved in PostgreSQL.
  for (const reminder of store.reminders) {
    if (!remindersById.has(reminder.id)) {
      remindersById.set(reminder.id, reminder);
    } else if (remindersById.get(reminder.id).chatId === reminder.chatId
      && reminder.telegramDeliveries && typeof reminder.telegramDeliveries === "object"
      && !Array.isArray(reminder.telegramDeliveries)) {
      // These receipts share the same transaction as the reminder table. Keep
      // them from authoritative state without requiring a new database column.
      remindersById.get(reminder.id).telegramDeliveries = structuredClone(reminder.telegramDeliveries);
    }
  }

  const reminders = [...remindersById.values()].sort(
    (left, right) => left.dueAt - right.dueAt,
  );
  setReminderPersistence(writeReminders, savedReminders);
  await saveStore({ ...store, reminders });
  store.reminders = reminders;
}

export async function closeReminderDatabase() {
  await closeDatabase();
}