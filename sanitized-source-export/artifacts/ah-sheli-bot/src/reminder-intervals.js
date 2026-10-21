import { createId, mutateReminderState } from "./store.js";
import { formatJerusalemTime, getJerusalemDateString, parseJerusalemDateTime, isReminderTimePast,
  reminderValidationTime } from "./time.js";
import { friendlyConfirmation } from "./conversation-style.js";

const cleanText = value => value.trim().replace(/\s+/gu, " ");
export function extractRequestedInterval(text) {
  const match = /(?:כל|בהפרש(?:ים)?(?:\s+של)?|במרווח(?:ים)?(?:\s+של)?)\s+(?:(\d+|שתי|שתיים|שני|שניים|אחת)\s*)?(דקות|דקה|דק[׳'.]?|שעתיים|שעות|שעה)/u.exec(text);
  if (!match) return null;
  const number = match[1] == null
    ? (match[2] === "שעתיים" ? 2 : ["דקות", "שעות"].includes(match[2]) ? NaN : 1)
    : /^\d+$/u.test(match[1]) ? Number(match[1]) : match[1] === "אחת" ? 1 : 2;
  const remaining = text.slice(match.index + match[0].length);
  return { minutes: number * (match[2].startsWith("שע") ? 60 : 1), start: match.index, end: match.index + match[0].length,
    ambiguous: /(?:כל|בהפרש(?:ים)?|במרווח(?:ים)?)\s+\d+/u.test(remaining) };
}

export function nextIntervalDueAt(dueAt, intervalMs, now) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 60_000 || intervalMs > 604_800_000) {
    throw new Error("Invalid reminder interval.");
  }
  // Anchor to the saved deadline, never to a Cron tick or delivery completion.
  // Skip missed ticks rather than sending a burst of catch-up notifications.
  return dueAt + Math.max(1, Math.floor((now - dueAt) / intervalMs) + 1) * intervalMs;
}

export async function scheduleIntervalReminder(store, chatId, intent, now = Date.now()) {
  const { intervalMinutes, repeatCount } = intent;
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) {
    return "לא נשמרה תזכורת: ההפרש צריך להיות מספר דקות שלם בין 1 ל-10080.";
  }
  if (repeatCount != null && (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 1000)) {
    return "לא נשמרה תזכורת: מספר הפעמים צריך להיות בין 1 ל-1000.";
  }
  if (typeof intent.text !== "string" || !intent.text.trim() || intent.text.length > 300) {
    return "מה להזכיר לך בכל פעם? עדיין לא נשמרה תזכורת חוזרת.";
  }
  if (intent.hour == null && intent.date) {
    return "באיזו שעה להתחיל את התזכורת החוזרת בתאריך הזה? עדיין לא נשמר דבר.";
  }
  const repeatEveryMs = intervalMinutes * 60_000;
  let dueAt = now + repeatEveryMs;
  if (intent.hour != null) {
    try {
      dueAt = parseJerusalemDateTime(intent.date ?? getJerusalemDateString(new Date(reminderValidationTime(now))),
        `${String(intent.hour).padStart(2, "0")}:${String(intent.minute ?? 0).padStart(2, "0")}`,
        { allowPast: true });
    } catch (error) { return `לא נשמרה תזכורת: ${error.message}`; }
    if (isReminderTimePast(dueAt, reminderValidationTime(now))) return "מועד ההתחלה כבר עבר. לא העברתי אותו למחר; באיזה מועד עתידי להתחיל?";
  }
  const text = cleanText(intent.text);
  const existing = store.reminders.find(item => item.chatId === chatId && !item.sentAt
    && cleanText(item.text) === text && item.repeatEveryMs === repeatEveryMs
    && (intent.hour == null || item.dueAt === dueAt));
  if (existing) return "התזכורת החוזרת הזאת כבר קיימת. לא יצרתי כפילות.";
  const reminder = { id: createId(), chatId, text, dueAt, createdAt: now,
    repeatEveryMs, ...(repeatCount != null ? { remainingOccurrences: repeatCount } : {}) };
  await mutateReminderState(store, candidate => {
    candidate.reminders.push(reminder);
  });
  return friendlyConfirmation(`אזכיר לך כל ${intervalMinutes} דקות${repeatCount == null ? " עד לביטול" : `, ${repeatCount} פעמים`}: ${text}\nנתחיל ב־${formatJerusalemTime(dueAt)}.`);
}
