import {
  extractHebrewTime,
  getJerusalemDateString,
  getNextJerusalemWeekdayDate,
  parseJerusalemDateTime,
  shiftJerusalemDate,
  reminderValidationTime,
} from "./time.js";
import { parseRecordQuery, parseExplicitListWrite } from "./record-queries.js";
import { extractRequestedInterval } from "./reminder-intervals.js";
import { parseListDeletion } from "./list-deletion.js";
import { parseBareTasks } from "./task-understanding.js";

const WEEKDAYS = new Map([
  ["ראשון", 0],
  ["שני", 1],
  ["שלישי", 2],
  ["רביעי", 3],
  ["חמישי", 4],
  ["שישי", 5],
  ["שבת", 6],
]);

function cleanPhrase(value) {
  return value
    .trim()
    .replace(/^[\s,;:־-]+|[\s,;:־-]+$/gu, "")
    .replace(/[.!?]+$/u, "")
    .trim();
}

function removeRange(text, start, end) {
  return `${text.slice(0, start)} ${text.slice(end)}`.replace(/\s+/gu, " ").trim();
}

export function extractHebrewDate(text, now = new Date(reminderValidationTime())) {
  const isoMatch = /(?:^|\s)(\d{4}-\d{2}-\d{2})(?=$|\s|[,.!?])/u.exec(text);
  if (isoMatch) {
    return {
      date: isoMatch[1],
      start: isoMatch.index,
      end: isoMatch.index + isoMatch[0].length,
    };
  }

  const simpleDayMatch = /(?:^|\s)(היום|מחרתיים|מחר)(?=$|\s|[,.!?])/u.exec(text);
  if (simpleDayMatch) {
    const localToday = getJerusalemDateString(now);
    const days = simpleDayMatch[1] === "היום" ? 0 : simpleDayMatch[1] === "מחר" ? 1 : 2;
    return {
      date: shiftJerusalemDate(localToday, days),
      start: simpleDayMatch.index,
      end: simpleDayMatch.index + simpleDayMatch[0].length,
    };
  }

  const weekdayMatch =
    /(?:^|\s)(?:(?:ב)?יום\s+|ב)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?:\s+(?:הבא|הקרוב))?(?=$|\s|[,.!?])/u.exec(
      text,
    );
  if (weekdayMatch) {
    const weekday = WEEKDAYS.get(weekdayMatch[1]);
    return {
      date: getNextJerusalemWeekdayDate(weekday, now),
      start: weekdayMatch.index,
      end: weekdayMatch.index + weekdayMatch[0].length,
    };
  }

  const relativeDaysMatch = /(?:^|\s)בעוד\s+(\d{1,2})\s+ימים?(?=$|\s|[,.!?])/u.exec(text);
  if (relativeDaysMatch) {
    return {
      date: shiftJerusalemDate(getJerusalemDateString(now), Number(relativeDaysMatch[1])),
      start: relativeDaysMatch.index,
      end: relativeDaysMatch.index + relativeDaysMatch[0].length,
    };
  }
  return null;
}

function splitItems(rawItems) {
  return rawItems
    .replace(/\s+וגם\s+/gu, ",")
    .split(/,|;|\s+ו(?=[א-ת])/u)
    .map(cleanPhrase)
    .filter(Boolean);
}

function parseReminder(text, now) {
  const prefix =
    /^(?:בבקשה\s+)?(?:תזכיר(?:י)? לי|שים לי תזכורת|קבע לי תזכורת|תזכורת לי|אל תשכח(?:י)?)\s*/u.exec(
      text,
    );
  if (!prefix) return null;

  let remainder = text.slice(prefix[0].length);
  const dateMatch = extractHebrewDate(remainder, now);
  if (dateMatch) remainder = removeRange(remainder, dateMatch.start, dateMatch.end);

  const timeMatch = extractHebrewTime(remainder);
  if (timeMatch) remainder = removeRange(remainder, timeMatch.start, timeMatch.end);

  const reminderText = cleanPhrase(
    remainder
      .replace(/^(?:נא\s+)?(?:בבקשה\s+)?/u, "")
      .replace(/^(?:שלא\s+)?תשכח(?:י)?\s+/u, ""),
  );

  let date = dateMatch?.date ?? null;
  if (!date && timeMatch) {
    date = getJerusalemDateString(now);
    const timeText = `${String(timeMatch.hour).padStart(2, "0")}:${String(timeMatch.minute).padStart(2, "0")}`;
    parseJerusalemDateTime(date, timeText, {
      allowPast: true,
    });
  }

  return {
    type: "reminder",
    text: reminderText,
    date,
    hour: timeMatch?.hour ?? null,
    minute: timeMatch?.minute ?? null,
  };
}

export function parseNaturalIntent(rawText, now = new Date(reminderValidationTime())) {
  const text = rawText.trim().replace(/\s+/gu, " ");
  if (!text) return null;
  const deletion = parseListDeletion(text);
  if (deletion) return deletion;
  const query = parseRecordQuery(text) ?? parseExplicitListWrite(text);
  if (query) return query;
  const interval = extractRequestedInterval(text);
  if (interval && /^(?:בבקשה\s+)?(?:תזכיר|הזכר|שלח\s+לי\s+תזכורת)/u.test(text)
    && (text.match(/\d{1,2}:\d{2}/gu) ?? []).length <= 1 && !/[\n;]/u.test(rawText)) {
    if (interval.ambiguous) return { type: "clarify", response: "ציינת כמה הפרשי זמן. איזה הפרש שייך לכל תזכורת? אפשר להשלים את כולם יחד; עדיין לא נשמר דבר." };
    if (/\d+\s*(?:פעילויות|אירועים)/u.test(text)) return null;
    if (/(?:עד\s+(?!לביטול(?:\s|$))|למשך\s|במשך\s)/u.test(text)) {
      return { type: "clarify", response: "כדי לא ליצור חזרה בלי גבול, ציין כמה פעמים לשלוח את התזכורת. אפשר גם לכתוב במפורש שהיא חוזרת עד לביטול." };
    }
    let body = removeRange(text, interval.start, interval.end)
      .replace(/^(?:בבקשה\s+)?(?:תזכיר|הזכר)(?:\s+לי)?\s*/u, "")
      .replace(/^(?:בבקשה\s+)?שלח\s+לי\s+תזכורת\s*/u, "");
    let repeatCount = null;
    const count = /(\d+)\s*(?:פעמים|תזכורות)/u.exec(body);
    if (!count && /פעמים/u.test(body)) {
      return { type: "clarify", response: "כמה פעמים לשלוח? כתוב את מספר הפעמים בספרות כדי שלא אקבע חזרה ללא הגבלה בטעות." };
    }
    if (count) {
      repeatCount = Number(count[1]);
      body = removeRange(body, count.index, count.index + count[0].length);
    }
    const date = extractHebrewDate(body, now);
    if (date) body = removeRange(body, date.start, date.end);
    const time = extractHebrewTime(body);
    if (time) body = removeRange(body, time.start, time.end);
    body = cleanPhrase(body.replace(/(?:החל\s+מ|מתחיל\s+ב|החל|מעכשיו|עד לביטול)/gu, ""));
    return { type: "repeat-reminder", text: body, intervalMinutes: interval.minutes, repeatCount,
      date: date?.date ?? null, hour: time?.hour ?? null, minute: time?.minute ?? null };
  }

  if (/^(?:עזרה|תעזור לי|איך משתמשים|מה אפשר לעשות)[?!. ]*$/u.test(text)) {
    return { type: "help" };
  }
  if (/^(?:רשימות|מה הרשימות שלי|אילו רשימות יש לי)[?!. ]*$/u.test(text)) {
    return { type: "list-lists" };
  }
  if (/^(?:תזכורות|התזכורות שלי|מה התזכורות שלי)[?!. ]*$/u.test(text)) {
    return { type: "list-reminders" };
  }
  if (/^(?:שלום|היי|אהלן|בוקר טוב|ערב טוב)[!,. ]*$/u.test(text)) {
    return { type: "greeting" };
  }
  if (/^(?:תודה(?: רבה)?|תודה אח שלי|מעריך אותך|מעריכה אותך)[!,. ]*$/u.test(text)) {
    return { type: "thanks" };
  }
  if (/^(?:ביי|להתראות|לילה טוב|נדבר)[!,. ]*$/u.test(text)) {
    return { type: "farewell" };
  }
  if (/^(?:מה נשמע|מה קורה|איך אתה)[?!. ]*$/u.test(text)) {
    return { type: "small-talk" };
  }
  if (/^(?:מה השעה|כמה השעה)(?: עכשיו)?[?!. ]*$/u.test(text)) {
    return { type: "tell-time", now };
  }
  if (/^(?:מה התאריך היום|איזה יום היום|מה היום)(?: היום)?[?!. ]*$/u.test(text)) {
    return { type: "tell-date", now };
  }

  const reminderCancellation =
    /^(?:בטל|תבטל|מחק|תמחק)\s+(?:לי\s+)?(?:את\s+)?התזכורת\s+(?:של\s+)?(.+?)[.!?]*$/u.exec(
      text,
    );
  if (reminderCancellation) {
    if (/^\d+$/u.test(cleanPhrase(reminderCancellation[1]))) {
      return {
        type: "cancel-reminder-number",
        position: Number(reminderCancellation[1]),
      };
    }
    return { type: "cancel-reminder", description: cleanPhrase(reminderCancellation[1]) };
  }

  const reminder = parseReminder(text, now);
  if (reminder) return reminder;

  const personalTask =
    /^(?:אני\s+)?(?:צריך|צריכה|צריכים|צריכות|חייב|חייבת|חייבים|חייבות)\s+(ל[\p{L}\p{N}][\p{L}\p{N}\s'״׳-]*)[.!?]*$/u.exec(
      text,
    );
  if (personalTask) {
    return { type: "add-task", text: cleanPhrase(personalTask[1]) };
  }
  const bareTasks = parseBareTasks(text);
  if (bareTasks) return bareTasks;

  const createList =
    /^(?:בבקשה\s+)?(?:צור|תיצור|פתח|תפתח|תכין|הכן)\s+(?:לי\s+)?(?:את\s+)?(?:רשימת|רשימה)\s+(.+?)(?:\s+חדשה)?[.!?]*$/u.exec(
      text,
    );
  if (createList) {
    return { type: "create-list", name: cleanPhrase(createList[1]) };
  }

  const addItems =
    /^(?:בבקשה\s+)?(?:תוסיף|הוסף|תכניס|תוסיפי|תכניסי|רשום|תרשום|רשמי|תרשמי)\s+(.+?)\s+ל(?:רשימת|רשימה)\s+(.+?)[.!?]*$/u.exec(
      text,
    ) ??
    /^(?:בבקשה\s+)?(?:תוסיף|הוסף|תכניס|תוסיפי|תכניסי|רשום|תרשום|רשמי|תרשמי)\s+(.+)\s+ל(.+?)[.!?]*$/u.exec(
      text,
    );
  if (addItems) {
    return {
      type: "add-items",
      items: splitItems(addItems[1]),
      listName: cleanPhrase(addItems[2]),
    };
  }

  const showList =
    /^(?:תראה|תראי|הצג|תציג|פתח|תפתח)\s+(?:לי\s+)?(?:את\s+)?(?:רשימת|רשימה|הרשימה)\s+(.+?)[.!?]*$/u.exec(
      text,
    ) ??
    /^מה\s+יש\s+ב(?:רשימת|רשימה)\s+(.+?)[?!.]*$/u.exec(text);
  if (showList) {
    const name = cleanPhrase(showList[1] ?? showList[2]);
    return { type: "show-list", name };
  }

  const markItem =
    /^(?:סמן|תסמן|סיימתי)\s+(.+?)\s+(?:ברשימת|ברשימה)\s+(.+?)[.!?]*$/u.exec(text);
  if (markItem) {
    return {
      type: "mark-item",
      itemText: cleanPhrase(markItem[1]),
      listName: cleanPhrase(markItem[2]),
    };
  }

  const removeItem =
    /^(?:תסיר|הסר|תמחק|מחק)\s+(.+?)\s+מ(?:רשימת|רשימה)\s+(.+?)[.!?]*$/u.exec(text);
  if (removeItem) {
    return {
      type: "remove-item",
      itemText: cleanPhrase(removeItem[1]),
      listName: cleanPhrase(removeItem[2]),
    };
  }

  const reminderNumber =
    /^(?:בטל|תבטל)\s+(?:לי\s+)?(?:את\s+)?(?:(?:הת)?זכורת\s+)?(?:מספר\s+)?(\d+)[.!?]*$/u.exec(
      text,
    );
  if (reminderNumber) {
    return { type: "cancel-reminder-number", position: Number(reminderNumber[1]) };
  }

  return null;
}
