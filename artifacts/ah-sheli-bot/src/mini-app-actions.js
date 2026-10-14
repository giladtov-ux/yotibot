import { createHmac, timingSafeEqual } from "node:crypto";
import { getChatLists, mutateList, mutateReminderState, saveStore } from "./store.js";
import { parseJerusalemDateTime } from "./time.js";
import { weeklyEntryFor, nextWeeklyDueAt } from "./weekly-schedules.js";
import { nextIntervalDueAt } from "./reminder-intervals.js";
import { occurrenceKey } from "./reminder-actions.js";

export function verifyMiniAppRequest(body, signature, token, now = Date.now()) {
  if (!body || typeof body !== "object" || !/^[1-9]\d{0,15}$/u.test(body.userId ?? "")
    || !Number.isSafeInteger(body.timestamp) || Math.abs(now - body.timestamp) > 30_000
    || typeof signature !== "string" || !/^[a-f0-9]{64}$/u.test(signature) || !token) return false;
  const expected = createHmac("sha256", token).update("AhSheliMiniApp\n")
    .update(JSON.stringify(body)).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function invalid(message = "הפרטים לא תקינים. בדוק אותם ונסה שוב.") {
  throw Object.assign(new Error(message), { status: 400 });
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) invalid();
  return value.trim();
}
function detachWeekly(candidate, id) {
  candidate.savedSchedules = (candidate.savedSchedules ?? []).map(schedule => ({
    ...schedule, entries: schedule.entries.filter(entry => entry.reminderId !== id),
  })).filter(schedule => schedule.entries.length);
}
function clock(input) {
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23
    || !Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) invalid();
  if (input.weekdays !== undefined && (!Array.isArray(input.weekdays)
    || input.weekdays.length > 7 || new Set(input.weekdays).size !== input.weekdays.length
    || input.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) invalid();
}

// Invoked only inside the bot's existing update + reminder operation queues.
// Never create a second state writer in the public API process.
export async function applyMiniAppAction(store, chatId, input, now = Date.now()) {
  if (!input || !/^[a-f0-9-]{36}$/iu.test(input.requestId ?? "")
    || !["create", "update", "delete", "complete"].includes(input.action)) invalid();
  if (input.entity === "list" || input.entity === "item") {
    if (input.entity === "item" && input.dueAt !== undefined && input.dueAt !== null
      && (!Number.isSafeInteger(input.dueAt) || input.dueAt < 0 || input.dueAt > 8_640_000_000_000_000)) invalid();
    const name = text(input.listName, 60);
    if (["__proto__", "constructor", "prototype"].includes(name)) invalid();
    const lists = getChatLists(store, chatId);
    if (input.entity === "list") {
      if (input.action === "create") {
        if (Object.hasOwn(lists, name)) return;
        await mutateList(store, chatId, name, () => { lists[name] = []; });
      } else if (input.action === "delete") {
        if (!Object.hasOwn(lists, name)) return;
        const nextLists = structuredClone(store.lists);
        delete nextLists[chatId][name];
        const lastListActions = structuredClone(store.lastListActions ?? {});
        if (lastListActions[chatId]?.listName === name) delete lastListActions[chatId];
        await saveStore({ ...store, lists: nextLists, lastListActions });
        store.lists = nextLists;
        store.lastListActions = lastListActions;
      } else invalid();
      return;
    }
    if (!Object.hasOwn(lists, name)) invalid("הרשימה הזו כבר לא קיימת. רענן את המסך.");
    const items = lists[name];
    if (input.action === "create") {
      const value = text(input.text, 200);
      if (items.some(item => item.id === input.requestId)) return;
      await mutateList(store, chatId, name, () => {
        items.push({ id: input.requestId, text: value, checked: false, createdAt: now,
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}) });
      });
      return;
    }
    const item = items.find(record => record.id === input.id);
    if (!item) {
      if (input.action === "delete") return;
      invalid("הפריט הזה כבר לא קיים. רענן את המסך.");
    }
    if (input.checked !== undefined && typeof input.checked !== "boolean") invalid();
    const updatedText = input.text === undefined ? item.text : text(input.text, 200);
    await mutateList(store, chatId, name, () => {
      if (input.action === "delete") lists[name] = items.filter(record => record.id !== item.id);
      else {
        item.text = updatedText;
        if (input.dueAt !== undefined) item.dueAt = input.dueAt;
        if (input.action === "complete") item.checked = input.checked ?? true;
        else if (input.checked !== undefined) item.checked = input.checked;
      }
    }, false, false, { completedAt: now });
    return;
  }
  if (input.entity !== "reminder") invalid();
  const existing = store.reminders.find(record => record.id === input.id && record.chatId === chatId);
  if (input.action !== "create" && !existing) {
    if (input.action === "delete") return;
    invalid("התזכורת הזו כבר לא קיימת. רענן את המסך.");
  }
  if (input.action === "delete") {
    await mutateReminderState(store, candidate => {
      candidate.reminders = candidate.reminders.filter(record => record.id !== existing.id);
      detachWeekly(candidate, existing.id);
    });
    return;
  }
  if (input.action === "complete") {
    if (Object.values(existing.telegramDeliveries ?? {})
      .some(receipt => receipt.miniAppRequestId === input.requestId)) return;
    await mutateReminderState(store, candidate => {
      const updated = structuredClone(existing);
      updated.telegramDeliveries ??= {};
      const pending = Object.entries(updated.telegramDeliveries)
        .filter(([, receipt]) => ["pending", "sent"].includes(receipt.state))
        .sort(([a], [b]) => parseInt(b, 36) - parseInt(a, 36));
      const key = pending[0]?.[0] ?? occurrenceKey(updated.dueAt);
      if (updated.telegramDeliveries[key]?.state === "done") return;
      const receipt = updated.telegramDeliveries[key] ?? {};
      updated.telegramDeliveries[key] = {
        ...receipt, state: "done", completedAt: now, miniAppRequestId: input.requestId,
      };
      delete updated.telegramDeliveries[key].nagAttemptAt;
      delete updated.telegramDeliveries[key].nagRetryAt;
      delete updated.telegramDeliveries[key].pendingNagToken;
      const weekly = weeklyEntryFor(candidate, updated.id);
      if (occurrenceKey(updated.dueAt) === key && !updated.sentAt) {
        if (weekly) updated.dueAt = nextWeeklyDueAt(weekly, Math.max(now, updated.dueAt) + 1);
        else if (updated.repeatEveryMs
          && (updated.remainingOccurrences == null || updated.remainingOccurrences > 1)) {
          updated.dueAt = nextIntervalDueAt(updated.dueAt, updated.repeatEveryMs, Math.max(now, updated.dueAt));
          if (updated.remainingOccurrences != null) updated.remainingOccurrences--;
        } else {
          updated.sentAt = now;
          if (updated.remainingOccurrences != null) updated.remainingOccurrences = 0;
        }
        delete updated.lastAttemptAt;
      }
      candidate.reminders = candidate.reminders.map(record => record.id === updated.id ? updated : record);
    });
    return;
  }
  clock(input);
  const value = text(input.text, 300);
  const weekdays = input.weekdays ?? [];
  // A client-supplied request UUID makes retrying an uncertain creation idempotent.
  const id = input.action === "create" ? input.requestId : existing.id;
  if (input.action === "create" && store.reminders.some(record => record.id === id)) {
    if (store.reminders.some(record => record.id === id && record.chatId === chatId)) return;
    invalid();
  }
  const entry = { reminderId: id, text: value, weekdays, hour: input.hour, minute: input.minute };
  const dueAt = weekdays.length ? nextWeeklyDueAt(entry, now, { includeCurrentMinute: true })
    : parseJerusalemDateTime(input.date ?? "", `${String(input.hour).padStart(2, "0")}:${String(input.minute).padStart(2, "0")}`, { now });
  await mutateReminderState(store, candidate => {
    const record = {
      ...(existing ? structuredClone(existing) : {}),
      id, chatId, text: value, dueAt, createdAt: existing?.createdAt ?? now,
    };
    delete record.sentAt;
    delete record.lastAttemptAt;
    if (weekdays.length) {
      delete record.repeatEveryMs;
      delete record.remainingOccurrences;
    }
    if (existing) candidate.reminders = candidate.reminders.map(item => item.id === id ? record : item);
    else candidate.reminders.push(record);
    detachWeekly(candidate, id);
    if (weekdays.length) candidate.savedSchedules.push({
      id: `mini-app:${id}`, chatId, source: value, entries: [entry],
    });
  });
}
