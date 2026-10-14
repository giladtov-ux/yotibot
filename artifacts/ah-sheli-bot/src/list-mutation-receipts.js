import { AsyncLocalStorage } from "node:async_hooks";
import { listItemLabel } from "./shopping-emoji.js";

// Presentation-only observer. Writers still await and verify the same database
// transaction; this scope cannot authorize, perform, or acknowledge a write.
const receipts = new AsyncLocalStorage();

export async function collectListReceipts(work) {
  const events = [];
  const result = await receipts.run(events, work);
  return { result, events };
}

export function recordListReceipt(chatId, listName, before, after) {
  const events = receipts.getStore();
  if (events) events.push(structuredClone({ chatId, listName, before: before ?? [], after }));
}

export function listReceiptText(receipt) {
  const { before, after, listName } = receipt;
  if (!after) return `🗑️ מחקתי את הרשימה “${listName}”.`;
  const byId = new Map(before.map(item => [item.id, item]));
  const remaining = new Set(after.map(item => item.id));
  const added = after.filter(item => !byId.has(item.id));
  const removed = before.filter(item => !remaining.has(item.id));
  const completed = after.filter(item => item.checked && byId.has(item.id) && !byId.get(item.id).checked);
  const changed = after.filter(item => byId.has(item.id) && item.text !== byId.get(item.id).text);
  const messages = [];
  const labels = items => items.map(item => listItemLabel(listName, item.text)).join(", ");
  if (added.length) messages.push(`✅ הוספתי: ${labels(added)}.`);
  if (removed.length) messages.push(`🗑️ הסרתי: ${labels(removed)}.`);
  if (completed.length) messages.push(`✅ מעולה! סומן כבוצע: ${labels(completed)}.`);
  if (changed.length) messages.push(`✏️ עדכנתי: ${labels(changed)}.`);
  return messages.join("\n") || "הרשימה מעודכנת.";
}
