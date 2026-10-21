import { getJerusalemDateString, parseJerusalemDateTime } from "./time.js";
import { estimateTaskDuration, planDailyPriorities } from "./priority-planner.js";

const clock = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const clean = text => String(text ?? "").replace(/\s+/gu, " ").trim();
const title = text => clean(text).length > 90 ? `${clean(text).slice(0, 87)}…` : clean(text);

function localInstant(date, time) {
  if (time !== "24:00" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time ?? "")) return null;
  const calendarDate = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date
    || Number(date.slice(0, 4)) < 2020 || Number(date.slice(0, 4)) > 2100) return null;
  if (time === "24:00") {
    calendarDate.setUTCDate(calendarDate.getUTCDate() + 1);
    return localInstant(calendarDate.toISOString().slice(0, 10), "00:00");
  }
  let instant;
  try {
    instant = parseJerusalemDateTime(date, time, { allowPast: true });
  } catch (error) {
    if (error.message === "השעה הזאת לא קיימת בישראל בגלל מעבר לשעון קיץ או חורף.") return null;
    throw error;
  }
  // Reject repeated/missing wall clocks rather than choosing a speculative gap.
  if (clock.format(instant) !== time || [-3_600_000, 3_600_000].some(offset =>
    getJerusalemDateString(new Date(instant + offset)) === date
      && clock.format(instant + offset) === time)) return null;
  return instant;
}

function externalInstant(value) {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) return localInstant(value, "00:00");
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    ? Date.parse(value) : null;
}

// Input is the existing authorized SQL snapshot; no SQL or provider calls here.
// External events, if supplied by a separately authorized read-only adapter,
// use the existing Calendar reader's {id, title, start, end, allDay} shape.
export function morningPriorityPlan(snapshot, chatId, now, {
  tasks, events, windowStart, windowEnd, bufferMinutes = 10,
  defaultMinutes = 15, calendarEvents = [], calendarCoverage = "local-only",
} = {}) {
  const date = getJerusalemDateString(new Date(now));
  const reminders = snapshot.reminders.filter(item => String(item.chatId) === chatId);
  const byId = new Map(reminders.map(item => [item.id, item]));
  const ownedEvents = events.filter(event => !event.chatId || String(event.chatId) === chatId);
  const reminderEvents = ownedEvents.filter(event => byId.has(event.id));
  const linkedTasks = new Set(reminderEvents.map(event => byId.get(event.id).trackingTaskId).filter(Boolean));
  // dueAt alone can also mean a deadline in this adapter. The authorized agenda
  // identifies commitments; bind standalone entries to their owned source task.
  const scheduledKeys = new Set(ownedEvents.map(event => `${event.id}:${event.dueAt}`));
  const scheduledTasks = new Map(snapshot.tasks.filter(item =>
    (!item.chatId || String(item.chatId) === chatId) && !item.checked
    && Number.isFinite(item.dueAt) && getJerusalemDateString(new Date(item.dueAt)) === date
    && scheduledKeys.has(`${item.id}:${item.dueAt}`))
    .map(item => [item.id, item]));
  const candidates = tasks.filter(item => (!item.chatId || String(item.chatId) === chatId)
    && !linkedTasks.has(item.id) && !scheduledTasks.has(item.id)).map(item => ({
      id: item.id, text: item.text, checked: item.checked,
      deadline: Number.isFinite(item.dueAt) ? item.dueAt
        : item.scheduledDate ? parseJerusalemDateTime(item.scheduledDate, "23:59", { allowPast: true })
          : Math.min(Infinity, ...reminders.filter(reminder =>
            reminder.trackingTaskId === item.id && !reminder.sentAt).map(reminder => reminder.dueAt)),
    }));
  const busy = [
    ...reminderEvents,
    ...[...scheduledTasks.values()].filter(item => !linkedTasks.has(item.id)),
  ].map(event => {
    const duration = estimateTaskDuration(event.text, { defaultMinutes: null });
    return { id: event.id, startAt: event.dueAt,
      endAt: duration.minutes === null ? null : event.dueAt + duration.minutes * 60_000 };
  });
  // A repeated wall-clock occurrence with the same identity is not safe input.
  const seen = new Map();
  for (const event of busy) {
    const key = `${event.id}:${clock.format(event.startAt)}`;
    if (seen.has(key) && seen.get(key) !== event.startAt) event.ambiguous = true;
    seen.set(key, event.startAt);
  }
  for (const event of calendarEvents) {
    if (event.chatId && String(event.chatId) !== chatId) continue;
    busy.push({ id: event.id, startAt: externalInstant(event.start),
      endAt: externalInstant(event.end), cancelled: event.status === "cancelled",
      transparent: event.transparency === "transparent" });
  }
  const startAt = localInstant(date, windowStart);
  const endAt = localInstant(date, windowEnd);
  return planDailyPriorities({ tasks: candidates, busy, now,
    window: Number.isFinite(startAt) && Number.isFinite(endAt) ? { startAt, endAt } : null,
    bufferMinutes, defaultMinutes, coverage: calendarCoverage });
}

export function formatPriorityRecommendations(plan, legacyText) {
  if (!plan.items.length) return "אין כרגע משימות לא מתוזמנות לתעדוף.";
  if (plan.status === "unavailable") {
    const note = plan.reason === "calendar_unavailable" || plan.reason === "calendar_uncertain"
      ? "אין תמונת יומן בטוחה לשעות פנויות."
      : "אין חלון זמן מוגדר ופנוי לתכנון.";
    return `${note}\n${legacyText}`;
  }
  const lines = plan.items.map(item => {
    const alert = item.urgent || item.overdue ? "🔴" : "📌";
    if (!item.placement) return `${alert} ${title(item.text)} — ${item.reason === "duration_unknown"
      ? "בלי הערכת זמן" : item.overdue ? "המועד עבר" : "לא נכנס בחלונות שמצאתי"}`;
    const duration = `${item.estimated ? "כ־" : ""}${item.minutes} דקות`;
    return `🕒 ${clock.format(item.placement.startAt)}–${clock.format(item.placement.endAt)} — ${
      title(item.text)} (${duration})`;
  });
  return `${plan.coverage === "complete" ? "לפי היומן:" : "לפי הלו״ז השמור בלבד:"}\n${
    lines.join("\n")}${plan.uncertain ? "\nפגישות בלי שעת סיום צמצמו את החלונות." : ""}\nהזמנים מוצעים בלבד.`;
}
