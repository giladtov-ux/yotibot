import { saveStore } from "./store.js";
import { occurrenceKey } from "./reminder-actions.js";
import { weeklyEntryFor, nextWeeklyDueAt } from "./weekly-schedules.js";
import { nextIntervalDueAt } from "./reminder-intervals.js";
import { completionEncouragement } from "./conversation-style.js";
import { nextReminderDetails } from "./next-reminder.js";
import { updateShoppingStatus } from "./shopping-lifecycle.js";

// Direct, owner-bound record completion. Prose and AI output are not receipts.
export async function completeRecord(store, chatId, record, view, {
  persist = saveStore, now = Date.now,
} = {}) {
  const recordViews = Object.assign(Object.create(null), store.recordViews);
  delete recordViews[chatId];
  const candidate = { ...store, recordViews };
  if (record.kind === "item") {
    if (record.checked) return { text: "כבר סומן כבוצע ✅" };
    if (typeof record.id !== "string") throw new Error("The selected item has no stable identity.");
    candidate.lists = Object.assign(Object.create(null), store.lists, {
      [chatId]: Object.assign(Object.create(null), store.lists[chatId], {
        [record.name]: store.lists[chatId][record.name].map(item =>
          item.id === record.id ? { ...item, checked: true, completedAt: now() } : item),
      }),
    });
  } else {
    const reminder = store.reminders.find(item => item.id === record.id && item.chatId === chatId);
    if (!reminder) return { text: "התזכורת כבר לא נמצאת ברשימה." };
    // Older saved detail views did not bind a deadline. Prefer their outstanding
    // delivered occurrence, not the already-advanced next weekly/interval one.
    const outstanding = Object.entries(reminder.telegramDeliveries ?? {})
      .filter(([, delivery]) => ["sent", "pending"].includes(delivery.state))
      .map(([key]) => parseInt(key, 36)).sort((left, right) => right - left)[0];
    const selectedAt = view.completionDueAt ?? outstanding ?? reminder.dueAt;
    const key = occurrenceKey(selectedAt);
    const receipt = reminder.telegramDeliveries?.[key];
    if (receipt?.state === "done") return { text: "כבר סומן כבוצע ✅" };
    if (selectedAt !== reminder.dueAt && !receipt) {
      return { text: "המועד הזה כבר לא פעיל. פתח את התזכורת מחדש." };
    }
    const updated = structuredClone(reminder);
    const completedAt = now();
    if (selectedAt === reminder.dueAt && !reminder.sentAt) {
      const weekly = weeklyEntryFor(store, reminder.id);
      const after = Math.max(selectedAt, completedAt);
      if (weekly) updated.dueAt = nextWeeklyDueAt(weekly, after);
      else if (reminder.repeatEveryMs
        && (reminder.remainingOccurrences == null || reminder.remainingOccurrences > 1)) {
        updated.dueAt = nextIntervalDueAt(selectedAt, reminder.repeatEveryMs, after);
        if (updated.remainingOccurrences != null) updated.remainingOccurrences--;
      } else {
        updated.sentAt = completedAt;
        if (updated.remainingOccurrences != null) updated.remainingOccurrences = 0;
      }
      delete updated.lastAttemptAt;
    }
    updated.telegramDeliveries ??= {};
    updated.telegramDeliveries[key] = { ...receipt, state: "done", completedAt };
    delete updated.telegramDeliveries[key].nagAttemptAt;
    delete updated.telegramDeliveries[key].nagRetryAt;
    delete updated.telegramDeliveries[key].pendingNagToken;
    candidate.reminders = store.reminders.map(item =>
      item.id === reminder.id && item.chatId === chatId ? updated : item);
  }
  if (record.kind === "item") updateShoppingStatus(candidate, chatId, record.name, now());
  await persist(candidate, {
    verifyList: record.kind === "item" ? { chatId, listName: record.name } : null,
  });
  store.recordViews = candidate.recordViews;
  if (candidate.listStatuses) store.listStatuses = candidate.listStatuses;
  if (candidate.lists !== store.lists) store.lists = candidate.lists;
  if (candidate.reminders !== store.reminders) store.reminders = candidate.reminders;
  return { text: `${completionEncouragement()}\n✅ סומן כבוצע.${record.kind === "reminder"
    ? `\n\n${nextReminderDetails(store, chatId, now())}` : ""}` };
}
