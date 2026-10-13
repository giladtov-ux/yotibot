import { weeklyDueAtOnDate } from "./weekly-schedules.js";
import { getJerusalemDateString, parseJerusalemDateTime, shiftJerusalemDate } from "./time.js";

const scheduleWord = /לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה/u;
const normalize = text => text.trim().replace(/\s+/gu, " ").replace(/[?？!.]+$/u, "").trim();

export function isTodayScheduleQuery(rawText) {
  const text = normalize(rawText).replace(/^בבקשה\s+/u, "");
  return /^(?:מה|איך)\s+(?:הוא\s+|נראה\s+)?(?:ה)?(?:לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה)(?:\s+שלי)?\s+(?:של\s+|ל)?היום(?:\s+שלי)?$/u.test(text)
    || /^(?:מה|אילו)\s+(?:יש\s+לי|מתוכנן\s+לי|מחכה\s+לי)\s+היום$/u.test(text)
    || /^איך\s+(?:נראה\s+)?(?:היום\s+שלי|היום\s+נראה)$/u.test(text)
    || /^(?:תראה|תציג|הצג|אפשר\s+לראות)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה)(?:\s+שלי)?\s+(?:של\s+|ל)?היום$/u.test(text);
}

export function isScheduleInformationRequest(rawText) {
  const text = normalize(rawText);
  return scheduleQueryDayOffset(text) !== null
    || (scheduleWord.test(text)
      && /^(?:מה|איך|מתי|האם|אילו|איזה|אפשר\s+לראות|תראה|תציג|הצג)(?=\s)/u.test(text));
}

export function scheduleQueryDayOffset(rawText) {
  // Speech can contain a follow-up sentence; recognize only a clear read-only
  // opening question, never a command such as "תזכיר לי מחר".
  const sentences = rawText.split(/[?？!]/u).map(normalize).filter(Boolean);
  const text = (sentences[0] ?? "").replace(/^בבקשה\s+/u, "");
  const day = /מחר/u.test(text) ? "מחר" : "היום";
  if (sentences.slice(1).some(sentence =>
    !/^(?:מה|איך|מתי|אילו)(?=\s)/u.test(sentence)
    || !sentence.includes(day)
    || /(?:תזכיר|תוסיף|תמחק|תבטל|תקבע|תשמור|הוסף|מחק|בטל|שמור)/u.test(sentence))) return null;
  if (isTodayScheduleQuery(text) || /^מה\s+יש(?:\s+לי)?\s+היום$/u.test(text)) return 0;
  if (/^(?:ומה|מה\s+לגבי|ומה\s+לגבי)\s+מחר$/u.test(text)
    || /^(?:מה|אילו)\s+(?:יש(?:\s+לי)?|מתוכנן(?:\s+לי)?|מחכה\s+לי)\s+מחר$/u.test(text)
    || /^(?:מה|איך)\s+(?:הוא\s+|נראה\s+)?(?:ה)?(?:לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה)(?:\s+שלי)?\s+(?:של\s+|ל)?מחר(?:\s+שלי)?$/u.test(text)
    || /^(?:תראה|תציג|הצג|אפשר\s+לראות)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה)(?:\s+שלי)?\s+(?:של\s+|ל)?מחר$/u.test(text)) return 1;
  return null;
}

// A read-only view: never advances reminders, consumes pending requests or saves.
export function scheduleEventsOnDate(store, chatId, date) {
  const events = new Map();
  const add = (id, dueAt, text) => {
    if (!Number.isFinite(dueAt) || getJerusalemDateString(new Date(dueAt)) !== date) return;
    events.set(`${id}:${dueAt}`, { id, dueAt, text });
  };
  for (const reminder of store.reminders) {
    if (reminder.chatId === chatId) add(reminder.id, reminder.dueAt, reminder.text);
  }
  // The delivery worker may already have advanced a weekly reminder to next week.
  // Its saved weekly definition still describes today's occurrence.
  for (const schedule of store.savedSchedules ?? []) {
    if (schedule.chatId !== chatId) continue;
    for (const entry of schedule.entries ?? []) {
      if (!store.reminders.some(item => item.chatId === chatId && item.id === entry.reminderId)) continue;
      try {
        const dueAt = weeklyDueAtOnDate(entry, date);
        if (dueAt !== null) add(entry.reminderId, dueAt, entry.text);
      } catch { /* Do not invent a clock during a nonexistent DST wall time. */ }
    }
  }
  return [...events.values()].sort((left, right) => left.dueAt - right.dueAt);
}

export function formatTodaySchedule(store, chatId, now = new Date()) {
  return formatDaySchedule(store, chatId, now, 0);
}

export function formatDaySchedule(store, chatId, now = new Date(), offset = 0) {
  const date = shiftJerusalemDate(getJerusalemDateString(now), offset);
  const events = scheduleEventsOnDate(store, chatId, date);
  const day = offset === 1 ? "מחר" : "היום";
  if (!events.length) return `אחי, ל${day} אין כרגע תזכורת עם שעה.`;
  const clock = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const introduction = offset === 1
    ? `מחר ${new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem", weekday: "long",
    }).format(new Date(`${date}T12:00:00Z`))}, זה מה שמחכה לך:`
    : "זה מה שמחכה לך היום:";
  return `${introduction}\n\n${events
    .map(event => `${clock.format(new Date(event.dueAt))} — ${event.text}`).join("\n")}`;
}
