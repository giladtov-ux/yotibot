import { normalizeScheduledReminders } from "./assistant-intent.js";
import { createId, mutateReminderState } from "./store.js";
import { formatJerusalemTime, parseJerusalemDateTime } from "./time.js";
import { friendlyConfirmation } from "./conversation-style.js";
import { appendScheduleSource } from "./weekly-schedules.js";

const normalizedText = text => text.trim().replace(/\s+/gu, " ").toLocaleLowerCase("he-IL");
const describe = item => `• ${formatJerusalemTime(item.dueAt)} — ${item.text}`;

export async function scheduleDailyReminders(store, chatId, rawEntries, now = Date.now(), intervalMinutes = null, sourceText = "") {
  const todayStr = new Date().toISOString().split("T")[0];
  
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).map(entry => ({
    text: entry?.text || "תזכורת",
    date: entry?.date || todayStr,
    hour: entry?.hour ?? null,
    minute: entry?.minute ?? 0,
  }));

  if (entries.length === 0) {
    return "סגור אחי, לא זוהו פריטים בלו״ז.";
  }

  let planned = [];
  for (const entry of entries) {
    if (entry.hour == null || isNaN(entry.hour)) continue;
    try {
      const dueAt = parseJerusalemDateTime(
        entry.date,
        `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`,
        { allowPast: true }
      );
      if (Number.isFinite(dueAt)) {
        planned.push({
          text: entry.text,
          dueAt,
          date: entry.date,
        });
      }
    } catch {}
  }

  if (planned.length === 0) {
    return "אחי, לא הצלחתי לזהות שעות תקינות בלו״ז ששלחת. תוודא שהשעות מופיעות בצורה ברורה.";
  }

  planned.sort((a, b) => a.dueAt - b.dueAt);

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
}0
