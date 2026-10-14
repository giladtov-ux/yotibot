import { randomBytes } from "node:crypto";
import { saveStore } from "./store.js";
import { loadDailySummaryStore } from "./daily-summary-repository.js";
import { isDailySummaryRequest, formatTelegramDailySummary } from "./daily-summary.js";
import { parseNaturalTaskAction, bindItemIntent, fuzzyCompletionCandidates } from "./task-understanding.js";
import { completeRecord } from "./record-completion.js";
import { menuRecords } from "./record-menu.js";
import { isShoppingList } from "./shopping-emoji.js";
import { updateShoppingStatus } from "./shopping-lifecycle.js";
import { getJerusalemDateString, shiftJerusalemDate, parseJerusalemDateTime } from "./time.js";

const nonce = () => randomBytes(16).toString("base64url");
const taskList = name => /משימ|מטר|היום/u.test(name) && !isShoppingList(name);
const bareDone = text => text.trim() === "✅"
  || /^(?:בוצע|סיימתי|הושלם)$/u.test(text.trim().replace(/[.!✅\s]+$/u, ""));
const shoppingDone = text => /^(?:(?:ה?קניות|רשימת ה?קניות)\s+(?:בוצע|בוצעו|הושלמו|סיימתי)|סיימתי\s+(?:את\s+)?ה?קניות)[.!✅\s]*$/u.test(text.trim());
export class DailyRecapReadError extends Error {}
async function readCommitted(options, chatId, time) {
  try { return await options.readSnapshot(chatId, undefined, time); }
  catch (cause) { throw new DailyRecapReadError("Could not read the recap snapshot.", { cause }); }
}
async function continueAfterCommit(store, chatId, options, receipt) {
  try { return [{ text: receipt }, ...await progress(store, chatId, options)]; }
  catch {
    // The task commit succeeded. Never describe it as a failed mutation merely
    // because the following read/session update failed.
    return [{ text: receipt }, { text: "הפעולה נשמרה, אך לא הצלחתי לטעון את המשך הסיכום. אפשר לבקש סיכום יום שוב." }];
  }
}
function conciseSummary(snapshot, chatId, time) {
  const full = formatTelegramDailySummary(snapshot, chatId, time);
  const names = snapshot.completedTasks.slice(0, 3).map(item =>
    item.text.length > 120 ? `${item.text.slice(0, 117)}…` : item.text);
  const today = names.length ? names.join("; ") + (snapshot.completedTasks.length > 3
    ? `; ועוד ${snapshot.completedTasks.length - 3} משימות שהושלמו.` : "")
    : "לא סומנו משימות שהושלמו היום.";
  const deferred = (snapshot.deferredTomorrowTasks ?? []).map(item => `ללא שעה — ${item.text}`);
  return `היום:\n${today}\n\nמחר${full.split("\n\nמחר").slice(1).join("\n\nמחר")}${deferred.length ? `\n${deferred.join("\n")}` : ""}`;
}

async function commit(store, candidate, persist, verifyList) {
  await persist(candidate, { verifyList });
  for (const field of ["lists", "dailyRecaps", "recordViews", "listStatuses", "listConfirmations"]) {
    if (candidate[field]) store[field] = candidate[field];
  }
}

async function progress(store, chatId, { persist, readSnapshot, now, includeToday = false }) {
  const time = now();
  const snapshot = await readCommitted({ readSnapshot }, chatId, time);
  const text = conciseSummary(snapshot, chatId, time);
  const next = snapshot.openTasks?.[0];
  const session = { date: getJerusalemDateString(new Date(time)), nonce: nonce(),
    phase: next ? "review" : "finish",
    ...(next ? { listName: next.listName, itemId: next.item.id } : {}) };
  const recordViews = { ...store.recordViews };
  delete recordViews[chatId];
  const candidate = { ...store, recordViews, dailyRecaps: { ...store.dailyRecaps, [chatId]: session } };
  await commit(store, candidate, persist);
  if (!next) return [{ text, options: { reply_markup: { inline_keyboard: [[{
    text: "בוצע! ✅", callback_data: `rc:${session.nonce}:f`,
  }]] } } }];
  return [{ text: `${includeToday ? `${text.split("\n\nמחר")[0]}\n\n` : ""}נותר להיום:\n${next.item.text}`,
    options: { reply_markup: { inline_keyboard: [[
      { text: "בוצע! ✅", callback_data: `rc:${session.nonce}:d` },
      { text: "דחה למחר 📅", callback_data: `rc:${session.nonce}:p` },
      { text: "בטל משימה ❌", callback_data: `rc:${session.nonce}:x` },
    ]] } } }];
}

async function applyChoice(store, chatId, session, action, options) {
  const { persist, readSnapshot, now } = options;
  const time = now();
  const snapshot = await readCommitted(options, chatId, time);
  const candidate = structuredClone(store);
  // Consume the button in the same commit as its mutation, including on restart.
  candidate.dailyRecaps[chatId] = { ...session, nonce: nonce(), phase: "advancing" };
  if (action === "f") {
    if (session.phase !== "finish") return null;
    if (snapshot.openTasks?.length) return progress(store, chatId, options);
    candidate.dailyRecaps[chatId].phase = "done";
    await commit(store, candidate, persist);
    const tomorrow = shiftJerusalemDate(session.date, 1);
    const summary = formatTelegramDailySummary(snapshot, chatId, time);
    const agenda = summary.split("\n\nמחר")[1]?.split("\n").slice(1) ?? [];
    const first = agenda.find(line => /^\d{2}:\d{2} /u.test(line));
    const firstTask = Object.entries(store.lists[chatId] ?? {}).filter(([name]) => taskList(name))
      .flatMap(([, items]) => items).find(item => !item.checked
        && (item.scheduledDate === tomorrow || Number.isFinite(item.dueAt)
          && getJerusalemDateString(new Date(item.dueAt)) === tomorrow));
    return [{ text: `אלוף! ממשיכים בקצב שלך${first ? `\nהראשונה למחר: ${first}`
      : firstTask ? `\nהראשונה למחר: ${firstTask.text}` : "\nלא נשמרה משימה או השכמה למחר."}` }];
  }
  if (session.phase !== "review") return null;
  const current = snapshot.openTasks?.find(row => row.listName === session.listName && row.item.id === session.itemId);
  const items = candidate.lists[chatId]?.[session.listName];
  const item = items?.find(value => value.id === session.itemId && !value.checked);
  if (!current || !item) return progress(store, chatId, options);
  let receipt;
  if (action === "d") {
    item.checked = true;
    item.completedAt = time;
    receipt = `אלוף! סימנתי שביצעת: ${item.text} ✅`;
  } else if (action === "p") {
    item.scheduledDate = shiftJerusalemDate(session.date, 1);
    if (Number.isFinite(item.dueAt)) {
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(item.dueAt));
      item.dueAt = parseJerusalemDateTime(item.scheduledDate, clock, { allowPast: true });
    }
    receipt = `נדחה למחר: ${item.text} 📅`;
  } else if (action === "x") {
    candidate.lists[chatId][session.listName] = items.filter(value => value.id !== item.id);
    receipt = `המשימה בוטלה: ${item.text}`;
  } else return null;
  delete candidate.recordViews[chatId];
  await commit(store, candidate, persist, { chatId, listName: session.listName });
  return continueAfterCommit(store, chatId, options, receipt);
}

export async function handleDailyRecapMessage(store, chatId, text, {
  persist = saveStore, readSnapshot = loadDailySummaryStore, now = Date.now,
} = {}) {
  const options = { persist, readSnapshot, now };
  const session = store.dailyRecaps?.[chatId];
  const active = session && session.date === getJerusalemDateString(new Date(now()))
    && ["review", "finish"].includes(session.phase);
  if (isDailySummaryRequest(text)) return progress(store, chatId, { ...options, includeToday: true });
  if (active && bareDone(text) && !store.recordViews?.[chatId]) {
    return applyChoice(store, chatId, session, session.phase === "finish" ? "f" : "d", options);
  }
  if (shoppingDone(text) && Object.keys(store.lists[chatId] ?? {}).some(isShoppingList)) {
    const names = Object.keys(store.lists[chatId] ?? {}).filter(isShoppingList);
    const viewed = menuRecords(store, chatId, "s").find(row => row.key === store.recordViews?.[chatId]?.key)?.name;
    const recent = store.lastListActions?.[chatId]?.listName;
    const name = names.includes(viewed) ? viewed : names.includes(recent) ? recent
      : names.find(value => /^(?:רשימת )?ה?קניות(?: להיום)?$/u.test(value)) ?? (names.length === 1 ? names[0] : null);
    if (!name) return [{ text: names.length ? "איזו רשימת קניות סיימת?" : "אין כרגע רשימת קניות פתוחה." }];
    if (store.listStatuses?.[chatId]?.[name]?.status === "completed"
      && store.lists[chatId][name].every(item => item.checked)) {
      return [{ text: "הקניות כבר סגורות ✅" }, ...(active ? await progress(store, chatId, options) : [])];
    }
    const candidate = structuredClone(store);
    const time = now();
    candidate.lists[chatId][name] = candidate.lists[chatId][name].map(item =>
      item.checked ? item : { ...item, checked: true, completedAt: time });
    // Also close an existing shopping task, without inventing a new task.
    for (const [listName, items] of Object.entries(candidate.lists[chatId])) {
      if (taskList(listName)) for (const item of items) {
        if (!item.checked && /^(?:לעשות |לבצע )?קניות$/u.test(item.text.trim())) {
          item.checked = true; item.completedAt = time;
        }
      }
    }
    candidate.listStatuses ??= {};
    candidate.listStatuses[chatId] = { ...candidate.listStatuses[chatId],
      [name]: { status: "completed", archivedAt: time } };
    updateShoppingStatus(candidate, chatId, name, time);
    delete candidate.recordViews[chatId];
    await commit(store, candidate, persist, { chatId, listName: name });
    return active ? continueAfterCommit(store, chatId, options, "הקניות הושלמו והרשימה נסגרה ✅")
      : [{ text: "הקניות הושלמו והרשימה נסגרה ✅" }];
  }
  const intent = parseNaturalTaskAction(text);
  if (intent?.type === "mark-item") {
    const snapshot = await readCommitted(options, chatId, now());
    const lists = {};
    for (const row of snapshot.openTasks ?? []) (lists[row.listName] ??= []).push(row.item);
    const bound = bindItemIntent({ ...store, lists: { ...store.lists, [chatId]: lists } }, chatId, intent, text);
    if (bound.type && taskList(bound.listName)) {
      const record = menuRecords(store, chatId, "s").find(row => row.kind === "item"
        && row.name === bound.listName && row.id === bound.itemId);
      await completeRecord(store, chatId, record, {}, { persist, now });
      const receipt = `אלוף! סימנתי שביצעת: ${record.text} ✅`;
      return active ? continueAfterCommit(store, chatId, options, receipt) : [{ text: receipt }];
    }
    const exactDone = snapshot.completedTasks.filter(item => item.text.trim() === intent.itemText.trim());
    const done = exactDone.length ? exactDone : fuzzyCompletionCandidates(
      snapshot.completedTasks.map(item => ({ item })), intent.itemText).map(hit => hit.item);
    if (done.length) return [{ text: `כבר סומן כבוצע: ${done[0].text} ✅` },
      ...(active ? await progress(store, chatId, options) : [])];
  }
  if (active) {
    const candidate = { ...store, dailyRecaps: { ...store.dailyRecaps } };
    delete candidate.dailyRecaps[chatId];
    await commit(store, candidate, persist);
  }
  return null;
}

export async function handleDailyRecapCallback(store, telegram, query, {
  ownerChatId, persist = saveStore, readSnapshot = loadDailySummaryStore,
  now = Date.now, assertActive = () => {}, assertPermission = async () => {},
} = {}) {
  const match = /^rc:([A-Za-z0-9_-]{22}):([dpxf])$/u.exec(query.data ?? "");
  if (!match) return { ignored: true };
  const answer = text => telegram.call("answerCallbackQuery", { callback_query_id: query.id, ...(text ? { text } : {}) });
  if (String(query.from?.id) !== ownerChatId || String(query.message?.chat?.id) !== ownerChatId
    || query.from?.is_bot || query.message?.chat?.type !== "private") {
    await answer("הכפתור שייך לחשבון אחר."); return { ignored: true };
  }
  await assertPermission(); assertActive();
  const session = store.dailyRecaps?.[ownerChatId];
  if (!session || session.nonce !== match[1] || session.date !== getJerusalemDateString(new Date(now()))
    || session.phase === "done") {
    await answer("הכפתור כבר טופל או פג. אפשר לבקש סיכום יום חדש."); return { stale: true };
  }
  const messages = await applyChoice(store, ownerChatId, session, match[2], { persist, readSnapshot, now });
  await answer();
  for (const message of messages ?? []) {
    await assertPermission(); assertActive();
    await telegram.sendMessage(ownerChatId, message.text, message.options);
  }
  return { delivered: true };
}
