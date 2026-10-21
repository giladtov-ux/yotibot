import { getJerusalemDateString, shiftJerusalemDate, reminderValidationTime } from "./time.js";
import { scheduleEventsOnDate } from "./schedule-queries.js";

export function isDailySummaryRequest(rawText) {
  const text = rawText.trim().replace(/^בבקשה\s+/u, "").replace(/[?!.…]+$/u, "").trim();
  if (/אתמול|השבוע|שבוע\s+(?:הזה|האחרון|שעבר)/u.test(text)) return false;
  return /^(?:הכנה\s+למחר|(?:תכין|הכן)\s+(?:אותי|לי)\s+למחר)$/u.test(text)
    || (/^(?:מה\s+(?:ה?סיכום|עשינו|עודכן|בוצע)|(?:תן|תני|אפשר)\s+(?:לי\s+|לקבל\s+)?סיכום|סיכום|(?:תסכם|סכם|תסכמי|סכמי)\s)/u.test(text)
      && /היום|(?:סיכום\s+)(?:יום|יומי)|הכנה\s+למחר/u.test(text));
}

// Read-only presentation: no action inference, write, or full-list snapshot.
export function formatDailySummary(store, chatId, history = [], now = reminderValidationTime(), {
  telegramResponseStyle = false,
} = {}) {
  // Telegram has a strict SQL-row-only path. Legacy channel wording below is
  // never executed for its daily summaries.
  if (telegramResponseStyle) return formatTelegramDailySummary(store, chatId, now);
  const today = getJerusalemDateString(new Date(now));
  const onToday = timestamp => {
    const value = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
    return timestamp != null && Number.isFinite(value) && value <= now
      && getJerusalemDateString(new Date(value)) === today;
  };
  const confirmations = (Array.isArray(history) ? history : history?.rows ?? [])
    .filter(row => row.role === "assistant" && onToday(row.createdAt))
    .flatMap(row => String(row.content ?? row.text ?? "").split("\n"))
    .map(line => line.trim().replace(/^[^\p{L}\p{N}]+/u, "").replace(/^אחי[, ]+/u, ""))
    .filter(line => /^(?:נוסף\s+לרשימה|הרשימה\s+עודכנה|הוספתי|הסרתי|מחקתי|ניקיתי|עדכנתי|שיניתי|שמרתי|סימנתי|(?:מעולה!?\s*)?סומן\s+כבוצע)(?=\s|:|[.!]|$)/u.test(line));
  const completedReminders = store.reminders.filter(reminder => reminder.chatId === chatId
    && Object.values(reminder.telegramDeliveries ?? {}).some(receipt =>
      receipt.state === "done" && onToday(receipt.completedAt)));
  const completed = completedReminders.length > 0
    || confirmations.some(line => /סומן\s+כבוצע|^סימנתי.*בוצע/u.test(line));
  const updated = confirmations.some(line => !/סומן\s+כבוצע|^סימנתי.*בוצע/u.test(line));
  const completedTitles = [...new Set([
    ...completedReminders.map(item => item.text),
    ...confirmations.flatMap(line => {
      const match = line.match(/^(?:מעולה!?\s*)?סומן\s+כבוצע:\s*(.+)/u);
      return match ? match[1].split(",").map(title => title.trim()) : [];
    }),
  ].map(title => String(title).replace(/\s+/gu, " ").replace(/[.!]+$/u, "").trim())
    .filter(Boolean))];
  const execution = completedTitles.length
    ? `הושלמו: ${completedTitles.slice(0, 2).map(title =>
      title.length > 55 ? `${title.slice(0, 52)}…` : title).join(", ")}${completedTitles.length > 2 ? " ועוד פעולות" : ""}.`
    : completed ? "תועדו ביצועים במשימות ובתזכורות." : "";
  let activity = [execution, updated ? "נשמרו העדכונים שביקשת." : ""]
    .filter(Boolean).join(" ") || "אין כרגע ביצועים או עדכונים מתועדים להיום.";
  if (history?.unavailable) {
    activity = completed ? "סומנו ביצועים; היסטוריית העדכונים אינה זמינה כרגע."
      : "היסטוריית היום אינה זמינה כרגע.";
  } else if (history?.partial) activity = `לפי התיעוד הזמין: ${activity}`;

  return summaryWithTomorrow(store, chatId, now, activity, "אין כרגע אירועים מתוכננים עם שעה.");
}

export function formatTelegramDailySummary(snapshot, chatId, now = Date.now()) {
  if (!Array.isArray(snapshot.completedTasks)) {
    throw new Error("The summary requires committed SQL task rows.");
  }
  // No prose generation, prefix, truncation, deduplication or reminder union.
  const today = snapshot.completedTasks.length
    ? snapshot.completedTasks.map(task => task.text).join("\n")
    : "לא סומנו משימות שהושלמו היום.";
  return summaryWithTomorrow(snapshot, chatId, now, today, "לא נשמר לו״ז עם שעות למחר.");
}

function summaryWithTomorrow(store, chatId, now, activity, emptyAgenda) {
  const tomorrow = shiftJerusalemDate(getJerusalemDateString(new Date(now)), 1);
  const reminders = new Map(store.reminders.filter(item => item.chatId === chatId)
    .map(item => [item.id, item]));
  const events = scheduleEventsOnDate(store, chatId, tomorrow).filter(event => {
    const reminder = reminders.get(event.id);
    if (reminder?.telegramDeliveries?.[String(event.dueAt)]?.state === "done") return false;
    // A rescheduled current occurrence supersedes the old saved schedule clock.
    return !reminder || getJerusalemDateString(new Date(reminder.dueAt)) !== tomorrow
      || reminder.dueAt === event.dueAt;
  });
  const date = new Date(`${tomorrow}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", weekday: "long",
  }).format(date).replace(/^יום\s+/u, "");
  const [, month, day] = tomorrow.split("-");
  const clock = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const agenda = events.map(event =>
    `${clock.format(new Date(event.dueAt))} ${String(reminders.get(event.id)?.text ?? event.text)
      .replace(/\s+/gu, " ").trim()}`).join("\n") || emptyAgenda;
  return `היום:\n${activity}\n\nמחר (${weekday}, ${day}.${month}):\n${agenda}`;
}
