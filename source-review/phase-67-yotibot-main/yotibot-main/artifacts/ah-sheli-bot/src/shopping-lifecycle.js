import { isShoppingList } from "./shopping-emoji.js";

export function updateShoppingStatus(candidate, chatId, name, now = Date.now()) {
  if (!isShoppingList(name)) return;
  const statuses = { ...(candidate.listStatuses ?? {}) };
  const owned = { ...(statuses[chatId] ?? {}) };
  const items = candidate.lists[chatId]?.[name];
  if (!items) delete owned[name];
  else if (items.length && items.every(item => item.checked)) {
    owned[name] = { status: "completed", archivedAt: owned[name]?.archivedAt ?? now };
  } else if (items.some(item => !item.checked)) owned[name] = { status: "open" };
  statuses[chatId] = owned;
  candidate.listStatuses = statuses;
}

export const shoppingClosed = (store, chatId, name) =>
  isShoppingList(name) && store.listStatuses?.[chatId]?.[name]?.status === "completed";
