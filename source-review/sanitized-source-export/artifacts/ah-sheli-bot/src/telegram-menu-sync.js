import { saveStore } from "./store.js";

export async function refreshPreviousReminderMenu(store, telegram, chatId, markup, text = null) {
  const previous = store.telegramMenuMessages?.[chatId];
  if (!previous || typeof telegram.call !== "function") return;
  try {
    await telegram.call(text ? "editMessageText" : "editMessageReplyMarkup", {
      chat_id: chatId, message_id: previous.messageId, reply_markup: markup,
      ...(text ? { text, parse_mode: "HTML" } : {}),
    });
  } catch {
    // Presentation failure never rolls back a committed action or causes a
    // replay. The current reply still carries the new authoritative menu.
    console.warn("[Ah Sheli] Previous reminder menu could not be refreshed.");
  }
}

export async function rememberReminderMenu(store, chatId, message) {
  if (!Number.isSafeInteger(message?.message_id)) return;
  const telegramMenuMessages = { ...store.telegramMenuMessages, [chatId]: { messageId: message.message_id } };
  try {
    await saveStore({ ...store, telegramMenuMessages });
    store.telegramMenuMessages = telegramMenuMessages;
  } catch {
    console.warn("[Ah Sheli] Reminder menu reference could not be saved.");
  }
}
