import { createHash } from "node:crypto";
import { getLastListAction, saveStore } from "./store.js";
import { parseListDeletion } from "./list-deletion.js";
import { recordMenuForRequest } from "./record-menu.js";

const yes = /^כן(?:[, ]+(?:בבקשה|תנקה|נקה))?[.! ]*$/u;
const no = /^לא(?:[, ]+תודה)?[.! ]*$/u;
const asksConfirmation = text => /סגור\s*[?？]|(?:כן\s+או\s+לא|מאשר\s*[?？]|לאשר\s*[?？])/u.test(text);
export { asksConfirmation as isListConfirmationQuestion };
const keyFor = (request, response) => createHash("sha256").update(JSON.stringify([request, response]))
  .digest("base64url").slice(0, 22);
const content = row => row?.content ?? row?.text ?? "";

// A model question may identify an unanswered turn, never supply its target.
// Only the user's own cleanup request and this user's saved lists authorize it.
export function listClearTarget(store, chatId, request) {
  const text = request.trim().replace(/[?!.]+$/u, "").trim();
  const parsed = parseListDeletion(text);
  let target = parsed?.type === "clear-list" ? parsed.listName : null;
  if (!parsed) {
    const match = /^(?:(?:אחי|אח שלי)[, ]+)?(?:(?:בבקשה|אפשר|אני רוצה|אני רוצה שתנקה)\s+)?(?:לנקות|לרוקן|תנקה|נקה|תרוקן|רוקן)\s+(?:לי\s+)?(?:את\s+)?(.+)$/u.exec(text);
    if (match) target = match[1].replace(/^(?:כל\s+)?ה?פריטים\s+(?:מ|ב)/u, "")
      .replace(/^(?:רשימת|רשימה|הרשימה)\s+/u, "");
  }
  if (!target) return null;
  const names = Object.keys(store.lists[chatId] ?? {});
  target = target.replace(/\s+שלי$/u, "").trim();
  if (/^(?:אותה|הרשימה)$/u.test(target)) {
    const selected = getLastListAction(store, chatId)?.listName;
    return names.includes(selected) ? selected : null;
  }
  return names.find(name => name === target || `ה${name}` === target) ?? null;
}

function historyQuestion(store, chatId, history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const reply = history.at(-1), request = history.at(-2);
  if (reply?.role !== "assistant" || request?.role !== "user"
    || !asksConfirmation(content(reply))) return null;
  const listName = listClearTarget(store, chatId, content(request));
  return listName ? { listName, historyKey: keyFor(content(request), content(reply)), awaiting: true } : null;
}

export async function resolveListConfirmation(store, chatId, text, {
  history, persist = saveStore,
} = {}) {
  const request = text.trim();
  let pending = store.listConfirmations?.[chatId];
  const recovered = historyQuestion(store, chatId, history);
  // Recover only the immediately preceding validated user/question pair.
  // A persisted receipt prevents recovery after cancellation or a failed
  // conversation-history write following a successful database mutation.
  if (!pending?.awaiting && recovered && recovered.historyKey !== pending?.historyKey) pending = recovered;
  if (!pending?.awaiting) return null;
  const listConfirmations = Object.assign(Object.create(null), store.listConfirmations, {
    [chatId]: { ...pending, awaiting: false },
  });
  const candidate = { ...store, listConfirmations };
  if (!yes.test(request) && !no.test(request)) {
    await persist(candidate);
    store.listConfirmations = listConfirmations;
    return null; // Topic switch: process this same message normally.
  }
  if (no.test(request)) {
    await persist(candidate);
    store.listConfirmations = listConfirmations;
    return { text: "סגור, לא ניקיתי את הרשימה." };
  }
  const items = store.lists[chatId]?.[pending.listName];
  if (!items) {
    await persist(candidate);
    store.listConfirmations = listConfirmations;
    return { text: "הרשימה הזו כבר לא קיימת. לא שיניתי דבר." };
  }
  candidate.lists = Object.assign(Object.create(null), store.lists, {
    [chatId]: Object.assign(Object.create(null), store.lists[chatId], { [pending.listName]: [] }),
  });
  // Clear the actual list and consume its permission in the SAME transaction.
  await persist(candidate, { verifyList: { chatId, listName: pending.listName } });
  store.lists = candidate.lists;
  store.listConfirmations = listConfirmations;
  return {
    text: `רשימת “${pending.listName}” נוקתה.`,
    menu: recordMenuForRequest(store, chatId, `/show ${pending.listName}`),
  };
}

export async function rememberListConfirmation(store, chatId, text, response, { persist = saveStore } = {}) {
  if (!asksConfirmation(response)) return response;
  const listName = listClearTarget(store, chatId, text);
  if (!listName) return response;
  if (!store.lists[chatId][listName].length) return `רשימת “${listName}” כבר ריקה.`;
  const question = `לנקות את כל הפריטים ברשימת “${listName}”? ענה כן או לא.`;
  const listConfirmations = Object.assign(Object.create(null), store.listConfirmations, {
    [chatId]: { listName, awaiting: true, historyKey: keyFor(text, question) },
  });
  await persist({ ...store, listConfirmations });
  store.listConfirmations = listConfirmations;
  return question;
}

// Keep the archive intact; remove obsolete cleanup questions from the active
// AI context, not from stored history or from summary evidence.
export function activeConfirmationHistory(store, chatId, history, currentText) {
  if (!Array.isArray(history)) return history;
  const discard = new Set();
  for (let index = 1; index < history.length; index++) {
    const reply = history[index], request = history[index - 1];
    if (reply.role !== "assistant" || request.role !== "user" || !asksConfirmation(content(reply))
      || !listClearTarget(store, chatId, content(request))) continue;
    const state = store.listConfirmations?.[chatId];
    const next = history[index + 1];
    const nextText = next?.role === "user" ? content(next) : index === history.length - 1 ? currentText : null;
    const closed = state?.historyKey === keyFor(content(request), content(reply)) && !state.awaiting;
    if (closed || (nextText !== null && !yes.test(nextText.trim()) && !no.test(nextText.trim()))) {
      discard.add(index - 1);
      discard.add(index);
    }
  }
  return history.filter((_, index) => !discard.has(index));
}
