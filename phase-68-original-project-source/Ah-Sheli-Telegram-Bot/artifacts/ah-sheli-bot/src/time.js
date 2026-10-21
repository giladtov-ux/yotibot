import { AsyncLocalStorage } from "node:async_hooks";
import { TIME_ZONE } from "./israel-timezone.js";

const requestClock = new AsyncLocalStorage();

// Creation checks share the request's clock, not the later AI/save clock.
// Async-local state isolates concurrent messages; background delivery stays live.
export function reminderValidationTime(fallback = Date.now()) {
  return requestClock.getStore() ?? fallback;
}

export function withReminderRequestTime(operation, timestamp = Date.now()) {
  if (requestClock.getStore() !== undefined) return operation();
  if (!Number.isFinite(timestamp) || timestamp <= 0
    || !Number.isFinite(new Date(timestamp).getTime())) throw new Error("Invalid request timestamp.");
  return requestClock.run(timestamp, operation);
}
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getParts(date) {
  const parts = Object.fromEntries(
    partsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

// User-supplied HH:mm has minute precision. After conversion from Israel time,
// compare UTC instants at that same precision, independently of the host's TZ.
export function isReminderTimePast(epoch, now = Date.now()) {
  return epoch < Math.floor(now / 60_000) * 60_000;
}

export function parseJerusalemDateTime(dateText, timeText, { allowPast = false, now = reminderValidationTime() } = {}) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeText);
  if (!dateMatch || !timeMatch) {
    throw new Error("צריך להשתמש בתאריך YYYY-MM-DD ובשעה HH:mm.");
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (year < 2020 || year > 2100) {
    throw new Error("השנה צריכה להיות בין 2020 ל-2100.");
  }

  const desiredLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() + 1 !== month ||
    calendarCheck.getUTCDate() !== day
  ) {
    throw new Error("התאריך הזה לא קיים בלוח השנה.");
  }

  let epoch = desiredLocalAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = getParts(new Date(epoch));
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const correction = desiredLocalAsUtc - representedAsUtc;
    epoch += correction;
    if (correction === 0) break;
  }

  const resolved = getParts(new Date(epoch));
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    throw new Error("השעה הזאת לא קיימת בישראל בגלל מעבר לשעון קיץ או חורף.");
  }

  if (!allowPast && isReminderTimePast(epoch, now)) {
    throw new Error("צריך לבחור מועד שעדיין לא עבר.");
  }
  return epoch;
}

export function getJerusalemDateString(date = new Date()) {
  const parts = getParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function shiftJerusalemDate(dateText, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) throw new Error("Invalid local date.");
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function getNextJerusalemWeekdayDate(weekday, now = new Date()) {
  const localDate = getJerusalemDateString(now);
  const [year, month, day] = localDate.split("-").map(Number);
  const todayWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  let daysAhead = (weekday - todayWeekday + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  return shiftJerusalemDate(localDate, daysAhead);
}

export function extractHebrewTime(text) {
  const periodPattern =
    /(?:^|\s)(?:בשעה\s*|ב[־-]?\s*)?(\d{1,2})(?::([0-5]\d))?\s*(לפנות\s*בוקר|בבוקר|בצהריים|אחר\s*הצהריים|בערב|בלילה)(?=$|\s|[,.!?])/iu;
  let match = periodPattern.exec(text);
  if (match) {
    const rawHour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const period = match[3].replace(/\s+/g, "");
    let hour = rawHour;

    if (period === "בבוקר" || period === "לפנותבוקר") {
      hour = rawHour === 12 ? 0 : rawHour;
    } else if (period === "בצהריים" || period === "אחרהצהריים" || period === "בערב") {
      hour = rawHour === 12 ? 12 : rawHour + 12;
    } else if (period === "בלילה") {
      hour = rawHour === 12 ? 0 : rawHour <= 5 ? rawHour : rawHour + 12;
    }

    return { hour, minute, start: match.index, end: match.index + match[0].length };
  }

  const clockPattern =
    /(?:^|\s)(?:בשעה\s*|ב[־-]?\s*)?(\d{1,2}):([0-5]\d)(?=$|\s|[,.!?])/u;
  match = clockPattern.exec(text);
  if (match) {
    return {
      hour: Number(match[1]),
      minute: Number(match[2]),
      start: match.index,
      end: match.index + match[0].length,
    };
  }

  const hourOnlyPattern =
    /(?:^|\s)(?:בשעה\s*|ב[־-]?\s*)(\d{1,2})(?!\d)(?!\s*(?:דקות?|ימים?|שעות?))/u;
  match = hourOnlyPattern.exec(text);
  if (match) {
    const hour = Number(match[1]);
    if (hour > 23) return null;
    return { hour, minute: 0, start: match.index, end: match.index + match[0].length };
  }
  return null;
}

export function formatJerusalemTime(epoch) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(epoch));
}
