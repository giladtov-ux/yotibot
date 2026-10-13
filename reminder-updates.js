import { getChatReminders, mutateReminderState } from "./store.js";
import { extractHebrewDate } from "./natural-language.js";
import { extractHebrewTime, getJerusalemDateString, parseJerusalemDateTime,
  formatJerusalemTime, reminderValidationTime, shiftJerusalemDate } from "./time.js";
import { isScheduleInformationRequest, scheduleQueryDayOffset } from "./schedule-queries.js";
import { menuRecords } from "./record-menu.js";
import { nextWeeklyDueAt } from "./weekly-schedules.js";

const change = /^(?:אחי[,\s]+|בבקשה\s+)?(?:שנה|תשנה|שני|שינוי|עדכן|תעדכן|העבר|תעביר|תזיז|הזז|דחה|תדחה|הקדם|תקדים)(?=\s)/u;
const noWrite = /(?:אל|לא)\s+(?:תשנה|תעדכן|תעביר|תזיז)|(?:רק|לשם)\s+(?:דוגמה|ציטוט)|^(?:מה|איך|האם)\s/u;
const normalized = text => text.replace(/[״"'׳.,!?]/gu, "").replace(/\s+/gu, " ").trim();

export function isReminderTimeUpdate(text) {
  return change.test(text.trim()) && !noWrite.test(text)
    && !/רשימ/u.test(text);
}

function requestedClocks(text) {
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
  const now = new Date(reminderValidationTime());
  const clocks = requestedClocks(rawText);
  const clock = clocks.at(-1);
  if (!clock || clock.hour > 23) return "לאיזו שעה להעביר את התזכורת?";
  const explicitDate = extractHebrewDate(rawText.replace(/(?<![א-ת])ל(?=מחר|היום|\d{4}-)/gu, " "), now)?.date;
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
  if (!matches.length && intent.reminderId) {
    matches = own.filter(item => item.id === intent.reminderId);
  }
  if (!matches.length && intent.itemText) {
    matches = own.filter(item => normalized(item.text) === normalized(intent.itemText));
  }
  if (!matches.length && genericTarget && !intent.reminderId && !intent.itemText
    && store.recordViews?.[chatId]) {
    const selected = menuRecords(store, chatId, store.recordViews[chatId].scope ?? "s")
      .find(item => item.key === store.recordViews[chatId].key && item.kind === "reminder");
    if (selected) matches = own.filter(item => item.id === selected.id);
  }
  if (!matches.length && !intent.reminderId && !intent.itemText && genericTarget) matches = own;
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
  const wholeSeries = /כל\s+(?:הסדרה|התזכורות|הפעמים)|(?:באופן\s+)?קבוע|מעתה|מעכשיו/u.test(rawText);
  if (target.repeatEveryMs && !wholeSeries) {
    return "זו תזכורת חוזרת. לשנות את כל הסדרה או רק תזכורת אחת?";
  }
  if (wholeSeries && explicitDate && weekly) return "שינוי יום בסדרה חוזרת דורש לבחור את ימי השבוע. לא שיניתי דבר.";
  const date = explicitDate ?? getJerusalemDateString(new Date(target.dueAt));
  let dueAt;
  try {
    dueAt = weekly && wholeSeries ? nextWeeklyDueAt({ ...weekly, hour: clock.hour, minute: clock.minute,
      timeOverrides: {} },
      reminderValidationTime(), { includeCurrentMinute: true })
      : parseJerusalemDateTime(date,
        `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`);
  } catch (error) { return `${error.message} לא שיניתי את התזכורת.`; }
  await mutateReminderState(store, candidate => {
    // Replacing, not editing the live object, keeps delivery/readers on the old
    // deadline until the transaction and verification have succeeded.
    candidate.reminders = candidate.reminders.map(item => item.id === target.id
      && item.chatId === chatId ? { ...item, dueAt } : item);
    if (weekly) {
      for (const schedule of candidate.savedSchedules.filter(item => item.chatId === chatId)) {
        for (const entry of schedule.entries ?? []) {
          if (entry.reminderId !== target.id) continue;
          if (wholeSeries) Object.assign(entry, {
            hour: clock.hour, minute: clock.minute, timeOverrides: {},
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
