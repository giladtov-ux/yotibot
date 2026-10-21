import { saveStore } from "./store.js";
import { loadDailySummaryStore } from "./daily-summary-repository.js";
import { scheduleEventsOnDate, scheduleQueryDayOffset } from "./schedule-queries.js";
import { isDailySummaryRequest } from "./daily-summary.js";
import { getJerusalemDateString, shiftJerusalemDate, parseJerusalemDateTime } from "./time.js";

const normalize = text => text.trim().replace(/[?!.…]+$/gu, "").replace(/\s+/gu, " ")
  .replace(/^(?:אחי[, ]+|אח שלי[, ]+|בבקשה\s+)/u, "");
export function isPreparationReminder(rawText) {
  const text = normalize(rawText);
  return isDailySummaryRequest(text) || /^(?:סיכום והכנה למחר|סיכום יום והיערכות למחר)$/u.test(text);
}
export function preparationIntent(rawText) {
  const text = normalize(rawText);
  if (/^(?:תדחה|דחה|לדחות|תעביר|העבר)\s+(?:לי\s+)?(?:את\s+)?כל\s+(?:ה)?(?:משימות|מטרות)(?:\s+(?:שנותרו|הנותרות|שנשארו|של היום|מהיום))*\s+למחר$/u.test(text)) {
    return "defer-tasks";
  }
  if (isDailySummaryRequest(text) || scheduleQueryDayOffset(text) === 1
    || /^(?:מה\s+(?:ה?סיכום|ה?סיכום של היום)|סיכום והכנה למחר|סיכום יום והיערכות למחר)$/u.test(text)
    || /^(?:תשלב|שלב|תאחד|אחד)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:משימות|מטרות)(?:\s+(?:בלו[״"׳']?ז|במקום שלהן|במקומן|למחר|עם הלו[״"׳']?ז))*$/u.test(text)) {
    return "prepare-tomorrow";
  }
  return null;
}

const clock = timestamp => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(timestamp));

// Single presentation for the scheduled send, written requests, voice
// transcripts and semantic NLP intents. All rows come from one SQL snapshot.
export function formatTomorrowPreparation(snapshot, chatId, now) {
  if (!Array.isArray(snapshot.reminders) || !Array.isArray(snapshot.savedSchedules)
    || !Array.isArray(snapshot.tomorrowTasks)) throw new Error("Committed preparation rows are required.");
  const tomorrow = shiftJerusalemDate(getJerusalemDateString(new Date(now)), 1);
  const reminders = new Map(snapshot.reminders.map(item => [item.id, item]));
  const linkedTasks = new Set();
  const events = scheduleEventsOnDate(snapshot, chatId, tomorrow).filter(event => {
    const reminder = reminders.get(event.id);
    if (reminder?.telegramDeliveries?.[String(event.dueAt)]?.state === "done") return false;
    return !reminder || getJerusalemDateString(new Date(reminder.dueAt)) !== tomorrow
      || reminder.dueAt === event.dueAt;
  }).map(event => {
    const reminder = reminders.get(event.id);
    if (reminder?.trackingTaskId) linkedTasks.add(reminder.trackingTaskId);
    return { ...event, text: reminder?.text ?? event.text };
  });
  const untimed = [];
  for (const { item } of snapshot.tomorrowTasks) {
    if (item.checked || linkedTasks.has(item.id)) continue;
    if (Number.isFinite(item.dueAt)
      && getJerusalemDateString(new Date(item.dueAt)) === tomorrow) {
      events.push({ id: item.id, dueAt: item.dueAt, text: item.text });
    } else untimed.push(item.text);
  }
  const agenda = events.sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id))
    .map(event => `${clock(event.dueAt)} ${String(event.text).replace(/\s+/gu, " ").trim()}`);
  return `סיכום יום והכנה למחר\n\nלו״ז למחר:\n${agenda.join("\n") || "לא נשמר לו״ז עם שעות למחר."}${
    untimed.length ? `\n\nמשימות למחר ללא שעה:\n${untimed.join("\n")}` : ""}`;
}

export async function handleTomorrowPreparation(store, chatId, text, {
  persist = saveStore, readSnapshot = loadDailySummaryStore, now = Date.now,
  intent = preparationIntent(text),
} = {}) {
  if (!intent) return null;
  const time = now();
  const snapshot = await readSnapshot(chatId, undefined, time);
  if (intent !== "defer-tasks") {
    const response = formatTomorrowPreparation(snapshot, chatId, time);
    // A new preparation replaces an old per-task review, not its data. Old
    // buttons must not consume a later bare "done" as an unrelated completion.
    if (store.dailyRecaps?.[chatId] || store.recordViews?.[chatId]) {
      const candidate = { ...store, dailyRecaps: { ...store.dailyRecaps }, recordViews: { ...store.recordViews } };
      delete candidate.dailyRecaps[chatId];
      delete candidate.recordViews[chatId];
      await persist(candidate);
      store.dailyRecaps = candidate.dailyRecaps;
      store.recordViews = candidate.recordViews;
    }
    return [{ text: response }];
  }
  const remaining = snapshot.openTasks ?? [];
  if (!remaining.length) return [{ text: "אין משימות שנותרו להיום לדחות." }];
  const tomorrow = shiftJerusalemDate(getJerusalemDateString(new Date(time)), 1);
  const candidate = structuredClone(store);
  const taskIds = new Set(remaining.map(row => row.item.id));
  for (const row of remaining) {
    const item = candidate.lists[chatId]?.[row.listName]?.find(value => value.id === row.item.id && !value.checked);
    if (!item) throw new Error("The task snapshot changed before deferral.");
    item.scheduledDate = tomorrow;
    if (Number.isFinite(item.dueAt)) {
      item.dueAt = parseJerusalemDateTime(tomorrow, clock(item.dueAt), { allowPast: true });
    }
  }
  const recurringIds = new Set((snapshot.savedSchedules ?? []).flatMap(source =>
    source.entries?.map(entry => entry.reminderId) ?? []));
  candidate.reminders = candidate.reminders.map(reminder => {
    if (reminder.chatId !== chatId || !taskIds.has(reminder.trackingTaskId)
      || recurringIds.has(reminder.id) || reminder.repeatEveryMs) return reminder;
    // Never clear an uncertain outbound marker to permit accidental replay.
    if (reminder.lastAttemptAt) throw new Error("An unresolved delivery must not be rescheduled.");
    const moved = { ...reminder,
      dueAt: parseJerusalemDateTime(tomorrow, clock(reminder.dueAt), { allowPast: true }) };
    delete moved.sentAt;
    return moved;
  });
  const state = candidate.reminderCheckIns?.[chatId];
  if (state) state.pending = Object.fromEntries(Object.entries(state.pending ?? {})
    .filter(([, record]) => !taskIds.has(record.taskId)));
  if (candidate.dailyRecaps) delete candidate.dailyRecaps[chatId];
  if (candidate.recordViews) delete candidate.recordViews[chatId];
  await persist(candidate, { verifyList: { chatId, listName: remaining[0].listName } });
  for (const field of ["lists", "reminders", "reminderCheckIns", "dailyRecaps", "recordViews"]) {
    if (candidate[field]) store[field] = candidate[field];
  }
  return [{ text: "כל המשימות שנותרו להיום נדחו למחר." }];
}
