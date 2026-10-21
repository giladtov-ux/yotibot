import { escapeMenuHtml } from "./record-menu.js";

// Keep the complete plain-text data response, not just shortened button labels.
// Small replies fit into one Telegram message; large replies retain the existing
// plain-text splitter so no HTML tag or Unicode character is cut in half.
export function menuDelivery(menu, response, { summary = false, listOnly = false } = {}) {
  if (!menu) return [[response]];
  if (listOnly) return [[menu.text, menu.options]];
  if (summary) return [[menu.text, menu.options], [response]];
  const combined = `${menu.text}\n\n${escapeMenuHtml(response)}`;
  if (combined.length <= 3900) return [[combined, menu.options]];
  return [[menu.text, menu.options], [response]];
}
