import { extractHebrewDate } from "./natural-language.js";
import { getJerusalemDateString, shiftJerusalemDate } from "./time.js";

export function contextualScheduleDate(history, now) {
  // Only the current conversation topic can supply a missing day. A fresh
  // "tomorrow" header takes precedence over the preceding "today" section.
  for (const row of history.slice(-2).reverse()) {
    const content = String(row.content ?? "");
    const at = new Date(row.createdAt ?? now);
    // Telegram message dates have second precision; DB history has milliseconds.
    // A prior reply in the same second must not look like future context.
    if (!Number.isFinite(at.getTime()) || now - at > 86_400_000 || at.getTime() >= now + 1000) return null;
    if (/(?:^|\n)מחר\s*(?:\(|:)|הכנה\s+למחר/u.test(content)) {
      return shiftJerusalemDate(getJerusalemDateString(at), 1);
    }
    const date = extractHebrewDate(content.replace(/(^|\s)למחר(?=\s|$)/gu, "$1 מחר"), at);
    if (date) return date.date;
    if (row.role === "user") return null;
  }
  return null;
}

// A narrow Telegram-only fast path. Scheduling creates an event, never a
// completion, removal, or move of a task. Ambiguous destructive commands stay
// with the existing deletion engine.
export function parseContextualSchedule(rawText, history = [], now = Date.now()) {
  if (/[?？\n;]/u.test(rawText) || /אל\s+|בלי\s+|לדוגמה|דוגמה/u.test(rawText)) return null;
  let text = rawText.trim().replace(/[.!]+$/u, "")
    .replace(/^(?:בבקשה\s+)?(?:תוסיף|הוסף|תשבץ|שבץ|תקבע|קבע)\s+/u, "")
    .replace(/(^|\s)ל(מחרתיים|מחר|היום)(?=\s|$)/gu, "$1 $2");
  const transfer = /^תוריד\s+\d{1,2}:\d{2}\s+ל?משימות\s+מחר$/u.test(text);
  if (transfer) text = text.replace(/^תוריד\s+/u, "");
  else if (/^(?:מחק|תמחק|תוריד|הסר|תסיר|בטל|תבטל|שנה|תשנה|תעדכן|עדכן)\s/u.test(text)) return null;
  const supplied = extractHebrewDate(text, new Date(now));
  if (supplied) text = `${text.slice(0, supplied.start)} ${text.slice(supplied.end)}`.trim();
  const match = /^(\d{1,2}):(\d{2})\s+(.+)$/u.exec(text);
  if (!match || (text.match(/\d{1,2}:\d{2}/gu) ?? []).length !== 1) return null;
  const date = supplied?.date ?? contextualScheduleDate(history, now);
  if (!date) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const activity = transfer ? "משימות" : match[3].trim();
  return { type: "schedule-reminders", reminders: [{ text: activity, date, hour, minute }] };
}
