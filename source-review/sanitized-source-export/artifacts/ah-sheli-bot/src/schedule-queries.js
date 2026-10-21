import { weeklyDueAtOnDate, scheduleWeekdays } from "./weekly-schedules.js";
import { getJerusalemDateString, parseJerusalemDateTime, shiftJerusalemDate } from "./time.js";

const scheduleWord = /לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה/u;
const normalize = text => text.trim().replace(/\s+/gu, " ").replace(/[?？!.]+$/u, "").trim();

export function isWeeklyScheduleQuery(rawText) {
  const text = normalize(rawText).replace(/^(?:(?:אחי|אח שלי)[, ]+)?(?:בבקשה\s+)?/u, "")
    .replace(/\s+בבקשה$/u, "");
  // Only an entire read-only request: a date or a mutation must still reach
  // the existing today/tomorrow and write handlers.
  return /^(?:(?:מה|איך|תראה|תציג|הצג|תן|אפשר לראות|אפשר לקבל)\s+(?:(?:נראה|הוא|לי|את)\s+)*)?(?:ה)?(?:לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה)(?:\s+(?:שלי|הקבוע|קבוע|השבועי|שבועי|השבוע|של השבוע))*$/u.test(text);
}

export function weeklyScheduleQueryDays(rawText) {
  const text = normalize(rawText).replace(/^בבקשה\s+/u, "");
  const match = /^(?:(?:מה|תראה|תציג|הצג|תן|אפשר לראות)\s+)?(?:ה)?(?:לו[״"׳']?ז|לוח\s*(?:ה)?זמנים|סידור\s*(?:ה)?עבודה)(?:\s+שלי)?\s+(?:של\s+|ל)?(.+)$/u.exec(text);
  if (!match || !/^(?:(?:ימי|ימים)\s+)?(?:[אבגדהו][׳']?\s*[-–־]\s*[אבגדהו][׳']?|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/u.test(match[1])) return null;
  const weekdays = scheduleWeekdays(match[1]);
  return weekdays.length ? weekdays : null;
}

// A focused weekday read leaves the proven full-week view and storage intact.
export function formatWeekdaySchedule(store, chatId, weekdays) {
  const rows = new Map();
  for (const schedule of store.savedSchedules ?? []) {
    if (schedule.chatId !== chatId) continue;
    for (const entry of schedule.entries ?? []) {
      const reminder = store.reminders.find(item => item.chatId === chatId && item.id === entry.reminderId);
      const activeDays = weekdays.filter(day => entry.weekdays?.includes(day));
      if (!reminder || !activeDays.length) continue;
      const clock = `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`;
      const key = `${clock} ${reminder.text}`;
      const row = rows.get(key) ?? { clock, text: reminder.text, days: new Set() };
      activeDays.forEach(day => row.days.add(day));
      rows.set(key, row);
    }
  }
  const names = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
  return [...rows.values()].sort((a, b) => a.clock.localeCompare(b.clock))
    .map(row => `${row.clock} ${row.text}${row.days.size === weekdays.length ? ""
      : ` (${[...row.days].sort().map(day => names[day]).join(", ")}${row.days.size === 1 ? " בלבד" : ""})`}`)
    .join("\n") || "עוד לא קבענו לו״ז לימים האלה.";
}

export function formatWeeklySchedule(store, chatId) {
  const schedules = (store.savedSchedules ?? []).filter(item => item.chatId === chatId);
  const reminders = store.reminders.filter(item => item.chatId === chatId);
  const linked = new Set();
  const days = Array.from({ length: 7 }, () => new Set());
  for (const schedule of schedules) for (const entry of schedule.entries ?? []) {
    const reminder = reminders.find(item => item.id === entry.reminderId);
    if (!reminder || linked.has(reminder.id)) continue;
    linked.add(reminder.id);
    const line = `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")} — ${reminder.text}`;
    for (const day of entry.weekdays ?? []) if (days[day]) days[day].add(line);
  }
  const rows = days.map(day => [...day].sort().join("\n"));
  const names = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const sections = [];
  if (rows.slice(0, 5).every(row => row === rows[0])) {
    sections.push(`ראשון–חמישי:\n${rows[0] || "לא נשמר לו״ז קבוע."}`);
  } else for (let day = 0; day < 5; day++) {
    sections.push(`${names[day]}:\n${rows[day] || "לא נשמר לו״ז קבוע."}`);
  }
  for (const day of [5, 6]) sections.push(`${names[day]}:\n${rows[day] || "לא נשמר לו״ז קבוע."}`);
  const dateLabel = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric", year: "numeric",
  });
  const clock = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const singles = reminders.filter(item => !linked.has(item.id) && !item.sentAt)
    .sort((a, b) => a.dueAt - b.dueAt);
  const dated = new Map();
  for (const item of singles) {
    if (!Number.isFinite(item.dueAt)) continue;
    const date = getJerusalemDateString(new Date(item.dueAt));
    const group = dated.get(date) ?? { title: dateLabel.format(new Date(item.dueAt)), rows: [] };
    group.rows.push(`${clock.format(new Date(item.dueAt))} — ${item.text}${
      item.repeatEveryMs ? " (תזכורת חוזרת)" : ""}`);
    dated.set(date, group);
  }
  if (dated.size) sections.push(`תזכורות נוספות לפי יום:\n\n${[...dated.values()]
    .map(group => `${group.title}:\n${group.rows.join("\n")}`).join("\n\n")}`);
  // Source-only schedules may contain activities without an exact clock.
  const sources = schedules.filter(item => !item.entries?.length).map(item => item.source).filter(Boolean);
  if (sources.length) sections.push(`פרטים נוספים שנשמרו:\n${sources.join("\n\n")}`);
  return `הלו״ז שלך\n\n${sections.join("\n\n")}`;
}

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
