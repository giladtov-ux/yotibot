import { getJerusalemDateString, shiftJerusalemDate, reminderValidationTime } from "./time.js";
import { scheduleEventsOnDate } from "./schedule-queries.js";

const days = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const clock = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const calendar = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric",
});
export const isReminderMenuScope = scope => ["r", "t", "n"].includes(scope);

function weekdayLabel(weekdays) {
  const groups = [];
  for (const day of weekdays) {
    const last = groups.at(-1);
    if (last && last.at(-1) + 1 === day) last.push(day);
    else groups.push([day]);
  }
  return groups.map(group => group.length > 1
    ? `${days[group[0]]}–${days[group.at(-1)]}` : days[group[0]]).join(", ");
}

// Display metadata only; do not sort, reschedule or otherwise mutate storage.
export function reminderMenuRecords(store, chatId, scope, now = new Date(reminderValidationTime())) {
  const own = store.reminders.filter(item => item.chatId === chatId);
  const definitions = (store.savedSchedules ?? []).filter(item => item.chatId === chatId)
    .flatMap(item => item.entries ?? []);
  const details = (item, dueAt = item.dueAt) => {
    const entry = definitions.find(value => value.reminderId === item.id);
    const weekdays = [...new Set((entry?.weekdays ?? [])
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
    const ongoing = Boolean(entry) || Number(item.repeatEveryMs) > 0;
    const date = getJerusalemDateString(new Date(dueAt));
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const interval = Number(item.repeatEveryMs) > 0
      ? item.repeatEveryMs % 3_600_000 === 0
        ? `כל ${item.repeatEveryMs / 3_600_000} שעות`
        : `כל ${item.repeatEveryMs / 60_000} דקות` : null;
    return {
      id: item.id, kind: "reminder", text: item.text, ongoing, dueAt,
      sentAt: item.sentAt ?? null,
      days: scope === "r" && weekdays.length ? weekdayLabel(weekdays)
        : scope === "r" && interval ? interval : days[weekday],
      clock: clock.format(new Date(dueAt)),
      date: calendar.format(new Date(dueAt)),
      sortDay: weekdays.length ? weekdays[0] : weekday,
    };
  };
  if (scope !== "r") {
    const date = shiftJerusalemDate(getJerusalemDateString(now), scope === "n" ? 1 : 0);
    return scheduleEventsOnDate(store, chatId, date).map(event =>
      details(own.find(item => item.id === event.id), event.dueAt));
  }
  return own.map(item => details(item)).sort((left, right) =>
    Number(right.ongoing) - Number(left.ongoing)
    || (left.ongoing ? left.sortDay - right.sortDay || left.clock.localeCompare(right.clock) : 0)
    || left.dueAt - right.dueAt);
}

export function reminderButtonLabel(record) {
  const title = Array.from(record.text.replace(/\s+/gu, " ").trim());
  const label = title.length > 55 ? `${title.slice(0, 54).join("")}…` : title.join("");
  // Isolate the Latin clock from Hebrew text in native Telegram clients.
  return `${record.days}${record.ongoing ? "" : ` (${record.date})`} · \u2066${record.clock}\u2069 · ${label}${record.ongoing ? " 🔄" : " ☝️"}`;
}
