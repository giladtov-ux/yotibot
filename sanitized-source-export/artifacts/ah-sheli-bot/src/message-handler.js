import { handleAssistantMessage } from "./assistant.js";
import { prepareReminderDeletion, cancelUnrelatedReminderSelection } from "./reminder-selection.js";
import { loadHistory, loadSummaryHistory, saveTurn } from "./conversation-repository.js";
import { needsConversationHistory as needsBaseConversationHistory } from "./assistant-performance.js";
import { handleInterruptedRequests } from "./interrupted-requests.js";
import { withReminderRequestTime } from "./time.js";
import { isSummaryRequest, summaryPeriod } from "./summary-queries.js";
import { isDailySummaryRequest, formatTelegramDailySummary } from "./daily-summary.js";
import { parseContextualSchedule } from "./contextual-schedule.js";
import { loadDailySummaryStore } from "./daily-summary-repository.js";
import { recordMenuForRequest, recordMenuForList, menuRecords, renderRecordDetails } from "./record-menu.js";
import { saveStore, refreshCommittedLists } from "./store.js";
import { refreshPreviousReminderMenu, rememberReminderMenu } from "./telegram-menu-sync.js";
import { collectListReceipts, listReceiptText } from "./list-mutation-receipts.js";
import { parseNaturalTaskAction } from "./task-understanding.js";
import { parseRecordQuery } from "./record-queries.js";
import { menuDelivery } from "./menu-delivery.js";
import { handleRecordViewAction, clearRecordView } from "./record-view-actions.js";
import { resolveListConfirmation, rememberListConfirmation, activeConfirmationHistory } from "./list-confirmations.js";
import { handleDailyRecapMessage, DailyRecapReadError } from "./daily-recap-flow.js";
import { shoppingClosed } from "./shopping-lifecycle.js";
import { isWeeklyScheduleQuery, weeklyScheduleQueryDays } from "./schedule-queries.js";
import { reminderPresentationSnapshot, changedReminderRecords, renderReminderMutation } from "./reminder-presentation.js";
import { collectReminderReceipts } from "./reminder-mutation-receipts.js";
import { voiceCapabilityReply } from "./voice-conversation.js";
import { handleTomorrowPreparation, preparationIntent } from "./tomorrow-preparation.js";
import { handleMultipleListDeletion } from "./multiple-list-deletion.js";
import { renderRecordMenu } from "./record-menu.js";
import { isDayStatusRequest, formatDayStatus } from "./day-status.js";
import { loadMorningSnapshot } from "./morning-brief-repository.js";
import { interpretIncoming, conversationalTypes } from "./conversation-engine.js";
import { askAssistant } from "./lib/assistant.server.ts";
import { parseDefaultTaskAddition } from "./natural-language.js";
import { parseListDeletion } from "./list-deletion.js";
import { AiServiceError } from "./ai-errors.js";
import { formatListSnapshot } from "./list-presentation.js";
import { runToolConversation } from "./tool-conversation.js";

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
      if (replyOptions.toolUse) {
        // No transcript exists: let the model phrase the failure, but disable
        // all writes so neither history nor a guessed recording becomes work.
        return replyToOwnerMessage(store, telegram, String(message.chat.id), "", {
          ...replyOptions, assertActive, assertPermission,
          toolOptions: { ...replyOptions.toolOptions, voiceFailure: true },
        });
      }
      await telegram.sendMessage(String(message.chat.id), voiceSupport
        ? voiceSupport.voiceFailureReply(error)
        : "כרגע הקוליות לא זמינות. כתוב לי את הבקשה ואטפל בה.");
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
    referenceText: message.reply_to_message?.from?.is_bot
      && String(message.reply_to_message.chat?.id) === String(message.chat.id)
      ? message.reply_to_message.text ?? "" : "",
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
  referenceText = "",
  readDaySnapshot = loadMorningSnapshot,
  llmFirst = false,
  analyzeIncoming = askAssistant,
  readLiveConversationSnapshot,
  refreshListSnapshot = refreshCommittedLists,
  toolUse = false,
  toolOptions = {},
} = {}) {
  const started = performance.now();
  const timings = {};
  let phase = "history";
  let mark = started;
  const changedListsSince = before => [...new Set([
    ...Object.keys(before), ...Object.keys(store.lists[chatId] ?? {}),
  ])].filter(name => JSON.stringify(before[name]) !== JSON.stringify(store.lists[chatId]?.[name]));
  const deliverUpdatedLists = async names => {
    await recordOperation(async () => {
      await assertPermission(); assertActive();
      await refreshListSnapshot(store, chatId);
    });
    const body = [...new Set(names)].map(name => {
      const items = store.lists[chatId]?.[name];
      return items ? formatListSnapshot(name, items, { updated: true })
        : `📝 ${name}\n✅ הרשימה נמחקה`;
    }).join("\n\n");
    await assertPermission(); assertActive();
    await saveConversation(chatId, text, body);
    await assertPermission(); assertActive();
    await telegram.sendMessage(chatId, body);
    phase = "delivered";
    return { delivered: true };
  };
  const deliverBatchDeletion = async batchDeletion => {
    await assertPermission(); assertActive();
    if (llmFirst && batchDeletion.listNames.length) return deliverUpdatedLists(batchDeletion.listNames);
    if (llmFirst) {
      await saveConversation(chatId, text, batchDeletion.text);
      await telegram.sendMessage(chatId, batchDeletion.text);
      phase = "delivered";
      return { delivered: true };
    }
    const menus = batchDeletion.listNames.map(name => recordMenuForList(store, chatId, name, "a")).filter(Boolean);
    const body = [batchDeletion.text, ...menus.map(menu => menu.text)].join("\n\n");
    const seenRows = new Set();
    const markup = { inline_keyboard: menus.flatMap(menu => menu.options.reply_markup.inline_keyboard)
      .filter(row => {
        const key = JSON.stringify(row.map(button => button.callback_data));
        if (seenRows.has(key)) return false;
        seenRows.add(key); return true;
      }) };
    await saveConversation(chatId, text, body);
    if (menus.length) await refreshPreviousReminderMenu(store, telegram, chatId, { inline_keyboard: [] });
    assertActive(); await assertPermission();
    const sent = await telegram.sendMessage(chatId, body, menus.length
      ? { ...menus[0].options, reply_markup: markup } : undefined);
    if (menus.length) await rememberReminderMenu(store, chatId, sent);
    phase = "delivered";
    return { delivered: true };
  };
  try {
    assertActive();
    if (toolUse) {
      // The active runtime bypasses every legacy intent parser, menu,
      // confirmation state and hardcoded conversational response below.
      try {
        await assertPermission();
        const history = await readHistory(chatId);
        const { response } = await runToolConversation(store, chatId, text, {
          ...toolOptions, history, referenceText, now: summaryNow(),
          recordOperation, assertPermission, assertActive,
        });
        await assertPermission(); assertActive();
        await saveConversation(chatId, text, response);
        await assertPermission(); assertActive();
        await telegram.sendMessage(chatId, response);
        phase = "delivered";
        return { delivered: true };
      } catch (error) {
        error.suppressDefaultReply = true;
        throw error;
      }
    }
    let interpreted;
    let conversationHistory = [];
    if (llmFirst) {
      await assertPermission();
      try { conversationHistory = await readHistory(chatId); }
      catch { console.warn("[Ah Sheli] Conversation history unavailable"); }
      try {
        interpreted = await interpretIncoming(store, chatId, text, {
          readSnapshot: readLiveConversationSnapshot, history: conversationHistory,
          analyze: analyzeIncoming, now: summaryNow(), referenceText, assertPermission, assertActive,
        });
      } catch (error) {
        // A provider failure must not become a scripted misunderstanding or a
        // claim that a conversational question was an unsuccessful DB write.
        error.suppressDefaultReply = true;
        throw error;
      }
      // The model owns contextual read intent. Do not run a summary through
      // legacy list/confirmation parsers or gate it on its delivery clock.
      if (interpreted.intent.type === "prepare-tomorrow") {
        const messages = await recordOperation(async () => {
          await assertPermission(); assertActive();
          return handleTomorrowPreparation(store, chatId, text, {
            intent: "prepare-tomorrow", persist: recapPersist,
            readSnapshot: readDailySummaryStore, now: summaryNow,
          });
        });
        await assertPermission(); assertActive();
        await saveConversation(chatId, text, messages[0].text);
        await assertPermission(); assertActive();
        await telegram.sendMessage(chatId, messages[0].text);
        phase = "delivered";
        return { delivered: true };
      }
      // Model-first does not discard existing complete-list views, batch
      // operations, completion receipts or confirmations of a saved draft.
      const needsValidatedEngine = !isDayStatusRequest(text) && (
        parseRecordQuery(text) || parseNaturalTaskAction(text) || parseDefaultTaskAddition(text)
        || parseListDeletion(text) || preparationIntent(text) || isDailySummaryRequest(text)
        || isSummaryRequest(text) || isWeeklyScheduleQuery(text) || weeklyScheduleQueryDays(text)
        || /^(?:בוצע|עשיתי|רשמתי|סיימתי|טופל)(?:\s|[.!?]|$)/u.test(text.trim())
        || (/^(?:כן|לא|אוקיי|סגור)[.!?\s]*$/u.test(text.trim())
          && (store.pendingActions?.[chatId] || store.pendingListActions?.[chatId]
            || store.listConfirmations?.[chatId]))
      );
      if (conversationalTypes.has(interpreted.intent.type) && !needsValidatedEngine) {
        await assertPermission(); assertActive();
        await saveConversation(chatId, text, interpreted.intent.response);
        await assertPermission(); assertActive();
        await telegram.sendMessage(chatId, interpreted.intent.response);
        phase = "delivered";
        return { delivered: true };
      }
    }
    if (!llmFirst && isDayStatusRequest(text)) {
      const response = await recordOperation(async () => {
        await assertPermission(); assertActive();
        let snapshot;
        try { snapshot = await readDaySnapshot(chatId); }
        catch {
          console.warn("[Ah Sheli] Current day SQL read unavailable");
          return "כרגע לא הצלחתי לקרוא את הלו״ז השמור.";
        }
        return formatDayStatus(snapshot, chatId, summaryNow());
      });
      await assertPermission(); assertActive();
      await saveConversation(chatId, text, response);
      await assertPermission(); assertActive();
      await telegram.sendMessage(chatId, response);
      phase = "delivered";
      return { delivered: true };
    }
    await recordOperation(async () => {
      await assertPermission();
      assertActive();
      await refreshCommittedLists(store, chatId);
      await cancelUnrelatedReminderSelection(store, chatId, text);
    });
    const capabilityReply = voiceCapabilityReply(text);
    if (capabilityReply) {
      // Do not consume a pending action or expose a stale list just because the
      // user asks whether voice is supported.
      await assertPermission();
      assertActive();
      await saveConversation(chatId, text, capabilityReply);
      await telegram.sendMessage(chatId, capabilityReply);
      phase = "delivered";
      return { delivered: true };
    }
    if (telegramResponseStyle) {
      const preparation = await recordOperation(async () => {
        await assertPermission(); assertActive();
        return handleTomorrowPreparation(store, chatId, text, {
          persist: recapPersist, readSnapshot: readDailySummaryStore, now: summaryNow,
        });
      });
      if (preparation) {
        await assertPermission(); assertActive();
        await saveConversation(chatId, text, preparation[0].text);
        await telegram.sendMessage(chatId, preparation[0].text);
        if (preparationIntent(text) === "defer-tasks") {
          const menu = renderRecordMenu(store, chatId, "r", "c");
          await refreshPreviousReminderMenu(store, telegram, chatId, menu.options.reply_markup, menu.text);
        }
        phase = "delivered";
        return { delivered: true };
      }
    }
    const batchDeletion = await recordOperation(async () => {
      await assertPermission(); assertActive();
      return handleMultipleListDeletion(store, chatId, text);
    });
    if (batchDeletion) {
      return deliverBatchDeletion(batchDeletion);
    }
    const beforeListAction = structuredClone(store.lists[chatId] ?? {});
    const listActionResult = await collectListReceipts(() => recordOperation(async () => {
      await assertPermission();
      assertActive();
      return resolveListConfirmation(store, chatId, text);
    }));
    const listAction = listActionResult.result;
    const deliverListAction = async action => {
      assertActive();
      await saveConversation(chatId, text, action.text);
      await telegram.sendMessage(chatId, action.text);
      if (action.menu && !llmFirst) await telegram.sendMessage(chatId, action.menu.text, action.menu.options);
      phase = "delivered";
      return { delivered: true };
    };
    if (listAction) {
      const changed = [...listActionResult.events.filter(event => event.chatId === chatId)
        .map(event => event.listName), ...changedListsSince(beforeListAction)];
      if (llmFirst && changed.length) return deliverUpdatedLists(changed);
      return await deliverListAction(listAction);
    }
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
        recapMessages = [{ text: "הסיכום לא זמין כרגע. לא אציג לך נתונים לא בדוקים." }];
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
    const beforeRecordAction = structuredClone(store.lists[chatId] ?? {});
    const recordActionResult = await collectListReceipts(() => recordOperation(async () => {
      await assertPermission();
      assertActive();
      return await prepareReminderDeletion(store, chatId, text, { referenceText })
        ?? await handleRecordViewAction(store, chatId, text);
    }));
    const recordAction = recordActionResult.result;
    if (recordAction) {
      const changed = [...recordActionResult.events.filter(event => event.chatId === chatId)
        .map(event => event.listName), ...changedListsSince(beforeRecordAction)];
      if (llmFirst && changed.length) return deliverUpdatedLists(changed);
      assertActive();
      await saveConversation(chatId, text, recordAction.text);
      await telegram.sendMessage(chatId, recordAction.text, recordAction.options);
      if (recordAction.menu && !llmFirst) await telegram.sendMessage(chatId, recordAction.menu.text, recordAction.menu.options);
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
        await telegram.sendMessage(chatId, "הסיכום לא זמין כרגע. לא אציג לך נתונים לא בדוקים.");
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
    const previousPresentation = reminderPresentationSnapshot(store, chatId);
    let committedReminders = [];
    let initialIntentAvailable = Boolean(interpreted);
    const currentAnalyzer = interpreted ? async (request, context) => {
      if (initialIntentAvailable && request === text) {
        initialIntentAvailable = false;
        return interpreted.intent;
      }
      return analyzeIncoming(request, { ...context, recentConversation: conversationHistory,
        currentDayFromSql: interpreted.context.currentDayFromSql });
    } : undefined;
    const collected = telegramDaily
      ? { events: [], result: formatTelegramDailySummary(dailySnapshot, chatId, dailySummaryTime) }
      : await collectListReceipts(async () => {
        const writes = await collectReminderReceipts(() => assistant(store, chatId, text, currentAnalyzer, history,
          { assertPermission, telegramResponseStyle, referenceText,
            resolvedListIntent: llmFirst && interpreted?.intent.type === "add-items"
              ? interpreted.intent : undefined }));
        committedReminders = writes.events.filter(event => event.chatId === chatId).map(event => event.id);
        return writes.result;
      });
    const batchReceipts = collected.events.filter(event => event.chatId === chatId && event.batchDeletion);
    if (batchReceipts.length) return deliverBatchDeletion({
      text: "הסרתי את הפריטים המבוקשים ✅",
      listNames: [...new Set(batchReceipts.map(event => event.listName))],
    });
    const receipt = collected.events.filter(event => event.chatId === chatId).at(-1);
    if (llmFirst && receipt) return deliverUpdatedLists(collected.events
      .filter(event => event.chatId === chatId).map(event => event.listName));
    const reminderChanges = telegramResponseStyle && !telegramDaily
      ? changedReminderRecords(store, chatId, previousPresentation)
        .filter(record => committedReminders.includes(record.id)) : [];
    const reminderMutation = renderReminderMutation(store, chatId, reminderChanges, previousPresentation,
      { titleCorrection: collected.result === "הבנתי, תוקן!" });
    // A short addition receipt is presentation only, and only follows a
    // committed list mutation. Internal callers retain their default presentation.
    const previousIds = new Set((receipt?.before ?? []).map(item => item.id));
    const addedItems = receipt?.after?.some(item => !previousIds.has(item.id));
    const additionRequest = parseNaturalTaskAction(text)?.type === "add-items"
      || /^(?:(?:אחי|אח שלי)[, ]+)?(?:בבקשה\s+)?(?:תוסיף|הוסף|הוסיפי|תוסיפי|להוסיף|תכניס|הכנס)\s/u.test(text.trim());
    const shortAddition = telegramResponseStyle && Array.isArray(receipt?.after)
      && receipt.after.length > 0 && (addedItems || additionRequest);
    // Model prose is cleaned at its own boundary. Persisted list/schedule text
    // must never be processed as generic courtesy wording.
    let response = telegramDaily ? collected.result
      : receipt ? listReceiptText(receipt) : collected.result;
    if (shortAddition) {
      response = addedItems ? "נוסף לרשימה"
        : JSON.stringify(receipt.before) !== JSON.stringify(receipt.after)
          ? "הרשימה עודכנה" : "כבר קיים ברשימה";
    }
    if (reminderMutation) response = llmFirst
      ? (reminderChanges.some(record => previousPresentation.has(record.id)) ? "מעודכן" : "רשמתי")
      : reminderMutation.conversationText;
    if (llmFirst && (typeof response !== "string" || !response.trim())) {
      try {
        const repaired = await interpretIncoming(store, chatId, text, {
          readSnapshot: readLiveConversationSnapshot, history: conversationHistory,
          analyze: (request, context) => analyzeIncoming(request, { ...context,
            readOnlyReplyRepair: true,
            instruction: "המסלול המקומי לא הפיק תשובה. ענה בשיחה לפי ההקשר; אל תמציא אישור פעולה ואל תבצע שינוי נוסף.",
          }),
          now: summaryNow(), referenceText, assertPermission, assertActive,
        });
        if (!conversationalTypes.has(repaired.intent.type)) throw new AiServiceError("invalid_response");
        response = repaired.intent.response;
      } catch (error) { error.suppressDefaultReply = true; throw error; }
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
    if (telegramResponseStyle && !llmFirst && !telegramDaily && !isSummaryRequest(text)) {
      const freshReminder = reminderChanges.length === 1 ? store.reminders.find(item =>
        item.chatId === chatId && item.id === reminderChanges[0].id) : null;
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
            callback_data: `v:u:${selected.key}:${scope}:c:0`, style: "success" });
          directDetails = { reply_markup: { inline_keyboard: [actions] } };
        }
      }
    }
    const textOnly = shortAddition || (llmFirst && Boolean(receipt || reminderMutation)) || isDailySummaryRequest(text)
      || (receipt && shoppingClosed(displayStore, chatId, receipt.listName))
      || (telegramResponseStyle && Boolean(parseContextualSchedule(text, history, summaryNow())))
      || (telegramResponseStyle && isSummaryRequest(text));
    const menu = textOnly ? null : receipt ? recordMenuForList(displayStore, chatId, receipt.listName)
      : recordMenuForRequest(store, chatId, text)
        ?? (parseNaturalTaskAction(text) ? recordMenuForList(store, chatId,
          store.lastListActions?.[chatId]?.listName ?? "משימות") : null);
    if ((menu && !directDetails) || (reminderMutation && reminderChanges.length > 1)
      || isWeeklyScheduleQuery(text) || weeklyScheduleQueryDays(text)) await recordOperation(async () => {
      assertActive();
      await assertPermission();
      await clearRecordView(store, chatId);
    });
    const listRead = !receipt && ["show-list", "list-lists"].includes(parseRecordQuery(text)?.type);
    const deliveries = llmFirst
      ? [[menu && !menu.keepResponse ? menu.text : response, menu && !menu.keepResponse ? { parse_mode: "HTML" } : undefined]]
      : directDetails ? [[response, directDetails]]
      : reminderMutation ? [[reminderMutation.text, reminderMutation.options]]
      : menuDelivery(menu, response, { summary: isSummaryRequest(text), listOnly: listRead });
    for (const [body, options] of deliveries) {
      assertActive();
      if (options) {
        if (reminderMutation && options.reply_markup) {
          await refreshPreviousReminderMenu(store, telegram, chatId, reminderMutation.options.reply_markup);
        }
        const delivered = await telegram.sendMessage(chatId, body, options);
        if (!directDetails && options.reply_markup && (reminderMutation || menu?.text?.includes("רשימת התזכורות"))) {
          await rememberReminderMenu(store, chatId, delivered);
        }
      }
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
