import { menuRecords, renderRecordMenu } from "./record-menu.js";
import { saveStore } from "./store.js";
import { completeRecord } from "./record-completion.js";
import { bindItemIntent } from "./task-understanding.js";
import { shoppingClosed } from "./shopping-lifecycle.js";

const deletion = /^(?:מחק|למחוק|תמחק|תמחקי|תוריד|תסיר|הסר|בטל|תבטל)(?:\s+(?:את\s+)?(?:זה|הפריט|המשימה|התזכורת|אותו|אותה))?[.!? ]*$/u;
const affirmative = /^(?:כן|כן בבקשה|כן מחק|כן תמחק|אשר|מאשר|מאשרת|בטח|בהחלט)[.! ]*$/u;
const negative = /^(?:לא|לא זו|לא תודה|בטל|ביטול|עזוב|לא משנה)[.! ]*$/u;
export const isRecordCompletion = text =>
  /^(?:✅\s*)?(?:בוצע|בוצעתי|עשיתי|סיימתי|סמן\s+(?:כ)?בוצע|סמן\s+וי|done)(?:\s+(?:את\s+)?(?:זה|אותו|אותה|הפריט|המשימה|התזכורת))?[\s.!✅]*$/iu.test(text.trim());

export async function handleRecordViewAction(store, chatId, text, {
  persist = saveStore, selectedView, now = Date.now,
} = {}) {
  let view = selectedView ?? store.recordViews?.[chatId];
  const request = text.trim();
  const completing = isRecordCompletion(request);
  if (!view && completing) {
    const target = bindItemIntent(store, chatId, { type: "mark-item" });
    const record = target.type && menuRecords(store, chatId, "s").find(item =>
      item.kind === "item" && item.name === target.listName && item.id === target.itemId);
    if (record) view = { key: record.key, scope: "s", mode: "c", offset: 0, awaitingDelete: false };
  }
  if (!view) return completing ? { text: "איזו משימה לסמן כבוצע? פתח אותה מהרשימה." } : null;
  const recordViews = Object.assign(Object.create(null), store.recordViews);
  if (!completing && !deletion.test(request)
    && !(view.awaitingDelete && (affirmative.test(request) || negative.test(request)))) {
    // An unrelated turn is not consent; a later "yes" must not revive it.
    if (view.awaitingDelete) {
      recordViews[chatId] = { ...view, awaitingDelete: false };
      await persist({ ...store, recordViews });
      store.recordViews = recordViews;
    }
    return null;
  }
  const returnMenu = () => renderRecordMenu(store, chatId, view.scope, view.mode, view.offset);
  if (view.awaitingDelete && negative.test(request)) {
    recordViews[chatId] = { ...view, awaitingDelete: false };
    await persist({ ...store, recordViews });
    store.recordViews = recordViews;
    return { text: "לא מחקתי דבר." };
  }
  // Resolve the stable key against this owner's full records, not a page index
  // or a now-expired today/tomorrow filter. Reordering cannot change the target.
  const record = menuRecords(store, chatId, "s").find(item => item.key === view.key);
  if (!record) {
    delete recordViews[chatId];
    await persist({ ...store, recordViews });
    store.recordViews = recordViews;
    return { text: "הפריט כבר לא נמצא ברשימה.", menu: returnMenu() };
  }
  if (completing) {
    const result = await completeRecord(store, chatId, record, view, { persist, now });
    return shoppingClosed(store, chatId, record.name)
      ? { text: "הקניות הושלמו והרשימה נסגרה ✅" }
      : { ...result, menu: returnMenu() };
  }
  if (record.kind === "reminder" && record.ongoing && !view.awaitingDelete) {
    recordViews[chatId] = { ...view, awaitingDelete: true };
    const pendingReminderSelections = { ...store.pendingReminderSelections };
    delete pendingReminderSelections[chatId];
    await persist({ ...store, recordViews, pendingReminderSelections });
    store.recordViews = recordViews;
    store.pendingReminderSelections = pendingReminderSelections;
    return { text: `למחוק את “${record.text}” ואת כל החזרות שלה?`,
      options: deletionConfirmationOptions(view) };
  }
  delete recordViews[chatId];
  const pendingReminderSelections = { ...store.pendingReminderSelections };
  delete pendingReminderSelections[chatId];
  const candidate = { ...store, recordViews, pendingReminderSelections };
  if (record.kind === "item") {
    // Hash matching also binds the list and item ID, so identical text in other
    // lists or another user's data can never become the deletion target.
    const items = store.lists[chatId][record.name];
    if (typeof record.id !== "string") throw new Error("The selected item has no stable identity.");
    candidate.lists = Object.assign(Object.create(null), store.lists, {
      [chatId]: Object.assign(Object.create(null), store.lists[chatId], {
        [record.name]: items.filter(item => item.id !== record.id),
      }),
    });
  } else {
    // Resolve the same key through the reminder-only menu to recover its ID.
    const id = menuRecords(store, chatId, "r").find(item => item.key === view.key)?.id;
    if (!id) throw new Error("The selected reminder no longer has a stable identity.");
    candidate.reminders = store.reminders.filter(item => !(item.chatId === chatId && item.id === id));
    candidate.savedSchedules = (store.savedSchedules ?? []).map(schedule => schedule.chatId === chatId
      ? { ...schedule, entries: schedule.entries.filter(entry => entry.reminderId !== id) } : schedule)
      .filter(schedule => schedule.chatId !== chatId || schedule.entries.length);
  }
  // The existing state + reminder-table transaction is the success boundary.
  // Failure leaves the live target and records intact for a safe retry.
  await persist(candidate, {
    verifyList: record.kind === "item" ? { chatId, listName: record.name } : null,
  });
  store.recordViews = candidate.recordViews;
  store.pendingReminderSelections = candidate.pendingReminderSelections;
  if (candidate.lists !== store.lists) store.lists = candidate.lists;
  if (candidate.reminders !== store.reminders) store.reminders = candidate.reminders;
  if (candidate.savedSchedules !== store.savedSchedules) store.savedSchedules = candidate.savedSchedules;
  return { text: "הפריט נמחק", menu: returnMenu() };
}

export function deletionConfirmationOptions(view) {
  return { reply_markup: { inline_keyboard: [[
    { text: "מחק", callback_data: `v:c:${view.key}:${view.scope}:${view.mode}:${view.offset}`, style: "danger" },
    { text: "לא זו", callback_data: `v:p:${view.scope}:${view.mode}:${view.offset}` },
  ]] } };
}

export async function clearRecordView(store, chatId) {
  if (!store.recordViews?.[chatId]) return;
  const recordViews = Object.assign(Object.create(null), store.recordViews);
  delete recordViews[chatId];
  await saveStore({ ...store, recordViews });
  store.recordViews = recordViews;
}
