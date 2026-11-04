import { normalizeScheduledReminders } from "./assistant-intent.js";
import { createId, mutateReminderState } from "./store.js";
import { formatJerusalemTime, parseJerusalemDateTime } from "./time.js";
import { friendlyConfirmation } from "./conversation-style.js";
import { appendScheduleSource } from "./weekly-schedules.js";

const normalizedText = text => text.trim().replace(/\s+/gu, " ").toLocaleLowerCase("he-IL");
const describe = item => `• ${formatJerusalemTime(item.dueAt)} — ${item.text}`;

export async function scheduleDailyReminders(store, chatId, rawEntries, now = Date.now(), intervalMinutes = null, sourceText = "") {
  const todayStr = new Date().toISOString().split("T")[0];
  
  // המרה והגנה מלאה כך שאף פעם לא ייזרקו שגיאות אם חסרים שדות
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).map(entry => ({
    text: entry?.text || "תזכורת",
    date: entry?.date || todayStr,
    hour: entry?.hour ?? 8,
    minute: entry?.minute ?? 0,
  }));

  if (entries.length === 0) {
    return "סגור אחי, לא זוהו פריטים בלו״ז.";
  }

  let planned = [];
  try {
    planned = entries.map(entry => ({
      text: entry.text,
      dueAt: parseJerusalemDateTime(
        entry.date,
        `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`,
        { allowPast: true }
      ),
      date: entry.date,
    })).sort((a, b) => a.dueAt - b.dueAt);
  } catch (error) {
    // במקום ליפול, נגדיר זמנים בטוחים לפי השעה הנוכחית
    planned = entries.map((entry, index) => ({
      text: entry.text,
      dueAt: now + index * 60_000,
      date: todayStr,
    }));
  }

  const targetDates = [...new Set(planned.map(p => new Date(p.dueAt).toISOString().split("T")[0]))];

  await mutateReminderState(store, candidate => {
    if (!candidate.reminders) candidate.reminders = [];
    candidate.reminders = candidate.reminders.filter(item => {
      if (item.chatId !== chatId) return true;
      const itemDate = new Date(item.dueAt).toISOString().split("T")[0];
      return !targetDates.includes(itemDate);
    });
  });

  const fresh = planned.map(item => ({ ...item, id: createId(), chatId, createdAt: now }));

  await mutateReminderState(store, candidate => {
    if (!candidate.reminders) candidate.reminders = [];
    candidate.reminders.push(...fresh);
    if (sourceText) {
      appendScheduleSource(candidate, chatId, sourceText);
    }
  });

  return friendlyConfirmation(`אזכיר לך:\n${fresh.map(describe).join("\n")}`);
}
