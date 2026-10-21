import { createId, mutateReminderState } from "./store.js";
import { getJerusalemDateString, shiftJerusalemDate, parseJerusalemDateTime, extractHebrewTime, isReminderTimePast } from "./time.js";

const clocks = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/gu;
const weekdayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const cadence = /(?:לו[״"׳']?ז|לוח\s*זמנים|סידור)\s+(?:שבועי|קבוע)|(?<![א-ת])(?:ב?ימי|כל\s+יום|בכל\s+יום)(?=[\s:]|$)|(?:א[׳']?\s*[-–־]\s*ה[׳']?)/u;
const nonWrite = /^(?:מה|איך|האם|אפשר לראות|תראה|תציג|הצג)|(?:אל|לא)\s+(?:תשמור|שמור)|(?:רק|לשם)\s+(?:דוגמה|ניתוח|ציטוט)/u;

export function scheduleWeekdays(text) {
  const days = [];
  const marker = /(?:יום|ימי|בימי|ביום|לימי|כל יום|בכל יום)\s+/u.exec(text);
  const declaration = (marker ? text.slice(marker.index + marker[0].length) : text)
    .split(/\d{1,2}:\d{2}|(?:בשעה|ב[־-]?)\s*\d{1,2}/u)[0];
  for (const range of text.matchAll(/([אבגדהו])[׳']?\s*[-–־]\s*([אבגדהו])[׳']?/gu)) {
    const start = "אבגדהו".indexOf(range[1]), end = "אבגדהו".indexOf(range[2]);
    for (let day = start; ; day = (day + 1) % 7) {
      days.push(day);
      if (day === end) break;
    }
  }
  if (/(?:כל|בכל)\s+יום(?:[\s:]|$)/u.test(text) && !weekdayNames.some(name => declaration.includes(name))) {
    days.push(0, 1, 2, 3, 4, 5, 6);
  }
  weekdayNames.forEach((name, day) => {
    if (new RegExp(`(?:^|[\\s,])(?:ב|ל|ו)?${name}(?=[\\s,:׳'״"]|$)`, "u").test(declaration)) days.push(day);
  });
  for (const match of text.matchAll(/(?:יום|ימי|בימי|ביום|לימי)\s+([אבגדהו])[׳'](?=\s|[:,–־-]|$)/gu)) {
    days.push("אבגדהו".indexOf(match[1]));
  }
  return [...new Set(days)].sort();
}

export function weeklyDueAtOnDate(entry, date) {
  if (Object.hasOwn(entry.timeOverrides ?? {}, date)) return entry.timeOverrides[date];
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!entry.weekdays.includes(day)) return null;
  const clock = `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`;
  return parseJerusalemDateTime(date, clock, { allowPast: true });
}

export function nextWeeklyDueAt(entry, after = Date.now(), { includeCurrentMinute = false } = {}) {
  const date = getJerusalemDateString(new Date(after));
  for (let offset = 0; offset <= 14; offset++) {
    const localDate = shiftJerusalemDate(date, offset);
    let dueAt;
    try { dueAt = weeklyDueAtOnDate(entry, localDate); }
    catch { continue; } // A nonexistent DST wall time is not moved to a made-up time.
    if (dueAt === null) continue;
    if (includeCurrentMinute ? !isReminderTimePast(dueAt, after) : dueAt > after) return dueAt;
  }
  throw new Error("No valid weekly occurrence.");
}

export function weeklyEntryFor(store, reminderId) {
  return (store.savedSchedules ?? []).flatMap(schedule => schedule.entries)
    .find(entry => entry.reminderId === reminderId) ?? null;
}

export function parseWeeklySchedule(source) {
  const text = source.trim();
  if (!cadence.test(text) || nonWrite.test(text) || /[?？]|^(?:אפשר|האם)\s/u.test(text)
    || /לדוגמה|דוגמה|ציטוט|בלי\s+(?:לשמור|תזכורות)|מה דעתך/u.test(text)
    || (/רשימ(?:ת|ה)/u.test(text) && !/לו[״"׳']?ז|לוח\s*זמנים|סידור/u.test(text))) return null;
  // Never silently discard a supplied start/end date or an exception.
  if (/\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}|עד\s+(?:סוף|תאריך|יום|שבת|\d)|לשבוע\s+(?:הזה|הבא)|החל\s+מ|למשך|חוץ\s+מ|למעט|פרט\s+ל|לא\s+(?:בימי|ביום)|בחגים|בחופשות/u.test(text)) {
    return { source, entries: [], hasRanges: false };
  }
  const entries = [];
  let weekdays = [];
  let hasRanges = false;
  for (const line of text.split(/[\n;]+/u)) {
    const specifiedDays = scheduleWeekdays(line);
    if (specifiedDays.length) weekdays = specifiedDays;
    if (/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/u.test(line)) {
      hasRanges = true;
      continue;
    }
    let matches = [...line.matchAll(clocks)];
    if (!matches.length) {
      const time = extractHebrewTime(line);
      if (time && time.hour >= 0 && time.hour <= 23) {
        const match = [line.slice(time.start, time.end), String(time.hour), String(time.minute)];
        match.index = time.start;
        matches = [match];
      }
    }
    for (const [index, match] of matches.entries()) {
      if (!weekdays.length) continue;
      const end = matches[index + 1]?.index ?? line.length;
      let label = line.slice(match.index + match[0].length, end).trim()
        .replace(/^[\s,:־–—-]+|[\s,;]+$/gu, "");
      if (!label && matches.length === 1) {
        label = line.slice(0, match.index)
          .replace(/(?:ב?ימי|ביום|יום|לימי|כל יום|בכל יום)\s+(?:[אבגדהו][׳']?(?:\s*[-–־]\s*[אבגדהו][׳']?)?|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/gu, "")
          .replace(/\b(?:בשעה|ב)\s*$/u, "").trim();
      }
      if (label && label.length <= 300) entries.push({
        text: label, weekdays: [...weekdays], hour: Number(match[1]), minute: Number(match[2]),
      });
    }
  }
  return { source, entries, hasRanges };
}

export function appendScheduleSource(candidate, chatId, source, entries = []) {
  if (!source) return;
  const existing = candidate.savedSchedules.find(item => item.chatId === chatId && item.source === source);
  if (existing) {
    if (entries.length) existing.entries = existing.entries.filter(entry =>
      candidate.reminders.some(reminder => reminder.id === entry.reminderId)).concat(entries);
    return;
  }
  candidate.savedSchedules.push({ id: createId(), chatId, source, entries, createdAt: Date.now() });
}

export async function saveWeeklySchedule(store, chatId, parsed, now = Date.now()) {
  const known = (store.savedSchedules ?? []).filter(item => item.chatId === chatId);
  if (known.some(item => item.source === parsed.source
    && (item.entries.length || !parsed.entries.length)
    && item.entries.every(entry => store.reminders.some(reminder =>
      reminder.id === entry.reminderId && !reminder.sentAt)))) return `זה כבר שמור אצלי.\n\n${parsed.source}`;
  const entries = [];
  const fresh = [];
  for (const entry of parsed.entries) {
    const key = `${entry.weekdays}:${entry.hour}:${entry.minute}:${entry.text}`;
    const existing = known.flatMap(item => item.entries).find(item =>
      `${item.weekdays}:${item.hour}:${item.minute}:${item.text}` === key
      && store.reminders.some(reminder => reminder.id === item.reminderId && !reminder.sentAt));
    if (existing) continue;
    const id = createId();
    fresh.push({ id, chatId, text: entry.text,
      dueAt: nextWeeklyDueAt(entry, now, { includeCurrentMinute: true }), createdAt: now });
    entries.push({ ...entry, reminderId: id });
  }
  await mutateReminderState(store, candidate => {
    candidate.reminders.push(...fresh);
    appendScheduleSource(candidate, chatId, parsed.source, entries);
  });
  const detail = parsed.hasRanges ? "\nטווחי השעות נשמרו כטקסט, בלי לבחור זמן להתראה." : "";
  const reply = fresh.length ? "סגור, אזכיר לך בימים ובשעות שכתבת."
    : parsed.entries.length ? "הלו״ז הזה כבר שמור אצלי."
      : "שמרתי את הלו״ז כטקסט, בדיוק כמו ששלחת.";
  return `${reply}${detail}\n\n${parsed.source}`;
}
