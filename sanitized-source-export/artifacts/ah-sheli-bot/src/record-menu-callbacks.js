import { renderRecordMenu, renderRecordDetails } from "./record-menu.js";
import { saveStore } from "./store.js";
import { handleRecordViewAction } from "./record-view-actions.js";

const scopePattern = "(s|a|r|t|n|l[A-Za-z0-9_-]{22})";
const pagePattern = new RegExp(`^v:p:${scopePattern}:([ca]):(\\d{1,7})$`, "u");
const itemPattern = new RegExp(`^v:[iu]:([lr][A-Za-z0-9_-]{22}):${scopePattern}:([ca]):(\\d{1,7})$`, "u");
const actionPattern = new RegExp(`^v:([dxc]):([lr][A-Za-z0-9_-]{22}):${scopePattern}:([ca]):(\\d{1,7})(?::([a-z0-9]{1,11}))?$`, "u");

// Navigation records the displayed target, without changing any saved item.
export async function handleRecordMenuCallback(store, telegram, query, {
  ownerChatId, assertActive = () => {},
  persist = saveStore,
} = {}) {
  if (typeof query?.data !== "string" || !query.data.startsWith("v:")
    || typeof query.id !== "string") return { ignored: true };
  const message = query.message;
  const answer = async (text, showAlert = false) => {
    assertActive();
    await telegram.call("answerCallbackQuery", {
      callback_query_id: query.id, ...(text ? { text, show_alert: showAlert } : {}),
    });
  };
  if (!ownerChatId || String(query.from?.id) !== ownerChatId || query.from?.is_bot
    || message?.chat?.type !== "private" || String(message.chat.id) !== ownerChatId
    || message.from?.is_bot !== true || !Number.isSafeInteger(message.message_id)
    || message.message_id <= 0) {
    await answer("התפריט הזה פרטי לבעל הבוט.", true);
    return { denied: true };
  }
  const action = actionPattern.exec(query.data);
  if (action) {
    const pending = store.recordViews?.[ownerChatId];
    if (action[1] === "c" && (!pending?.awaitingDelete || pending.key !== action[2])) {
      await answer("פתח את התזכורת מחדש לפני מחיקה.");
      return { stale: true };
    }
    const selectedView = {
      key: action[2], scope: action[3], mode: action[4], offset: Number(action[5]), awaitingDelete: action[1] === "c",
      ...(action[6] ? { completionDueAt: parseInt(action[6], 36) } : {}),
    };
    if (action[1] === "d" && action[2].startsWith("r") && !action[6]) {
      await answer("פתח את התזכורת מחדש כדי לסמן את המועד הנכון.");
      return { stale: true };
    }
    const result = await handleRecordViewAction(store, ownerChatId,
      action[1] === "d" ? "בוצע" : action[1] === "c" ? "כן" : "מחק", { persist, selectedView });
    // No success toast or chat receipt is sent before persistence resolves.
    try { await answer(); }
    catch { console.warn("[Ah Sheli] Record action saved; callback acknowledgement failed."); }
    assertActive();
    try { await telegram.sendMessage(ownerChatId, result.text, result.options); }
    catch { console.warn("[Ah Sheli] Record action resolved; chat receipt delivery failed."); }
    if (result.menu) {
      try {
        await telegram.call("editMessageText", {
          chat_id: ownerChatId, message_id: message.message_id, text: result.menu.text,
          parse_mode: result.menu.options.parse_mode, reply_markup: result.menu.options.reply_markup,
        });
      } catch { console.warn("[Ah Sheli] Record action resolved; menu refresh failed."); }
    }
    return { acted: true };
  }
  const page = pagePattern.exec(query.data);
  const item = itemPattern.exec(query.data);
  const view = page ? renderRecordMenu(store, ownerChatId, page[1], page[2], Number(page[3]))
    : item ? renderRecordDetails(store, ownerChatId, item[1], item[2], item[3], Number(item[4])) : null;
  if (!view) {
    await answer("הפריט כבר לא מופיע כאן. אפשר לבקש את הרשימה מחדש.", true);
    return { stale: true };
  }
  if (item && query.data.startsWith("v:u:")) view.text += "\nלעדכון, כתוב מה לשנות.";
  await answer();
  assertActive();
  // Clear the previous target durably before changing the visible message.
  // If either Telegram or the subsequent context save fails, an old target
  // must never remain actionable behind different details on the screen.
  const recordViews = Object.assign(Object.create(null), store.recordViews);
  delete recordViews[ownerChatId];
  if (store.recordViews?.[ownerChatId]) {
    await persist({ ...store, recordViews });
    store.recordViews = recordViews;
  }
  let unchanged = false;
  try {
    await telegram.call("editMessageText", {
      chat_id: ownerChatId, message_id: message.message_id, text: view.text,
      parse_mode: view.options.parse_mode, reply_markup: view.options.reply_markup,
    });
  } catch (error) {
    if (!(error.deliveryRejected && /message is not modified/iu.test(error.message))) throw error;
    unchanged = true;
  }
  const nextViews = Object.assign(Object.create(null), store.recordViews);
  if (item) nextViews[ownerChatId] = {
    key: item[1], scope: item[2], mode: item[3], offset: Number(item[4]), awaitingDelete: false,
    ...(view.completionDueAt != null ? { completionDueAt: view.completionDueAt } : {}),
  };
  assertActive();
  await persist({ ...store, recordViews: nextViews });
  store.recordViews = nextViews;
  return unchanged ? { unchanged: true } : { displayed: true };
}
