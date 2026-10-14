import { parseScheduleFallback } from "./schedule-fallback.js";
import { parseRecordQuery } from "./record-queries.js";
import { scheduleQueryDayOffset } from "./schedule-queries.js";

const clock = /\d{1,2}:\d{2}|\d{1,2}\s*(?:בבוקר|בערב|בלילה|בצהריים)|בשעה\s*\d{1,2}/gu;
const scheduleHeader = /לו[״"׳']?ז|סידור\s+(?:ה)?עבודה|לוח\s*זמנים/u;
const rowText = row => typeof row?.content === "string" ? row.content : row?.text;

// A new, fully specified roster does not need an older conversation to interpret it.
// Ambiguous schedules and short clarification replies retain conversation context.
export function needsConversationHistory(text) {
  if (/^\/[a-z]+(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text.trim())) return false;
  // Explicit saved-data reads are code-owned and cannot consume pending writes.
  // Keep history for follow-ups, summaries and ambiguous/multi-part requests.
  if ((parseRecordQuery(text) && /^(?:מה|אילו|הצג|תציג|תראה|תראי)(?=\s)/u.test(text.trim()))
    || scheduleQueryDayOffset(text) !== null) return false;
  const schedule = parseScheduleFallback(text);
  return !(schedule?.type === "schedule-reminders" && schedule.reminders.every(item =>
    item.text && item.date && item.hour != null && item.minute != null));
}

export function compactHistory(history = []) {
  const rows = (Array.isArray(history) ? history : []).filter(row =>
    ["user", "assistant"].includes(row?.role)
    && typeof rowText(row) === "string" && rowText(row).trim().length > 0);
  let anchor = -1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const text = rowText(rows[index]);
    const clocks = [...text.matchAll(clock)].length;
    if (rows[index].role === "user" && ((scheduleHeader.test(text) && clocks > 0)
      || (clocks >= 2 && /השכמה|יציאה|איסוף|חזרה/u.test(text)))) {
      anchor = index;
      break;
    }
  }
  // Retain four exchanges, including previous clarifications and topic changes,
  // without increasing the provider payload's existing character budget.
  const selected = new Set(rows.slice(-8).map((_, offset) => Math.max(0, rows.length - 8) + offset));
  if (anchor >= 0) {
    selected.add(anchor);
    // Keep answers between the roster and the current turn, not only the last
    // two exchanges. Otherwise a supplied date disappears during clarification.
    for (let index = anchor + 1; index < rows.length; index += 1) {
      if (rows[index].role === "user") selected.add(index);
    }
  }
  const priority = [...selected].sort((a, b) => b - a);
  if (anchor >= 0) {
    priority.splice(priority.indexOf(anchor), 1);
    priority.unshift(anchor);
  }
  let remaining = 5200;
  const output = [];
  for (const index of priority) {
    const row = rows[index];
    const limit = row.role === "assistant" ? 350 : 4096;
    const content = rowText(row).slice(0, Math.min(limit, remaining));
    if (!content) continue;
    remaining -= content.length;
    output.push({ index, row: { role: row.role, [typeof row.content === "string" ? "content" : "text"]: content } });
  }
  return output.sort((a, b) => a.index - b.index).map(item => item.row);
}

export function outputTokenBudget(message, history = []) {
  // Reserve more only for large batches (including a roster being completed).
  // Never truncate the new user message to fit a response budget.
  const inputs = [message, ...history.filter(row => row.role === "user")
    .map(rowText).filter(text => scheduleHeader.test(text) || [...text.matchAll(clock)].length >= 2)];
  const clocks = Math.max(...inputs.map(text => [...text.matchAll(clock)].length));
  const longest = Math.max(...inputs.map(text => text.length));
  const detailed = /מפורט|בהרחבה|בפירוט|לעומק/u.test(message) ? 2048 : 640;
  return Math.min(8192, Math.max(detailed, clocks * 70 + 256, Math.ceil(longest * 0.7) + 256));
}

export function modelContext(context) {
  // These static facts already appear in the system instruction.
  const { user, dailyScheduleContextOnly, ...runtime } = context;
  return { ...runtime, ...(context.isOwner === false && user
    ? { user: { preferredName: user.preferredName } } : {}),
    recentConversation: compactHistory(runtime.recentConversation) };
}
