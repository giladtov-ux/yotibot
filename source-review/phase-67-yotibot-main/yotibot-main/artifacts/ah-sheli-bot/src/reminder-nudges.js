import { reminderKeyboard } from "./reminder-actions.js";
import { weeklyEntryFor } from "./weekly-schedules.js";
import { randomBytes } from "node:crypto";

export const NUDGE_INTERVAL_MS = 5 * 60_000;
export const MAX_NUDGES_PER_OCCURRENCE = 3;

// Called inside the existing reminder/button queue, not a second scheduler.
export async function sendReminderNudges(store, telegram, ownerChatId, persist,
  assertActive, logError, now = Date.now(), { isAuthorized = async () => false } = {}) {
  let sent = 0;
  const eligible = id => ownerChatId && (id === ownerChatId || isAuthorized(id));
  for (const reminder of store.reminders) {
    if (!ownerChatId || reminder.lastAttemptAt) continue;
    for (const [key, delivery] of Object.entries(reminder.telegramDeliveries ?? {})) {
      // Older one-off receipts have a reliable reminder-level delivery time.
      // Never guess a recurring delivery's time from its planned deadline.
      const deliveredAt = delivery.sentAt ?? reminder.sentAt;
      if (delivery.state !== "sent" || !Number.isSafeInteger(delivery.messageId)
        || !Number.isFinite(deliveredAt) || delivery.nagAttemptAt
        // Confirmed copies are already persisted with this occurrence. Reuse
        // them so restarting cannot reset the limit, including older receipts.
        || (delivery.nagMessageIds?.length ?? 0) >= MAX_NUDGES_PER_OCCURRENCE
        || (delivery.nagRetryAt ?? 0) > now
        || now - (delivery.lastNagAt ?? deliveredAt) < NUDGE_INTERVAL_MS) continue;
      if (!await eligible(reminder.chatId)) continue;
      assertActive();
      // Commit before sending: unknown transport/COMMIT outcomes must not replay.
      delivery.nagAttemptAt = now;
      const previousToken = delivery.pendingNagToken;
      const attemptToken = randomBytes(12).toString("base64url");
      delivery.pendingNagToken = attemptToken;
      try {
        await persist(store);
      } catch (error) {
        if (error?.code !== "STATE_COMMIT_UNKNOWN") {
          delete delivery.nagAttemptAt;
          if (previousToken) delivery.pendingNagToken = previousToken;
          else delete delivery.pendingNagToken;
        }
        throw error;
      }
      let stillAuthorized;
      try { stillAuthorized = await eligible(reminder.chatId); }
      catch (error) {
        delete delivery.nagAttemptAt;
        if (previousToken) delivery.pendingNagToken = previousToken;
        else delete delivery.pendingNagToken;
        await persist(store);
        throw error;
      }
      if (!stillAuthorized) {
        delete delivery.nagAttemptAt;
        if (previousToken) delivery.pendingNagToken = previousToken;
        else delete delivery.pendingNagToken;
        await persist(store);
        continue;
      }
      let accepted = false;
      try {
        assertActive();
        const message = await telegram.sendMessage(reminder.chatId,
          `היי, רק מוודא – הספקת לטפל בזה?\n\n${reminder.text}${
            weeklyEntryFor(store, reminder.id) || reminder.repeatEveryMs
              ? "\n\nתזכורת חוזרת · ״מחק״ יבטל גם את ההמשך." : ""}`,
          { reply_markup: reminderKeyboard(reminder, parseInt(key, 36), attemptToken) });
        accepted = true;
        if (!Number.isSafeInteger(message?.message_id) || message.message_id <= 0) {
          throw new Error("Nudge response missing its message ID");
        }
        // Every sent copy remains actionable until this occurrence is completed.
        delivery.nagMessageIds = [...new Set([...(delivery.nagMessageIds ?? []), message.message_id])];
        delivery.lastNagAt = Date.now();
        delete delivery.nagAttemptAt;
        delete delivery.nagRetryAt;
        delete delivery.pendingNagToken;
        await persist(store);
        sent++;
      } catch (error) {
        if (!accepted && error?.deliveryRejected) {
          delete delivery.nagAttemptAt;
          delete delivery.pendingNagToken;
          delivery.nagRetryAt = now + 60_000;
          try {
            await persist(store);
          } catch (persistError) {
            delivery.nagAttemptAt = now;
            delivery.pendingNagToken = attemptToken;
            throw persistError;
          }
          logError("Reminder nudge rejected; it will retry", error);
        } else {
          // Keep this occurrence fenced even if the send succeeded but saving
          // its confirmation failed. Original buttons can still complete it.
          delivery.nagAttemptAt = now;
          delivery.pendingNagToken = attemptToken;
          logError("Reminder nudge outcome uncertain; automatic resend blocked", error);
        }
      }
    }
  }
  return sent;
}
