import { handleAssistantIntent, handleText, resolvePendingList, resolvePendingReminder } from "./commands.js";
import { listClearTarget, isListConfirmationQuestion } from "./list-confirmations.js";
import { isDeletionSuccessClaim } from "./deletion-receipts.js";
import { getChatReminders, getPendingAction, getLastListAction, getPendingListAction } from "./lib/assistant.server.js";
import { getChatReminders, getPendingAction, getLastListAction, getPendingListAction } from "./store.js";
import { formatJerusalemTime, getJerusalemDateString, extractHebrewTime,
  reminderValidationTime, withReminderRequestTime } from "./time.js";
import { AiServiceError } from "./ai-errors.js";
import { parseScheduleFallback } from "./schedule-fallback.js";
import { compactHistory } from "./assistant-performance.js";
import { parseRecordQuery, parseExplicitListWrite } from "./record-queries.js";
import { parseNaturalIntent } from "./natural-language.js";
import { parseNaturalTaskAction, bindItemIntent } from "./task-understanding.js";
import { extractRequestedInterval } from "./reminder-intervals.js";
import { parseListDeletion } from "./list-deletion.js";
import { parseListContinuation } from "./list-continuation.js";
import { scheduleQueryDayOffset, isScheduleInformationRequest, formatDaySchedule } from "./schedule-queries.js";
import { isSummaryRequest, answerSummary } from "./summary-queries.js";
import { assistantIdentity } from "./assistant-identity.js";
import { isReminderTimeUpdate, updateReminderTime, isUpdateSuccessClaim } from "./reminder-updates.js";
import { menuRecords } from "./record-menu.js";
import { parseContextualSchedule } from "./contextual-schedule.js";
import { parseNewAppointment } from "./appointment-flow.js";

const timezone = "Asia/Jerusalem";

function currentLocalDateTime(now = new Date()) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
}

export function buildAssistantContext(store, chatId, now = new Date(), message = "") {
  const lists = store.lists[chatId] ?? {};
  const listEntries = Object.entries(lists);
  const namedLists = listEntries.filter(([name]) => message.includes(name))
    .sort(([left], [right]) => right.length - left.length);
  const includeLists = !message || namedLists.length > 0
    || /רשימ|משימ|קניות|לקנות|נשאר|סמן|מחק|סיימ/u.test(message);
  const includeReminders = !message || isScheduleInformationRequest(message)
    || /תזכורת|תזכיר|התרא|בטל|ביטול|מתוכנן|פגישה/u.test(message);
  const reminders = (includeReminders ? getChatReminders(store, chatId) : [])
    .sort((left, right) => left.dueAt - right.dueAt)
    .slice(0, 12)
    .map((reminder) => ({
      text: reminder.text.slice(0, 160),
      dueAt: formatJerusalemTime(reminder.dueAt),
      ...(reminder.repeatEveryMs ? { intervalMinutes: reminder.repeatEveryMs / 60_000,
        remainingOccurrences: reminder.remainingOccurrences ?? null } : {}),
    }));
  const pendingReminder = getPendingAction(store, chatId);
  // Semantic interpretation must not depend on a keyword selecting the records.
  // Keep this small; exact reads still use the existing full-record handlers.
  const allReminders = getChatReminders(store, chatId)
    .sort((left, right) => left.dueAt - right.dueAt);
  const lastListAction = getLastListAction(store, chatId);
  const view = store.recordViews?.[chatId];
  const displayed = view?.key ? (menuRecords(store, chatId, "s") ?? [])
    .find(record => record.key === view.key) : null;
  const displayedRecord = displayed ? {
    kind: displayed.kind, id: displayed.id, text: displayed.text.slice(0, 1600),
    textPartial: displayed.text.length > 1600,
    ...(displayed.kind === "item" ? { listName: displayed.name, checked: displayed.checked } : {}),
    ...(displayed.kind === "reminder" ? {
      date: getJerusalemDateString(new Date(displayed.dueAt)),
      dueAt: formatJerusalemTime(displayed.dueAt), sentAt: displayed.sentAt,
    } : {}),
  } : null;
  const contextualLists = [...listEntries].sort(([left], [right]) =>
    Number(right === (displayedRecord?.listName ?? lastListAction?.listName))
      - Number(left === (displayedRecord?.listName ?? lastListAction?.listName)));

  return {
    ...assistantIdentity(store, chatId),
    currentLocalDateTime: currentLocalDateTime(now),
    currentLocalDate: getJerusalemDateString(now),
    timezone,
    ...(assistantIdentity(store, chatId).isOwner ? { user: {
      preferredName: "יוטי",
      age: 56,
      work: ["מלווה בהסעות תלמידים", "פעיל בנדל״ן"],
    },
    dailyScheduleContextOnly: {
      entries: [
        { time: "06:00", activity: "השכמה" },
        { time: "06:35", activity: "יציאה לאיסופים" },
        { time: "09:00", activity: "חזרה למשימות" },
        { time: "14:00", activity: "יציאה לאיסוף צהריים" },
        { time: "16:30", activity: "חזרה למשימות" },
      ],
      freeWindows: ["09:00-14:00", "16:30 ואילך"],
      neverCreateRemindersFromTheseEntries: true,
    } } : {}),
    availableListNames: listEntries.slice(0, 30).map(([name]) => name),
    storedDataMayBePartial: true,
    lastConfirmedListAction: lastListAction,
    displayedRecord,
    semanticRecordOverview: {
      readOnlyContext: true,
      partial: true,
      listCount: listEntries.length,
      reminderCount: allReminders.length,
      lists: contextualLists.slice(0, 3).map(([name, items]) => ({
        name, totalItems: items.length,
        items: items.slice(0, 6).map(item => ({
          text: item.text.slice(0, 160), checked: item.checked,
        })),
      })),
      reminders: allReminders.slice(0, 8).map(item => ({
        id: item.id, date: getJerusalemDateString(new Date(item.dueAt)),
        text: item.text.slice(0, 160), dueAt: formatJerusalemTime(item.dueAt),
      })),
      schedules: (store.savedSchedules ?? []).filter(item => item.chatId === chatId)
        .slice(-2).map(item => ({ source: item.source.slice(0, 1200) })),
    },
    pendingListAddition: getPendingListAction(store, chatId),
    lists: (includeLists ? (namedLists.length ? namedLists : listEntries).slice(0, 3) : []).map(([name, items]) => ({
      name,
      totalItems: items.length,
      items: items.slice(0, 12).map((item) => ({
        text: item.text.slice(0, 160),
        checked: item.checked,
      })),
    })),
    activeReminders: reminders,
    pendingReminder: pendingReminder
      ? {
          text: pendingReminder.text,
          date: pendingReminder.date,
          hour: pendingReminder.hour,
          minute: pendingReminder.minute,
        }
      : null,
  };
}

export function handleAssistantMessage(store, chatId, rawText, analyzer = analyzeMessage, history = [],
  { assertPermission = async () => {}, telegramResponseStyle = false } = {}) {
  const authorizedAnalyzer = async (...args) => {
    await assertPermission();
    const result = await analyzer(...args);
    await assertPermission();
    return result;
  };
  return withReminderRequestTime(async () => {
    await assertPermission();
    return processAssistantMessage(store, chatId, rawText, authorizedAnalyzer, history,
      { telegramResponseStyle });
  });
}

async function processAssistantMessage(
  store,
  chatId,
  rawText,
  analyzer = analyzeMessage,
  history = [],
  { telegramResponseStyle = false } = {},
) {
  const text = rawText.trim();
  if (telegramResponseStyle) {
    const appointment = parseNewAppointment(text, history, reminderValidationTime());
    if (appointment) return handleAssistantIntent(store, chatId, appointment, text);
    const schedule = parseContextualSchedule(text, history, reminderValidationTime());
    if (schedule) return handleAssistantIntent(store, chatId, schedule, text);
  }
  if (isReminderTimeUpdate(text)) return updateReminderTime(store, chatId, text, {}, history);
  if (isSummaryRequest(text)) return answerSummary(store, chatId, text, analyzer, history);
  const dayOffset = scheduleQueryDayOffset(text);
  if (dayOffset !== null) return formatDaySchedule(store, chatId, new Date(reminderValidationTime()), dayOffset);
  const scheduleInformation = isScheduleInformationRequest(text);
  if (/^(?:מה|תראה|תציג|הצג|אפשר לראות).*(?:לו[״"׳']?ז|לוח\s*זמנים|סידור).*(?:קבוע|שבועי)/u.test(text)) {
    const sources = (store.savedSchedules ?? []).filter(item => item.chatId === chatId);
    return sources.length ? sources.map(item => item.source).join("\n\n") : "עוד לא שמרת אצלי לו״ז קבוע.";
  }
  const weekly = parseWeeklySchedule(rawText);
  if (weekly) return saveWeeklySchedule(store, chatId, weekly, reminderValidationTime());
  const deletion = parseListDeletion(text);
  if (deletion) return handleAssistantIntent(store, chatId, deletion, text);
  const pendingListResponse = scheduleInformation ? null
    : await resolvePendingList(store, chatId, text, { allowNaturalTarget: true });
  if (pendingListResponse !== null) return pendingListResponse;
  if (!text || /^\/[a-z]+(?:@[a-z0-9_]+)?(?:\s|$)/iu.test(text)) {
    return handleText(store, chatId, rawText);
  }
  const query = parseRecordQuery(text) ?? parseExplicitListWrite(text)
    ?? parseListContinuation(text, getLastListAction(store, chatId),
      Object.keys(store.lists[chatId] ?? {}));
  if (query && query.type !== "clarify") return handleAssistantIntent(store, chatId, query, text);
  let localIntent;
  let localParseFailed = false;
  try { localIntent = parseNaturalIntent(text, new Date(reminderValidationTime())); }
  catch { localParseFailed = true; }
  const unparsedDate = localIntent?.type === "reminder" && !localIntent.date
    && /ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר/u.test(text);
  if (["add-items", "add-task", "create-list", "mark-item", "remove-item", "reminder",
    "cancel-reminder", "cancel-reminder-number", "repeat-reminder"].includes(localIntent?.type)
    && !unparsedDate
    || (localIntent?.type === "clarify" && /(?:כל|הפרש|מרווח)/u.test(text))) {
    if (telegramResponseStyle && localIntent?.type === "reminder") localIntent = {
      ...localIntent, trackTask: getPendingAction(store, chatId)?.trackTask ?? true,
    };
    return handleAssistantIntent(store, chatId, localIntent, text);
  }
  const pendingReminderReply = scheduleInformation || localParseFailed ? null
    : await resolvePendingReminder(store, chatId, text);
  if (pendingReminderReply !== null) return pendingReminderReply;

  const taskAction = parseNaturalTaskAction(text);
  if (taskAction) {
    const bound = bindItemIntent(store, chatId, taskAction, text);
    if (bound.type) return handleAssistantIntent(store, chatId, bound, text, undefined, { semantic: true });
    // A local miss is not a rejection: other phrasing or a pronoun can still
    // be resolved by the contextual model using the user's saved records.
  }
  const context = buildAssistantContext(store, chatId, new Date(reminderValidationTime()), text);
  context.recentConversation = compactHistory(history);
  let intent;
  try {
    intent = await analyzer(text, context);
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error;
    if (scheduleInformation) {
      console.warn(`[Ah Sheli] Schedule information read from saved records (${error.code}).`);
      return handleAssistantIntent(store, chatId, { type: "list-reminders" }, text);
    }
    if (error.code === "invalid_response") {
      console.warn("[Ah Sheli] AI output incomplete or unreadable; no model action applied.");
      let sourceSchedule;
      try { sourceSchedule = parseScheduleFallback(text); } catch { /* no guessed dates */ }
      if (sourceSchedule?.type === "schedule-reminders") {
        const reply = await handleAssistantIntent(store, chatId, sourceSchedule, rawText);
        return reply;
      }
      return handleAssistantIntent(store, chatId, {
        type: "clarify", response: "אחי, התשובה נקטעה לי הפעם. אפשר לנסות שוב בעוד רגע; לא שיניתי דבר בעקבות הבקשה הזו.",
      }, text);
    }
    const schedule = parseScheduleFallback(text);
    if (schedule) {
      console.warn(`[Ah Sheli] Schedule backup used (${error.code}).`);
      const reply = await handleAssistantIntent(store, chatId, schedule, rawText);
      return reply;
    }
    console.warn(`[Ah Sheli] AI unavailable (${error.code}); attempting current-message recovery.`);
    // Genuine outages remain visible; current-message recovery never replays history.
    const localReply = await handleText(store, chatId, text);
    // A greeting or simple conversational response doesn't need an error banner.
    if (["greeting", "thanks", "farewell", "small-talk", "tell-time", "tell-date"]
      .includes(localIntent?.type)) return localReply;
    return `${error.message}\n\n${localReply}`;
  }
  if (intent.type === "update-reminder") {
    if (scheduleInformation) return handleAssistantIntent(store, chatId, { type: "list-reminders" }, text);
    return updateReminderTime(store, chatId, text, intent, history);
  }
  if (scheduleInformation && !["answer", "list-reminders",
    "help", "greeting", "thanks", "farewell", "small-talk", "tell-time", "tell-date"].includes(intent.type)) {
    return handleAssistantIntent(store, chatId, { type: "list-reminders" }, text);
  }
  const intervalClarification = /^(?:מחר|היום|מחרתיים|(?:ב[־-]?)?\d{1,2}:\d{2}|\d+\s*פעמים)[.!? ]*$/u.test(text);
  const previousInterval = intervalClarification
    ? context.recentConversation.filter(row => row.role === "user")
      .map(row => extractRequestedInterval(row.content ?? row.text)).filter(Boolean).at(-1)
    : null;
  if (intent.type === "schedule-reminders" && !extractRequestedInterval(text)?.minutes && !previousInterval) {
    let suppliedSchedule;
    try { suppliedSchedule = parseScheduleFallback(text); } catch { /* retain source instead of guessing */ }
    if (suppliedSchedule?.type === "schedule-reminders" && suppliedSchedule.reminders.every(entry =>
      entry.text && entry.date && entry.hour !== null && entry.minute !== null)) {
      intent = { ...intent, reminders: suppliedSchedule.reminders };
    }
    // Action JSON cannot manufacture clocks absent from the user's own words.
    const source = [text, ...context.recentConversation.filter(row => row.role === "user")
      .map(row => row.content ?? row.text)].join("\n");
    const suppliedClocks = new Set([...source.matchAll(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/gu)]
      .map(match => `${Number(match[1])}:${Number(match[2])}`));
    for (const segment of source.split(/[\n,;]+/u)) {
      let rest = segment;
      for (let count = 0; count < 100; count++) {
        const time = extractHebrewTime(rest);
        if (!time) break;
        suppliedClocks.add(`${time.hour}:${time.minute}`);
        rest = rest.slice(time.end);
      }
    }
    intent = { ...intent, reminders: intent.reminders.map(entry => suppliedClocks.has(`${entry.hour}:${entry.minute}`)
      ? entry : { ...entry, hour: null, minute: null }) };
  }
  if (["answer", "clarify", "small-talk", "greeting", "thanks", "farewell"].includes(intent?.type)) {
    if (/נראה\s+ששלחת(?:\s+לי)?\s+מידע\s+טכני/u.test(intent.response ?? "")) {
      return "מה תרצה לעשות במשימה או ברשימה?";
    }
    // A prose promise from the model is not a receipt. A validated current
    // cleanup request must run through the database writer; an unbound claim
    // must never be relayed as if something had actually been deleted.
    const listName = listClearTarget(store, chatId, rawText);
    const claimsDeletion = isDeletionSuccessClaim(intent.response);
    if (listName && (claimsDeletion || !isListConfirmationQuestion(intent.response ?? ""))) {
      return handleAssistantIntent(store, chatId, { type: "clear-list", listName }, rawText, previousInterval, { semantic: true });
    }
    const explicitAddition = /^(?:בבקשה\s+)?(?:תוסיף|תוסיפי|הוסף|הוסיפי|תכניס|תכניסי)\s+/u.test(text);
    const additionProgress = /(?:אני\s+(?:מוסיף|מוסיפה|מכניס|מכניסה|שומר|שומרת|רושם|רושמת)|(?:מוסיף|מוסיפה|מכניס|מכניסה)\s+(?:עכשיו|כרגע)|(?:אוסיף|אשמור|ארשום)\s+)/u.test(intent.response ?? "");
    const currentTaskAction = /^(?:סיימתי|עשיתי|גמרתי|סגרתי|תוריד|להוריד|תעיף|תמחק|מחק|תשנה|שנה|תעדכן|עדכן)(?:\s|$)/u.test(text);
    if (!currentTaskAction && !explicitAddition && !additionProgress) {
      if (claimsDeletion) return "לא מחקתי דבר. איזה פריט או רשימה למחוק?";
      if (isUpdateSuccessClaim(intent.response)) return "עוד לא שיניתי דבר. מה בדיוק לעדכן?";
    }
    if (explicitAddition || additionProgress || currentTaskAction || claimsDeletion || isUpdateSuccessClaim(intent.response)) {
      // A conversational answer cannot perform an addition. Repair only the
      // current request, once; historical prose is never an executable receipt.
      const repaired = await analyzer(text, {
        ...context,
        actionReceiptCorrection: {
          previousReplyWasNotExecuted: true,
          instruction: "התשובה הקודמת לא ביצעה דבר. פענח רק את הבקשה הנוכחית: משימה חדשה add-task; הוספה לרשימה add-items; סיום משימה mark-item; הורדת פריט remove-item; שינוי נוסח update-item עם text החדש. זהה listName ו-itemText לפי הנתונים וההקשר, ללא דרישה למילות פקודה. שמור את מלוא התוכן. אל תחזיר הבטחת ביצוע או בקשת המתנה. שאלות, שלילה ושיחה אינן אישור לשינוי.",
        },
      });
      if (["add-task", "add-items", "create-list", "mark-item", "remove-item", "update-item"].includes(repaired?.type)) {
        return handleAssistantIntent(store, chatId, repaired, rawText, previousInterval, { semantic: true });
      }
      return explicitAddition || additionProgress ? "עוד לא נשמרה משימה. כדי להוסיף במדויק, צריך את הפעולה עצמה."
        : "צריך לזהות את הפריט המדויק לפני שינוי. אפשר לבחור אותו ברשימה.";
    }
    if (isUpdateSuccessClaim(intent.response)) return "עוד לא שיניתי דבר. מה בדיוק לעדכן?";
  }
  if (telegramResponseStyle && intent?.type === "reminder") {
    intent = { ...intent, trackTask: getPendingAction(store, chatId)?.trackTask ?? true,
      taskListName: intent.listName === "מטרות" ? "מטרות" : "משימות" };
  }
  return handleAssistantIntent(store, chatId, intent, rawText, previousInterval, { semantic: true });
}
