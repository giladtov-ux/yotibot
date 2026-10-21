import { saveStore, mutateReminderState } from "./store.js";
import { nextIntervalDueAt } from "./reminder-intervals.js";
import { weeklyEntryFor, nextWeeklyDueAt } from "./weekly-schedules.js";
import { occurrenceKey, retryReminderMessageUpdates,
  hasPendingMessageUpdates } from "./reminder-actions.js";
import { sendReminderNudges } from "./reminder-nudges.js";
import { enforceCurrentState } from "./current-state-retention.js";
import { refreshPreviousReminderMenu } from "./telegram-menu-sync.js";
import { renderRecordMenu } from "./record-menu.js";
import { registerReminderCheckIn } from "./reminder-checkins.js";
import { isPreparationReminder, formatTomorrowPreparation } from "./tomorrow-preparation.js";
import { loadDailySummaryStore } from "./daily-summary-repository.js";
import { sendMorningBrief } from "./morning-brief.js";
import { loadMorningSnapshot } from "./morning-brief-repository.js";

export function createReminderWorker(store, telegram, allowedChatId, logError, persist = saveStore,
  assertActive = () => {}, {
    isAuthorized = async () => false, commit = mutateReminderState, currentStateOnly = false,
    readPreparationSnapshot = loadDailySummaryStore,
    morningBrief = false, readMorningSnapshot = loadMorningSnapshot,
  } = {}) {
  let inProgress = false;
  const retryNotBefore = new Map();
  const retainCurrent = async (chatId, now) => {
    const result = await enforceCurrentState(store, chatId, persist, now);
    if (result.removed) {
      const menu = renderRecordMenu(store, chatId, "r", "c");
      await refreshPreviousReminderMenu(store, telegram, chatId, menu.options.reply_markup, menu.text);
    }
  };
  return async function deliverDueReminders() {
    if (inProgress) return { ok: true, busy: true, sent: 0 };
    inProgress = true;
    let sent = 0;
    try {
      assertActive();
      const now = Date.now();
      const ownerChatId = typeof allowedChatId === "function" ? allowedChatId() : allowedChatId;
      if (currentStateOnly) await retainCurrent(ownerChatId, now);
      await retryReminderMessageUpdates(store, telegram, {
        ownerChatId, isAuthorized, assertActive, commit,
      });
      const eligible = id => ownerChatId && (id === ownerChatId || isAuthorized(id));
      for (const reminder of store.reminders) {
        if (reminder.sentAt || reminder.dueAt > now) continue;
        if ((retryNotBefore.get(reminder.id) ?? 0) > now) continue;
        // A persisted attempt without an outcome may have reached Telegram.
        // Never resend it automatically after a database/process disconnect.
        if (reminder.lastAttemptAt) continue;
        if (!await eligible(reminder.chatId)) continue;
        const previousDueAt = reminder.dueAt;
        const preparation = isPreparationReminder(reminder.text);
        const preparationText = preparation
          ? formatTomorrowPreparation(await readPreparationSnapshot(reminder.chatId, undefined, now),
            reminder.chatId, now) : null;
        const previousCount = reminder.remainingOccurrences;
        const weekly = weeklyEntryFor(store, reminder.id);
        const key = occurrenceKey(previousDueAt);
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
            preparationText ?? reminder.text,
            {},
          );
          reminder.telegramDeliveries[key] = {
            state: "sent",
            messageId: Number.isSafeInteger(message?.message_id) ? message.message_id : null,
            sentAt: Date.now(),
            ...(preparation ? { informational: true } : {}),
          };
          if (!preparation) registerReminderCheckIn(store, reminder, key, reminder.telegramDeliveries[key]);
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
          if (currentStateOnly && reminder.sentAt && !weekly) {
            await retainCurrent(reminder.chatId, Date.now());
          } else await persist(store);
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
      if (morningBrief) {
        try {
          sent += await sendMorningBrief(store, telegram, ownerChatId, {
            persist, readSnapshot: readMorningSnapshot, assertActive, logError,
            isAuthorized: eligible,
          });
        } catch (error) { logError("Morning brief could not be prepared", error); }
      }
      const nudged = await sendReminderNudges(store, telegram, ownerChatId, persist, assertActive, logError,
        undefined, { isAuthorized });
      return { ok: true, sent, nudged };
    } finally {
      inProgress = false;
    }
  };
}
