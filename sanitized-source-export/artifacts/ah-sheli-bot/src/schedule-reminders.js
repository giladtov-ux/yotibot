import { normalizeScheduledReminders } from "./assistant-intent.js";
import { createId, mutateReminderState } from "./store.js";
import { formatJerusalemTime, parseJerusalemDateTime, isReminderTimePast, reminderValidationTime } from "./time.js";
import { friendlyConfirmation } from "./conversation-style.js";
import { appendScheduleSource } from "./weekly-schedules.js";

const normalizedText = text => text.trim().replace(/\s+/gu, " ").toLocaleLowerCase("he-IL");
const reminderKey = item => `${item.dueAt}:${normalizedText(item.text)}`;
const describe = item => `• ${formatJerusalemTime(item.dueAt)} — ${item.text}`;

export async function scheduleDailyReminders(store, chatId, rawEntries, now = Date.now(), intervalMinutes = null, sourceText = "") {
  // Validate the entire batch before changing any saved record.
  const entries = normalizeScheduledReminders(rawEntries);
  const missing = entries.flatMap((entry, index) => {
    const fields = [];
    if (!entry.text) fields.push("מה הפעילות");
    if ((!intervalMinutes || index === 0) && !entry.date) fields.push("באיזה יום");
    if ((!intervalMinutes || index === 0) && (entry.hour === null || entry.minute === null)) fields.push("באיזו שעה");
    return fields.length ? [`• ${entry.text ?? `פריט ${index + 1}`}: ${fields.join(", ")}`] : [];
  });
  if (missing.length) {
    if (sourceText) {
      await mutateReminderState(store, candidate => appendScheduleSource(candidate, chatId, sourceText));
      return "שמרתי את הלו״ז כמו ששלחת, בלי לקבוע יום או שעה שלא ציינת.";
    }
    return [
      "זיהיתי את הלו״ז. כדי לשמור את כולו יחד חסרים רק הפרטים הבאים:",
      ...missing,
      "ענה בהודעה אחת על הפרטים החסרים; אין צורך לשלוח את כל הלו״ז מחדש. עדיין לא נשמרו תזכורות מהלו״ז הזה.",
    ].join("\n");
  }

  let planned;
  try {
    if (intervalMinutes != null && (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080)) {
      return "לא נשמרו תזכורות: הפרש הדקות אינו תקין.";
    }
    if (intervalMinutes != null) {
      const first = entries[0];
      const start = parseJerusalemDateTime(first.date,
        `${String(first.hour).padStart(2, "0")}:${String(first.minute).padStart(2, "0")}`, { allowPast: true });
      planned = entries.map((entry, index) => ({ text: entry.text, dueAt: start + index * intervalMinutes * 60_000 }));
    } else {
      planned = entries.map(entry => ({
        text: entry.text,
        dueAt: parseJerusalemDateTime(entry.date,
          `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`,
          { allowPast: true }),
      })).sort((a, b) => a.dueAt - b.dueAt);
    }
  } catch (error) {
    return `לא נשמרו תזכורות מהלו״ז הזה: ${error.message}`;
  }

  const known = new Set(store.reminders.filter(item => item.chatId === chatId).map(reminderKey));
  const fresh = [], existing = [], past = [];
  for (const item of planned) {
    if (isReminderTimePast(item.dueAt, reminderValidationTime(now))) {
      past.push(item);
    } else if (known.has(reminderKey(item))) {
      existing.push(item);
    } else {
      known.add(reminderKey(item));
      fresh.push({ ...item, id: createId(), chatId, createdAt: now });
    }
  }
  if (fresh.length || sourceText) {
    await mutateReminderState(store, candidate => {
      candidate.reminders.push(...fresh);
      appendScheduleSource(candidate, chatId, sourceText);
    });
  }
  return [
    fresh.length
      ? friendlyConfirmation(`אזכיר לך:\n${fresh.map(describe).join("\n")}`)
      : "",
    existing.length ? `זה כבר שמור אצלי:\n${existing.map(describe).join("\n")}` : "",
    past.length ? `אלה כבר עברו, אז לא הזזתי אותם ליום אחר:\n${past.map(describe).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}
