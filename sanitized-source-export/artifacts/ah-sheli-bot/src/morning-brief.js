import { randomBytes } from "node:crypto";
import { getJerusalemDateString, parseJerusalemDateTime } from "./time.js";
import { scheduleEventsOnDate } from "./schedule-queries.js";
import { loadMorningSnapshot } from "./morning-brief-repository.js";
import { saveStore } from "./store.js";
import { morningPriorityPlan, formatPriorityRecommendations } from "./morning-priorities.js";
import { loadUserRoutine } from "./user-routine-repository.js";
import { routinePriorityOptions } from "./user-routine.js";

export const MORNING_BRIEF_TIME = "08:00";
const WINDOW_MS = 60_000;
const clock = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const clean = text => String(text ?? "").replace(/\s+/gu, " ").trim();
const short = text => clean(text).length > 95 ? `${clean(text).slice(0, 92)}…` : clean(text);

export function morningKeyboard(token) {
  return { inline_keyboard: [
    [{ text: "אני רוצה תעדוף", callback_data: `mb:p:${token}` }],
    [{ text: "📅 היומן של היום", callback_data: `mb:c:${token}` }],
  ] };
}

export function morningAgenda(snapshot, chatId, now) {
  const today = getJerusalemDateString(new Date(now));
  const reminders = new Map(snapshot.reminders.map(item => [item.id, item]));
  const linked = new Set();
  const events = scheduleEventsOnDate(snapshot, chatId, today).filter(event => {
    const reminder = reminders.get(event.id);
    if (reminder?.telegramDeliveries?.[event.dueAt.toString(36)]?.state === "done") return false;
    return !reminder || getJerusalemDateString(new Date(reminder.dueAt)) !== today
      || reminder.dueAt === event.dueAt;
  }).map(event => {
    const reminder = reminders.get(event.id);
    if (reminder?.trackingTaskId) linked.add(reminder.trackingTaskId);
    return { ...event, text: reminder?.text ?? event.text };
  });
  for (const task of snapshot.tasks) {
    if (task.checked || linked.has(task.id) || !Number.isFinite(task.dueAt)
      || getJerusalemDateString(new Date(task.dueAt)) !== today) continue;
    linked.add(task.id);
    events.push({ id: task.id, dueAt: task.dueAt, text: task.text });
  }
  return events.sort((a, b) => a.dueAt - b.dueAt || String(a.id).localeCompare(String(b.id)));
}

function openTasks(snapshot, chatId, now) {
  const today = getJerusalemDateString(new Date(now));
  return snapshot.tasks.filter(task => {
    if (task.checked || !clean(task.text)) return false;
    if (task.scheduledDate) return task.scheduledDate <= today;
    if (Number.isFinite(task.dueAt)) return getJerusalemDateString(new Date(task.dueAt)) <= today;
    const linked = snapshot.reminders.filter(item => item.chatId === chatId
      && item.trackingTaskId === task.id && !item.sentAt);
    return !linked.length || linked.some(item => getJerusalemDateString(new Date(item.dueAt)) <= today);
  });
}

export function formatMorningBrief(snapshot, chatId, now) {
  const events = morningAgenda(snapshot, chatId, now);
  const tasks = openTasks(snapshot, chatId, now);
  const lines = events.slice(0, 5).map(event => `${clock.format(event.dueAt)} ${short(event.text)}`);
  if (events.length > 5) lines.push("המשך בכפתור היומן.");
  const taskLines = tasks.slice(0, 3).map(item => `• ${short(item.text)}`);
  if (tasks.length > 3) taskLines.push("נמשיך לפי התעדוף.");
  return `בוקר טוב.\n\nהיום:\n${lines.join("\n") || "אין אירועים עם שעה."}\n\nמשימות פתוחות:\n${
    taskLines.join("\n") || "אין כרגע משימות פתוחות."}`;
}

export function formatMorningPriorities(snapshot, chatId, now) {
  const deadline = task => Number.isFinite(task.dueAt) ? task.dueAt
    : task.scheduledDate ? parseJerusalemDateTime(task.scheduledDate, "23:59", { allowPast: true })
    : Math.min(Infinity, ...snapshot.reminders.filter(item => item.chatId === chatId
      && item.trackingTaskId === task.id && !item.sentAt).map(item => item.dueAt));
  const tasks = openTasks(snapshot, chatId, now).map((item, index) => ({ item, index, due: deadline(item) }))
    .sort((a, b) => a.due - b.due || a.index - b.index);
  if (!tasks.length) return "אין כרגע משימות פתוחות להיום.";
  return `נתחיל מאלה:\n${tasks.slice(0, 3).map(({ item }, index) =>
    `${index + 1}. ${clean(item.text)}`).join("\n")}`;
}

export function formatMorningCalendar(snapshot, chatId, now) {
  const events = morningAgenda(snapshot, chatId, now);
  return `היום:\n${events.map(event => `${clock.format(event.dueAt)} ${clean(event.text)}`).join("\n")
    || "אין אירועים עם שעה."}`;
}

export function formatTimeAwareMorningPriorities(snapshot, chatId, now, options = {}) {
  if (options.routineClosed) return "אין חלונות פנויים לתעדוף היום לפי השגרה שלך.";
  // Narrow to the authenticated owner before deriving agenda or linked IDs.
  const owned = {
    tasks: snapshot.tasks.filter(item => !item.chatId || String(item.chatId) === chatId),
    reminders: snapshot.reminders.filter(item => String(item.chatId) === chatId),
    savedSchedules: snapshot.savedSchedules.filter(item => String(item.chatId) === chatId),
  };
  const legacyText = formatMorningPriorities(owned, chatId, now);
  const plan = morningPriorityPlan(owned, chatId, now, { ...options,
    tasks: openTasks(owned, chatId, now), events: morningAgenda(owned, chatId, now) });
  return formatPriorityRecommendations(plan, legacyText);
}

// Runs in the existing exclusive reminder queue. Only the 08:00 Israel minute
// is eligible; no late catch-up, pending completion or proactive follow-up.
export async function sendMorningBrief(store, telegram, chatId, {
  persist = saveStore, readSnapshot = loadMorningSnapshot, assertActive = () => {},
  isAuthorized = async () => false, now = Date.now, logError = () => {},
} = {}) {
  const time = now();
  if (!chatId) return 0;
  const date = getJerusalemDateString(new Date(time));
  const due = parseJerusalemDateTime(date, MORNING_BRIEF_TIME, { allowPast: true });
  if (time < due || time >= due + WINDOW_MS) return 0;
  const previous = store.reminderCheckIns?.[chatId];
  const receipt = previous?.morningBrief;
  if (receipt?.date === date && (receipt.status !== "retry" || receipt.retryAt > time)) return 0;
  if (!await isAuthorized(chatId)) return 0;
  assertActive();
  const snapshot = await readSnapshot(chatId);
  const text = formatMorningBrief(snapshot, chatId, time);
  const attempt = { date, status: "attempting", token: randomBytes(12).toString("base64url"), attemptAt: time };
  store.reminderCheckIns ??= Object.create(null);
  store.reminderCheckIns[chatId] = { ...previous, morningBrief: attempt };
  try {
    await persist(store);
  } catch (error) {
    if (error?.code !== "STATE_COMMIT_UNKNOWN") {
      if (previous) store.reminderCheckIns[chatId] = previous;
      else delete store.reminderCheckIns[chatId];
    }
    throw error;
  }
  let accepted = false;
  try {
    assertActive();
    if (!await isAuthorized(chatId) || now() >= due + WINDOW_MS) {
      attempt.status = "skipped";
      await persist(store);
      return 0;
    }
    assertActive();
    const message = await telegram.sendMessage(chatId, text, { reply_markup: morningKeyboard(attempt.token) });
    accepted = true;
    if (!Number.isSafeInteger(message?.message_id) || message.message_id <= 0) {
      throw new Error("Morning brief response missing its message ID.");
    }
    Object.assign(attempt, { status: "sent", messageId: message.message_id, sentAt: now() });
    await persist(store);
    return 1;
  } catch (error) {
    if (!accepted && error?.deliveryRejected) {
      Object.assign(attempt, { status: "retry", retryAt: now() + 15_000 });
      try { await persist(store); }
      catch (saveError) { attempt.status = "uncertain"; throw saveError; }
    } else attempt.status = "uncertain";
    logError("Morning brief delivery not confirmed; no ambiguous replay", error);
    return 0;
  }
}

function isPriorityTestUser(chatId, configuredId) {
  if (typeof configuredId !== "string" || typeof chatId !== "string") return false;
  const id = configuredId.trim();
  return /^[1-9]\d{0,14}$/u.test(id) && id === chatId;
}

export async function handleMorningCallback(store, telegram, query, {
  ownerChatId, readSnapshot = loadMorningSnapshot, assertActive = () => {},
  assertPermission = async () => {}, now = Date.now,
  timeAwarePriorities = process.env.AH_SHELI_TIME_AWARE_PRIORITIES === "1",
  userRoutines = process.env.AH_SHELI_PRIORITY_USER_ROUTINES === "1",
  priorityTestUserId = process.env.AH_SHELI_PRIORITY_TEST_USER_ID,
  readRoutine = loadUserRoutine,
  priorityOptions = {
    windowStart: process.env.AH_SHELI_PRIORITY_WINDOW_START,
    windowEnd: process.env.AH_SHELI_PRIORITY_WINDOW_END,
  },
} = {}) {
  const match = /^mb:([pc]):([A-Za-z0-9_-]{16})$/u.exec(query.data ?? "");
  const message = query.message;
  const receipt = store.reminderCheckIns?.[ownerChatId]?.morningBrief;
  if (!match || String(query.from?.id) !== ownerChatId || String(message?.chat?.id) !== ownerChatId
    || message.chat.type !== "private" || !message.from?.is_bot
    || receipt?.status !== "sent" || receipt.token !== match[2] || receipt.messageId !== message.message_id) {
    await telegram.call("answerCallbackQuery", { callback_query_id: query.id, text: "הכפתור הזה אינו פעיל." });
    return { ignored: true };
  }
  await assertPermission(); assertActive();
  await telegram.call("answerCallbackQuery", { callback_query_id: query.id });
  const snapshot = await readSnapshot(ownerChatId);
  const time = now();
  const timeAwareForUser = timeAwarePriorities === true
    && isPriorityTestUser(ownerChatId, priorityTestUserId);
  let options = priorityOptions, missingRoutine = false;
  if (match[1] === "p" && timeAwareForUser && userRoutines) {
    const routine = await readRoutine(ownerChatId);
    if (routine) options = routinePriorityOptions(routine, ownerChatId, time, priorityOptions);
    else missingRoutine = true;
  }
  const text = match[1] === "p" ? timeAwareForUser
    ? missingRoutine ? "עדיין לא נשמרה לך שגרה אישית לתעדוף."
      : formatTimeAwareMorningPriorities(snapshot, ownerChatId, time, options)
    : formatMorningPriorities(snapshot, ownerChatId, time)
    : formatMorningCalendar(snapshot, ownerChatId, time);
  await assertPermission(); assertActive();
  await telegram.sendMessage(ownerChatId, text);
  return { handled: true };
}
