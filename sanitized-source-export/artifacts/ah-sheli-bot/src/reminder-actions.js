import { createHash } from "node:crypto";
import { mutateReminderState as commitReminderBatch } from "./store.js";
import { closeCheckInRecord } from "./reminder-checkins.js";
import { weeklyEntryFor, nextWeeklyDueAt } from "./weekly-schedules.js";
import { nextIntervalDueAt } from "./reminder-intervals.js";
import { completionEncouragement } from "./conversation-style.js";
import { nextReminderDetails } from "./next-reminder.js";
import { telegramMessageReceipts } from "./reminder-repository.js";

export const TELEGRAM_ALLOWED_UPDATES = ["message", "callback_query"];

const reminderToken = id => createHash("sha256").update(id).digest("base64url").slice(0, 22);
export const occurrenceKey = dueAt => Math.trunc(dueAt).toString(36);

export const MESSAGE_UPDATE_MAX_ATTEMPTS = 5;
export const MESSAGE_UPDATE_LIFETIME_MS = 24 * 60 * 60_000;
const validMessageId = id => Number.isSafeInteger(id) && id > 0;
const pendingUpdate = (update, now) => update.status === "pending"
  && update.attempts < MESSAGE_UPDATE_MAX_ATTEMPTS && update.expiresAt > now;
export const hasPendingMessageUpdates = (receipt, now) =>
  receipt.messageUpdates?.some(update => pendingUpdate(update, now)) === true;

function messageUpdates(delivery, clicked, action, original, timestamp) {
  return [...new Set([clicked, delivery.messageId, ...(delivery.nagMessageIds ?? [])])]
    .filter(validMessageId).map(messageId => ({
      messageId,
      method: action === "x" ? "deleteMessage"
        : messageId === clicked ? "editMessageText" : "editMessageReplyMarkup",
      ...(action === "d" && messageId === clicked ? { text: `${original}\n\n✅ בוצע!` } : {}),
      status: "pending", attempts: 0, nextAttemptAt: timestamp,
      expiresAt: timestamp + MESSAGE_UPDATE_LIFETIME_MS,
    }));
}

function alreadyApplied(error, method) {
  // Only an explicit Bot API response proves the desired UI is already retired.
  return error?.deliveryRejected === true && (
    /message (?:to (?:delete|edit) )?not found/iu.test(error.message)
    || (method !== "deleteMessage" && /message is not modified/iu.test(error.message)));
}

async function applyMessageUpdate(telegram, chatId, update, assertActive) {
  const address = { chat_id: chatId, message_id: update.messageId };
  const call = async (method, payload) => {
    assertActive();
    try { await telegram.call(method, payload); }
    catch (error) { if (!alreadyApplied(error, method)) throw error; }
  };
  if (update.method === "deleteMessage") {
    try { await call("deleteMessage", address); }
    catch {
      // Old Telegram messages may not be deletable; editing is idempotent too.
      await call("editMessageText", {
        ...address, text: "🗑️ התזכורת נמחקה.", reply_markup: { inline_keyboard: [] },
      });
    }
  } else {
    await call(update.method, {
      ...address, ...(update.method === "editMessageText" ? { text: update.text } : {}),
      reply_markup: { inline_keyboard: [] },
    });
  }
}

// Called only inside the existing reminder operation queue. No reminder action
// or send is replayed here; attempt budgets are durable BEFORE Telegram I/O.
export async function retryReminderMessageUpdates(store, telegram, {
  ownerChatId, isAuthorized = async () => false, assertActive = () => {},
  commit = commitReminderBatch, now = Date.now, limit = 16,
  only,
} = {}) {
  if (!ownerChatId) return 0;
  let attempted = 0;
  const timestamp = now();
  for (const { reminder, key, receipt } of telegramMessageReceipts(store)) {
    if (only && (reminder.id !== only.id || reminder.chatId !== only.chatId
      || (only.key !== undefined && key !== only.key))) continue;
    if (reminder.chatId !== ownerChatId && !await isAuthorized(reminder.chatId)) continue;
    for (let index = 0; index < (receipt.messageUpdates?.length ?? 0); index++) {
      const update = receipt.messageUpdates[index];
      if (attempted >= limit) return attempted;
      if (!validMessageId(update.messageId) || !pendingUpdate(update, timestamp)
        || update.nextAttemptAt > timestamp
        || !["deleteMessage", "editMessageText", "editMessageReplyMarkup"].includes(update.method)) continue;
      const change = async mutate => {
        assertActive();
        await commit(store, candidate => {
          const target = telegramMessageReceipts(candidate).find(item =>
            item.reminder.id === reminder.id && item.reminder.chatId === reminder.chatId && item.key === key);
          if (!target) throw new Error("Reminder message receipt disappeared.");
          const copy = structuredClone(target.reminder);
          mutate(copy.telegramDeliveries[key].messageUpdates[index]);
          if (target.receipt.state === "deleted") {
            candidate.telegramDeletionReceipts = candidate.telegramDeletionReceipts.map(item =>
              item.id === reminder.id && item.chatId === reminder.chatId ? copy : item);
          } else {
            candidate.reminders = candidate.reminders.map(item =>
              item.id === reminder.id && item.chatId === reminder.chatId ? copy : item);
          }
        });
      };
      await change(job => {
        job.attempts++;
        job.nextAttemptAt = timestamp + 60_000 * 2 ** (job.attempts - 1);
      });
      attempted++;
      // Recheck membership after the durable attempt, before touching the chat.
      assertActive();
      if (reminder.chatId !== ownerChatId && !await isAuthorized(reminder.chatId)) continue;
      let succeeded = false;
      try {
        await applyMessageUpdate(telegram, reminder.chatId, update, assertActive);
        succeeded = true;
      } catch {
        assertActive();
        console.warn("[Ah Sheli] Reminder message update deferred; action remains saved.");
      }
      await change(job => {
        if (succeeded) job.status = "updated";
        else if (job.attempts >= MESSAGE_UPDATE_MAX_ATTEMPTS) job.status = "exhausted";
      });
    }
  }
  return attempted;
}

export function reminderKeyboard(reminder, dueAt = reminder.dueAt, nudgeToken) {
  const prefix = `${reminderToken(reminder.id)}:${occurrenceKey(dueAt)}${
    nudgeToken ? `:${nudgeToken}` : ""}`;
  return { inline_keyboard: [[
    { text: "✅ בוצע!", callback_data: `r:d:${prefix}` },
    { text: "🗑️ מחק", callback_data: `r:x:${prefix}` },
  ]] };
}

// Serialize button mutations with outgoing deliveries, independently of AI calls.
export function createReminderOperationQueue() {
  let tail = Promise.resolve();
  return operation => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}

export async function handleReminderCallback(store, telegram, query, {
  ownerChatId,
  assertActive = () => {},
  commit = commitReminderBatch,
  now = Date.now,
} = {}) {
  if (typeof query?.id !== "string") return { ignored: true };
  const message = query.message;
  const answer = async (text, showAlert = false) => {
    assertActive();
    await telegram.call("answerCallbackQuery", {
      callback_query_id: query.id, text, show_alert: showAlert,
    });
  };
  if (!ownerChatId || String(query.from?.id) !== ownerChatId
    || query.from?.is_bot || message?.chat?.type !== "private"
    || String(message.chat.id) !== ownerChatId || message.from?.is_bot !== true
    || !Number.isSafeInteger(message.message_id) || message.message_id <= 0) {
    await answer("הכפתור הזה פרטי לבעל הבוט.", true);
    return { denied: true };
  }
  const match = /^r:([dx]):([A-Za-z0-9_-]{22}):([a-z0-9]{1,11})(?::([A-Za-z0-9_-]{16}))?$/u.exec(query.data ?? "");
  if (!match) {
    await answer("הכפתור הזה כבר לא פעיל.");
    return { ignored: true };
  }
  const [, action, token, key, nudgeToken] = match;
  const reminder = store.reminders.find(item =>
    item.chatId === ownerChatId && reminderToken(item.id) === token);
  const delivery = reminder?.telegramDeliveries?.[key];
  if (!reminder) {
    await answer("התזכורת כבר הוסרה.");
    return { alreadyRemoved: true };
  }
  // An owner clicking a bot-authored nudge proves delivery even when Telegram's
  // send response was lost. Its unguessable token was saved BEFORE that send.
  const uncertainNudge = nudgeToken && delivery?.nagAttemptAt
    && nudgeToken === delivery.pendingNagToken;
  if (!delivery || !["pending", "sent", "done"].includes(delivery.state)
    || (delivery.messageId != null && delivery.messageId !== message.message_id
      && !delivery.nagMessageIds?.includes(message.message_id) && !uncertainNudge)) {
    await answer("הכפתור הזה לא שייך לתזכורת פעילה.");
    return { ignored: true };
  }
  if (delivery.state === "done") {
    await answer("כבר סימנת את זה כבוצע.");
    return { alreadyDone: true };
  }
  assertActive();
  try {
    await commit(store, candidate => {
      if (action === "x") {
        // Archive only delivery evidence, not a schedulable reminder. Retain
        // active retries; expired/exhausted archives can be discarded.
        candidate.telegramDeletionReceipts = (candidate.telegramDeletionReceipts ?? [])
          .filter(item => Object.values(item.telegramDeliveries).some(receipt =>
            receipt.messageUpdates?.some(update => pendingUpdate(update, now()))));
        if (candidate.telegramDeletionReceipts.length >= 128) {
          throw new Error("Telegram message cleanup queue is full.");
        }
        candidate.telegramDeletionReceipts.push({
          id: reminder.id, chatId: ownerChatId,
          telegramDeliveries: Object.fromEntries(Object.entries(reminder.telegramDeliveries)
            .map(([receiptKey, receipt]) => [receiptKey, {
              ...structuredClone(receipt), state: "deleted",
              messageUpdates: messageUpdates(receipt,
                receiptKey === key ? message.message_id : receipt.messageId,
                "x", "", now()),
            }])),
        });
        candidate.reminders = candidate.reminders.filter(item => item.id !== reminder.id);
        candidate.savedSchedules = candidate.savedSchedules.map(schedule => ({
          ...schedule, entries: schedule.entries.filter(entry => entry.reminderId !== reminder.id),
        })).filter(schedule => schedule.entries.length);
        return;
      }
      const updated = structuredClone(reminder);
      const dueAt = parseInt(key, 36);
      const weekly = weeklyEntryFor(candidate, reminder.id);
      // A button also proves delivery when its send confirmation was lost.
      // Never advance an already-advanced series a second time.
      if (occurrenceKey(updated.dueAt) === key && !updated.sentAt) {
        if (weekly) {
          updated.dueAt = nextWeeklyDueAt(weekly, now());
        } else if (updated.repeatEveryMs
          && (updated.remainingOccurrences == null || updated.remainingOccurrences > 1)) {
          updated.dueAt = nextIntervalDueAt(dueAt, updated.repeatEveryMs, now());
          if (updated.remainingOccurrences != null) updated.remainingOccurrences--;
        } else {
          updated.sentAt = now();
          if (updated.remainingOccurrences != null) updated.remainingOccurrences = 0;
        }
        delete updated.lastAttemptAt;
      }
      updated.telegramDeliveries[key] = {
        ...delivery, state: "done", messageId: delivery.messageId ?? message.message_id, completedAt: now(),
        messageUpdates: messageUpdates(delivery, message.message_id, "d",
          typeof message.text === "string" ? message.text : reminder.text, now()),
        ...(uncertainNudge ? {
          nagMessageIds: [...new Set([...(delivery.nagMessageIds ?? []), message.message_id])],
        } : {}),
      };
      delete updated.telegramDeliveries[key].nagAttemptAt;
      delete updated.telegramDeliveries[key].nagRetryAt;
      delete updated.telegramDeliveries[key].pendingNagToken;
      closeCheckInRecord(candidate, ownerChatId, reminder.id, key, now());
      candidate.reminders = candidate.reminders.map(item =>
        item.id === reminder.id ? updated : item);
    });
  } catch (error) {
    if (error?.code === "STATE_COMMIT_UNKNOWN") throw error;
    await answer("לא הצלחתי לשמור כרגע. נסה שוב עוד רגע.");
    throw error;
  }
  // Persistence is the success boundary. UI/network failures cannot undo it.
  const confirmation = action === "x"
    ? "סגור, מחקתי את התזכורת."
    : completionEncouragement();
  try {
    await answer(confirmation);
  } catch {
    console.warn("[Ah Sheli] Reminder action saved; callback acknowledgement failed.");
  }
  if (action === "d") {
    try {
      assertActive();
      // A real chat reply, not only Telegram's temporary callback toast.
      // The persisted done receipt prevents repeated clicks from sending it twice.
      await telegram.sendMessage(ownerChatId,
        `${confirmation}\n\n${nextReminderDetails(store, ownerChatId, now())}`);
    } catch {
      // Never undo completion or replay a send whose network outcome is uncertain.
      console.warn("[Ah Sheli] Reminder completed; encouragement message delivery failed.");
    }
  }
  try {
    await retryReminderMessageUpdates(store, telegram, {
      ownerChatId, assertActive, commit, now,
      only: { id: reminder.id, chatId: ownerChatId, ...(action === "d" ? { key } : {}) },
    });
  } catch (error) {
    if (error?.code === "STATE_COMMIT_UNKNOWN") throw error;
    console.warn("[Ah Sheli] Reminder action saved; Telegram message cleanup deferred.");
  }
  return { action: action === "x" ? "deleted" : "done" };
}
