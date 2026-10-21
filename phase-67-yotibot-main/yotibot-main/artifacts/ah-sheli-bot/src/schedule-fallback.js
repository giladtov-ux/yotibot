import { isScheduleInformationRequest } from "./schedule-queries.js";
import { extractHebrewDate } from "./natural-language.js";
import { extractHebrewTime, getJerusalemDateString, reminderValidationTime } from "./time.js";

const scheduleHeader = /(?:סידור\s*(?:העבודה|עבודה)|לוח\s*זמנים|לו[״"׳']?ז)/u;
const activity = /השכמה|קימה|יציאה|איסוף|איסופים|חזרה|פגישה|ארוחה|עבודה/u;
const clockPattern = /(?<!\d)(?:(?:בשעה\s*|ב[־-]?)?\d{1,2}(?::\d{2})?\s*(?:לפנות\s*בוקר|בבוקר|בצהריים|אחר\s*הצהריים|בערב|בלילה)|\d{1,2}:\d{2}|(?:בשעה\s*|ב[־-]?)\d{1,2}(?=\s|[,;.!]|$))(?!\d)/gu;
const clarify = response => ({ type: "clarify", response });
const clean = text => text.trim()
  .replace(/^[\s•*–—,;:־-]+|[\s•*–—,;:־.!-]+$/gu, "").trim();

function stripHeading(text) {
  return clean(text
    .replace(/(?:^|\s)(?:ביום|ליום|בתאריך|לתאריך)\s*[:־-]?\s*$/u, "")
    .replace(/^(?:זה\s+)?ה?(?:סידור\s*(?:העבודה|עבודה)|לוח\s*זמנים|לו[״"׳']?ז)(?:\s*(?:היומי|יומי|שלי))?/u, "")
    .replace(/(?:^|\s)(?:בשעה|[לב][־-]?)\s*$/u, ""));
}

// Strictly original user text, never the fixed routine or untrusted AI output.
// Unsupported/ambiguous formats are clarified as a batch rather than partially saved.
export function parseScheduleFallback(text, now = new Date(reminderValidationTime())) {
  if (isScheduleInformationRequest(text)) return null;
  const hasHeader = scheduleHeader.test(text);
  const clocks = [...text.matchAll(clockPattern)];
  if (!hasHeader && (clocks.length < 2 || !activity.test(text))) return null;
  if (/[?？]/u.test(text)
    || /(?:אל\s+(?:תיצור|תקבע|תשמור|תזכיר)|(?:בלי|ללא)\s+(?:תזכורות|התראות)|רק\s+(?:נתח|הצג|תציג)|(?:ניתוח|הצגה)\s+בלבד|לדוגמה|דוגמה|ציטוט|מה\s+דעתך|האם)/u.test(text)) {
    return clarify("לא יצרתי תזכורות: זו בקשת ניתוח או הצגה בלבד. ניתוח חופשי יתאפשר כש-Groq יחזור להיות זמין.");
  }
  if (!clocks.length) {
    return clarify("לא שמרתי דבר: זיהיתי לו״ז, אך אין בו שעות ברורות. אפשר להשלים את השעות של כל הפעילויות בהודעה אחת.");
  }
  if (/אתמול|שלשום|\d{1,2}\s*ב?(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/u.test(text)) {
    return clarify("זיהיתי ציון יום שלא אוכל לפענח בבטחה בגיבוי. כתוב תאריך YYYY-MM-DD כדי שאשמור את כל הלו״ז במועדים הנכונים, בלי לנחש.");
  }
  if (/(?:\d+\s*(?:דקות?|שעות?)|חצי\s*שעה|רבע\s*שעה|שעה|שעתיים)\s*(?:לפני|קודם|מראש|אחרי)/u.test(text)) {
    return clarify("זיהיתי בקשה לשנות את זמן ההתראה ביחס לפעילות. בגיבוי לא אשמור את שעות הפעילות במקום שעות ההתראה: כתוב את שעות ההתראה הרצויות יחד, או ננסה שוב כש-Groq זמין.");
  }
  if (/\d{1,2}[/.]\d{1,2}/u.test(text)) {
    return clarify("זיהיתי מספר שאפשר לפרש כתאריך או שעה. כדי לא לנחש, כתוב שעות כ-HH:mm ויום כהיום, מחר או YYYY-MM-DD. אין צורך להגדיר כל תזכורת בנפרד.");
  }
  if (/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/u.test(text)) {
    return clarify("זיהיתי טווח שעות בלו״ז. האם לקבוע התראה בתחילת הטווח, בסופו או בשניהם? לא שמרתי חלק מהלו״ז בניחוש.");
  }

  let date = getJerusalemDateString(now);
  const reminders = [];
  for (const rawSegment of text.split(/[\n,;]+/u).map(clean).filter(Boolean)) {
    // Preserve character offsets while making date headings such as 'למחר:' recognizable.
    const dateText = rawSegment.replace(/:/gu, " ")
      .replace(/(^|\s)ל(מחרתיים|מחר|היום|יום)(?=\s|[.!]|$)/gu, "$1 $2")
      .replace(/(^|\s)[לב][־-]?(?=\d{4}-\d{2}-\d{2})/gu, match => match.replace(/[לב־-]/gu, " "));
    const dateMatch = extractHebrewDate(dateText, now);
    let segment = rawSegment;
    if (dateMatch) {
      date = dateMatch.date;
      segment = `${segment.slice(0, dateMatch.start)} ${segment.slice(dateMatch.end)}`;
    } else if (/(?:ביום|ליום|בעוד|בתאריך)\s/u.test(segment)) {
      return clarify("חסר לי תאריך חד־משמעי לפענוח הלו״ז בגיבוי. כתוב יום או תאריך אחד ברור לכל יום עבודה; אין צורך לשלוח פריטים בנפרד.");
    }
    if ((segment.match(/(?:מחרתיים|מחר|היום|\d{4}-\d{2}-\d{2})/gu) ?? []).length) {
      return clarify("זיהיתי כמה ימים באותה פסקה. כדי לשמור את כל האירועים במועד הנכון, הפרד בין הימים בשורה חדשה.");
    }
    const matches = [...segment.matchAll(clockPattern)];
    if (!matches.length) {
      const label = stripHeading(segment);
      if (label) reminders.push({ text: label, date, hour: null, minute: null });
      continue;
    }
    const prefix = stripHeading(segment.slice(0, matches[0].index));
    const suffix = clean(segment.slice(matches.at(-1).index + matches.at(-1)[0].length));
    const beforeClock = Boolean(prefix);
    if (beforeClock && suffix) {
      return clarify("יש בלו״ז טקסט גם לפני השעה וגם אחריה, ולא אנחש איזה אירוע שייך לכל שעה. אפשר לשלוח את כל הלו״ז בהודעה אחת, בשורות של שעה ופעילות או פעילות ושעה.");
    }
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const time = extractHebrewTime(match[0]);
      if (!time || time.hour > 23 || time.minute > 59) {
        return clarify("אחת השעות בלו״ז אינה תקינה. תקן אותה בפורמט 24 שעות כדי שאשמור את כל הלו״ז יחד.");
      }
      let label = beforeClock
        ? segment.slice(index ? matches[index - 1].index + matches[index - 1][0].length : 0, match.index)
        : segment.slice(match.index + match[0].length, matches[index + 1]?.index ?? segment.length);
      label = stripHeading(label.replace(/(?:^|\s)ו\s*$/u, ""));
      reminders.push({ text: label || null, date, hour: time.hour, minute: time.minute });
    }
  }
  if (!reminders.length || reminders.length > 100) {
    return clarify("לא הצלחתי לזהות לו״ז מלא ובטוח לשמירה בגיבוי. אפשר לשלוח את כולו בהודעה אחת עם יום, שעות ופעילויות ברורים.");
  }
  if (reminders.some(item => item.text?.length > 300)) {
    return clarify("אחד מתיאורי הפעילויות ארוך מ-300 תווים. לא קיצרתי ולא שמרתי חלק מהלו״ז; אפשר לקצר את התיאור הארוך ולהשאיר את שאר הפעילויות כפי שהן.");
  }
  return { type: "schedule-reminders", reminders };
}
