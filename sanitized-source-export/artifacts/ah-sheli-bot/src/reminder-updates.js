import { getChatReminders, mutateReminderState } from "./store.js";
import { extractHebrewDate } from "./natural-language.js";
import { extractHebrewTime, getJerusalemDateString, parseJerusalemDateTime,
  formatJerusalemTime, reminderValidationTime, shiftJerusalemDate } from "./time.js";
import { isScheduleInformationRequest, scheduleQueryDayOffset } from "./schedule-queries.js";
import { menuRecords } from "./record-menu.js";
import { nextWeeklyDueAt, scheduleWeekdays, appendScheduleSource } from "./weekly-schedules.js";
import { matchReminderReference } from "./reminder-reference.js";

const change = /^(?:(?:אחי|אח שלי)[,\s]+)?(?:בבקשה\s+)?(?:(?:תוכל|אפשר)\s+)?(?:שנה|תשנה|שני|שינוי|לשנות|עדכן|תעדכן|לעדכן|העבר|תעביר|להעביר|תזיז|הזז|להזיז|דחה|תדחה|לדחות|הקדם|תקדים|להקדים)(?=\s)/u;
const noWrite = /(?:אל|לא)\s+(?:תשנה|תעדכן|תעביר|תזיז)|(?:רק|לשם)\s+(?:דוגמה|ציטוט)|^(?:מה|איך|האם)\s/u;
const normalized = text => text.replace(/[״"'׳.,!?]/gu, "").replace(/\s+/gu, " ").trim();

export function isReminderTimeUpdate(text) {
  return change.test(text.trim()) && !noWrite.test(text)
    && !/רשימ/u.test(text);
}

export function contextualReminderTimeRequest(store, chatId, text, history = []) {
  const time = extractHebrewTime(text);
  if (!time || noWrite.test(text) || isReminderTimeUpdate(text)) return null;
  let remaining = `${text.slice(0, time.start)} ${text.slice(time.end)}`;
  const date = extractHebrewDate(remaining.replace(/(?<![א-ת])ל(?=מחר|היום)/gu, " "));
  if (date) remaining = `${remaining.slice(0, date.start)} ${remaining.slice(date.end)}`;
  if (normalized(remaining).replace(/^[\s־-]+|[\s־-]+$/gu, "").length) return null;
  const previous = history.filter(row => row.role === "user").at(-1);
  const reply = history.filter(row => row.role === "assistant").at(-1);
  const previousText = previous?.content ?? previous?.text ?? "";
  const replyText = reply?.content ?? reply?.text ?? "";
  if (isReminderTimeUpdate(previousText) && /לאיזו שעה להעביר/u.test(replyText)) {
    return `${previousText} ${text}`;
  }
  return null;
}

export function requestedClocks(text) {
  const clocks = [];
  let remaining = text.replace(/(?<![א-ת])[למ][־-]?(?=\d)/gu, " ");
  while (remaining) {
    const time = extractHebrewTime(remaining);
    if (!time) break;
    clocks.push(time);
    remaining = remaining.slice(time.end);
  }
  return clocks;
}

function conversationDate(history, now) {
  // Only the latest user turn can provide a displayed day; old requests are
  // not replayed and assistant prose cannot authorize or date a write.
  const previous = history.filter(row => row.role === "user").at(-1);
  const text = previous?.content ?? previous?.text ?? "";
  const offset = scheduleQueryDayOffset(text);
  if (offset !== null) return shiftJerusalemDate(getJerusalemDateString(now), offset);
  return isScheduleInformationRequest(text)
    ? extractHebrewDate(text.replace(/(?<![א-ת])ל(?=מחר|היום|\d{4}-)/gu, " "), now)?.date ?? null : null;
}

export async function updateReminderTime(store, chatId, rawText, intent = {}, history = []) {
  if (noWrite.test(rawText)) return "לא שיניתי דבר.";
  if (/(?:לא\s+(?:בימי|ביום)|למעט|חוץ\s+מ|פרט\s+ל)/u.test(rawText)) {
    return "באילו ימים להשאיר את התזכורת?";
  }
  const now = new Date(reminderValidationTime());
  const clocks = requestedClocks(rawText);
  const clock = clocks.at(-1);
  if (!clock || clock.hour > 23) return "לאיזו שעה להעביר את התזכורת?";
  const requestedDays = /[אבגדהו][׳']?\s*[-–־]\s*[אבגדהו][׳']?|(?:ב?ימי|לימי|בכל יום|כל יום)\s/u.test(rawText)
    ? scheduleWeekdays(rawText) : [];
  const explicitDate = requestedDays.length && !/היום|מחר|תאריך|\d{4}-\d{2}|\d{1,2}[/.]\d{1,2}/u.test(rawText)
    ? undefined : extractHebrewDate(rawText.replace(/(?<![א-ת])ל(?=מחר|היום|\d{4}-)/gu, " "), now)?.date;
  const contextDate = conversationDate(history, now);
  const own = getChatReminders(store, chatId);
  const text = normalized(rawText);
  const genericTarget = /(?:אותה|אותו|את זה|התזכורת הזו|התזכורת הזאת)/u.test(rawText)
    || !normalized(rawText).replace(change, "")
      .replace(/[למב־-]*\d+(?::\d+)?/gu, "")
      .split(" ").filter(word => word && !new Set([
        "את", "התזכורת", "תזכורת", "האירוע", "הפגישה", "של", "ל", "לשעה", "שעה", "השעה", "הזמן", "המועד", "בשעה",
        "היום", "מחר", "למחר", "מחרתיים", "בבוקר", "בערב", "בצהריים", "בלילה",
      ]).has(word)).length;
  // A named target takes precedence over a currently displayed record.
  let matches = own.filter(item => text.includes(normalized(item.text)));
  if (!matches.length && !genericTarget) {
    matches = matchReminderReference(own, rawText, [], { matchTime: false });
  }
  if (!matches.length && intent.reminderId) {
    matches = own.filter(item => item.id === intent.reminderId);
  }
  if (!matches.length && intent.itemText) {
    matches = own.filter(item => normalized(item.text) === normalized(intent.itemText));
  }
  if (!matches.length && genericTarget && intent.referenceText) {
    matches = matchReminderReference(own, intent.referenceText,
      (store.savedSchedules ?? []).filter(item => item.chatId === chatId));
  }
  if (!matches.length && genericTarget && !intent.referenceText && !intent.reminderId && !intent.itemText
    && store.recordViews?.[chatId]) {
    const selected = menuRecords(store, chatId, store.recordViews[chatId].scope ?? "s")
      .find(item => item.key === store.recordViews[chatId].key && item.kind === "reminder");
    if (selected) matches = own.filter(item => item.id === selected.id);
  }
  if (!matches.length && !intent.referenceText && !intent.reminderId && !intent.itemText && genericTarget) matches = own;
  // The day displayed by the last read disambiguates repeated titles. A
  // explicitly requested destination date must not hide the old source record.
  if (matches.length > 1 && contextDate) matches = matches.filter(item =>
    getJerusalemDateString(new Date(item.dueAt)) === contextDate);
  if (matches.length > 1 && clocks.length > 1) {
    const oldClock = clocks[0];
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    matches = matches.filter(item => formatter.format(new Date(item.dueAt)) ===
      `${String(oldClock.hour).padStart(2, "0")}:${String(oldClock.minute).padStart(2, "0")}`);
  }
  if (matches.length !== 1) return matches.length
    ? "איזו תזכורת להעביר? יש כמה שמתאימות." : "איזו תזכורת להעביר? לא מצאתי תזכורת מתאימה.";
  const target = matches[0];
  if (target.sentAt) return "התזכורת הזו כבר נשלחה. לקבוע תזכורת חדשה?";
  const weekly = (store.savedSchedules ?? []).filter(item => item.chatId === chatId)
    .flatMap(item => item.entries ?? []).find(item => item.reminderId === target.id);
  // Do not silently change a whole recurring series when one day is intended.
  const wholeSeries = requestedDays.length > 0
    || /כל\s+(?:הסדרה|התזכורות|הפעמים)|(?:באופן\s+)?קבוע|מעתה|מעכשיו/u.test(rawText);
  if (target.repeatEveryMs && !wholeSeries) {
    return "זו תזכורת חוזרת. לשנות את כל הסדרה או רק תזכורת אחת?";
  }
  if (wholeSeries && explicitDate && weekly) return "שינוי יום בסדרה חוזרת דורש לבחור את ימי השבוע. לא שיניתי דבר.";
  const date = explicitDate ?? getJerusalemDateString(new Date(target.dueAt));
  const updatedWeekly = requestedDays.length ? { ...(weekly ?? {}),
    reminderId: target.id, text: target.text, weekdays: requestedDays,
    hour: clock.hour, minute: clock.minute, timeOverrides: {} } : null;
  let dueAt;
  try {
    dueAt = updatedWeekly ? nextWeeklyDueAt(updatedWeekly, reminderValidationTime(), { includeCurrentMinute: true })
      : weekly && wholeSeries ? nextWeeklyDueAt({ ...weekly, hour: clock.hour, minute: clock.minute,
      timeOverrides: {} },
      reminderValidationTime(), { includeCurrentMinute: true })
      : parseJerusalemDateTime(date,
        `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`);
  } catch (error) {
    return /HH:mm|YYYY-MM-DD/u.test(error.message) ? "לאיזה יום ושעה להעביר את התזכורת?"
      : `${error.message} לא שיניתי את התזכורת.`;
  }
  await mutateReminderState(store, candidate => {
    // Replacing, not editing the live object, keeps delivery/readers on the old
    // deadline until the transaction and verification have succeeded.
    candidate.reminders = candidate.reminders.map(item => item.id === target.id
      && item.chatId === chatId ? { ...item, dueAt,
        ...(updatedWeekly ? { repeatEveryMs: null, remainingOccurrences: null } : {}) } : item);
    if (updatedWeekly && !weekly) appendScheduleSource(candidate, chatId, rawText, [updatedWeekly]);
    if (weekly) {
      for (const schedule of candidate.savedSchedules.filter(item => item.chatId === chatId)) {
        for (const entry of schedule.entries ?? []) {
          if (entry.reminderId !== target.id) continue;
          if (wholeSeries) Object.assign(entry, {
            hour: clock.hour, minute: clock.minute, timeOverrides: {},
            ...(requestedDays.length ? { weekdays: [...requestedDays] } : {}),
          });
          else {
            const oldDate = getJerusalemDateString(new Date(target.dueAt));
            entry.timeOverrides = { ...entry.timeOverrides, [oldDate]: null, [date]: dueAt };
          }
        }
      }
    }
  }, { verifyReminder: { id: target.id, chatId, dueAt } });
  return `סגור, “${target.text}” הועברה ל־${formatJerusalemTime(dueAt)}.`;
}

export function isUpdateSuccessClaim(response) {
  if (typeof response !== "string") return false;
  const verbs = "(?:שיניתי|עדכנתי|העברתי|הזזתי|דחיתי|הקדמתי|תיקנתי|הוספתי|שמרתי|רשמתי|יצרתי|סימנתי|ביטלתי)";
  const withoutNegatives = response.replace(
    new RegExp(`(?:לא|טרם)\\s+${verbs}(?=[\\s\\p{P}]|$)`, "gu"), "");
  return new RegExp(`(?:^|[\\s\\p{P}\\p{S}])${verbs}(?=[\\s\\p{P}]|$)`, "u")
    .test(withoutNegatives)
    || /(?:^|[\s\p{P}\p{S}])(?:המשימה|המשימות|הפריט|הפריטים|הרשימה|השעה|התזכורת|האירוע)\s+(?:נוספ(?:ה|ו)?|נשמר(?:ה|ו)?|נוצר(?:ה|ו)?|סומנ(?:ה|ו)?|עודכנ(?:ה|ו)?|שונתה|הועברה|נדחה|עודכן|הוזז)(?=[\s\p{P}]|$)/u.test(withoutNegatives);
}
