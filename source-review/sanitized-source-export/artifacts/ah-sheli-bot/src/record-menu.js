import { createHash } from "node:crypto";
import { parseRecordQuery } from "./record-queries.js";
import { isSummaryRequest } from "./summary-queries.js";
import { formatJerusalemTime } from "./time.js";
import { scheduleQueryDayOffset, isWeeklyScheduleQuery } from "./schedule-queries.js";
import { isReminderMenuScope, reminderMenuRecords, reminderButtonLabel } from "./reminder-menu-records.js";
import { isShoppingList, shoppingItemLabel, listItemLabel } from "./shopping-emoji.js";
import { visualItemLabel, listHeading } from "./list-presentation.js";

const token = value => createHash("sha256").update(value).digest("base64url").slice(0, 22);
export const escapeMenuHtml = value => String(value).replace(/[&<>]/gu,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
const listKey = (chatId, name) => `l${token(JSON.stringify([chatId, name]))}`;
const itemKey = (chatId, name, item) => `l${token(JSON.stringify([chatId, name, item.id ?? item.text]))}`;
const reminderKey = (chatId, item) => `r${token(JSON.stringify([chatId, item.id]))}`;
const shortLabel = text => {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  return characters.length > 55 ? `${characters.slice(0, 54).join("")}…` : characters.join("");
};
const button = (text, data) => ({ text, callback_data: data, style: "success" });
export const pageData = (scope, mode = "c", offset = 0) => `v:p:${scope}:${mode}:${offset}`;

function isOngoingListItem(name, item) {
  // Presentation hints only; these never establish a scheduled recurrence.
  return /^(?:רשימת\s+)?(?:(?:מטרות|משימות|יעדים)\s+)?(?:מתמשכות|קבועות|חוזרות)(?:\s+שלי)?$/u.test(name)
    || /^\s*🔄/u.test(item.text);
}

export function menuRecords(store, chatId, scope) {
  if (isReminderMenuScope(scope)) return reminderMenuRecords(store, chatId, scope)
    .map(record => ({ ...record, key: reminderKey(chatId, record) }));
  const lists = store.lists[chatId] ?? {};
  if (scope === "a") return Object.entries(lists).map(([name, items]) => ({
    key: listKey(chatId, name), kind: "list", name, text: name, count: items.filter(item => !item.checked).length,
  }));
  const namedList = Object.keys(lists).find(name => listKey(chatId, name) === scope);
  if (scope !== "s" && !namedList) return null;
  const records = Object.entries(lists).filter(([name]) => scope === "s" || name === namedList)
    .flatMap(([name, items]) => items.map(item => ({
      key: itemKey(chatId, name, item), kind: "item", id: item.id, name, text: item.text,
      checked: item.checked, ongoing: isOngoingListItem(name, item),
    })));
  if (scope === "s") {
    for (const item of store.reminders.filter(reminder => reminder.chatId === chatId)) {
      const weekly = (store.savedSchedules ?? []).some(schedule =>
        schedule.chatId === chatId && schedule.entries?.some(entry => entry.reminderId === item.id));
      records.push({
        key: reminderKey(chatId, item), kind: "reminder", id: item.id, text: item.text,
        ongoing: weekly || Number(item.repeatEveryMs) > 0,
        dueAt: item.dueAt, sentAt: item.sentAt ?? null,
        checked: Boolean(item.sentAt && item.telegramDeliveries?.[item.dueAt.toString(36)]?.state === "done"),
      });
    }
  }
  // Sort the new display array only, never the saved list or reminder queue.
  return records.sort((left, right) => Number(right.ongoing) - Number(left.ongoing));
}

export function renderRecordMenu(store, chatId, scope, mode = "c", offset = 0, titleOverride,
  { includeReminderIds = [] } = {}) {
  const allRecords = menuRecords(store, chatId, scope);
  if (!allRecords) return null;
  // Retain completed records for history, detail lookup and idempotent old
  // buttons, but never paginate or count them in an open-record menu.
  const records = allRecords.filter(record => !record.checked);
  const names = Object.keys(store.lists[chatId] ?? {});
  const name = names.find(value => listKey(chatId, value) === scope);
  const shopping = isShoppingList(name);
  const reminders = isReminderMenuScope(scope);
  const title = titleOverride ?? (reminders
    ? `🟨 רשימת התזכורות שלך${scope === "n" ? " למחר" : scope === "t" ? " להיום" : ""}`
    : scope === "s" ? "📊 הסיכום והמטרות שלך"
    : scope === "a" ? "🗂️ הרשימות שלך" : listHeading(name));
  const limit = mode === "a" ? 20 : reminders ? 6 : 5;
  const start = Math.min(offset, Math.max(0, Math.floor((records.length - 1) / limit) * limit));
  let visible = records.slice(start, start + limit);
  if (isReminderMenuScope(scope) && mode === "c" && includeReminderIds.length) {
    const highlighted = records.filter(record => includeReminderIds.includes(record.id)).slice(-limit);
    visible = [...visible.filter(record => !highlighted.some(item => item.id === record.id))
      .slice(0, limit - highlighted.length), ...highlighted];
  }
  const lines = records.map(record => record.kind === "list"
    ? `${record.name} (${record.count})`
    : reminders ? reminderButtonLabel(record).replace(/[🔄👆☝️]/gu, "").trim()
    : record.kind === "item" ? visualItemLabel(record.name, record.text) : record.text);
  const rows = visible.map(record => [record.kind === "list"
    ? button(`🗂️ ${shortLabel(record.name)} (${record.count})`, pageData(record.key))
    : button(reminders ? reminderButtonLabel(record)
      : shopping ? shortLabel(shoppingItemLabel(record.text))
      : `${record.ongoing ? "🔄" : "☝️"} ${record.checked ? "✅ " : ""}${shortLabel(record.text)}`,
      `v:i:${record.key}:${scope}:${mode}:${start}`)]);
  if (mode === "c" && records.length > limit) rows.push([
    button(reminders ? `הצג הכל (${records.length} פריטים) ${records.some(record => !record.ongoing) ? "👆" : "🔄"}`
      : `☝️ הצג הכל (${records.length} פריטים)`, pageData(scope, "a")),
  ]);
  if (reminders && records.length && records.every(record => record.ongoing)) {
    rows.push([button("אין תזכורות חד־פעמיות 👆", pageData(scope, mode, start))]);
  }
  if (mode === "a") {
    const navigation = [];
    if (start > 0) navigation.push(button("⬅️ הקודם", pageData(scope, "a", Math.max(0, start - limit))));
    if (start + limit < records.length) navigation.push(button("הבא ➡️", pageData(scope, "a", start + limit)));
    if (navigation.length) rows.push(navigation);
    rows.push([button("↩️ תצוגה קצרה", pageData(scope))]);
  }
  if (name) rows.push([button("🗂️ כל הרשימות", pageData("a"))]);
  return {
    text: `<b>${escapeMenuHtml(title)}</b>\n${lines.length
      ? lines.map(line => `• ${escapeMenuHtml(line)}`).join("\n") : "הרשימה ריקה."}`,
    options: { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } },
  };
}

export function recordMenuForList(store, chatId, listName, mode = "c") {
  return Object.hasOwn(store.lists[chatId] ?? {}, listName)
    ? renderRecordMenu(store, chatId, listKey(chatId, listName), mode)
    : renderRecordMenu(store, chatId, "a");
}

export function recordMenuForRequest(store, chatId, text) {
  if (isWeeklyScheduleQuery(text)) return null;
  if (isSummaryRequest(text)) return {
    ...renderRecordMenu(store, chatId, "s", "c", 0,
      /השבוע|שבוע/u.test(text) ? "📊 סיכום השבוע והמטרות שלך" : "📊 הסיכום והמטרות שלך"),
    keepResponse: true,
  };
  const request = parseRecordQuery(text);
  const dayOffset = scheduleQueryDayOffset(text);
  if (dayOffset !== null) return {
    ...renderRecordMenu(store, chatId, dayOffset === 1 ? "n" : "t"),
    keepResponse: true,
  };
  if (request?.type === "list-reminders" || /^\/reminders(?:@[a-z0-9_]+)?[?!.]*$/iu.test(text.trim())) {
    return renderRecordMenu(store, chatId, "r");
  }
  const command = /^\/show(?:@[a-z0-9_]+)?\s+(.+)$/iu.exec(text.trim());
  const requested = request?.type === "show-list" ? request.name : command?.[1];
  if (requested) {
    const names = Object.keys(store.lists[chatId] ?? {});
    const normalized = requested.replace(/^ה(?=קניות|משימות)/u, "");
    const name = names.find(value => value === requested || value === normalized);
    return name ? renderRecordMenu(store, chatId, listKey(chatId, name)) : null;
  }
  if (/^\/lists(?:@[a-z0-9_]+)?$/iu.test(text.trim())
    || /^(?:מה\s+(?:הן\s+)?|(?:הצג|תציג|תראה)\s+(?:לי\s+)?(?:את\s+)?)?(?:ה)?רשימות(?:\s+שלי)?[?!.]*$/u.test(text.trim())) {
    return renderRecordMenu(store, chatId, "a");
  }
  return null;
}

export function renderRecordDetails(store, chatId, key, scope, mode, offset) {
  const record = menuRecords(store, chatId, scope)?.find(item => item.key === key);
  if (!record || record.kind === "list") return null;
  const classification = isReminderMenuScope(scope)
    ? record.ongoing ? "🔄 תזכורת חוזרת" : "☝️ תזכורת חד־פעמית"
    : record.ongoing ? "🔄 מטרה מתמשכת" : "☝️ פריט חד־פעמי";
  const reminder = record.kind === "reminder"
    ? store.reminders.find(item => item.id === record.id && item.chatId === chatId) : null;
  const openOccurrence = reminder ? Object.entries(reminder.telegramDeliveries ?? {})
    .filter(([, receipt]) => ["sent", "pending"].includes(receipt.state))
    .sort(([left], [right]) => parseInt(right, 36) - parseInt(left, 36))[0] : null;
  const completionDueAt = reminder ? openOccurrence ? parseInt(openOccurrence[0], 36) : reminder.dueAt : null;
  const completed = record.kind === "item" ? record.checked
    : reminder?.telegramDeliveries?.[completionDueAt.toString(36)]?.state === "done";
  const details = record.kind === "item"
    ? `רשימה: ${escapeMenuHtml(record.name)}\nמצב: ${record.checked ? "בוצע" : "פתוח"}`
    : `מועד שמור: ${escapeMenuHtml(formatJerusalemTime(completionDueAt))}\nמצב התזכורת: ${completed ? "בוצע ✅" : openOccurrence || record.sentAt ? "נשלחה" : "ממתינה לשליחה"}`;
  return {
    completionDueAt,
    text: `<b>${escapeMenuHtml(listItemLabel(record.name, record.text))}</b>${completed ? " — בוצע" : ""}`,
    options: { parse_mode: "HTML", reply_markup: { inline_keyboard: [
      ...(completed ? [] : [[button("✅ בוצע", `v:d:${key}:${scope}:${mode}:${offset}${reminder ? `:${completionDueAt.toString(36)}` : ""}`)]]),
      [button("🗑️ מחק", `v:x:${key}:${scope}:${mode}:${offset}`)],
      [button("↩️ חזרה לרשימה", pageData(scope, mode, offset))],
    ] } },
  };
}
