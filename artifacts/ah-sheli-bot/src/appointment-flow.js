import { extractHebrewDate } from "./natural-language.js";
import { extractHebrewTime, reminderValidationTime } from "./time.js";
import { contextualScheduleDate } from "./contextual-schedule.js";
import { createId, saveStore } from "./store.js";

// Narrow fast path for new appointments, not queries, cancellations, examples,
// shopping additions or existing-record edits. Other language remains AI-routed.
export function parseNewAppointment(rawText, history = [], now = reminderValidationTime()) {
  let text = rawText.trim().replace(/(^|\s)ל(מחרתיים|מחר|היום)(?=\s|$)/gu, "$1$2");
  if (/[?？\n;]/u.test(text)
    || /^(?:מה|מתי|איפה|האם|איך|מחק|תמחק|בטל|תבטל|תוריד|שנה|תשנה|עדכן|תעדכן)\s/u.test(text)
    || /(?:אין לי|לא צריך|אל\s+|בלי\s+|לדוגמה|דוגמה|בוטל|בוטלה|ביטלתי|סיימתי|כל\s+(?:יום|שבוע|חודש|דקה|שעה)|חוזר|שבועי|קבוע)/u.test(text)) return null;
  const date = extractHebrewDate(text, new Date(now));
  const time = extractHebrewTime(text);
  const scheduling = /^(?:בבקשה\s+)?(?:תקבע|קבע|תשבץ|שבץ|תתזמן|תזמן)\s/u.test(text);
  const goals = /(?:תוסיף|הוסף|תשמור|שמור)\s+(?:את\s+זה\s+)?(?:ל|ב)(?:רשימת\s+)?(?:מטרות|יעדים)/u.test(text);
  for (const span of [date, time].filter(Boolean).sort((a, b) => b.start - a.start)) {
    text = `${text.slice(0, span.start)} ${text.slice(span.end)}`;
  }
  const title = text.replace(/^(?:בבקשה\s+)?(?:יש לי|נקבעה לי|נקבע לי|קבעתי|אני צריך לקבוע|צריך לקבוע|תקבע לי|קבע לי|תקבע|קבע|תשבץ|שבץ|תתזמן|תזמן)\s+/u, "")
    .replace(/\s+/gu, " ").replace(/[\s,.!]+$/u, "")
    .replace(/\s+(?:ו)?(?:תוסיף|הוסף|תשמור|שמור)\s+(?:את\s+זה\s+)?(?:ל|ב)(?:רשימת\s+)?(?:מטרות|יעדים)$/u, "")
    .replace(/\s+(?:ב|בשעה|ביום)$/u, "").trim();
  const appointment = /^(?:פגישה|תור|אירוע|מפגש|ראיון|בדיקה|ישיבה)(?:\s|$)/u.test(title);
  const task = /^(?:ללכת|לדבר|להתקשר|לאסוף|לקחת|לשלם|להביא|להיפגש|לעשות|להחזיר|לסדר)(?:\s|$)/u.test(title);
  if (!appointment && !(task && (time || date || scheduling))) return null;
  // Unsupported written dates must be interpreted by the normal contextual AI,
  // never discarded and replaced with an assumed day.
  if (!date && /ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר/u.test(rawText)) return null;
  return { type: "reminder", text: title, date: date?.date ?? contextualScheduleDate(history, now),
    hour: time?.hour ?? null, minute: time?.minute ?? null, trackTask: true,
    taskListName: goals ? "מטרות" : "משימות" };
}

// The canonical writer commits the event and independent task in one verified
// state transaction. Neither live in-memory array is changed before success.
export async function persistTrackedReminder(store, chatId, reminder, taskListName = "משימות") {
  const name = taskListName === "מטרות" ? "מטרות" : "משימות";
  const oldLists = store.lists[chatId] ?? {};
  const items = oldLists[name] ?? [];
  const existing = items.find(item => !item.checked && item.text.trim() === reminder.text.trim());
  const task = existing ?? { id: createId(), text: reminder.text, checked: false };
  reminder.trackingTaskId = task.id;
  reminder.trackingListName = name;
  const candidate = { ...store, reminders: [...store.reminders, reminder],
    lists: { ...store.lists, [chatId]: { ...oldLists, [name]: existing ? items : [...items, task] } },
    pendingActions: { ...store.pendingActions } };
  delete candidate.pendingActions[chatId];
  await saveStore(candidate, { verifyList: { chatId, listName: name } });
  store.reminders = candidate.reminders;
  store.lists = candidate.lists;
  store.pendingActions = candidate.pendingActions;
  return { createdTask: !existing, listName: name };
}
