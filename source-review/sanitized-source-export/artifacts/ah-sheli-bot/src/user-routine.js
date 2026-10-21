import { getJerusalemDateString, parseJerusalemDateTime } from "./time.js";

const groups = ["weekday", "friday", "saturday"];
const statuses = new Set(["available", "blocked", "restricted"]);
const clock = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const invalid = () => { throw new TypeError("Invalid user daily routine."); };
function minute(value, end = false) {
  if (end && value === "24:00") return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value ?? "")) return invalid();
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

// Versioned user-settings value, not schema DDL or application state.
export function validateUserRoutine(value) {
  if (!value || value.version !== 1 || value.timeZone !== "Asia/Jerusalem"
    || !value.days || Array.isArray(value.days)
    || Object.keys(value).some(key => !["version", "timeZone", "days"].includes(key))
    || Object.keys(value.days).sort().join() !== [...groups].sort().join()) return invalid();
  const days = {};
  for (const group of groups) {
    const periods = value.days[group];
    if (!Array.isArray(periods) || periods.length > 48) return invalid();
    let previousEnd = 0;
    days[group] = periods.map(period => {
      if (!period || Object.keys(period).some(key => !["start", "end", "status", "label"].includes(key))
        || !statuses.has(period.status)
        || (period.label !== undefined && (typeof period.label !== "string" || period.label.length > 160))) {
        return invalid();
      }
      const start = minute(period.start), end = minute(period.end, true);
      if (start < previousEnd || end <= start) return invalid();
      previousEnd = end;
      return { start: period.start, end: period.end, status: period.status,
        ...(period.label === undefined ? {} : { label: period.label }) };
    });
  }
  return { version: 1, timeZone: "Asia/Jerusalem", days };
}

export function routineDayGroup(now) {
  if (!Number.isFinite(now)) return invalid();
  const date = getJerusalemDateString(new Date(now));
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday === 5 ? "friday" : weekday === 6 ? "saturday" : "weekday";
}

function boundary(date, time) {
  if (time === "24:00") {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10); time = "00:00";
  }
  const instant = parseJerusalemDateTime(date, time, { allowPast: true });
  if (clock.format(instant) !== time || [-3_600_000, 3_600_000].some(offset =>
    getJerusalemDateString(new Date(instant + offset)) === date
      && clock.format(instant + offset) === time)) {
    throw new RangeError("User routine boundary is ambiguous in Israel local time.");
  }
  return new Date(instant).toISOString();
}

// Pure materialization: routine + existing busy data, never a calendar/SQL write.
export function routinePriorityOptions(value, chatId, now, base = {}) {
  const routine = validateUserRoutine(value);
  const group = routineDayGroup(now);
  const periods = routine.days[group];
  const available = periods.filter(period => period.status === "available");
  const date = getJerusalemDateString(new Date(now));
  const blocked = [];
  if (!periods.length) blocked.push({ start: "00:00", end: "24:00" });
  let previous;
  for (const period of periods) {
    // Unspecified internal gaps are unavailable, not invented free time.
    if (previous && previous !== period.start) blocked.push({ start: previous, end: period.start });
    if (period.status !== "available") blocked.push(period);
    previous = period.end;
  }
  return {
    ...base,
    windowStart: periods[0]?.start ?? "00:00",
    windowEnd: available.at(-1)?.end ?? (periods.at(-1)?.end === "24:00"
      ? "23:59" : periods.at(-1)?.end ?? "23:59"),
    bufferMinutes: 10,
    calendarCoverage: base.calendarCoverage ?? "local-only",
    calendarEvents: [
      ...(base.calendarEvents ?? []),
      ...blocked.map((period, index) => ({
        id: `user-routine-${group}-${index}`, chatId,
        start: boundary(date, period.start), end: boundary(date, period.end),
      })),
    ],
    routineClosed: available.length === 0,
    routineDay: group,
  };
}
