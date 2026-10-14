import { formatJerusalemTime, isReminderTimePast } from "./time.js";

// Read only: completion must not advance or otherwise change the next event.
export function nextReminderDetails(store, chatId, now = Date.now()) {
  const next = store.reminders
    .filter(reminder => reminder.chatId === chatId && !reminder.sentAt
      && !reminder.lastAttemptAt && Number.isFinite(reminder.dueAt))
    .sort((left, right) => left.dueAt - right.dueAt)[0];
  if (!next) return "כרגע אין עוד תזכורת בתור.";
  const time = formatJerusalemTime(next.dueAt);
  return isReminderTimePast(next.dueAt, now)
    ? `הבאה בתור: ${next.text}\nהמועד שלה כבר הגיע: ${time}.`
    : `הבאה בתור: ${next.text}\nב־${time}.`;
}
