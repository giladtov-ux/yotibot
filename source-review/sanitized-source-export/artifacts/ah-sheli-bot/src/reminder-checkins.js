import { saveStore } from "./store.js";
import { reminderValidationTime, getJerusalemDateString } from "./time.js";
import { parseReminderTitleCorrection } from "./reminder-title-corrections.js";
import { weeklyEntryFor, nextWeeklyDueAt } from "./weekly-schedules.js";
import { nextIntervalDueAt } from "./reminder-intervals.js";
import { randomInt } from "node:crypto";

export const checkInEmojis = Object.freeze(["👀", "🎯", "☕", "📌", "🤨", "🫶", "👏", "🙏", "🤔"]);

export function registerReminderCheckIn(store, reminder, key, delivery) {
  if (delivery.informational) return;
  store.reminderCheckIns ??= Object.create(null);
  const previous = store.reminderCheckIns[reminder.chatId] ?? { pending: {} };
  const id = `${reminder.id}:${key}`;
  store.reminderCheckIns = { ...store.reminderCheckIns, [reminder.chatId]: {
    ...previous, focus: id, pending: { ...previous.pending, [reminder.id]: {
      id, reminderId: reminder.id, key, text: reminder.text, dueAt: parseInt(key, 36),
      taskId: reminder.trackingTaskId ?? null, listName: reminder.trackingListName ?? null,
      delivery: { ...delivery },
    } },
  } };
}

export function activeReminderCheckIns(store, chatId) {
  const pending = store.reminderCheckIns?.[chatId]?.pending ?? {};
  return Object.values(pending).flatMap(record => {
    if (!record || !Number.isFinite(record.dueAt)) return [];
    const reminder = store.reminders.find(item => item.chatId === chatId && item.id === record.reminderId);
    const delivery = reminder?.telegramDeliveries?.[record.key] ?? record.delivery;
    const task = record.taskId ? (store.lists[chatId]?.[record.listName] ?? [])
      .find(item => item.id === record.taskId) : null;
    if (delivery?.state !== "sent" || delivery.informational || record.taskId && (!task || task.checked)) return [];
    return [{ ...record, chatId, originalText: record.text, text: reminder?.text ?? task?.text ?? record.text,
      delivery, reminder, task }];
  });
}

// Bridge only today's confirmed active deliveries. Never create a backlog of
// check-ins for old archived dates or an uncertain Telegram send.
export function seedCurrentCheckIns(store, now) {
  const today = getJerusalemDateString(new Date(now));
  const mostRecent = item => Math.max(0, ...Object.values(item.telegramDeliveries ?? {})
    .map(delivery => delivery.sentAt ?? item.sentAt ?? 0));
  for (const reminder of [...store.reminders].sort((a, b) => mostRecent(b) - mostRecent(a))) {
    if (reminder.lastAttemptAt || store.reminderCheckIns?.[reminder.chatId]?.pending?.[reminder.id]) continue;
    const latest = Object.entries(reminder.telegramDeliveries ?? {})
      .filter(([, delivery]) => !delivery.informational && ["sent", "done"].includes(delivery.state) && Number.isSafeInteger(delivery.messageId)
        && Number.isFinite(delivery.sentAt ?? reminder.sentAt)
        && getJerusalemDateString(new Date(delivery.sentAt ?? reminder.sentAt)) === today)
      .sort((a, b) => (b[1].sentAt ?? reminder.sentAt) - (a[1].sentAt ?? reminder.sentAt))[0];
    if (latest && latest[1].state === "sent") {
      const oldFocus = store.reminderCheckIns?.[reminder.chatId]?.focus;
      registerReminderCheckIn(store, reminder, latest[0], {
        ...latest[1], sentAt: latest[1].sentAt ?? reminder.sentAt,
      });
      // A consumed focus is not permission to interpret another bare "done".
      if (oldFocus) store.reminderCheckIns[reminder.chatId].focus = oldFocus;
    }
  }
}

export function closeCheckInRecord(candidate, chatId, reminderId, key, now = Date.now()) {
  const state = candidate.reminderCheckIns?.[chatId];
  const record = state?.pending?.[reminderId];
  if (!record || record.key !== key) return;
  const pending = { ...state.pending };
  delete pending[reminderId];
  candidate.reminderCheckIns = { ...candidate.reminderCheckIns, [chatId]: { ...state, pending } };
  if (record.taskId && record.listName) {
    const lists = candidate.lists[chatId] ?? {};
    candidate.lists = { ...candidate.lists, [chatId]: { ...lists,
      [record.listName]: (lists[record.listName] ?? []).map(item =>
        item.id === record.taskId && !item.checked ? { ...item, checked: true, completedAt: now } : item),
    } };
  }
}

export async function acknowledgeReminderCheckIn(store, chatId, id) {
  const record = activeReminderCheckIns(store, chatId).find(item => item.id === id);
  if (!record) return "סגור.";
  const now = reminderValidationTime();
  const candidate = { ...store, reminders: structuredClone(store.reminders) };
  const reminder = candidate.reminders.find(item => item.chatId === chatId && item.id === record.reminderId);
  if (reminder?.telegramDeliveries?.[record.key]) {
    // A confirmed send followed by a failed save can still be acknowledged
    // in this process. Release its fence and advance this occurrence once,
    // just like the existing native Done button; never resend it.
    if (reminder.dueAt === record.dueAt && !reminder.sentAt) {
      const weekly = weeklyEntryFor(candidate, reminder.id);
      if (weekly) reminder.dueAt = nextWeeklyDueAt(weekly, now);
      else if (reminder.repeatEveryMs
        && (reminder.remainingOccurrences == null || reminder.remainingOccurrences > 1)) {
        reminder.dueAt = nextIntervalDueAt(record.dueAt, reminder.repeatEveryMs, now);
        if (reminder.remainingOccurrences != null) reminder.remainingOccurrences--;
      } else {
        reminder.sentAt = now;
        if (reminder.remainingOccurrences != null) reminder.remainingOccurrences = 0;
      }
      delete reminder.lastAttemptAt;
    }
    reminder.telegramDeliveries[record.key] = {
      ...reminder.telegramDeliveries[record.key], state: "done", completedAt: now,
    };
  }
  closeCheckInRecord(candidate, chatId, record.reminderId, record.key, now);
  await saveStore(candidate, { verifyCheckIns: { chatId },
    ...(record.taskId ? { verifyList: { chatId, listName: record.listName } } : {}) });
  store.reminders = candidate.reminders;
  store.lists = candidate.lists;
  store.reminderCheckIns = candidate.reminderCheckIns;
  return "מעולה, רשמתי שבוצע.";
}

export async function handleCheckInReply(store, chatId, text, referenceText = "") {
  const state = store.reminderCheckIns?.[chatId];
  if (!state?.focus) return null;
  store.reminderCheckIns = { ...store.reminderCheckIns,
    [chatId]: { ...state, lastReplyAt: reminderValidationTime() } };
  const records = activeReminderCheckIns(store, chatId);
  const quoted = referenceText ? records.filter(item =>
    referenceText.includes(item.text) || referenceText.includes(item.originalText)) : [];
  let record = quoted.length === 1 ? quoted[0] : records.find(item => item.id === state.focus);
  const simple = /^(?:כן[, ]*)?(?:בוצע|בוצעה|רשמתי|עשיתי|סיימתי|טופל|הסתדר|סיימנו|✅)(?:\s+(?:כבר|תודה|אחי|בהצלחה))?[.!✅\s]*$/u.test(text);
  const named = /(?:בוצע|בוצעה|רשמתי|טופל|סיימתי)[.!✅\s]*$/u.test(text)
    && !/(?:^|\s)(?:לא|טרם|מחר)(?:\s|$)/u.test(text);
  if (named && !simple && quoted.length !== 1) {
    const found = records.filter(item => text.includes(item.text));
    if (found.length !== 1) return null;
    record = found[0];
  }
  if (simple || named) return record ? acknowledgeReminderCheckIn(store, chatId, record.id) : "מעולה.";
  if (!record) return null;
  if (/^(?:מתי|באיזו שעה)(?:\s+(?:זה|היה|הייתה|התזכורת))*\s*[?？]*$/u.test(text)) {
    const clock = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(record.dueAt);
    return `התזכורת הייתה ב־${clock}.`;
  }
  if (/^(?:מה|מה יהיה|על מה|מה זה|מה התזכורת)\s*[?？]*$/u.test(text)) return `זה לגבי ${record.text}.`;
  const correction = parseReminderTitleCorrection(text);
  if (correction && !record.reminder && record.task) {
    const replacement = correction.newText;
    if (!replacement) return null;
    const candidate = { ...store, lists: structuredClone(store.lists),
      reminderCheckIns: structuredClone(store.reminderCheckIns) };
    const task = candidate.lists[chatId][record.listName].find(item => item.id === record.taskId);
    task.text = replacement;
    candidate.reminderCheckIns[chatId].pending[record.reminderId].text = replacement;
    candidate.reminderCheckIns[chatId].pending[record.reminderId].delivery.nagSuppressedAt = reminderValidationTime();
    await saveStore(candidate, { verifyList: { chatId, listName: record.listName }, verifyCheckIns: { chatId } });
    store.lists = candidate.lists; store.reminderCheckIns = candidate.reminderCheckIns;
    return "הבנתי, תוקן!";
  }
  return null;
}

export function checkInHint(record, previousHint = "") {
  const text = String(record.text ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return null;
  const choices = checkInEmojis.filter(emoji => emoji !== previousHint);
  return choices[randomInt(choices.length)];
}
