import { handleAssistantMessage } from "./assistant.js";
import { loadHistory, loadSummaryHistory, saveTurn } from "./conversation-repository.js";
import { needsConversationHistory as needsBaseConversationHistory } from "./assistant-performance.js";
import { handleInterruptedRequests } from "./interrupted-requests.js";
import { withReminderRequestTime } from "./time.js";
import { isSummaryRequest, summaryPeriod } from "./summary-queries.js";
import { isDailySummaryRequest, formatTelegramDailySummary } from "./daily-summary.js";
import { parseContextualSchedule } from "./contextual-schedule.js";
import { loadDailySummaryStore } from "./daily-summary-repository.js";
import { stripRepetitiveClosing } from "./conversation-style.js";
import { recordMenuForRequest, recordMenuForList, menuRecords, renderRecordDetails } from "./record-menu.js";
import { saveStore } from "./store.js";
import { collectListReceipts, listReceiptText } from "./list-mutation-receipts.js";
import { parseNaturalTaskAction } from "./task-understanding.js";
import { parseRecordQuery } from "./record-queries.js";
import { menuDelivery } from "./menu-delivery.js";
import { handleRecordViewAction, clearRecordView } from "./record-view-actions.js";
import { resolveListConfirmation, rememberListConfirmation, activeConfirmationHistory } from "./list-confirmations.js";
import { handleDailyRecapMessage, DailyRecapReadError } from "./daily-recap-flow.js";
import { shoppingClosed } from "./shopping-lifecycle.js";

const needsConversationHistory = text => needsBaseConversationHistory(text)
  || /פגישה|תור|אירוע|מפגש|ראיון|תקבע|תשבץ/u.test(text);

// Called after the runtime's owner authorization gate. Keep inspection outside
// the conversation pipeline so report commands cannot answer pending questions.
export async function handleOwnerUpdate(store, telegram, update, {
  ownerChatId,
  assertActive = () => {},
  inspectionOptions = {},
  replyOptions = {},
  transcribeVoice,
  assertPermission = async () => {},
} = {}) {
  let message = update.message;
  // Text always takes the original path, without loading or configuring speech
  // support. An optional audio attachment must never override written text.
  const hasText = typeof message?.text === "string" && message.text.length > 0;
  if (!hasText && !message?.voice) return { ignored: true };
  // Telegram dates are UTC epoch seconds, not an Israel wall-clock string.
  const requestTime = Number.isSafeInteger(message.date) && message.date > 0
    ? message.date * 1000 : Date.now();
  await assertPermission();
  if (!hasText) {
    // Never download or send another user's recording to the transcription API.
    if (!ownerChatId || String(message.chat.id) !== ownerChatId
      || String(message.from?.id) !== ownerChatId || message.from?.is_bot
      || message.chat.type !== "private") return { ignored: true };
    let text;
    let voiceSupport;
    try {
      assertActive();
      // A missing speech dependency or credential must affect voice only.
      voiceSupport = await import("./voice-transcription.js");
      text = await (transcribeVoice ?? voiceSupport.transcribeTelegramVoice)(
        message.voice, telegram, { assertActive });
      if (typeof text !== "string" || !text.trim()) {
        throw Object.assign(new Error("Empty transcription"), { code: "empty" });
      }
    } catch (error) {
      assertActive();
      // Log only our own safe categories/status, never audio, transcripts,
      // provider bodies, file URLs or credentials from transport errors.
      console.warn("[Ah Sheli] Voice transcription failed", voiceSupport && error instanceof voiceSupport.VoiceTranscriptionError
        ? { code: error.code, stage: error.stage, status: error.status } : { code: "unavailable" });
      await telegram.sendMessage(String(message.chat.id), voiceSupport
        ? voiceSupport.voiceFailureReply(error)
        : "לא הצלחתי לתמלל את ההודעה הקולית כרגע. אפשר לשלוח שוב או לכתוב לי?");
      return { transcriptionFailed: true };
    }
    assertActive();
    await assertPermission();
    message = { ...message, text: text.trim() };
  }
  if (await handleInterruptedRequests(message, telegram, {
    ...inspectionOptions,
    ownerChatId, currentUpdateId: update.update_id, assertActive,
  })) return;
  return withReminderRequestTime(() => replyToOwnerMessage(store, telegram, String(message.chat.id), message.text, {
    ...replyOptions, assertActive, assertPermission,
  }), requestTime);
}

// Shared by the real incoming-message handler and end-to-end delivery checks.
export function replyToOwnerMessage(store, telegram, chatId, text, options = {}) {
  return withReminderRequestTime(() => processOwnerMessage(store, telegram, chatId, text, options));
}

async function processOwnerMessage(store, telegram, chatId, text, {
  readHistory = loadHistory,
  readSummaryHistory = loadSummaryHistory,
  readDailySummaryStore = loadDailySummaryStore,
  summaryNow = Date.now,
  saveConversation = saveTurn,
  assistant = handleAssistantMessage,
  assertActive = () => {},
  assertPermission = async () => {},
  recordOperation = work => work(),
  telegramResponseStyle = false,
  recapPersist = saveStore,
} = {}) {
  const started = performance.now();
  const timings = {};
  let phase = "history";
  let mark = started;
  try {
    assertActive();
    const listAction = await recordOperation(async () => {
      await assertPermission();
      assertActive();
      return resolveListConfirmation(store, chatId, text);
    });
    const deliverListAction = async action => {
      assertActive();
      await saveConversation(chatId, text, action.text);
      await telegram.sendMessage(chatId, action.text);
      if (action.menu) await telegram.sendMessage(chatId, action.menu.text, action.menu.options);
      phase = "delivered";
      return { delivered: true };
    };
    if (listAction) return await deliverListAction(listAction);
    if (telegramResponseStyle) {
      let recapMessages;
      try {
        recapMessages = await recordOperation(async () => {
          await assertPermission(); assertActive();
          return handleDailyRecapMessage(store, chatId, text, {
            persist: recapPersist, readSnapshot: readDailySummaryStore, now: summaryNow,
          });
        });
      } catch (error) {
        if (!(error instanceof DailyRecapReadError)) throw error;
        recapMessages = [{ text: "לא הצלחתי לקרוא את נתוני הסיכום ממסד הנתונים. אפשר לנסות שוב." }];
      }
      if (recapMessages) {
        await saveConversation(chatId, text, recapMessages.map(message => message.text).join("\n\n"));
        for (const message of recapMessages) {
          await assertPermission(); assertActive();
          await telegram.sendMessage(chatId, message.text, message.options);
        }
        phase = "delivered";
        return { delivered: true };
      }
    }
    const recordAction = await recordOperation(async () => {
      await assertPermission();
      assertActive();
      return handleRecordViewAction(store, chatId, text);
    });
    if (recordAction) {
      assertActive();
      await telegram.sendMessage(chatId, recordAction.text);
      if (recordAction.menu) await telegram.sendMessage(chatId, recordAction.menu.text, recordAction.menu.options);
      phase = "delivered";
      return { delivered: true };
    }
    let history;
    const telegramDaily = telegramResponseStyle && isDailySummaryRequest(text);
    let dailySnapshot;
    let dailySummaryTime;
    if (telegramDaily) {
      try {
        dailySummaryTime = summaryNow();
        dailySnapshot = await readDailySummaryStore(chatId, undefined, dailySummaryTime);
      } catch {
        await assertPermission();
        assertActive();
        await telegram.sendMessage(chatId, "לא הצלחתי לקרוא את נתוני הסיכום כרגע. אפשר לנסות שוב.");
        phase = "delivered";
        return { delivered: true, summaryUnavailable: true };
      }
      history = [];
    } else if (isSummaryRequest(text)) {
      try { history = await readSummaryHistory(chatId, summaryPeriod(text)); }
      catch {
        console.warn("[Ah Sheli] Summary history unavailable; using saved records without claiming an empty archive.");
        history = { rows: [], unavailable: true };
      }
    } else history = needsConversationHistory(text) ? await readHistory(chatId) : [];
    if (Array.isArray(history) && history.length) {
      const recoveredAction = await recordOperation(async () => {
        await assertPermission();
        assertActive();
        return resolveListConfirmation(store, chatId, text, { history });
      });
      if (recoveredAction) return await deliverListAction(recoveredAction);
      history = activeConfirmationHistory(store, chatId, history, text);
    }
    timings.historyMs = Math.round(performance.now() - mark);
    phase = "assistant";
    mark = performance.now();
    await assertPermission();
    const previousReminders = new Map(store.reminders.map(item => [item.id,
      { dueAt: item.dueAt, text: item.text }]));
    const collected = telegramDaily
      ? { events: [], result: formatTelegramDailySummary(dailySnapshot, chatId, dailySummaryTime) }
      : await collectListReceipts(() => assistant(store, chatId, text, undefined, history,
        { assertPermission, telegramResponseStyle }));
    const receipt = collected.events.filter(event => event.chatId === chatId).at(-1);
    // A short addition receipt is presentation only, and only follows a
    // committed list mutation. Internal callers retain their default presentation.
    const previousIds = new Set((receipt?.before ?? []).map(item => item.id));
    const addedItems = receipt?.after?.some(item => !previousIds.has(item.id));
    const additionRequest = parseNaturalTaskAction(text)?.type === "add-items"
      || /^(?:(?:אחי|אח שלי)[, ]+)?(?:בבקשה\s+)?(?:תוסיף|הוסף|הוסיפי|תוסיפי|להוסיף|תכניס|הכנס)\s/u.test(text.trim());
    const shortAddition = telegramResponseStyle && Array.isArray(receipt?.after)
      && receipt.after.length > 0 && (addedItems || additionRequest);
    let response = telegramDaily ? collected.result
      : stripRepetitiveClosing(receipt ? listReceiptText(receipt) : collected.result);
    if (shortAddition) {
      response = addedItems ? "נוסף לרשימה"
        : JSON.stringify(receipt.before) !== JSON.stringify(receipt.after)
          ? "הרשימה עודכנה" : "כבר קיים ברשימה";
    }
    if (!telegramDaily) response = await recordOperation(async () => {
      await assertPermission();
      assertActive();
      return rememberListConfirmation(store, chatId, text, response);
    });
    timings.assistantMs = Math.round(performance.now() - mark);
    phase = "save";
    mark = performance.now();
    assertActive();
    await saveConversation(chatId, text, response);
    timings.saveMs = Math.round(performance.now() - mark);
    phase = "telegram";
    mark = performance.now();
    assertActive();
    const displayStore = receipt?.after ? {
      ...store, lists: { ...store.lists, [chatId]: { ...store.lists[chatId], [receipt.listName]: receipt.after } },
    } : store;
    let directDetails = null;
    if (telegramResponseStyle && !telegramDaily && !isSummaryRequest(text)) {
      const freshReminder = store.reminders.find(item => item.chatId === chatId
        && item.trackingTaskId && (!previousReminders.has(item.id)
          || previousReminders.get(item.id).dueAt !== item.dueAt
          || previousReminders.get(item.id).text !== item.text));
      const freshTask = Array.isArray(receipt?.after) && /משימ|מטר/u.test(receipt.listName)
        ? receipt.after.find(item => !item.checked && (!previousIds.has(item.id)
          || receipt.before?.find(previous => previous.id === item.id)?.text !== item.text)) : null;
      const scope = freshReminder ? "r" : "s";
      const selected = freshReminder
        ? menuRecords(store, chatId, scope)?.find(item => item.id === freshReminder.id)
        : freshTask ? menuRecords(store, chatId, scope)?.find(item => item.kind === "item"
          && item.name === receipt.listName && item.id === freshTask.id) : null;
      if (selected) {
        const details = renderRecordDetails(store, chatId, selected.key, scope, "c", 0);
        if (details) {
          await recordOperation(async () => {
            assertActive();
            await assertPermission();
            const recordViews = { ...store.recordViews, [chatId]: {
              key: selected.key, scope, mode: "c", offset: 0, awaitingDelete: false,
              ...(details.completionDueAt != null ? { completionDueAt: details.completionDueAt } : {}),
            } };
            await saveStore({ ...store, recordViews });
            store.recordViews = recordViews;
          });
          const actions = details.options.reply_markup.inline_keyboard.flat()
            .filter(button => /^v:[dx]:/u.test(button.callback_data));
          actions.splice(1, 0, { text: "✏️ עדכן",
            callback_data: `v:i:${selected.key}:${scope}:c:0`, style: "success" });
          directDetails = { reply_markup: { inline_keyboard: [actions] } };
        }
      }
    }
    const textOnly = shortAddition || isDailySummaryRequest(text)
      || (receipt && shoppingClosed(displayStore, chatId, receipt.listName))
      || (telegramResponseStyle && Boolean(parseContextualSchedule(text, history, summaryNow())))
      || (telegramResponseStyle && isSummaryRequest(text));
    const menu = textOnly ? null : receipt ? recordMenuForList(displayStore, chatId, receipt.listName)
      : recordMenuForRequest(store, chatId, text)
        ?? (parseNaturalTaskAction(text) ? recordMenuForList(store, chatId,
          store.lastListActions?.[chatId]?.listName ?? "משימות") : null);
    if (menu && !directDetails) await recordOperation(async () => {
      assertActive();
      await assertPermission();
      await clearRecordView(store, chatId);
    });
    const listRead = !receipt && ["show-list", "list-lists"].includes(parseRecordQuery(text)?.type);
    const deliveries = directDetails ? [[response, directDetails]]
      : menuDelivery(menu, response, { summary: isSummaryRequest(text), listOnly: listRead });
    for (const [body, options] of deliveries) {
      assertActive();
      if (options) await telegram.sendMessage(chatId, body, options);
      else await telegram.sendMessage(chatId, body);
    }
    timings.telegramMs = Math.round(performance.now() - mark);
    phase = "delivered";
    return { delivered: true };
  } finally {
    if (phase !== "delivered") timings[`${phase}Ms`] = Math.round(performance.now() - mark);
    console.info(`[Ah Sheli] Message timing ${JSON.stringify({
      ...timings, totalMs: Math.round(performance.now() - started), phase,
    })}`);
  }
}
