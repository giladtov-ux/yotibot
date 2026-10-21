import { getJerusalemDateString, parseJerusalemDateTime, shiftJerusalemDate,
  reminderValidationTime, formatJerusalemTime } from "./time.js";
import { AiServiceError } from "./ai-errors.js";
import { assistantIdentity } from "./assistant-identity.js";
import { isDailySummaryRequest, formatDailySummary } from "./daily-summary.js";

// Inspection only. A summary must not consume a pending action or replay writes.
export function isSummaryRequest(text) {
  if (isDailySummaryRequest(text)) return true;
  const query = text.trim().replace(/^בבקשה\s+/u, "").replace(/[?!.…]+$/u, "").trim();
  return /^(?:מה\s+(?:ה?סיכום|עשינו|דיברנו)|על\s+מה\s+דיברנו)(?=\s|$)/u.test(query)
    || /^מה\s+היה\s+(?:השבוע|היום|אתמול|בשבוע)/u.test(query)
    || /^(?:(?:תן|תני)\s+(?:לי\s+)?סיכום|אפשר\s+(?:לקבל\s+)?סיכום|סיכום)$/u.test(query)
    || (/^(?:(?:תסכם|סכם|תסכמי|סכמי)\s|(?:תן|תני)\s+(?:לי\s+)?סיכום\s|סיכום\s)/u.test(query)
      && /השבוע|היום|אתמול|שבוע\s+(?:הזה|האחרון|שעבר)|מה\s+שעשינו|השיחות\s+שלנו|הפעילות\s+שלנו/u.test(query));
}

export function summaryPeriod(text, now = reminderValidationTime()) {
  const date = getJerusalemDateString(new Date(now));
  let firstDate = null;
  if (/השבוע|שבוע\s+(?:הזה|האחרון|שעבר)/u.test(text)) {
    if (/שבוע\s+האחרון/u.test(text)) firstDate = shiftJerusalemDate(date, -6);
    else {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      firstDate = shiftJerusalemDate(date, -weekday - (/שבוע\s+שעבר/u.test(text) ? 7 : 0));
    }
  } else if (/היום/u.test(text) || isDailySummaryRequest(text)) firstDate = date;
  else if (/אתמול/u.test(text)) firstDate = shiftJerusalemDate(date, -1);
  const from = firstDate ? parseJerusalemDateTime(firstDate, "00:00", { allowPast: true }) : null;
  let until = now + 1;
  if (/שבוע\s+שעבר/u.test(text)) {
    until = parseJerusalemDateTime(shiftJerusalemDate(firstDate, 7), "00:00", { allowPast: true });
  } else if (/אתמול/u.test(text)) {
    until = parseJerusalemDateTime(date, "00:00", { allowPast: true });
  }
  return { from, until };
}

export function buildSummaryEvidence(store, chatId, text, history = [], now = reminderValidationTime()) {
  const period = summaryPeriod(text, now);
  const within = value => Number.isFinite(value)
    && (period.from === null || value >= period.from) && value < period.until;
  const rows = Array.isArray(history) ? history : history?.rows ?? [];
  const evidence = {
    period,
    // Current lists are a snapshot, not proof an item was completed this week.
    currentLists: Object.entries(store.lists[chatId] ?? {}).map(([name, items]) => ({
      name, items: items.map(item => ({ text: item.text, checked: item.checked })),
    })),
    reminders: store.reminders.filter(item => item.chatId === chatId).flatMap(item => {
      const deliveries = Object.entries(item.telegramDeliveries ?? {})
        .filter(([dueAt, receipt]) => within(Number(dueAt)) || within(receipt.completedAt))
        .map(([dueAt, receipt]) => ({
          dueAt: Number(dueAt), state: receipt.state,
          completedAt: receipt.completedAt ?? null,
        }));
      return within(item.dueAt) || deliveries.length || period.from === null
        ? [{ text: item.text, dueAt: item.dueAt, sentAt: item.sentAt ?? null, deliveries }] : [];
    }),
    savedSchedules: (store.savedSchedules ?? []).filter(item => item.chatId === chatId)
      .map(item => ({ source: item.source })),
    conversation: rows.filter(row => ["user", "assistant"].includes(row?.role)
      && typeof (row.content ?? row.text) === "string"
      && (row.createdAt == null || within(new Date(row.createdAt).getTime())))
      .map(row => ({ role: row.role, content: row.content ?? row.text, recordedAt: row.createdAt ?? null })),
    historyPartial: history?.partial === true,
    historyUnavailable: history?.unavailable === true,
  };
  // Bound only summary context, not normal conversations or original saved data.
  // Coverage is explicit: a sample must never be described as an empty archive.
  const budgets = { conversation: 18_000, currentLists: 8_000, reminders: 8_000, savedSchedules: 6_000 };
  evidence.dataPartial = false;
  for (const key of ["conversation", "currentLists", "reminders", "savedSchedules"]) {
    let remaining = budgets[key];
    const selected = [];
    const records = key === "conversation" ? [...evidence[key]].reverse() : evidence[key];
    for (const record of records) {
      const size = JSON.stringify(record).length;
      if (size > remaining) { evidence.dataPartial = true; continue; }
      remaining -= size;
      selected.push(record);
    }
    evidence[key] = key === "conversation" ? selected.reverse() : selected;
  }
  return evidence;
}

export function formatSummaryEvidence(evidence) {
  const sections = [];
  if (evidence.conversation.length) sections.push(`מתוך השיחות ששמרנו:\n${evidence.conversation
    .map(row => `• ${row.role === "assistant" ? "הבוט השיב: " : ""}${row.recordedAt ? `${formatJerusalemTime(new Date(row.recordedAt).getTime())} — ` : ""}${row.content}`).join("\n")}`);
  if (evidence.currentLists.length) sections.push(`הרשימות כפי שהן עכשיו:\n${evidence.currentLists
    .map(list => `${list.name}:\n${list.items.map(item => `${item.checked ? "✓" : "•"} ${item.text}`).join("\n") || "הרשימה ריקה."}`).join("\n\n")}`);
  if (evidence.reminders.length) sections.push(`בתזכורות ששמרנו:\n${evidence.reminders.flatMap(item => {
    const lines = item.deliveries.map(receipt =>
      `• ${item.text} — ${formatJerusalemTime(receipt.dueAt)}: ${receipt.state === "done"
        ? `יש אישור ביצוע שמור${receipt.completedAt ? ` מ־${formatJerusalemTime(receipt.completedAt)}` : ""}.`
        : receipt.state === "sent" ? "נשלחה תזכורת; אין אישור ביצוע." : "אין אישור ביצוע."}`);
    if (!item.deliveries.some(receipt => receipt.dueAt === item.dueAt)
      && (evidence.period.from === null || item.dueAt >= evidence.period.from && item.dueAt < evidence.period.until)) {
      lines.push(`• ${item.text} — ${formatJerusalemTime(item.dueAt)}: ${item.sentAt ? "נשלחה תזכורת; אין אישור ביצוע." : "מתוכנן, ללא אישור ביצוע."}`);
    }
    return lines;
  }).join("\n")}`);
  if (evidence.savedSchedules.length) sections.push(`הלו״ז הקבוע ששמרנו:\n${evidence.savedSchedules.map(item => item.source).join("\n\n")}`);
  if (evidence.historyUnavailable) sections.push("לא הצלחתי לקרוא כרגע את היסטוריית השיחות; זה הסיכום מתוך הנתונים שכן זמינים לי.");
  else if (evidence.historyPartial || evidence.dataPartial) sections.push("זה סיכום חלקי מתוך הנתונים שקראתי, לא כל ההיסטוריה.");
  return sections.join("\n\n") || "לא מצאתי מידע מתועד בתקופה הזו; זה לא אומר שלא עשית דברים שלא נשמרו אצלי.";
}

export async function answerSummary(store, chatId, text, analyzer, history) {
  if (isDailySummaryRequest(text)) return formatDailySummary(store, chatId, history);
  const evidence = buildSummaryEvidence(store, chatId, text, history);
  const hasEvidence = [evidence.conversation, evidence.currentLists,
    evidence.reminders, evidence.savedSchedules].some(records => records.length);
  if (!hasEvidence) return formatSummaryEvidence(evidence);
  try {
    const intent = await analyzer(text, {
      ...assistantIdentity(store, chatId),
      timezone: "Asia/Jerusalem",
      currentLocalDate: getJerusalemDateString(new Date(reminderValidationTime())),
      summaryEvidence: evidence,
    });
    // Even a misclassified AI result can never execute actions during inspection.
    if (intent?.type === "answer" && typeof intent.response === "string" && intent.response.trim()
      && !(/אין\s+(?:לי\s+|אצלי\s+)?(?:שום\s+דבר|כלום)\s+שמור/u.test(intent.response)
        && hasEvidence)) return intent.response;
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error;
    console.warn(`[Ah Sheli] Summary read from saved evidence (${error.code}).`);
  }
  return formatSummaryEvidence(evidence);
}
