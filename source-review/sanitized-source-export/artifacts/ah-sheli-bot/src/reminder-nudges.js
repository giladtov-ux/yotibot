import { randomBytes } from "node:crypto";
import { activeReminderCheckIns, seedCurrentCheckIns, checkInHint } from "./reminder-checkins.js";
import { getJerusalemDateString } from "./time.js";

export const NUDGE_INTERVAL_MS = 15 * 60_000;
export const MAX_NUDGES_PER_OCCURRENCE = 1;
export const WAKE_COFFEE_INTERVAL_MS = 5 * 60_000;
// Permit a scheduler tick / confirmed-rejection retry, never a late backlog.
const WAKE_COFFEE_SEND_WINDOW_MS = 2 * 60_000;

function isWakeCoffee(record, configuredId) {
  if (typeof configuredId !== "string") return false;
  const id = configuredId.trim();
  return /^[1-9]\d{0,14}$/u.test(id) && record.chatId === id
    && record.originalText?.trim() === "השכמה";
}

// Called inside the existing reminder/button queue, not a second scheduler.
export async function sendReminderNudges(store, telegram, ownerChatId, persist,
  assertActive, logError, now = Date.now(), {
    isAuthorized = async () => false,
    wakeCoffeeTestUserId = process.env.AH_SHELI_WAKE_COFFEE_TEST_USER_ID,
  } = {}) {
  let sent = 0;
  const eligible = id => ownerChatId && (id === ownerChatId || isAuthorized(id));
  seedCurrentCheckIns(store, now);
  const focused = Object.entries(store.reminderCheckIns ?? {}).flatMap(([chatId, state]) =>
    activeReminderCheckIns(store, chatId).filter(item => item.id === state.focus));
  for (const record of focused) {
    const chatState = store.reminderCheckIns[record.chatId];
    const wakeCoffee = isWakeCoffee(record, wakeCoffeeTestUserId);
    const interval = wakeCoffee ? WAKE_COFFEE_INTERVAL_MS : NUDGE_INTERVAL_MS;
    if (!wakeCoffee && (now - (chatState.lastReplyAt ?? 0) < NUDGE_INTERVAL_MS
      || now - (chatState.lastCheckInAt ?? 0) < 30 * 60_000)) continue;
    const reminder = record.reminder ?? { id: record.reminderId, chatId: record.chatId, text: record.text };
    if (!ownerChatId || reminder.lastAttemptAt) continue;
    for (const [key, delivery] of [[record.key, record.delivery]]) {
      // Older one-off receipts have a reliable reminder-level delivery time.
      // Never guess a recurring delivery's time from its planned deadline.
      const deliveredAt = delivery.sentAt ?? reminder.sentAt;
      if (delivery.state !== "sent" || !Number.isSafeInteger(delivery.messageId)
        || !Number.isFinite(deliveredAt) || delivery.nagAttemptAt || delivery.nagSuppressedAt
        // Confirmed copies are already persisted with this occurrence. Reuse
        // them so restarting cannot reset the limit, including older receipts.
        || (delivery.nagMessageIds?.length ?? 0) >= MAX_NUDGES_PER_OCCURRENCE
        || (delivery.nagRetryAt ?? 0) > now
        || now - (delivery.lastNagAt ?? deliveredAt) < interval) continue;
      if (wakeCoffee) {
        const today = getJerusalemDateString(new Date(now));
        if ((!record.reminder && record.retainedOneOffDelivery !== true)
          || store.telegramDeletionReceipts?.some(item =>
            item.chatId === record.chatId && item.id === record.reminderId)
          || (chatState.lastReplyAt ?? 0) >= deliveredAt
          || now - deliveredAt >= interval + WAKE_COFFEE_SEND_WINDOW_MS
          || getJerusalemDateString(new Date(deliveredAt)) !== today
          || getJerusalemDateString(new Date(record.dueAt)) !== today) continue;
      }
      if (!await eligible(reminder.chatId)) continue;
      assertActive();
      const hint = wakeCoffee ? "☕" : checkInHint(record, chatState.lastCheckInHint);
      if (!hint) continue;
      // Commit before sending: unknown transport/COMMIT outcomes must not replay.
      // Keep variation in the existing chat state, including across restarts.
      chatState.lastCheckInHint = hint;
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
        const message = await telegram.sendMessage(reminder.chatId, hint,
          { reply_parameters: { message_id: delivery.messageId, allow_sending_without_reply: true } });
        accepted = true;
        if (!Number.isSafeInteger(message?.message_id) || message.message_id <= 0) {
          throw new Error("Nudge response missing its message ID");
        }
        // Every sent copy remains actionable until this occurrence is completed.
        delivery.nagMessageIds = [...new Set([...(delivery.nagMessageIds ?? []), message.message_id])];
        delivery.lastNagAt = Date.now();
        store.reminderCheckIns[record.chatId].lastCheckInAt = Date.now();
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
