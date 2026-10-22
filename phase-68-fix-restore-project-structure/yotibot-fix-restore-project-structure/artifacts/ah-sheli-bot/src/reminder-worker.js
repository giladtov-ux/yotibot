import { saveStore, mutateReminderState } from "./store.js";
import { nextIntervalDueAt } from "./reminder-intervals.js";
import { weeklyEntryFor, nextWeeklyDueAt } from "./weekly-schedules.js";
import { occurrenceKey, reminderKeyboard, retryReminderMessageUpdates,
  hasPendingMessageUpdates } from "./reminder-actions.js";
import { sendReminderNudges } from "./reminder-nudges.js";

export function createReminderWorker(store, telegram, allowedChatId, logError, persist = saveStore,
  assertActive = () => {}, {
    isAuthorized = async () => false, isMessagingEnabled = async () => true,
    commit = mutateReminderState,
  } = {}) {
  let inProgress = false;
  const retryNotBefore = new Map();
  return async function deliverDueReminders() {
    if (inProgress) return { ok: true, busy: true, sent: 0 };
    inProgress = true;
    let sent = 0;
    try {
      assertActive();
      const now = Date.now();
      const ownerChatId = typeof allowedChatId === "function" ? allowedChatId() : allowedChatId;
      await retryReminderMessageUpdates(store, telegram, {
        ownerChatId, isAuthorized, isMessagingEnabled, assertActive, commit,
      });
      const eligible = async id => Boolean(ownerChatId)
        && (id === ownerChatId || await isAuthorized(id))
        && await isMessagingEnabled(id);
      for (const reminder of store.reminders) {
        if (reminder.sentAt || reminder.dueAt > now) continue;
        if ((retryNotBefore.get(reminder.id) ?? 0) > now) continue;
        // A persisted attempt without an outcome may have reached Telegram.
        // Never resend it automatically after a database/process disconnect.
        if (reminder.lastAttemptAt) continue;
        if (!await eligible(reminder.chatId)) continue;
        const previousDueAt = reminder.dueAt;
        const previousCount = reminder.remainingOccurrences;
        const weekly = weeklyEntryFor(store, reminder.id);
        const key = occurrenceKey(previousDueAt);
        const keyboard = reminderKeyboard(reminder, previousDueAt);
        const priorDeliveries = reminder.telegramDeliveries;
        assertActive();
        reminder.lastAttemptAt = now;
        // Keep bounded occurrence receipts in the existing atomic state JSON.
        const priorEntries = Object.entries(priorDeliveries ?? {});
        // Rotation must not erase still-retryable UI work. Preserve it until
        // its finite attempt budget/lifetime ends, then rotate it normally.
        const pendingEntries = priorEntries.filter(([, receipt]) => hasPendingMessageUpdates(receipt, now));
        const history = priorEntries.filter(([, receipt]) => !hasPendingMessageUpdates(receipt, now));
        const historyBudget = Math.max(0, 127 - pendingEntries.length);
        reminder.telegramDeliveries = Object.fromEntries([
          ...(historyBudget ? history.slice(-historyBudget) : []),
          ...pendingEntries,
        ]);
        reminder.telegramDeliveries[key] = { state: "pending", messageId: null };
        try {
          await persist(store);
        } catch (error) {
          // A missing COMMIT response may have durably saved this marker.
          // Only a definite failure permits another in-process attempt.
          if (error?.code !== "STATE_COMMIT_UNKNOWN") {
            delete reminder.lastAttemptAt;
            if (priorDeliveries) reminder.telegramDeliveries = priorDeliveries;
            else delete reminder.telegramDeliveries;
          }
          throw error;
        }
        // Membership can expire while the attempt marker is being committed.
        // No Telegram request has happened yet, so a denial safely restores it.
        let stillAuthorized;
        try { stillAuthorized = await eligible(reminder.chatId); }
        catch (error) {
          delete reminder.lastAttemptAt;
          if (priorDeliveries) reminder.telegramDeliveries = priorDeliveries;
          else delete reminder.telegramDeliveries;
          await persist(store);
          throw error;
        }
        if (!stillAuthorized) {
          delete reminder.lastAttemptAt;
          if (priorDeliveries) reminder.telegramDeliveries = priorDeliveries;
          else delete reminder.telegramDeliveries;
          await persist(store);
          continue;
        }
        try {
          assertActive();
          const message = await telegram.sendMessage(
            reminder.chatId,
            `היי אח שלי, הגיע הזמן: ${reminder.text}${weekly || reminder.repeatEveryMs
              ? "\n\nתזכורת חוזרת · ״מחק״ יבטל גם את ההמשך." : ""}`,
            { reply_markup: keyboard },
          );
          reminder.telegramDeliveries[key] = {
            state: "sent",
            messageId: Number.isSafeInteger(message?.message_id) ? message.message_id : null,
            sentAt: Date.now(),
          };
          if (weekly) {
            reminder.dueAt = nextWeeklyDueAt(weekly, Date.now());
          } else if (reminder.repeatEveryMs && (previousCount == null || previousCount > 1)) {
            reminder.dueAt = nextIntervalDueAt(previousDueAt, reminder.repeatEveryMs, Date.now());
            if (previousCount != null) reminder.remainingOccurrences = previousCount - 1;
          } else {
            reminder.sentAt = Date.now();
            if (previousCount != null) reminder.remainingOccurrences = 0;
          }
          delete reminder.lastAttemptAt;
          await persist(store);
          retryNotBefore.delete(reminder.id);
          sent++;
        } catch (error) {
          if (error?.deliveryRejected && !reminder.sentAt) {
            delete reminder.lastAttemptAt;
            delete reminder.telegramDeliveries[key];
            retryNotBefore.set(reminder.id, now + 60_000);
            // Persist the confirmed rejection before permitting another attempt.
            try {
              await persist(store);
            } catch (persistError) {
              reminder.lastAttemptAt = now;
              throw persistError;
            }
            logError("Reminder delivery rejected; it will retry", error);
          } else {
            reminder.telegramDeliveries[key].nagAttemptAt = now;
            // A repeat accepted by Telegram but not durably confirmed is
            // uncertain. Block the whole series, just as for a one-off send.
            if ((weekly || reminder.repeatEveryMs) && !reminder.sentAt) {
              reminder.dueAt = previousDueAt;
              reminder.remainingOccurrences = previousCount;
              reminder.lastAttemptAt = now;
            }
            logError("Reminder outcome uncertain; automatic resend blocked", error);
          }
        }
      }
      const nudged = await sendReminderNudges(store, telegram, ownerChatId, persist, assertActive, logError,
        undefined, { isAuthorized, isMessagingEnabled });
      return { ok: true, sent, nudged };
    } finally {
      inProgress = false;
    }
  };
}
