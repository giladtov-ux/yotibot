import { getJerusalemDateString } from "./time.js";
import { randomUUID } from "node:crypto";
import { CORE_LIST_NAMES, CORE_SCHEDULE_GROUPS as groups } from "./core-contract.js";

const clock = entry => `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`;

// A projection of current business state, not a schema migration or a replay
// of old conversations. It preserves stable weekly identities and all tasks.
export function currentStateProjection(store, chatId, now = Date.now()) {
  const ownSources = (store.savedSchedules ?? []).filter(item => item.chatId === chatId);
  const definitions = new Map();
  for (const source of ownSources) for (const entry of source.entries ?? []) {
    if (entry.weekdays?.length) definitions.set(entry.reminderId, structuredClone(entry));
  }
  const today = getJerusalemDateString(new Date(now));
  const removed = [];
  const reminders = store.reminders.filter(item => {
    if (item.chatId !== chatId || definitions.has(item.id)) return true;
    const expired = getJerusalemDateString(new Date(item.dueAt)) < today;
    if (item.sentAt || expired) { removed.push(item.id); return false; }
    return true;
  }).map(item => item.chatId === chatId && item.trackingListName
    && !CORE_LIST_NAMES.includes(item.trackingListName)
    ? { ...item, trackingListName: "משימות" } : item);
  const currentIds = new Set(reminders.filter(item => item.chatId === chatId).map(item => item.id));
  const entries = [...definitions.values()].filter(entry => currentIds.has(entry.reminderId))
    .sort((a, b) => clock(a).localeCompare(clock(b)) || a.reminderId.localeCompare(b.reminderId));
  const createdAt = ownSources.length ? Math.min(...ownSources.map(item => item.createdAt ?? now)) : now;
  const savedSchedules = [
    ...(store.savedSchedules ?? []).filter(item => item.chatId !== chatId),
    ...groups.map(group => {
      const selected = entries.filter(entry => entry.weekdays.some(day => group.days.includes(day)));
      return { id: `current-${chatId}-${group.suffix}`, chatId, createdAt,
        source: `${group.name}\n${selected.map(entry => `${clock(entry)} ${entry.text}`).join("\n")}`,
        entries: selected };
    }),
  ];
  const previousLists = store.lists[chatId] ?? {};
  const tasks = [...(previousLists["משימות"] ?? [])];
  const seen = new Set(tasks.map(item => item.id));
  // Preserve contents of custom lists rather than silently destroying tasks.
  for (const [name, items] of Object.entries(previousLists)) {
    if (name === "משימות" || name === "קניות") continue;
    for (const item of items) {
      if (tasks.some(existing => existing.id === item.id && existing.text === item.text)) continue;
      const saved = seen.has(item.id) ? { ...item, id: randomUUID() } : { ...item };
      tasks.push(saved); seen.add(saved.id);
    }
  }
  const lists = { ...store.lists, [chatId]: { משימות: tasks, קניות: [...(previousLists["קניות"] ?? [])] } };
  return { reminders, savedSchedules, lists, removed };
}

export async function enforceCurrentState(store, chatId, persist, now = Date.now()) {
  if (!chatId) return { removed: 0 };
  const next = currentStateProjection(store, chatId, now);
  const unchanged = store.currentStateOnly === true
    && !next.removed.length && JSON.stringify(next.savedSchedules) === JSON.stringify(store.savedSchedules)
    && JSON.stringify(next.lists) === JSON.stringify(store.lists);
  if (unchanged) return { removed: 0 };
  // Only automatic retirement of a confirmed one-off may keep its follow-up
  // eligible without an active job. Absence alone is not proof of retirement.
  const previous = store.reminderCheckIns?.[chatId];
  const pending = { ...previous?.pending };
  let retainedDelivery = false;
  for (const reminder of store.reminders) {
    if (reminder.chatId !== chatId || !next.removed.includes(reminder.id)
      || reminder.repeatEveryMs || !Number.isFinite(reminder.sentAt)
      || reminder.lastAttemptAt) continue;
    const record = pending[reminder.id];
    const receipt = reminder.telegramDeliveries?.[record?.key];
    if (!record || record.reminderId !== reminder.id
      || record.id !== `${reminder.id}:${record.key}`
      || record.key !== reminder.dueAt.toString(36)
      || record.dueAt !== reminder.dueAt
      || receipt?.state !== "sent" || receipt.informational
      || !Number.isSafeInteger(receipt.messageId) || receipt.messageId <= 0
      || !Number.isFinite(receipt.sentAt) || reminder.sentAt < receipt.sentAt
      || record.delivery?.state !== "sent"
      || record.delivery.messageId !== receipt.messageId
      || record.delivery.sentAt !== receipt.sentAt) continue;
    pending[reminder.id] = { ...record, retainedOneOffDelivery: true };
    retainedDelivery = true;
  }
  const candidate = { ...store, reminders: next.reminders, savedSchedules: next.savedSchedules,
    lists: next.lists, currentStateOnly: true,
    ...(retainedDelivery ? { reminderCheckIns: { ...store.reminderCheckIns,
      [chatId]: { ...previous, pending } } } : {}) };
  await persist(candidate, { verifyRetention: { chatId, removed: next.removed },
    ...(retainedDelivery ? { verifyCheckIns: { chatId } } : {}) });
  store.reminders = candidate.reminders;
  store.savedSchedules = candidate.savedSchedules;
  store.lists = candidate.lists;
  if (retainedDelivery) store.reminderCheckIns = candidate.reminderCheckIns;
  store.currentStateOnly = true;
  return { removed: next.removed.length };
}
