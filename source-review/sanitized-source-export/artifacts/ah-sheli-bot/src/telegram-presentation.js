import { cleanTelegramText } from "./conversation-style.js";

// The only new interactive message is the 08:00 brief. Legacy callback
// handlers remain valid for already-delivered messages; they cannot recreate
// a keyboard through an edit or an ordinary response.
export function isMorningKeyboard(markup) {
  const rows = markup?.inline_keyboard;
  if (!Array.isArray(rows) || rows.length !== 2 || rows.some(row => row.length !== 1)) return false;
  const [priority, calendar] = rows.map(row => row[0]);
  const token = /^mb:p:([A-Za-z0-9_-]{16})$/u.exec(priority.callback_data ?? "")?.[1];
  return Boolean(token && priority.text === "אני רוצה תעדוף"
    && calendar.text === "📅 היומן של היום" && calendar.callback_data === `mb:c:${token}`);
}

export function conversationalPayload(method, payload) {
  if (!["sendMessage", "editMessageText", "editMessageReplyMarkup"].includes(method)) return payload;
  if (typeof payload.text === "string") payload = { ...payload, text: cleanTelegramText(payload.text) };
  if (!payload.reply_markup) return payload;
  if (method === "sendMessage" && isMorningKeyboard(payload.reply_markup)) return payload;
  const { reply_markup: markup, ...clean } = payload;
  // Keep account/calendar connection links usable as text, not buttons.
  const links = (markup.inline_keyboard ?? []).flat()
    .filter(button => typeof button.url === "string")
    .map(button => `${button.text}: ${button.url}`);
  if (links.length && typeof clean.text === "string") clean.text += `\n${[...new Set(links)].join("\n")}`;
  if (method.startsWith("edit")) clean.reply_markup = { inline_keyboard: [] };
  return clean;
}
